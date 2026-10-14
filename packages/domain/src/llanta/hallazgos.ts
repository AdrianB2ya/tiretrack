/**
 * Hallazgos del levantamiento que salen de la medida misma (R6, pedido del
 * usuario 2026-10-13, tomado de su Excel de control de llantas).
 *
 * - **Diferencia de lados**: |exterior − interior|. Desde 1 mm la banda se
 *   gasta de un lado: en las posiciones 1 y 2 apunta a alineación; en las
 *   demás, a calibración y rotación.
 * - **Diferencia de presión**: encontrada − recomendada (la del eje). Con
 *   signo: negativa es que le faltaba aire.
 *
 * **Decisión del usuario (2026-10-14):** "posiciones 1 y 2" del Excel son el
 * NÚMERO de posición de la llanta, no el tipo de eje.
 */

export const UMBRAL_DIFERENCIA_LADOS = 1;

const redondear = (n: number) => Math.round(n * 100) / 100;

/** null si falta el exterior o el interior: no se inventa la diferencia. */
export function diferenciaDeLados(m: { exterior: number | null; interior: number | null }): number | null {
  if (m.exterior == null || m.interior == null) return null;
  return redondear(Math.abs(m.exterior - m.interior));
}

/** Qué revisar por la diferencia de lados; null si no llega al umbral. */
/** Las posiciones donde la diferencia de lados apunta a alineación. */
export const POSICIONES_ALINEACION: readonly number[] = [1, 2];

export function recomendacionPorLados(diferencia: number | null, posicion: number): string | null {
  if (diferencia == null || diferencia < UMBRAL_DIFERENCIA_LADOS) return null;
  return POSICIONES_ALINEACION.includes(posicion)
    ? "Alinear, revisar calibración y balanceo"
    : "Revisar calibración, rotación y balanceo";
}

/** Encontrada − recomendada, con signo; null si falta alguna. */
export function diferenciaPresion(encontrada: number | null | undefined, recomendada: number | null | undefined): number | null {
  if (encontrada == null || recomendada == null) return null;
  return redondear(encontrada - recomendada);
}
