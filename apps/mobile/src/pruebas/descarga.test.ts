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
