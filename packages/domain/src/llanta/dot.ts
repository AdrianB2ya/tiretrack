/**
 * Código DOT.
 *
 * El DOT NO es una fecha de vencimiento: es la fecha de FABRICACIÓN, en
 * formato semana + año de dos dígitos. "3624" es la semana 36 de 2024.
 *
 * El vencimiento se deriva: el caucho se degrada con el tiempo aunque la
 * llanta nunca se haya usado, así que a los seis años se considera vencida.
 */

export const ANIOS_VIDA_DOT = 6;

export interface LecturaDOT {
  readonly semana: number;
  readonly anio: number;
  /** Lunes aproximado de esa semana. */
  readonly fabricacion: Date;
  readonly fabricacionTexto: string;
  readonly aniosCumplidos: number;
  /** Fecha ISO en que cumple los años de vida. */
  readonly vencimiento: string;
  readonly vencida: boolean;
  /** Le queda menos de un año. */
  readonly porVencer: boolean;
}

/**
 * Interpreta un código DOT. Acepta el código completo grabado en el flanco
 * (que trae planta y medida antes) o solo los cuatro dígitos finales.
 *
 * Devuelve null si el código no es interpretable, en vez de inventar una
 * fecha: un dato inventado en el cálculo de vencimiento es peor que uno
 * faltante.
 */
export function leerDOT(codigo: string | null | undefined, hoy: Date = new Date()): LecturaDOT | null {
  const digitos = String(codigo ?? "").replace(/\D/g, "");
  if (digitos.length < 4) return null;

  const ultimos = digitos.slice(-4);
  const semana = Number.parseInt(ultimos.slice(0, 2), 10);
  const anioCorto = Number.parseInt(ultimos.slice(2), 10);

  if (!Number.isFinite(semana) || semana < 1 || semana > 53) return null;
  if (!Number.isFinite(anioCorto)) return null;

  // Dos dígitos: 00-79 se lee como 2000s, 80-99 como 1900s. Una llanta de
  // los noventa está vencida de todos modos, pero la fecha debe ser correcta.
  const anio = anioCorto <= 79 ? 2000 + anioCorto : 1900 + anioCorto;

  const fabricacion = new Date(Date.UTC(anio, 0, 1 + (semana - 1) * 7));
  const vence = new Date(fabricacion);
  vence.setUTCFullYear(vence.getUTCFullYear() + ANIOS_VIDA_DOT);

  const msTranscurridos = hoy.getTime() - fabricacion.getTime();
  const aniosTranscurridos = msTranscurridos / (365.25 * 24 * 60 * 60 * 1000);

  const vencimientoISO = vence.toISOString().split("T")[0] ?? "";

  return {
    semana,
    anio,
    fabricacion,
    fabricacionTexto: `Semana ${semana} de ${anio}`,
    aniosCumplidos: Math.floor(aniosTranscurridos),
    vencimiento: vencimientoISO,
    vencida: hoy.getTime() >= vence.getTime(),
    porVencer:
      hoy.getTime() < vence.getTime() &&
      aniosTranscurridos >= ANIOS_VIDA_DOT - 1,
  };
}

/** Solo la validez del formato, sin calcular fechas. */
export function dotValido(codigo: string | null | undefined): boolean {
  return leerDOT(codigo) !== null;
}
