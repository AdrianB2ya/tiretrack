import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar, type Conexion } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";
import { Descargador, type ClienteDescarga, type PaqueteDescargado } from "../datos/descarga";

/**
 * Descarga de datos al celular.
 *
 * Sin esto, un técnico instala la app, ingresa y ve una lista vacía para
 * siempre: el motor solo enviaba, nunca traía.
 *
 * Lo que más se prueba aquí es lo que no debe pasar: que lo descargado pise
 * el trabajo que el técnico capturó y todavía no salió del celular.
 */

let db: Conexion;
let repo: RepositorioLocal;
let descargador: Descargador;
let ahora = new Date("2026-09-21T08:00:00.000Z");

const CFG = "cfg-4";

function unaOrden(extra: Record<string, unknown> = {}) {
  return {
    id: "ord-1", sedeId: "sede-fun", clienteId: "cli-1", sedeClienteId: "sc-1",
    vehiculoId: "veh-1", tecnicoId: "u-tec1", configuracionEjeId: CFG,
    folio: "OS-FUN-000001", tipo: "preventivo", estado: "en_proceso",
    fecha: "2026-09-21", kilometraje: null, hallazgos: null,
    motivoDevolucion: null, notaCoordinador: null, version: 3, versionContenido: 1,
    codigoReferencia: null, accion: null, firmaNombre: null, firmaCedula: null,
    firmaCargo: null, firmaVersion: null, firmaFechaHora: null,
    ...extra,
  };
}

function unPaquete(extra: Partial<PaqueteDescargado> = {}): PaqueteDescargado {
  return {
    hasta: "2026-09-21T09:00:00.000Z",
    incremental: false,
    ordenes: [unaOrden()],
    mediciones: [],
    catalogo: {
      marcas: [{ id: "mar-1", nombre: "Michelin", esGlobal: true }],
      disenos: [{ id: "dis-1", marcaId: "mar-1", nombre: "XDN-2", tipoEje: "traccion" }],
      medidas: [{ id: "med-1", disenoId: "dis-1", medida: "295/80R22.5", profundidadOriginal: 16 }],
    },
    flota: {
      clientes: [{ id: "cli-1", nombre: "Transportes Reyna", nit: "800" }],
      sedes: [{ id: "sc-1", clienteId: "cli-1", nombre: "Planta" }],
      vehiculos: [{
        id: "veh-1", sedeClienteId: "sc-1", configuracionEjeId: CFG,
        codigo: "CA-12", placa: "SXK482", nombre: "Tractocamión", kmActual: 78900,
      }],
    },
    configuraciones: [{
      id: CFG,
      posiciones: [1, 2, 3, 4].map((numero) => ({
        numero, eje: numero <= 2 ? 1 : 2,
        lado: numero % 2 === 1 ? "izquierdo" : "derecho",
        esInterna: false, tipoEje: "traccion", psiObjetivo: 110, profundidadMinima: 3,
      })),
    }],
    tecnicos: [{ id: "u-tec1", nombre: "Carlos Méndez", sedeId: "sede-fun", activo: true }],
    ...extra,
  };
}

/** Servidor falso que registra qué `desde` recibió. */
function servidorCon(paquete: PaqueteDescargado | null): ClienteDescarga & { desdes: (string | null)[] } {
  const s = {
    desdes: [] as (string | null)[],
    traer: async (desde: string | null) => {
      s.desdes.push(desde);
      return paquete;
    },
  };
  return s;
}

beforeEach(async () => {
  db = await abrirBaseEnMemoria();
  await migrar(db);
  ahora = new Date("2026-09-21T08:00:00.000Z");
  repo = new RepositorioLocal(db, () => ahora);
  descargador = new Descargador(repo);
});

afterEach(async () => {
  await db.cerrar();
});

