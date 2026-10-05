import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  zAdjuntarFoto,
  zCambiarEstado,
  zComandoActualizarOrden,
  zCrearDiseno,
  zCrearMarca,
  zCrearOrden,
  zFirma,
  zMedicionLlanta,
  zReasignar,
} from "@tiretrack/contracts";
import { nuevoId } from "@tiretrack/domain";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar, type Conexion } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";

/**
 * Contrato entre la app y el servidor.
 *
 * Toma lo que el repositorio **encola de verdad** —no un objeto armado a
 * mano— y lo pasa por el mismo esquema que valida el servidor.
 *
 * Existe porque, antes de escribirla, el servidor habría rechazado TODAS las
 * mediciones del móvil: nulls donde el contrato espera ausencia, ids de
 * servicio donde espera nombres, motivos inventados donde espera códigos, y
 * un campo con otro nombre que se perdía sin error.
 */

let db: Conexion;
let repo: RepositorioLocal;
const ORDEN = nuevoId();

beforeEach(async () => {
  db = await abrirBaseEnMemoria();
  await migrar(db);
  repo = new RepositorioLocal(db);

  await repo.guardarCatalogo({
  });
  await repo.guardarOrden({
    id: ORDEN, sedeId: "sede-fun", clienteId: "cli-1", sedeClienteId: "sc-1",
    vehiculoId: "veh-1", tecnicoId: "u-tec1", configuracionEjeId: "cfg-1",
    tipo: "preventivo", estado: "en_proceso", fecha: "2026-09-21", encolar: false,
  });
});

afterEach(async () => {
  await db.cerrar();
});

/** Lo último que quedó en la cola para enviar. */
async function ultimoEncolado(): Promise<unknown> {
  const ops = await repo.operacionesPendientes();
  return ops[ops.length - 1]?.datos;
}

