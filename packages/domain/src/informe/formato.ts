import { CODIGOS_SERVICIO_LLANTA, definicionDeServicio } from "../tipos";
import { leerDOT } from "../llanta/dot";

/**
 * Informe de órdenes de servicio.
 *
 * Replica el formato operativo que ya usa el taller: **una fila por posición
 * de llanta**, con tres bloques —cabecera, llanta intervenida, llanta
 * desmontada— y los servicios como columnas marcadas con X.
 *
 * Las columnas de servicio salen del catálogo, no de una lista escrita a
 * mano: si mañana se agrega un servicio, el informe gana esa columna sola.
 */

export const MARCA_SERVICIO = "X";

/**
 * Columna del informe para un servicio, a partir de su código.
 *
 * Un código desconocido se muestra tal cual en vez de inventarle una columna:
 * así se nota en el informe en lugar de desaparecer.
 */
export function columnaDeServicio(codigo: string): string {
  return definicionDeServicio(codigo)?.columna ?? codigo;
}

/** Datos crudos de una fila: lo que trae la consulta, sin formatear. */
export interface FilaCruda {
  /** Para elegir órdenes en el informe; no es una columna del archivo. */
  readonly ordenId?: string;
  readonly fecha: string;
  readonly vehiculoCodigo: string | null;
  readonly vehiculoPlaca: string | null;
  readonly folio: string | null;
  readonly codigoReferencia: string | null;
  readonly estado: string;
  readonly kilometraje: number | null;
  readonly posicion: number;

  /** Códigos de servicio (`CALI`, `RETO`…), no nombres. */
  readonly servicios: readonly string[];

  readonly numCalor: string | null;
  readonly serial: string | null;
  readonly dot: string | null;
  readonly marca: string | null;
  readonly diseno: string | null;
  readonly medida: string | null;
  readonly estadoLlanta: string | null;
  readonly psiEncontrada: number | null;
  readonly psiCalibrado: number | null;
  /** La mínima de las tres: la de la llanta. */
  readonly profundidad: number | null;
  readonly profExterior?: number | null;
  readonly profCentro?: number | null;
  readonly profInterior?: number | null;
  readonly noIdentificada: boolean;

  readonly desPosicion: number | null;
  readonly desNumCalor: string | null;
  readonly desSerial: string | null;
  readonly desDot: string | null;
  readonly desMedida: string | null;
  readonly desProfundidad: number | null;
  readonly desProfExterior?: number | null;
  readonly desProfCentro?: number | null;
  readonly desProfInterior?: number | null;
  readonly desMarca: string | null;
  readonly desDiseno: string | null;
  readonly desDestino: string | null;
  readonly desDetalle: string | null;
}

/** Bloques del informe, en el orden del formato operativo. */
export const BLOQUES = {
  cabecera: ["FECHA", "VEHÍCULO", "PLACAS", "ORDEN DE SERVICIO", "ESTADO ORDEN", "KILOMETRAJE", "POSICION LLANTA"],
  intervenida: [
    "CALOR", "SERIAL", "DOT", "FABRICACIÓN", "VENCIMIENTO",
    "MARCA", "DISEÑO", "DIMENSIÓN", "ESTADO LLANTA",
    "PSI ENCONTRADO", "PSI CALIBRADO",
    // Tres puntos de la banda y la mínima, que es la de la llanta.
    "PROF EXT", "PROF CENTRO", "PROF INT", "PROF MÍN",
  ],
  desmontada: [
    "POS", "CALOR", "SERIAL", "DOT", "DIMENSION",
    "PROF EXT", "PROF CENTRO", "PROF INT", "PROF MÍN",
    "MARCA", "DISEÑO", "DESTINO", "DETALLE",
  ],
} as const;

export function encabezados(): string[] {
  return [
    ...BLOQUES.cabecera,
    ...CODIGOS_SERVICIO_LLANTA.map(columnaDeServicio),
    ...BLOQUES.intervenida,
    ...BLOQUES.desmontada,
  ];
}

/** Grupos para la fila superior de encabezados agrupados. */
export function gruposDeColumnas(): { titulo: string; columnas: number }[] {
  return [
    { titulo: "", columnas: BLOQUES.cabecera.length },
    { titulo: "Servicios realizados", columnas: CODIGOS_SERVICIO_LLANTA.length },
    { titulo: "Datos de llanta intervenida", columnas: BLOQUES.intervenida.length },
    { titulo: "Llanta desmontada · destino", columnas: BLOQUES.desmontada.length },
  ];
}

const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/**
 * Convierte una fila cruda a las celdas del informe.
 *
 * El estado de la orden va en el archivo a propósito: quien reciba el
 * exportado debe poder ver si esas mediciones estaban aprobadas o si eran
 * una captura preliminar que después cambió.
 */
