import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar, type Conexion } from "../datos/base";
import { RepositorioLocal, type OperacionPendiente } from "../datos/repositorio";
import {
  MotorSincronizacion,
  INTENTOS_MAXIMOS,
  type ClienteSincronizacion,
  type ResultadoEnvio,
} from "../datos/sincronizacion";
import { ClienteHttp } from "../datos/clienteHttp";

/**
 * Motor de sincronización.
 *
 * La prueba que justifica todo el diseño está en "una jornada sin señal":
 * veinte operaciones acumuladas, reconexión, y ni una duplicada.
 */

let db: Conexion;
let repo: RepositorioLocal;
let reloj = new Date("2026-09-17T08:00:00.000Z");

const ordenBase = {
  id: "ord-1",
  sedeId: "sede-fun",
  clienteId: "cli-1",
  sedeClienteId: "sc-1",
  vehiculoId: "veh-1",
  tecnicoId: "u-tec1",
  configuracionEjeId: "cfg-1",
  tipo: "preventivo",
  estado: "en_proceso",
  fecha: "2026-09-17",
};

/**
 * Servidor simulado que registra lo recibido. No es un doble perezoso:
 * implementa la idempotencia de verdad, para que la prueba de duplicados
 * signifique algo.
 */
class ServidorSimulado implements ClienteSincronizacion {
  public recibidas: OperacionPendiente[] = [];
  private aplicadas = new Set<string>();

  public sinRed = false;
  public respuestaForzada: Map<string, ResultadoEnvio> = new Map();
  /** Se cae después de N envíos, para simular pérdida de señal a mitad. */
  public caerTras: number | null = null;

  async enviar(op: OperacionPendiente): Promise<ResultadoEnvio> {
    if (this.sinRed) return { tipo: "sin_conexion", mensaje: "sin red" };
    if (this.caerTras !== null && this.recibidas.length >= this.caerTras) {
      return { tipo: "sin_conexion", mensaje: "se cayó la señal" };
    }

    const forzada = this.respuestaForzada.get(op.tipo);
    if (forzada) return forzada;

    this.recibidas.push(op);

    // Idempotencia real: la misma operación dos veces no se aplica dos veces.
    if (this.aplicadas.has(op.id)) {
      return { tipo: "duplicada", folio: "OS-FUN-000001" };
    }
    this.aplicadas.add(op.id);
    return { tipo: "aplicada", folio: op.tipo === "crear_orden" ? "OS-FUN-000001" : null };
  }

  get aplicadasUnicas(): number {
    return this.aplicadas.size;
  }
}

let servidor: ServidorSimulado;
let motor: MotorSincronizacion;

beforeEach(async () => {
  reloj = new Date("2026-09-17T08:00:00.000Z");
  db = await abrirBaseEnMemoria();
  await migrar(db);
  repo = new RepositorioLocal(db, () => reloj);
  servidor = new ServidorSimulado();
  motor = new MotorSincronizacion(repo, servidor);
});

afterEach(async () => {
  await db.cerrar();
});

/** Avanza el reloj para que las esperas de reintento venzan. */
function avanzarHoras(horas: number) {
  reloj = new Date(reloj.getTime() + horas * 3600_000);
}

