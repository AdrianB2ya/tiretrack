import { zFiltroInforme } from "@tiretrack/contracts";
import { CATALOGO_SERVICIOS, ESTADOS_LLANTA, MAX_ORDENES_PDF } from "@tiretrack/domain";

/**
 * Informe en la app: filtros, vista previa y exportación.
 *
 * Primero se ve, después se exporta. El coordinador revisa en pantalla cuántas
 * llantas y órdenes salen con el filtro antes de mandar un archivo que alguien
 * más va a abrir: un rango de fechas mal puesto se descubre aquí, no en la
 * hoja de cálculo del cliente.
 */

export interface FiltroPantalla {
  readonly clienteId: string | null;
  /** AAAA-MM-DD tal como se escribió. */
  readonly desde: string;
  readonly hasta: string;
  readonly serial: string;
  /** Placa o código escrito. */
  readonly vehiculo: string;
  /** Vehículo elegido de la lista del cliente. */
  readonly vehiculoId: string | null;
  readonly numCalor: string;
  readonly servicio: string | null;
  readonly estadoLlanta: string | null;
}

export const FILTRO_VACIO: FiltroPantalla = {
  clienteId: null, desde: "", hasta: "", serial: "", vehiculo: "", vehiculoId: null, numCalor: "", servicio: null, estadoLlanta: null,
};

/** Solo los servicios de la llanta: el lavado del vehículo no tiene fila en el informe. */
export const SERVICIOS_FILTRO = CATALOGO_SERVICIOS.filter((s) => s.porLlanta).map((s) => ({ codigo: s.codigo, nombre: s.nombre }));
export const ESTADOS_FILTRO = [...ESTADOS_LLANTA];

const fechaISO = (d: Date) => d.toISOString().slice(0, 10);

/** Rangos de un toque: escribir fechas con guantes es lento y se escribe mal. */
export function rangoRapido(cual: "hoy" | "7dias" | "mes" | "mesAnterior", hoy: string): { desde: string; hasta: string } {
  const [a, m] = hoy.split("-").map(Number) as [number, number];
  const base = new Date(`${hoy}T12:00:00Z`);
  switch (cual) {
    case "hoy":
      return { desde: hoy, hasta: hoy };
    case "7dias":
      return { desde: fechaISO(new Date(base.getTime() - 6 * 86_400_000)), hasta: hoy };
    case "mes":
      return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
    case "mesAnterior": {
      const inicio = new Date(Date.UTC(a, m - 2, 1));
      const fin = new Date(Date.UTC(a, m - 1, 0));
      return { desde: fechaISO(inicio), hasta: fechaISO(fin) };
    }
  }
}

/**
 * Problemas del filtro, antes de gastar señal. La fecha se valida con el
 * mismo contrato del servidor —por componentes: `2026-02-31` no existe—.
 */
export function revisarFiltro(f: FiltroPantalla): { campo: "desde" | "hasta" | "serial" | "vehiculo" | "numCalor"; mensaje: string }[] {
  const p: { campo: "desde" | "hasta" | "serial" | "vehiculo" | "numCalor"; mensaje: string }[] = [];
  if (f.vehiculo.trim().length > 120) p.push({ campo: "vehiculo", mensaje: "Demasiado largo" });
  if (f.numCalor.trim().length > 120) p.push({ campo: "numCalor", mensaje: "Demasiado largo" });
  for (const campo of ["desde", "hasta"] as const) {
    const v = f[campo].trim();
    if (v && !zFiltroInforme.shape[campo].safeParse(v).success) {
      p.push({ campo, mensaje: "Fecha como AAAA-MM-DD, y que exista" });
    }
  }
  if (p.length === 0 && f.desde.trim() && f.hasta.trim() && f.desde.trim() > f.hasta.trim()) {
    p.push({ campo: "hasta", mensaje: "La fecha final es anterior a la inicial" });
  }
  if (f.serial.trim().length > 120) p.push({ campo: "serial", mensaje: "Serial demasiado largo" });
  return p;
}

/**
 * Parámetros de la URL. Lo vacío no viaja: un `serial=` vacío no es "sin
 * filtro" para todos los servidores. Los mismos parámetros sirven para la
 * vista previa y para el archivo, así lo que se ve es lo que sale.
 */