describe("primera descarga", () => {
  it("deja el celular listo para trabajar", async () => {
    const r = await descargador.descargar(servidorCon(unPaquete()));

    expect(r.ordenesNuevas).toBe(1);
    expect(await repo.ordenesAsignadas()).toHaveLength(1);
    expect(await repo.marcas()).toHaveLength(1);
    expect(await repo.posicionesDe(CFG)).toHaveLength(4);
    expect(await repo.tecnicosDeSede("sede-fun")).toHaveLength(1);
  });

  it("los nombres de cliente y vehículo quedan resueltos", async () => {
    await descargador.descargar(servidorCon(unPaquete()));
    const ctx = await repo.contextoDeOrden("ord-1");
    expect(ctx?.vehiculoCodigo).toBe("CA-12");
    expect(ctx?.clienteNombre).toBe("Transportes Reyna");
  });

  it("pide todo: no hay marca previa", async () => {
    const servidor = servidorCon(unPaquete());
    await descargador.descargar(servidor);
    expect(servidor.desdes).toEqual([null]);
  });

  it("la segunda descarga pide solo lo que cambió", async () => {
    // Traer todo cada vez gasta los datos del técnico.
    const servidor = servidorCon(unPaquete());
    await descargador.descargar(servidor);
    await descargador.descargar(servidor);
    expect(servidor.desdes[1]).toBe("2026-09-21T09:00:00.000Z");
  });

  it("una orden descargada NO queda como pendiente de enviar", async () => {
    // Viene del servidor: encolarla la mandaría de vuelta.
    await descargador.descargar(servidorCon(unPaquete()));
    expect(await repo.contarPendientes()).toBe(0);
  });
});

describe("lo descargado no pisa el trabajo sin enviar", () => {
  it("una orden con cambios locales se respeta", async () => {
    // El servidor tiene la versión VIEJA: escribirla encima borraría lo que
    // el técnico capturó sin señal.
    await descargador.descargar(servidorCon(unPaquete()));
    await repo.actualizarDatosOrden("ord-1", { kilometraje: 78900, hallazgos: "Desgaste" });

    const r = await descargador.descargar(
      servidorCon(unPaquete({ ordenes: [unaOrden({ hallazgos: null, kilometraje: null })] })),
    );

    expect(r.ordenesRespetadas).toBe(1);
    const local = await repo.buscarOrden("ord-1");
    expect(local?.hallazgos).toBe("Desgaste");
    expect(local?.kilometraje).toBe(78900);
  });

  it("una medición corregida que sigue en la cola se respeta", async () => {
    await descargador.descargar(servidorCon(unPaquete()));
    await repo.guardarMedicion({
      id: "med-x", ordenId: "ord-1", posicion: 1, profundidad: 4, capturadoPorId: "u-tec1",
    });
    // El servidor todavía tiene la medición vieja.
    await repo.cambiarEstado("ord-1", "en_proceso");
    await db.ejecutar(`UPDATE orden SET sincronizada = 1 WHERE id = 'ord-1'`);

    await descargador.descargar(
      servidorCon(unPaquete({
        mediciones: [{
          id: "med-x", ordenId: "ord-1", posicion: 1, marcaId: null, disenoId: null,
          medida: null, serial: null, profundidad: 9,
        }],
      })),
    );

    const [m] = await repo.medicionesDe("ord-1");
    expect(m?.profundidad).toBe(4);
  });

  it("volver a descargar una orden firmada en este celular conserva la firma", async () => {
    // La descarga guardaba con INSERT OR REPLACE: lo que el servidor no
    // mandaba volvía a NULL. La firma desaparecía y la app pedía firmar otra
    // vez una orden que el servidor ya tenía firmada.
    await descargador.descargar(servidorCon(unPaquete()));
    await repo.firmar("ord-1", {
      nombre: "Luis Reyna", cedula: "77221004", trazo: "[[[0,0],[9,9]]]", consentimiento: "2026-09-v1",
    });
    // El envío llegó, como lo deja el motor: cola vacía y orden sincronizada.
    for (const op of await repo.operacionesPendientes()) await repo.marcarOperacionAplicada(op.id);
    await repo.confirmarSincronizacion("ord-1", null);
    const firmada = await repo.buscarOrden("ord-1");
    // Sin esto la comparación del trazo pasaría con null contra null.
    expect(firmada?.firmaTrazo).toBeTruthy();

    await descargador.descargar(servidorCon(unPaquete({
      ordenes: [unaOrden({
        estado: "en_revision", accion: "Calibración general", codigoReferencia: "FUN-K7M2",
        firmaNombre: "Luis Reyna", firmaCedula: "77221004",
        firmaVersion: firmada?.firmaVersion, firmaFechaHora: "2026-09-21T10:00:00.000Z",
      })],
    })));

    const despues = await repo.buscarOrden("ord-1");
    expect(despues?.estado).toBe("en_revision");
    expect(despues?.firmaNombre).toBe("Luis Reyna");
    expect(despues?.firmaVersion).toBe(firmada?.firmaVersion);
    // El trazo no viaja: se conserva el que se capturó aquí.
    expect(despues?.firmaTrazo).toBe(firmada?.firmaTrazo);
    expect(despues?.accion).toBe("Calibración general");
    expect(despues?.codigoReferencia).toBe("FUN-K7M2");
  });

  it("una orden ya sincronizada SÍ se actualiza", async () => {
    // Es el caso normal: el coordinador la devolvió con un motivo.
    await descargador.descargar(servidorCon(unPaquete()));
    const r = await descargador.descargar(
      servidorCon(unPaquete({ ordenes: [unaOrden({ motivoDevolucion: "Falta la posición 6" })] })),
    );

    expect(r.ordenesActualizadas).toBe(1);
    expect((await repo.buscarOrden("ord-1"))?.motivoDevolucion).toContain("posición 6");
  });
});