describe("una jornada sin señal", () => {
  it("veinte operaciones acumuladas se envían sin duplicar nada", async () => {
    // El escenario real: el técnico trabaja toda la mañana en Fundación sin
    // cobertura y al volver a la vía se envía todo de golpe.
    servidor.sinRed = true;

    await repo.guardarOrden(ordenBase);
    for (let posicion = 1; posicion <= 19; posicion++) {
      await repo.guardarMedicion({ ordenId: "ord-1", posicion, capturadoPorId: "u-tec1" });
    }
    expect(await repo.contarPendientes()).toBe(20);

    // Se intenta sin red: no se pierde nada
    const sinRed = await motor.sincronizar();
    expect(sinRed.aplicadas).toBe(0);
    expect(sinRed.interrumpida).toBe(true);
    expect(await repo.contarPendientes()).toBe(20);

    // Vuelve la señal
    servidor.sinRed = false;
    avanzarHoras(1);
    const conRed = await motor.sincronizar();

    expect(conRed.aplicadas).toBe(20);
    expect(conRed.pendientes).toBe(0);
    expect(servidor.aplicadasUnicas).toBe(20);
  });

  it("no se pierde nada si la señal se corta a mitad del envío", async () => {
    servidor.sinRed = true;
    await repo.guardarOrden(ordenBase);
    for (let posicion = 1; posicion <= 9; posicion++) {
      await repo.guardarMedicion({ ordenId: "ord-1", posicion, capturadoPorId: "u-tec1" });
    }

    // Vuelve la red pero se cae tras cinco envíos
    servidor.sinRed = false;
    servidor.caerTras = 5;
    const primera = await motor.sincronizar();
    expect(primera.aplicadas).toBe(5);
    expect(primera.interrumpida).toBe(true);
    expect(await repo.contarPendientes()).toBe(5);

    // Al recuperar, se envía el resto
    servidor.caerTras = null;
    avanzarHoras(1);
    const segunda = await motor.sincronizar();
    expect(segunda.aplicadas).toBe(5);
    expect(await repo.contarPendientes()).toBe(0);
  });

  it("reenviar la misma operación no la aplica dos veces", async () => {
    // Pasa de verdad: la petición llega, el servidor responde y la respuesta
    // se pierde en el camino.
    await repo.guardarOrden(ordenBase);
    const [op] = await repo.operacionesPendientes();

    await servidor.enviar(op as OperacionPendiente);
    const r = await servidor.enviar(op as OperacionPendiente);

    expect(r.tipo).toBe("duplicada");
    expect(servidor.aplicadasUnicas).toBe(1);
  });

  it("una operación duplicada se saca de la cola igual", async () => {
    // Duplicada no es un error: significa que el envío anterior sí llegó.
    await repo.guardarOrden(ordenBase);
    servidor.respuestaForzada.set("crear_orden", { tipo: "duplicada", folio: "OS-FUN-000007" });

    const r = await motor.sincronizar();
    expect(r.duplicadas).toBe(1);
    expect(r.pendientes).toBe(0);
    expect((await repo.buscarOrden("ord-1"))?.folio).toBe("OS-FUN-000007");
  });
});

describe("orden de envío", () => {
  it("la orden se crea antes que sus mediciones", async () => {
    await repo.guardarOrden(ordenBase);
    reloj = new Date("2026-09-17T08:05:00.000Z");
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });

    await motor.sincronizar();
    expect(servidor.recibidas[0]?.tipo).toBe("crear_orden");
    expect(servidor.recibidas[1]?.tipo).toBe("guardar_medicion");
  });

  it("si la creación falla, sus mediciones no se envían", async () => {
    // Enviar una medición de una orden que el servidor no tiene solo gasta
    // un intento y produce un rechazo.
    await repo.guardarOrden(ordenBase);
    reloj = new Date("2026-09-17T08:05:00.000Z");
    for (const posicion of [1, 2, 3]) {
      await repo.guardarMedicion({ ordenId: "ord-1", posicion, capturadoPorId: "u-tec1" });
    }

    servidor.respuestaForzada.set("crear_orden", {
      tipo: "rechazada",
      mensaje: "El vehículo no existe",
    });

    const r = await motor.sincronizar();
    expect(r.rechazadas).toBe(1);
    // Las tres mediciones siguen en la cola, sin gastar intentos
    expect(servidor.recibidas.filter((o) => o.tipo === "guardar_medicion")).toHaveLength(0);
    expect(await repo.contarPendientes()).toBe(3);
  });
});

describe("manejo de respuestas del servidor", () => {
  beforeEach(async () => {
    await repo.guardarOrden(ordenBase);
  });

  it("un conflicto no se reintenta: se avisa para recargar", async () => {
    // El servidor tiene una versión distinta; reintentar dará lo mismo.
    servidor.respuestaForzada.set("crear_orden", {
      tipo: "conflicto",
      mensaje: "Otra persona modificó la orden",
    });

    const r = await motor.sincronizar();
    expect(r.conflictos).toBe(1);
    expect(r.pendientes).toBe(0);
    expect(r.incidencias[0]?.clase).toBe("conflicto");
    expect(r.incidencias[0]?.mensaje).toContain("modificó");
  });

  it("un rechazo tampoco se reintenta", async () => {
    servidor.respuestaForzada.set("crear_orden", {
      tipo: "rechazada",
      mensaje: "El técnico no pertenece a esa sede",
    });

    const r = await motor.sincronizar();
    expect(r.rechazadas).toBe(1);
    expect(r.pendientes).toBe(0);
    expect(r.incidencias[0]?.clase).toBe("rechazada");
  });

  it("la falta de conexión sí se reintenta", async () => {
    servidor.sinRed = true;
    const r = await motor.sincronizar();
    expect(r.pendientes).toBe(1);
    expect(r.interrumpida).toBe(true);
  });

  it("corta la cola al primer fallo de red", async () => {
    // Si no hay red, las siguientes van a fallar igual y cada intento cuenta
    // para el descarte.
    reloj = new Date("2026-09-17T08:05:00.000Z");
    for (const posicion of [1, 2, 3]) {
      await repo.guardarMedicion({ ordenId: "ord-1", posicion, capturadoPorId: "u-tec1" });
    }
    servidor.sinRed = true;

    const r = await motor.sincronizar();
    expect(r.enviadas).toBe(1);
    expect(await repo.contarPendientes()).toBe(4);
  });

  it("confirma la orden y guarda el folio asignado", async () => {
    await motor.sincronizar();
    const o = await repo.buscarOrden("ord-1");
    expect(o?.sincronizada).toBe(true);
    expect(o?.folio).toBe("OS-FUN-000001");
  });
});

