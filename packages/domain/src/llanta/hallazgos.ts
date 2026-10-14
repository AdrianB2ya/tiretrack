/**
 * Hallazgos del levantamiento que salen de la medida misma (R6, pedido del
 * usuario 2026-10-13, tomado de su Excel de control de llantas).
 *
 * - **Diferencia de lados**: |exterior − interior|. Desde 1 mm la banda se
 *   gasta de un lado: en el eje direccional apunta a alineación; en los
 *   demás, a calibración y rotación.
 * - **Diferencia de presión**: encontrada − recomendada (la del eje). Con
 *   signo: negativa es que le faltaba aire.
 *
 * "Posiciones 1 y 2" del Excel se tomó como **el eje direccional**, para que
 * sirva con cualquier plantilla (pendiente de confirmar con el usuario).
 */

export const UMBRAL_DIFERENCIA_LADOS = 1;

const redondear = (n: number) => Math.round(n * 100) / 100;

/** null si falta el exterior o el interior: no se inventa la diferencia. */
export function diferenciaDeLados(m: { exterior: number | null; interior: number | null }): number | null {
  if (m.exterior == null || m.interior == null) return null;
  return redondear(Math.abs(m.exterior - m.interior));
}

/** Qué revisar por la diferencia de lados; null si no llega al umbral. */
export function recomendacionPorLados(diferencia: number | null, tipoEje: string | null | undefined): string | null {
  if (diferencia == null || diferencia < UMBRAL_DIFERENCIA_LADOS) return null;
  return tipoEje === "direccional"
    ? "Alinear, revisar calibración y balanceo"
    : "Revisar calibración, rotación y balanceo";
}

/** Encontrada − recomendada, con signo; null si falta alguna. */
export function diferenciaPresion(encontrada: number | null | undefined, recomendada: number | null | undefined): number | null {
  if (encontrada == null || recomendada == null) return null;
  return redondear(encontrada - recomendada);
}