describe("órdenes cerradas", () => {
  it("se quitan de la lista del celular", async () => {
    // Ya no se pueden trabajar y solo ocupan espacio.
    await descargador.descargar(servidorCon(unPaquete()));
    const r = await descargador.descargar(
      servidorCon(unPaquete({ ordenes: [unaOrden({ estado: "cerrada" })] })),
    );

    expect(r.cerradas).toBe(1);
    expect(await repo.buscarOrden("ord-1")).toBeNull();
  });

  it("pero NO si tienen trabajo sin enviar", async () => {
    // Si el servidor la cerró mientras el técnico capturaba, borrarla
    // perdería su trabajo antes de que pudiera enviarlo.
    await descargador.descargar(servidorCon(unPaquete()));
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });

    const r = await descargador.descargar(
      servidorCon(unPaquete({ ordenes: [unaOrden({ estado: "cerrada" })] })),
    );

    expect(r.ordenesRespetadas).toBe(1);
    expect(await repo.buscarOrden("ord-1")).not.toBeNull();
  });

  it("una cerrada que nunca estuvo en el celular no hace nada", async () => {
    const r = await descargador.descargar(
      servidorCon(unPaquete({ ordenes: [unaOrden({ estado: "anulada" })] })),
    );
    expect(r.cerradas).toBe(0);
    expect(r.ordenesNuevas).toBe(0);
  });
});