describe("protección contra ejecuciones simultáneas", () => {
  it("no arranca una segunda sincronización mientras corre la primera", async () => {
    // Dos a la vez enviarían lo mismo dos veces: la idempotencia lo
    // absorbería, pero al técnico le costaría el doble de datos móviles.
    await repo.guardarOrden(ordenBase);

    // Promesa diferida: el control de flujo de TypeScript no ve la
    // asignación dentro del ejecutor y reduce la variable a `never`.
    const bloqueo = diferida();
    const lento: ClienteSincronizacion = {
      enviar: async () => {
        await bloqueo.promesa;
        return { tipo: "aplicada", folio: "OS-FUN-000001" };
      },
    };
    const motorLento = new MotorSincronizacion(repo, lento);

    const primera = motorLento.sincronizar();
    await new Promise((r) => setTimeout(r, 10));
    expect(motorLento.ocupado).toBe(true);

    const segunda = await motorLento.sincronizar();
    expect(segunda.enviadas).toBe(0);

    bloqueo.resolver();
    await primera;
    expect(motorLento.ocupado).toBe(false);
  });
});

describe("operaciones atascadas", () => {
  it("no se borran solas tras muchos intentos", async () => {
    // Representan trabajo del técnico: descartarlas en silencio sería perder
    // una jornada sin que nadie se entere.
    await repo.guardarOrden(ordenBase);
    const [op] = await repo.operacionesPendientes();

    for (let i = 0; i < INTENTOS_MAXIMOS; i++) {
      await repo.marcarOperacionFallida(op?.id as string, "sin red");
      avanzarHoras(2);
    }

    const atascadas = await motor.operacionesAtascadas();
    expect(atascadas).toHaveLength(1);
    expect(atascadas[0]?.intentos).toBeGreaterThanOrEqual(INTENTOS_MAXIMOS);
    // Sigue en la cola, no se descartó
    expect(await repo.contarPendientes()).toBe(1);
  });

  it("una operación con pocos intentos no se considera atascada", async () => {
    await repo.guardarOrden(ordenBase);
    const [op] = await repo.operacionesPendientes();
    await repo.marcarOperacionFallida(op?.id as string, "sin red");
    avanzarHoras(2);

    expect(await motor.operacionesAtascadas()).toHaveLength(0);
  });
});