function validar(datos: unknown) {
  const r = zMedicionLlanta.safeParse(datos);
  return {
    ok: r.success,
    problemas: r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

describe("lo que la app envía cumple el contrato del servidor", () => {
  it("una medición completa", async () => {
    await repo.guardarMedicion({
      id: nuevoId(), ordenId: ORDEN, posicion: 7,
      marcaId: nuevoId(), disenoId: nuevoId(), medida: "295/80R22.5",
      serial: "MX10023458", dot: "3624", estadoLlanta: "Usada",
      psiEncontrada: 105, psiCalibrado: 110, profundidad: 9.5,
      capturadoPorId: "u-tec1", servicios: ["CALI"],
    });
    const r = validar(await ultimoEncolado());
    expect(r.problemas).toEqual([]);
  });

  it("una medición con casi todo vacío", async () => {
    // El caso más común en campo, y el que antes se rechazaba siempre:
    // SQLite y el formulario producen null, el contrato espera ausencia.
    await repo.guardarMedicion({
      id: nuevoId(), ordenId: ORDEN, posicion: 3,
      marcaId: null, disenoId: null, medida: null, numCalor: null,
      serial: "MX1", dot: null, estadoLlanta: null,
      psiEncontrada: null, psiCalibrado: 110, profundidad: 8,
      observaciones: null, capturadoPorId: "u-tec1",
    });
    const r = validar(await ultimoEncolado());
    expect(r.problemas).toEqual([]);
  });

  it("una llanta que no se pudo identificar", async () => {
    // Antes el motivo tenía otro nombre y otro vocabulario: se perdía o se
    // rechazaba.
    await repo.guardarMedicion({
      id: nuevoId(), ordenId: ORDEN, posicion: 12,
      noIdentificada: true, motivoNoId: "interna",
      profundidad: 7, capturadoPorId: "u-tec1",
    });
    const datos = await ultimoEncolado();
    expect(validar(datos).problemas).toEqual([]);
    expect(datos).toMatchObject({ motivoNoIdentificada: "interna" });
  });

  it("los servicios viajan por su código", async () => {
    // El código es el identificador; el nombre es para mostrar y puede
    // cambiar sin romper la sincronización.
    await repo.guardarMedicion({
      id: nuevoId(), ordenId: ORDEN, posicion: 1,
      capturadoPorId: "u-tec1", servicios: ["CALI", "ROTA"],
    });
    const datos = (await ultimoEncolado()) as { servicios: string[] };
    expect(datos.servicios.sort()).toEqual(["CALI", "ROTA"]);
    expect(validar(datos).problemas).toEqual([]);
  });

  it("el nombre de un servicio NO pasa el contrato", async () => {
    // Si alguien volviera a enviar nombres, el contrato debe rechazarlo.
    const r = validar({ id: nuevoId(), posicion: 1, noIdentificada: false, servicios: ["Calibración"] });
    expect(r.ok).toBe(false);
  });
});

describe("lo que NO debe viajar en el cuerpo", () => {
  async function encolarUna() {
    await repo.guardarMedicion({
      id: nuevoId(), ordenId: ORDEN, posicion: 1,
      serial: "MX1", capturadoPorId: "u-tec1",
    });
    return (await ultimoEncolado()) as Record<string, unknown>;
  }

  it("el autor no viaja: el servidor lo toma de la sesión", async () => {
    // Si viajara, cualquiera podría firmar mediciones a nombre de otro.
    expect(await encolarUna()).not.toHaveProperty("capturadoPorId");
  });

  it("la orden no viaja: va en la URL", async () => {
    expect(await encolarUna()).not.toHaveProperty("ordenId");
  });

  it("ningún campo viaja en null", async () => {
    // Se mandan nulls EXPLÍCITOS, como hace el editor real. Con campos
    // undefined esta prueba no probaba nada: JSON.stringify los descarta
    // solos y habría pasado con cualquier implementación.
    await repo.guardarMedicion({
      id: nuevoId(), ordenId: ORDEN, posicion: 4,
      marcaId: null, disenoId: null, medida: null, numCalor: null,
      serial: "MX1", dot: null, estadoLlanta: null, psiEncontrada: null,
      psiCalibrado: null, profundidad: null, observaciones: null,
      motivoNoId: null, capturadoPorId: "u-tec1",
    });
    const datos = (await ultimoEncolado()) as Record<string, unknown>;
    for (const [clave, valor] of Object.entries(datos)) {
      expect(valor, `${clave} viaja en null`).not.toBeNull();
    }
  });

  it("el nombre local del motivo no se filtra", async () => {
    await repo.guardarMedicion({
      id: nuevoId(), ordenId: ORDEN, posicion: 2,
      noIdentificada: true, motivoNoId: "sucia", capturadoPorId: "u-tec1",
    });
    expect(await ultimoEncolado()).not.toHaveProperty("motivoNoId");
  });
});

describe("un código desconocido no se descarta en silencio", () => {
  it("viaja tal cual para que el servidor lo rechace y quede apartado", async () => {
    // Descartarlo en el dispositivo borraría un servicio que el técnico sí
    // hizo. Rechazado por el servidor, queda apartado y se puede revisar.
    await repo.guardarMedicion({
      id: nuevoId(), ordenId: ORDEN, posicion: 1,
      capturadoPorId: "u-tec1", servicios: ["XXXX"],
    });
    const datos = (await ultimoEncolado()) as { servicios: string[] };
    expect(datos.servicios).toEqual(["XXXX"]);
    expect(validar(datos).ok).toBe(false);
  });
});

describe("creación de orden contra el contrato", () => {
  async function crearYLeer(extra: Record<string, unknown> = {}) {
    const db2 = await abrirBaseEnMemoria();
    await migrar(db2);
    const repo2 = new RepositorioLocal(db2);
    const id = nuevoId();
    await repo2.guardarOrden({
      id, sedeId: nuevoId(), clienteId: nuevoId(), sedeClienteId: nuevoId(),
      vehiculoId: nuevoId(), tecnicoId: nuevoId(), configuracionEjeId: nuevoId(),
      tipo: "preventivo", estado: "en_proceso", fecha: "2026-09-21",
      sinConductor: true, ...extra,
    });
    const [op] = await repo2.operacionesPendientes();
    await db2.cerrar();
    return { id, datos: op?.datos as Record<string, unknown> };
  }

  it("una orden creada en el dispositivo cumple el contrato", async () => {
    const { datos } = await crearYLeer();
    const r = zCrearOrden.safeParse(datos);
    expect(r.success ? [] : r.error.issues.map((i) => `${i.path}: ${i.message}`)).toEqual([]);
  });

  it("lleva la clave que evita duplicarla al reintentar", async () => {
    // El móvil no la mandaba y el contrato la exige.
    const { id, datos } = await crearYLeer();
    expect(datos.clientRequestId).toBe(id);
  });

  it("estado y folio no viajan: los decide el servidor", async () => {
    const { datos } = await crearYLeer();
    expect(datos).not.toHaveProperty("estado");
    expect(datos).not.toHaveProperty("folio");
    expect(datos).not.toHaveProperty("encolar");
  });

  it("con conductor también cumple", async () => {
    const { datos } = await crearYLeer({ sinConductor: false, conductorNombre: "Pedro Gómez" });
    expect(zCrearOrden.safeParse(datos).success).toBe(true);
  });

  it("sin conductor y sin marcarlo, el contrato lo rechaza", async () => {
    // Es la regla del negocio: alguien entrega el vehículo, o está en sede.
    const { datos } = await crearYLeer({ sinConductor: false });
    expect(zCrearOrden.safeParse(datos).success).toBe(false);
  });
});

describe("comandos contra sus contratos", () => {
  /** Última operación encolada de un tipo. */
  async function ultimaDe(tipo: string) {
    const ops = (await repo.operacionesPendientes()).filter((o) => o.tipo === tipo);
    return ops[ops.length - 1]?.datos as Record<string, unknown>;
  }
  const firmaReal = {
    nombre: "Luis Reyna", cedula: "77221004",
    trazo: "[[[0,0],[10,5]]]", consentimiento: "2026-09-v1",
  };

  it("la firma cumple el contrato", async () => {
    await repo.firmar(ORDEN, firmaReal);
    const r = zFirma.safeParse(await ultimaDe("firmar"));
    expect(r.success ? [] : r.error.issues.map((i) => `${i.path}: ${i.message}`)).toEqual([]);
  });

  it("la firma lleva la versión del contenido que se firmó", async () => {
    // El servidor la compara con la suya: si no coinciden, se firmó algo
    // que él no tiene.
    await repo.guardarMedicion({ id: nuevoId(), ordenId: ORDEN, posicion: 1, capturadoPorId: "u-tec1" });
    await repo.guardarMedicion({ id: nuevoId(), ordenId: ORDEN, posicion: 2, capturadoPorId: "u-tec1" });
    const antes = await repo.buscarOrden(ORDEN);
    await repo.firmar(ORDEN, firmaReal);
    expect((await ultimaDe("firmar")).versionContenido).toBe(antes?.versionContenido);
  });

  it("la firma conserva el consentimiento: es la constancia de la ley", async () => {
    await repo.firmar(ORDEN, firmaReal);
    expect((await ultimaDe("firmar")).consentimiento).toBe("2026-09-v1");
  });

  it("el cambio de estado cumple el contrato y no lleva versión", async () => {
    await repo.cambiarEstado(ORDEN, "en_revision");
    const datos = await ultimaDe("cambiar_estado");
    expect(zCambiarEstado.safeParse(datos).success).toBe(true);
    expect(datos).not.toHaveProperty("version");
  });

  it("la reasignación cumple el contrato", async () => {
    await repo.reasignar(ORDEN, nuevoId(), "Cambio de turno");
    expect(zReasignar.safeParse(await ultimaDe("reasignar")).success).toBe(true);
  });

  // Estas tres no se validaban en el servidor: un cuerpo malo respondía 500.
  // Ahora sí se validan, y estas pruebas aseguran que validar no rechace el
  // trabajo real del técnico.
  it("corregir kilometraje, hallazgos y acción cumple el contrato, sin versión", async () => {
    await repo.actualizarDatosOrden(ORDEN, { kilometraje: 78_950, hallazgos: "Desgaste irregular en eje 2", accion: "Rotación" });
    const datos = await ultimaDe("actualizar_orden");
    const r = zComandoActualizarOrden.safeParse(datos);
    expect(r.success ? [] : r.error.issues.map((i) => `${i.path}: ${i.message}`)).toEqual([]);
    expect(datos).not.toHaveProperty("version");
  });

  it("corregir solo un dato también cumple", async () => {
    await repo.actualizarDatosOrden(ORDEN, { kilometraje: 80_000 });
    expect(zComandoActualizarOrden.safeParse(await ultimaDe("actualizar_orden")).success).toBe(true);
  });

  it("una marca creada en campo cumple el contrato", async () => {
    await repo.crearMarcaLocal("  Firestone  ");
    const r = zCrearMarca.safeParse(await ultimaDe("crear_marca"));
    expect(r.success ? [] : r.error.issues.map((i) => `${i.path}: ${i.message}`)).toEqual([]);
  });

  it.each(["direccional", "traccion", "arrastre"])("un diseño creado en campo para un eje %s cumple el contrato", async (tipoEje) => {
    const marca = await repo.crearMarcaLocal("Firestone");
    await repo.crearDisenoLocal(marca.id, "FS591", tipoEje);
    const r = zCrearDiseno.safeParse(await ultimaDe("crear_diseno"));
    expect(r.success ? [] : r.error.issues.map((i) => `${i.path}: ${i.message}`)).toEqual([]);
  });

  it("adjuntar una foto cumple el contrato", async () => {
    await repo.adjuntarFoto({
      ordenId: ORDEN, uriLocal: "file:///fotos/p7.jpg",
      nombre: "posicion-7.jpg", tipoMime: "image/jpeg", tamanoBytes: 210_000,
    });
    const datos = await ultimaDe("adjuntar_foto");
    expect(zAdjuntarFoto.safeParse(datos).success).toBe(true);
    // La ruta del archivo en el celular no le sirve al servidor
    expect(datos).not.toHaveProperty("uriLocal");
  });
});

describe("la foto respeta el orden en que se trabajó", () => {
  const foto = {
    uriLocal: "file:///fotos/p7.jpg", nombre: "p7.jpg",
    tipoMime: "image/jpeg" as const, tamanoBytes: 200_000,
  };

  it("adjuntar cambia el contenido en ese momento", async () => {
    const antes = (await repo.buscarOrden(ORDEN))?.versionContenido ?? 0;
    await repo.adjuntarFoto({ ...foto, ordenId: ORDEN });
    expect((await repo.buscarOrden(ORDEN))?.versionContenido).toBe(antes + 1);
  });

  it("foto antes de firmar: la firma la incluye", async () => {
    // Antes, la foto contaba al confirmarse los bytes, que podían llegar
    // DESPUÉS de la firma e invalidarla.
    await repo.adjuntarFoto({ ...foto, ordenId: ORDEN });
    await repo.firmar(ORDEN, { nombre: "Luis Reyna", cedula: "77221004", trazo: "[[[0,0],[1,1]]]", consentimiento: "2026-09-v1" });
    const o = await repo.buscarOrden(ORDEN);
    expect(o?.firmaVersion).toBe(o?.versionContenido);
  });

  it("foto después de firmar: la firma queda invalidada", async () => {
    await repo.firmar(ORDEN, { nombre: "Luis Reyna", cedula: "77221004", trazo: "[[[0,0],[1,1]]]", consentimiento: "2026-09-v1" });
    await repo.adjuntarFoto({ ...foto, ordenId: ORDEN });
    const o = await repo.buscarOrden(ORDEN);
    expect(o?.firmaVersion).not.toBe(o?.versionContenido);
  });

  it("en la cola, la foto va antes que la firma si se tomó antes", async () => {
    await repo.adjuntarFoto({ ...foto, ordenId: ORDEN });
    await repo.firmar(ORDEN, { nombre: "Luis Reyna", cedula: "77221004", trazo: "[[[0,0],[1,1]]]", consentimiento: "2026-09-v1" });
    const tipos = (await repo.operacionesPendientes()).map((o) => o.tipo);
    expect(tipos.indexOf("adjuntar_foto")).toBeLessThan(tipos.indexOf("firmar"));
  });
});
