import type { MedicionLocal, OrdenLocal, PosicionEjeLocal } from "../datos/repositorio";

/**
 * Datos de prueba compartidos.
 *
 * Existe porque agregar un campo a `OrdenLocal` obligaba a parchear los
 * mismos datos en cinco archivos, y ese trabajo mecánico invita a copiar mal.
 * Con una fábrica, un campo nuevo se agrega una vez.
 */

export function unaOrden(extra: Partial<OrdenLocal> = {}): OrdenLocal {
  return {
    id: "ord-1",
    folio: "OS-FUN-000001",
    codigoReferencia: null,
    sedeId: "sede-fun",
    vehiculoId: "veh-1",
    clienteId: "cli-1",
    tecnicoId: "u-tec1",
    tecnicoNombre: "Carlos Méndez",
    enviadaRevisionEn: null,
    limiteCliente: null,
    estado: "en_proceso",
    motivoDevolucion: null,
    notaCoordinador: null,
    fecha: "2026-09-18",
    configuracionEjeId: "cfg-1",
    kilometraje: 78900,
    hallazgos: "Desgaste irregular en el direccional",
    accion: null,
    firmaNombre: null,
    firmaCedula: null,
    firmaVersion: null,
    firmaTrazo: null,
    firmaCargo: null,
    firmaFechaHora: null,
    version: 3,
    versionContenido: 2,
    sincronizada: true,
    ...extra,
  };
}

/** Orden firmada y lista para enviar o revisar. */
export function unaOrdenFirmada(extra: Partial<OrdenLocal> = {}): OrdenLocal {
  return unaOrden({
    firmaNombre: "Luis Reyna",
    firmaCedula: "77221004",
    firmaVersion: 2,
    firmaTrazo: "[[[0,0],[10,5]]]",
    firmaFechaHora: "2026-09-18T14:30:00.000Z",
    ...extra,
  });
}

export function unaMedicion(posicion: number, extra: Partial<MedicionLocal> = {}): MedicionLocal {
  return {
    id: `m-${posicion}`,
    ordenId: "ord-1",
    posicion,
    marcaId: "mar-1",
    disenoId: "dis-1",
    medida: "295/80R22.5",
    serial: "MX1",
    dot: "3624",
    psiEncontrada: 105,
    psiCalibrado: 110,
    profundidad: 9,
    noIdentificada: false,
    servicios: [],
    ...extra,
  };
}

/** Configuración de cuatro posiciones: un eje direccional y uno de tracción. */
export const CONFIGURACION_CUATRO: PosicionEjeLocal[] = [1, 2, 3, 4].map((numero) => ({
  configuracionEjeId: "cfg-1",
  numero,
  eje: numero <= 2 ? 1 : 2,
  lado: numero % 2 === 1 ? ("izquierdo" as const) : ("derecho" as const),
  esInterna: false,
  tipoEje: numero <= 2 ? "direccional" : "traccion",
  psiObjetivo: numero <= 2 ? 110 : 105,
  profundidadMinima: numero <= 2 ? 3 : 2.5,
}));