describe("cliente HTTP", () => {
  const op: OperacionPendiente = {
    id: "op-1",
    tipo: "crear_orden",
    recursoId: "ord-1",
    ordenId: "ord-1",
    datos: { vehiculoId: "veh-1" },
    intentos: 0,
    ultimoError: null,
    creadaEn: "2026-09-17T08:00:00.000Z",
  };

  function clienteCon(respuesta: Partial<Response> & { cuerpo?: unknown }) {
    const fetchFalso = vi.fn().mockResolvedValue({
      ok: respuesta.ok ?? false,
      status: respuesta.status ?? 200,
      json: async () => respuesta.cuerpo ?? {},
    } as Response);

    return {
      cliente: new ClienteHttp({
        baseUrl: "https://api.tiretrack.app/v1",
        obtenerToken: async () => "token-valido",
        fetch: fetchFalso as unknown as typeof globalThis.fetch,
      }),
      fetchFalso,
    };
  }

  it("envía el id de la operación como clave de idempotencia", async () => {
    // Es el id de la OPERACIÓN, no del recurso: guardar la misma posición
    // dos veces son dos operaciones y ambas deben aplicarse.
    const { cliente, fetchFalso } = clienteCon({ ok: true, status: 201, cuerpo: { folio: "OS-1" } });
    await cliente.enviar(op);

    const cabeceras = (fetchFalso.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
    expect(cabeceras["Idempotency-Key"]).toBe("op-1");
  });

  it("una respuesta correcta devuelve el folio", async () => {
    const { cliente } = clienteCon({ ok: true, status: 201, cuerpo: { folio: "OS-FUN-000042" } });
    const r = await cliente.enviar(op);
    expect(r.tipo).toBe("aplicada");
    expect(r.tipo === "aplicada" && r.folio).toBe("OS-FUN-000042");
  });

  it("conserva el cuerpo completo de la respuesta", async () => {
    // Al adjuntar una foto trae la URL firmada para subir los bytes;
    // descartarla obligaría a pedirla en otra petición.
    const { cliente } = clienteCon({
      ok: true, status: 201, cuerpo: { fotoId: "f-1", url: "https://subir.test/f-1", expiraEn: 600 },
    });
    const r = await cliente.enviar(op);
    expect(r.tipo === "aplicada" && r.datos?.["url"]).toBe("https://subir.test/f-1");
  });

  it("409 con YA_APLICADA es duplicada, no conflicto", async () => {
    const { cliente } = clienteCon({
      status: 409,
      cuerpo: { error: { codigo: "YA_APLICADA" }, folio: "OS-FUN-000042" },
    });
    const r = await cliente.enviar(op);
    expect(r.tipo).toBe("duplicada");
  });

  it("409 sin ese código es conflicto", async () => {
    const { cliente } = clienteCon({
      status: 409,
      cuerpo: { error: { codigo: "CONFLICTO_VERSION", mensaje: "La orden cambió" } },
    });
    const r = await cliente.enviar(op);
    expect(r.tipo).toBe("conflicto");
  });

  it("400 es rechazo, no falta de conexión", async () => {
    // Confundirlos haría reintentar algo que nunca va a funcionar.
    const { cliente } = clienteCon({
      status: 400,
      cuerpo: { error: { mensaje: "Falta el conductor" } },
    });
    const r = await cliente.enviar(op);
    expect(r.tipo).toBe("rechazada");
    expect(r.tipo === "rechazada" && r.mensaje).toContain("conductor");
  });

  it("500 es falta de conexión: es del servidor, no del dato", async () => {
    const { cliente } = clienteCon({ status: 500 });
    const r = await cliente.enviar(op);
    expect(r.tipo).toBe("sin_conexion");
  });

  it("un fallo de red se reintenta", async () => {
    const cliente = new ClienteHttp({
      baseUrl: "https://api.tiretrack.app/v1",
      obtenerToken: async () => "token",
      fetch: vi.fn().mockRejectedValue(new Error("Network request failed")) as unknown as typeof globalThis.fetch,
    });
    const r = await cliente.enviar(op);
    expect(r.tipo).toBe("sin_conexion");
  });

  it("sin sesión no envía nada y no aparta el trabajo", async () => {
    // Antes era un rechazo: cerrar sesión apartaba todo lo pendiente. La
    // intención —no reintentar sin sesión— se cumple igual: el motor detiene
    // la ronda y espera a que alguien ingrese.
    const fetchFalso = vi.fn();
    const cliente = new ClienteHttp({
      baseUrl: "https://api.tiretrack.app/v1",
      obtenerToken: async () => null,
      fetch: fetchFalso as unknown as typeof globalThis.fetch,
    });
    const r = await cliente.enviar(op);
    expect(r.tipo).toBe("sin_sesion");
    expect(r.tipo === "sin_sesion" && r.mensaje).toContain("sesión");
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("una operación desconocida se rechaza en vez de enviarse", async () => {
    const { cliente } = clienteCon({ ok: true });
    const r = await cliente.enviar({ ...op, tipo: "inventada" as never });
    expect(r.tipo).toBe("rechazada");
  });
});

/** Promesa que se resuelve desde fuera. */
function diferida(): { promesa: Promise<void>; resolver: () => void } {
  let resolver: () => void = () => undefined;
  const promesa = new Promise<void>((r) => {
    resolver = r;
  });
  return { promesa, resolver: () => resolver() };
}

describe("cobertura de tipos de operación", () => {
  it("ningún tipo que el móvil encola se rechaza por desconocido", async () => {
    // Pasó de verdad: crear_marca, crear_diseno y reasignar se agregaron al
    // repositorio sin agregarse al cliente. El cliente los rechazaba y el
    // motor los sacaba de la cola: se perdían en silencio.
    const tipos = [
      "crear_orden", "actualizar_orden", "guardar_medicion", "cambiar_estado",
      "crear_marca", "crear_diseno", "reasignar", "firmar", "subir_foto",
    ] as const;

    const fetchFalso = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({}),
    } as Response);
    const cliente = new ClienteHttp({
      baseUrl: "https://api.test/v1",
      obtenerToken: async () => "t",
      fetch: fetchFalso as unknown as typeof globalThis.fetch,
    });

    for (const tipo of tipos) {
      const r = await cliente.enviar({
        id: `op-${tipo}`, tipo, recursoId: "r-1", ordenId: "ord-1",
        datos: {}, intentos: 0, ultimoError: null, creadaEn: "2026-09-21T00:00:00Z",
      });
      expect(r.tipo, `${tipo} fue rechazado`).toBe("aplicada");
    }
    expect(fetchFalso).toHaveBeenCalledTimes(tipos.length);
  });
});

describe("operaciones rechazadas", () => {
  beforeEach(async () => {
    await repo.guardarOrden(ordenBase);
    reloj = new Date("2026-09-17T08:05:00.000Z");
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, profundidad: 9, capturadoPorId: "u-tec1" });
  });

  it("un rechazo NO borra la operación: la aparta", async () => {
    // Mientras el contrato no esté asentado, un campo mal nombrado da un 400.
    // Borrar la operación borraría la medición del celular.
    servidor.respuestaForzada.set("guardar_medicion", {
      tipo: "rechazada",
      mensaje: "Campo desconocido: profundidadMm",
    });

    await motor.sincronizar();

    const rechazadas = await repo.operacionesRechazadas();
    expect(rechazadas).toHaveLength(1);
    expect(rechazadas[0]?.motivoRechazo).toContain("profundidadMm");
  });

  it("la apartada no cuenta como pendiente de red", async () => {
    // No está esperando señal: está esperando que alguien la revise.
    servidor.respuestaForzada.set("guardar_medicion", { tipo: "rechazada", mensaje: "x" });
    await motor.sincronizar();
    expect(await repo.contarPendientes()).toBe(0);
  });

  it("no se vuelve a enviar sola", async () => {
    servidor.respuestaForzada.set("guardar_medicion", { tipo: "rechazada", mensaje: "x" });
    await motor.sincronizar();
    const enviadasAntes = servidor.recibidas.length;

    servidor.respuestaForzada.clear();
    avanzarHoras(5);
    await motor.sincronizar();
    expect(servidor.recibidas.length).toBe(enviadasAntes);
  });

  it("se puede reintentar tras corregir la causa", async () => {
    // El caso típico: era un desajuste del servidor, se corrigió, y la
    // medición del técnico todavía está.
    servidor.respuestaForzada.set("guardar_medicion", { tipo: "rechazada", mensaje: "x" });
    await motor.sincronizar();
    const [apartada] = await repo.operacionesRechazadas();

    servidor.respuestaForzada.clear();
    await repo.reintentarRechazada(apartada?.id as string);
    const r = await motor.sincronizar();

    expect(r.aplicadas).toBeGreaterThanOrEqual(1);
    expect(await repo.operacionesRechazadas()).toHaveLength(0);
  });

  it("la medición local sigue intacta mientras está apartada", async () => {
    servidor.respuestaForzada.set("guardar_medicion", { tipo: "rechazada", mensaje: "x" });
    await motor.sincronizar();
    const [m] = await repo.medicionesDe("ord-1");
    expect(m?.profundidad).toBe(9);
  });
});