export function aCeldas(f: FilaCruda): string[] {
  const dot = leerDOT(f.dot);
  const identificador = f.folio ?? f.codigoReferencia ?? "";

  return [
    f.fecha,
    texto(f.vehiculoCodigo),
    texto(f.vehiculoPlaca),
    identificador,
    f.estado.toUpperCase(),
    texto(f.kilometraje),
    String(f.posicion),

    ...CODIGOS_SERVICIO_LLANTA.map((c) => (f.servicios.includes(c) ? MARCA_SERVICIO : "")),

    texto(f.numCalor),
    // Una llanta sin identificar se dice, no se deja en blanco: el blanco
    // parece un olvido y esto fue una decisión del técnico en campo.
    f.serial ?? (f.noIdentificada ? "SIN IDENTIFICAR" : ""),
    texto(f.dot),
    dot?.fabricacionTexto ?? "",
    dot?.vencimiento ?? "",
    texto(f.marca),
    texto(f.diseno),
    texto(f.medida),
    texto(f.estadoLlanta),
    texto(f.psiEncontrada),
    texto(f.psiCalibrado),
    texto(f.profExterior),
    texto(f.profCentro),
    texto(f.profInterior),
    texto(f.profundidad),

    texto(f.desPosicion),
    texto(f.desNumCalor),
    texto(f.desSerial),
    texto(f.desDot),
    texto(f.desMedida),
    texto(f.desProfExterior),
    texto(f.desProfCentro),
    texto(f.desProfInterior),
    texto(f.desProfundidad),
    texto(f.desMarca),
    texto(f.desDiseno),
    texto(f.desDestino),
    texto(f.desDetalle),
  ];
}

/**
 * Serializa a CSV con punto y coma.
 *
 * Se usa `;` porque Excel en configuración regional española interpreta la
 * coma como separador decimal: con `,` las profundidades se parten en dos
 * columnas. El BOM al inicio es lo que hace que Excel reconozca UTF-8 y no
 * muestre "PosiciÃ³n".
 */
export function aCSV(filas: readonly FilaCruda[]): string {
  const escapar = (c: string) => `"${c.replace(/"/g, '""')}"`;
  const lineas = [
    encabezados().map(escapar).join(";"),
    ...filas.map((f) => aCeldas(f).map(escapar).join(";")),
  ];
  return "\uFEFF" + lineas.join("\n");
}

/** Nombre del archivo según cuántas órdenes lleva. */
export function nombreArchivo(folios: readonly string[], hoy: string): string {
  if (folios.length === 1) return `${folios[0]}.csv`;
  return `informe-${folios.length}-ordenes-${hoy}.csv`;
}

export interface ResumenExportacion {
  readonly registros: number;
  readonly ordenes: number;
  readonly folios: string[];
  /** Cuántas iban sin cerrar: son datos preliminares. */
  readonly sinCerrar: number;
}

/**
 * Resumen para la auditoría. Guardar los filtros importa tanto como el
 * conteo: no es lo mismo exportar una orden propia que toda la cartera de un
 * cliente en un rango de seis meses.
 */
export function resumirExportacion(filas: readonly FilaCruda[]): ResumenExportacion {
  const folios = [...new Set(filas.map((f) => f.folio ?? f.codigoReferencia ?? "sin folio"))];
  const sinCerrar = new Set(
    filas.filter((f) => f.estado !== "cerrada").map((f) => f.folio ?? f.codigoReferencia),
  );
  return {
    registros: filas.length,
    ordenes: folios.length,
    // Se recorta: un informe de 500 órdenes no debe inflar la auditoría
    folios: folios.slice(0, 20),
    sinCerrar: sinCerrar.size,
  };
}

/**
 * Recorrido de una llanta concreta: dónde estuvo y con qué profundidad.
 * Es lo que permite responder si una llanta se rotó y cuánto duró.
 */
export interface PasoTrazabilidad {
  readonly fecha: string;
  readonly folio: string;
  readonly vehiculoCodigo: string | null;
  readonly posicion: number;
  readonly profundidad: number | null;
  readonly kilometraje: number | null;
}

export function construirTrazabilidad(filas: readonly FilaCruda[]): PasoTrazabilidad[] {
  return [...filas]
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map((f) => ({
      fecha: f.fecha,
      folio: f.folio ?? f.codigoReferencia ?? "",
      vehiculoCodigo: f.vehiculoCodigo,
      posicion: f.posicion,
      profundidad: f.profundidad,
      kilometraje: f.kilometraje,
    }));
}

/** Desgaste acumulado a lo largo del recorrido, si hay dos mediciones. */
export function desgasteEnElTiempo(
  pasos: readonly PasoTrazabilidad[],
): { perdida: number; servicios: number } | null {
  const conProfundidad = pasos.filter((p) => p.profundidad !== null);
  if (conProfundidad.length < 2) return null;

  const primera = conProfundidad[0]?.profundidad as number;
  const ultima = conProfundidad[conProfundidad.length - 1]?.profundidad as number;
  return {
    perdida: Number((primera - ultima).toFixed(1)),
    servicios: conProfundidad.length,
  };
}