describe("cuando algo sale mal", () => {
  it("sin conexión no cambia nada", async () => {
    await descargador.descargar(servidorCon(unPaquete()));
    const r = await descargador.descargar(servidorCon(null));

    expect(r.sinConexion).toBe(true);
    expect(await repo.ordenesAsignadas()).toHaveLength(1);
  });

  it("sin conexión NO avanza la marca", async () => {
    // Avanzarla haría que la próxima descarga se saltara lo que faltó, y
    // esos datos no llegarían nunca.
    const servidor = servidorCon(unPaquete());
    await descargador.descargar(servidor);
    await descargador.descargar(servidorCon(null));
    await descargador.descargar(servidor);
    expect(servidor.desdes[1]).toBe("2026-09-21T09:00:00.000Z");
  });

  it("si falla a MITAD de aplicar, la marca no avanza", async () => {
    // Es el único caso donde importa cuándo se guarda la marca: si se
    // guardara antes, la próxima descarga pediría solo lo nuevo y lo que
    // quedó a medio aplicar no llegaría nunca.
    const roto = new Proxy(repo, {
      get(objetivo, prop, receptor) {
        if (prop === "guardarTecnicos") {
          return async () => {
            throw new Error("se acabó el espacio del dispositivo");
          };
        }
        return Reflect.get(objetivo, prop, receptor) as unknown;
      },
    }) as RepositorioLocal;

    await expect(new Descargador(roto).descargar(servidorCon(unPaquete()))).rejects.toThrow(
      /espacio/,
    );
    expect(await repo.marcaDeDescarga()).toBeNull();
  });

  it("tras fallar, la siguiente descarga vuelve a pedir todo", async () => {
    const roto = new Proxy(repo, {
      get(objetivo, prop, receptor) {
        if (prop === "guardarTecnicos") {
          return async () => {
            throw new Error("falló");
          };
        }
        return Reflect.get(objetivo, prop, receptor) as unknown;
      },
    }) as RepositorioLocal;
    await new Descargador(roto).descargar(servidorCon(unPaquete())).catch(() => undefined);

    const servidor = servidorCon(unPaquete());
    await descargador.descargar(servidor);
    expect(servidor.desdes).toEqual([null]);
  });

  it("no corre dos descargas a la vez", async () => {
    const servidor = servidorCon(unPaquete());
    await Promise.all([descargador.descargar(servidor), descargador.descargar(servidor)]);
    expect(servidor.desdes).toHaveLength(1);
  });
});

describe("técnicos y sedes de la empresa", () => {
  it("un técnico en dos sedes se guarda en las dos, y la descarga no se cae", async () => {
    // La clave era solo el id: el segundo registro chocaba, la descarga
    // fallaba entera y el coordinador con dos sedes nunca recibía datos.
    const r = await descargador.descargar(servidorCon(unPaquete({
      tecnicos: [
        { id: "u-tec1", nombre: "Carlos", sedeId: "sede-fun", activo: true },
        { id: "u-tec1", nombre: "Carlos", sedeId: "sede-ct01", activo: true },
      ],
    })));
    expect(r.sinConexion).toBe(false);
    // La marca solo avanza si se aplicó todo: es la prueba de que no se cayó.
    expect(await repo.marcaDeDescarga()).not.toBeNull();
    expect((await repo.tecnicosDeSede("sede-fun")).map((t) => t.id)).toEqual(["u-tec1"]);
    expect((await repo.tecnicosDeSede("sede-ct01")).map((t) => t.id)).toEqual(["u-tec1"]);
  });

  it("guarda las sedes de la empresa, con su código", async () => {
    await descargador.descargar(servidorCon(unPaquete({
      sedes: [{ id: "sede-fun", nombre: "Sede Fundación", codigo: "FUN" }],
    })));
    expect(await repo.sedes()).toEqual([{ id: "sede-fun", nombre: "Sede Fundación", codigo: "FUN" }]);
  });

  it("un servidor que no manda sedes no rompe la descarga", async () => {
    const r = await descargador.descargar(servidorCon(unPaquete()));
    expect(r.sinConexion).toBe(false);
    // La marca solo avanza si se aplicó todo: es la prueba de que no se cayó.
    expect(await repo.marcaDeDescarga()).not.toBeNull();
  });
});