export function aConsulta(f: FiltroPantalla): string {
  const q = new URLSearchParams();
  if (f.clienteId) q.set("clienteId", f.clienteId);
  if (f.desde.trim()) q.set("desde", f.desde.trim());
  if (f.hasta.trim()) q.set("hasta", f.hasta.trim());
  if (f.vehiculoId) q.set("vehiculoId", f.vehiculoId);
  if (f.vehiculo.trim()) q.set("vehiculo", f.vehiculo.trim());
  if (f.serial.trim()) q.set("serial", f.serial.trim());
  if (f.numCalor.trim()) q.set("numCalor", f.numCalor.trim());
  if (f.servicio) q.set("servicio", f.servicio);
  if (f.estadoLlanta) q.set("estadoLlanta", f.estadoLlanta);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export interface FilaVista {
  /** Opcional: un servidor anterior no lo manda. */
  readonly ordenId?: string | null;
  readonly fecha: string;
  readonly folio: string;
  readonly estado: string;
  readonly vehiculo: string;
  readonly posicion: number;
  readonly serial: string | null;
  readonly marca: string | null;
  readonly noIdentificada: boolean;
  readonly profundidad: number | null;
  readonly desSerial: string | null;
  readonly servicios: readonly string[];
}

export interface OrdenVista {
  readonly id: string;
  readonly folio: string;
  readonly fecha: string;
  readonly estado: string;
  readonly vehiculo: string;
  readonly posiciones: number;
}

export interface VistaPrevia {
  readonly registros: number;
  readonly ordenes: number;
  readonly sinCerrar: number;
  readonly filas: readonly FilaVista[];
  /** Opcional: un servidor anterior no la manda, y entonces no se elige. */
  readonly listaOrdenes?: readonly OrdenVista[];
}

/**
 * La consulta de la vista previa más las órdenes elegidas. Sin elegir,
 * sale todo lo del filtro.
 */
export function conOrdenes(consulta: string, elegidas: readonly string[]): string {
  if (elegidas.length === 0) return consulta;
  const q = new URLSearchParams(consulta.startsWith("?") ? consulta.slice(1) : consulta);
  for (const id of elegidas) q.append("ordenIds", id);
  return `?${q.toString()}`;
}

/** Por qué no se puede sacar el PDF, o null si se puede. */
export function motivoSinPdf(totalOrdenes: number, elegidas: number): string | null {
  const n = elegidas > 0 ? elegidas : totalOrdenes;
  if (n === 0) return "No hay órdenes para el PDF";
  if (n > MAX_ORDENES_PDF) {
    return `El PDF admite hasta ${MAX_ORDENES_PDF} órdenes y son ${n}. Elige cuáles, o exporta la hoja de cálculo.`;
  }
  return null;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** "48 llantas de 3 órdenes" — lo primero que se mira para saber si el filtro está bien. */
export function resumen(v: VistaPrevia): string {
  if (v.registros === 0) return "No hay registros con esos filtros";
  return `${plural(v.registros, "llanta", "llantas")} de ${plural(v.ordenes, "orden", "órdenes")}`;
}

/**
 * Aviso de datos preliminares. Quien reciba el archivo debe saber que esas
 * mediciones todavía pueden cambiar; por eso se dice antes de exportar.
 */
export function avisoSinCerrar(v: VistaPrevia): string | null {
  if (v.sinCerrar === 0) return null;
  const todas = v.sinCerrar === v.ordenes;
  return todas
    ? `${v.ordenes === 1 ? "La orden va" : "Todas las órdenes van"} sin cerrar: las mediciones aún pueden cambiar`
    : `${plural(v.sinCerrar, "orden va", "órdenes van")} sin cerrar: sus mediciones aún pueden cambiar`;
}

/** Una línea por llanta, en el orden en que se dicta por teléfono. */
export function describirFila(f: FilaVista): string {
  const llanta = f.noIdentificada ? "SIN IDENTIFICAR" : [f.marca, f.serial].filter(Boolean).join(" ") || "Sin datos";
  const prof = f.profundidad === null ? "" : ` · ${String(f.profundidad).replace(".", ",")} mm`;
  return `Pos. ${f.posicion} · ${llanta}${prof}`;
}

export interface PasoTrazabilidad {
  readonly fecha: string;
  readonly folio: string;
  readonly vehiculoCodigo: string | null;
  readonly posicion: number;
  readonly profundidad: number | null;
  readonly kilometraje: number | null;
}

export interface Trazabilidad {
  readonly pasos: readonly PasoTrazabilidad[];
  readonly desgaste: { perdida: number; servicios: number } | null;
}

/** Cuánto se gastó la llanta entre la primera y la última medición. */
export function describirDesgaste(t: Trazabilidad): string | null {
  if (!t.desgaste) return null;
  const mm = String(t.desgaste.perdida).replace(".", ",");
  return `Perdió ${mm} mm en ${plural(t.desgaste.servicios, "medición", "mediciones")}`;
}

/**
 * El servidor manda el CSV con BOM para que Excel lea las tildes, pero
 * `Response.text()` lo quita al decodificar. Sin volver a ponerlo, el archivo
 * compartido desde el celular muestra "PosiciÃ³n".
 */
const BOM = String.fromCharCode(0xfeff);

export function conBOM(texto: string): string {
  return texto.startsWith(BOM) ? texto : `${BOM}${texto}`;
}

/** Nombre del archivo que puso el servidor; si no vino, uno genérico. */
export function nombreDeDescarga(contentDisposition: string | null): string {
  const m = /filename="?([^";]+)"?/i.exec(contentDisposition ?? "");
  return m?.[1]?.trim() || "informe.csv";
}