describe("sesión vencida: el trabajo del técnico no se aparta", () => {
  function clienteCon(respuestas: number[], renovar?: () => Promise<boolean>) {
    let i = 0;
    const tokens = ["viejo", "nuevo"];
    let t = 0;
    const fetchFalso = vi.fn().mockImplementation(async () => {
      const status = respuestas[Math.min(i++, respuestas.length - 1)] as number;
      return { ok: status < 300, status, json: async () => ({}) } as Response;
    });
    const cliente = new ClienteHttp({
      baseUrl: "https://api.test/v1",
      obtenerToken: async () => tokens[t] ?? null,
      renovarSesion: renovar
        ? async () => {
            const ok = await renovar();
            if (ok) t = 1;
            return ok;
          }
        : undefined,
      fetch: fetchFalso as unknown as typeof globalThis.fetch,
    });
    return { cliente, fetchFalso };
  }
  const op = {
    id: "op-1", tipo: "guardar_medicion" as const, recursoId: "m-1", ordenId: "ord-1",
    datos: {}, intentos: 0, ultimoError: null, creadaEn: "2026-09-21T00:00:00Z",
  };

  it("ante un 401 renueva la sesión y reintenta", async () => {
    // Los tokens de acceso duran 15 minutos: vencerse es lo normal tras una
    // jornada sin señal, no un rechazo.
    const { cliente, fetchFalso } = clienteCon([401, 200], async () => true);
    const r = await cliente.enviar(op);
    expect(r.tipo).toBe("aplicada");
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("reintenta con el token NUEVO", async () => {
    const { cliente, fetchFalso } = clienteCon([401, 200], async () => true);
    await cliente.enviar(op);
    const segunda = fetchFalso.mock.calls[1]?.[1] as RequestInit;
    expect((segunda.headers as Record<string, string>).Authorization).toBe("Bearer nuevo");
  });

  it("si no se puede renovar, la operación queda esperando, NO apartada", async () => {
    // Antes era un rechazo: todo el trabajo del día quedaba apartado.
    const { cliente } = clienteCon([401], async () => false);
    const r = await cliente.enviar(op);
    expect(r.tipo).toBe("sin_sesion");
  });

  it("renueva una sola vez, no en bucle", async () => {
    const renovar = vi.fn().mockResolvedValue(true);
    const { cliente, fetchFalso } = clienteCon([401, 401], renovar);
    const r = await cliente.enviar(op);
    expect(r.tipo).toBe("sin_sesion");
    expect(renovar).toHaveBeenCalledTimes(1);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("un 403 sí es un rechazo: el usuario no tiene permiso", async () => {
    const { cliente } = clienteCon([403], async () => true);
    expect((await cliente.enviar(op)).tipo).toBe("rechazada");
  });
});

describe("el motor ante una sesión vencida", () => {
  beforeEach(async () => {
    await repo.guardarOrden(ordenBase);
    reloj = new Date("2026-09-17T08:05:00.000Z");
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });
  });

  it("deja todo en la cola y pide ingresar", async () => {
    servidor.respuestaForzada.set("crear_orden", { tipo: "sin_sesion", mensaje: "expiró" });
    const antes = await repo.contarPendientes();
    const r = await motor.sincronizar();
    expect(r.requiereIngreso).toBe(true);
    expect(await repo.contarPendientes()).toBe(antes);
    expect(await repo.operacionesRechazadas()).toHaveLength(0);
  });

  it("no lo cuenta como intento fallido", async () => {
    // Si contara, un técnico que no ingresa en una semana vería su trabajo
    // marcado como atascado sin que nada hubiera fallado.
    servidor.respuestaForzada.set("crear_orden", { tipo: "sin_sesion", mensaje: "expiró" });
    for (let i = 0; i < 10; i++) {
      await motor.sincronizar();
      avanzarHoras(2);
    }
    const [primera] = await repo.operacionesPendientes();
    expect(primera?.intentos ?? 0).toBe(0);
  });
});

describe("un conflicto aparta, no borra", () => {
  beforeEach(async () => {
    await repo.guardarOrden(ordenBase);
    reloj = new Date("2026-09-17T08:05:00.000Z");
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });
  });

  it("la operación en conflicto queda apartada con su motivo", async () => {
    // Los conflictos típicos son una firma desactualizada o una posición
    // ocupada. Antes el comentario decía "se aparta" y el código la borraba.
    servidor.respuestaForzada.set("guardar_medicion", {
      tipo: "conflicto",
      mensaje: "La posición 1 ya tiene una medición registrada desde otro dispositivo",
    });
    await motor.sincronizar();
    const apartadas = await repo.operacionesRechazadas();
    expect(apartadas).toHaveLength(1);
    expect(apartadas[0]?.motivoRechazo).toContain("otro dispositivo");
  });

  it("se sigue reportando como incidencia", async () => {
    servidor.respuestaForzada.set("guardar_medicion", { tipo: "conflicto", mensaje: "x" });
    const r = await motor.sincronizar();
    expect(r.conflictos).toBe(1);
    expect(r.incidencias.length).toBeGreaterThan(0);
  });
});