describe("flota creada en campo", () => {
  it("un cliente creado sin señal sobrevive a la descarga", async () => {
    // La descarga reemplazaba la flota entera: lo creado en el celular se
    // borraba y las órdenes que lo usaban quedaban huérfanas.
    const id = await repo.crearClienteLocal({ nombre: "Transportes Nuevo", nit: "900555111" });
    await descargador.descargar(servidorCon(unPaquete()));
    expect((await repo.clientes()).map((c) => c.id)).toContain(id);
  });

  it("cuando el servidor lo devuelve, queda como suyo", async () => {
    const id = await repo.crearClienteLocal({ nombre: "Transportes Nuevo", nit: "900555111" });
    const conElCliente = unPaquete();
    await descargador.descargar(servidorCon({
      ...conElCliente,
      flota: { ...conElCliente.flota, clientes: [...conElCliente.flota.clientes, { id, nombre: "Transportes Nuevo", nit: "900555111" }] },
    }));
    // La siguiente descarga ya no lo trae (p. ej. se desactivó): ahora sí se va.
    await descargador.descargar(servidorCon(unPaquete()));
    expect((await repo.clientes()).map((c) => c.id)).not.toContain(id);
  });

  it("guarda el nombre de las plantillas para elegirlas al registrar un vehículo", async () => {
    const p = unPaquete();
    await descargador.descargar(servidorCon({
      ...p,
      configuraciones: p.configuraciones.map((c) => ({ ...c, nombre: "Tractocamión 6x4", version: 1, vigente: true })),
    }));
    const cfgs = await repo.configuracionesVigentes();
    expect(cfgs[0]?.nombre).toBe("Tractocamión 6x4");
    expect(cfgs[0]?.posiciones).toBeGreaterThan(0);
  });
});

describe("historial del cliente", () => {
  it("con conservarCerradas, las cerradas se guardan; sin él, se quitan", async () => {
    const { Descargador } = await import("../datos/descarga");
    const cerrada = unPaquete({ ordenes: [unaOrden({ estado: "cerrada" })] });
    await new Descargador(repo, { conservarCerradas: true }).descargar(servidorCon(cerrada));
    expect((await repo.buscarOrden("ord-1"))?.estado).toBe("cerrada");
  });
});

describe("mediciones descargadas", () => {
  // Ninguna prueba guardaba de verdad una medición descargada: la única
  // tomaba el camino que la salta. El INSERT usaba una columna inexistente
  // ("capturada_en"), toda descarga con mediciones fallaba después de guardar
  // las órdenes, y la pantalla del coordinador quedaba vacía.
  const completa = {
    id: "med-s", ordenId: "ord-1", posicion: 3, marcaId: "mar-1", disenoId: "dis-1",
    medida: "295/80R22.5", numCalor: "C12", serial: "MX3", dot: "3624", estadoLlanta: "Nueva",
    psiEncontrada: 98.5, psiCalibrado: 110, profundidad: 1.8, observaciones: "Corte en el flanco",
    noIdentificada: false, motivoNoIdentificada: null, capturadoPorId: "u-tec1", servicios: ["CALI", "ROTA"],
  };

  it("se guardan completas, con sus servicios, y la marca de descarga queda puesta", async () => {
    await descargador.descargar(servidorCon(unPaquete({ mediciones: [completa] })));
    const [m] = await repo.medicionesDe("ord-1");
    expect(m).toMatchObject({
      id: "med-s", posicion: 3, numCalor: "C12", serial: "MX3", dot: "3624", estadoLlanta: "Nueva",
      psiEncontrada: 98.5, psiCalibrado: 110, profundidad: 1.8, observaciones: "Corte en el flanco",
    });
    expect([...(m?.servicios ?? [])].sort()).toEqual(["CALI", "ROTA"]);
    // Si fallara a mitad, la marca no se guardaría y cada descarga sería completa.
    expect(await repo.marcaDeDescarga()).toBe("2026-09-21T09:00:00.000Z");
  });

  it("corregir una posición descargada reutiliza el id del servidor y no pierde lo que no se tocó", async () => {
    // Era el rechazo "posición ocupada" de la orden devuelta: el celular no
    // tenía la medición del servidor y creaba otra para la misma posición.
    await descargador.descargar(servidorCon(unPaquete({
      ordenes: [unaOrden({ motivoDevolucion: "Confirma la posición 3" })],
      mediciones: [completa],
    })));
    const [anterior] = await repo.medicionesDe("ord-1");
    await repo.guardarMedicion({
      ordenId: "ord-1", posicion: 3, capturadoPorId: "u-tec1",
      ...{ ...anterior, profundidad: 2.1, motivoNoId: null },
    });
    const [m] = await repo.medicionesDe("ord-1");
    expect(m?.id).toBe("med-s");
    const [op] = (await repo.operacionesPendientes()).filter((o) => o.tipo === "guardar_medicion");
    expect(op?.datos).toMatchObject({ id: "med-s", profundidad: 2.1, dot: "3624", psiEncontrada: 98.5, estadoLlanta: "Nueva" });
  });

  it("una medición local de esa posición con otro id, ya rechazada, cede ante la del servidor", async () => {
    await descargador.descargar(servidorCon(unPaquete()));
    const idLocal = await repo.guardarMedicion({ ordenId: "ord-1", posicion: 3, profundidad: 2, capturadoPorId: "u-tec1" });
    const [op] = await repo.operacionesPendientes();
    await repo.apartarOperacion(op!.id, "POSICION_OCUPADA: la posición ya tiene medición");
    await db.ejecutar(`UPDATE orden SET sincronizada = 1 WHERE id = 'ord-1'`);

    await descargador.descargar(servidorCon(unPaquete({ mediciones: [completa] })));
    const ms = await repo.medicionesDe("ord-1");
    expect(ms.map((m) => m.id)).toEqual(["med-s"]);
    expect(idLocal).not.toBe("med-s");
  });

  it("una captura local de esa posición que sigue sin enviar se respeta", async () => {
    await descargador.descargar(servidorCon(unPaquete()));
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 3, profundidad: 2, capturadoPorId: "u-tec1" });
    await db.ejecutar(`UPDATE orden SET sincronizada = 1 WHERE id = 'ord-1'`);
    await descargador.descargar(servidorCon(unPaquete({ mediciones: [completa] })));
    const ms = await repo.medicionesDe("ord-1");
    expect(ms).toHaveLength(1);
    expect(ms[0]?.profundidad).toBe(2);
  });

  it("la llanta desmontada llega con la medición: corregir la orden no la borra", async () => {
    const desmontada = {
      posicionOrigen: 3, marcaId: null, disenoId: null, medida: null, numCalor: null, serial: "VIEJA-3", dot: "1520",
      profundidad: 2.5, profundidades: { exterior: 3, centro: 2.5, interior: 2.8 }, destino: "Reencauche", detalle: null,
    };
    await descargador.descargar(servidorCon(unPaquete({
      mediciones: [{ ...completa, profundidades: { exterior: 9, centro: 8.5, interior: 8 }, desmontada }],
    })));
    const [m] = await repo.medicionesDe("ord-1");
    expect(m?.desmontada).toEqual(desmontada);
    // Las tres medidas viajan: sin ellas, corregir una posición las borraría.
    expect(m?.profundidades).toEqual({ exterior: 9, centro: 8.5, interior: 8 });
  });

  it("de un servidor anterior, sin los campos nuevos, se guarda lo que venga", async () => {
    const vieja = { id: "med-v", ordenId: "ord-1", posicion: 1, marcaId: null, disenoId: null, medida: null, serial: "S", profundidad: 9 };
    await descargador.descargar(servidorCon(unPaquete({ mediciones: [vieja] })));
    expect((await repo.medicionesDe("ord-1"))[0]).toMatchObject({ id: "med-v", serial: "S", dot: null });
  });
});
