import type { TipoEje } from "../tipos";

/**
 * Desgaste y umbrales.
 *
 * La profundidad de fábrica depende del DISEÑO **y de la MEDIDA**, no solo
 * del diseño: un XZY-3 en 295/80R22.5 trae 16 mm y en 11R22.5 trae 14.5. Si
 * se calcula contra un solo número por diseño, el porcentaje sale mal en
 * cuanto la flota tenga dos medidas del mismo diseño, que es lo normal.
 */

/** Configuración de un eje: umbrales con los que se juzga cada posición. */
export interface DefinicionEje {
  readonly numero: number;
  readonly tipoEje: TipoEje;
  /** Presión objetivo del eje. El técnico no la escribe: se precarga. */
  readonly psiObjetivo?: number;
  /** Profundidad por debajo de la cual la llanta debe salir de servicio. */
  readonly profundidadMinima?: number;
  readonly posicionesIzquierda: readonly number[];
  readonly posicionesDerecha: readonly number[];
}

/** Tolerancia de presión antes de marcar la lectura como fuera de rango. */
export const TOLERANCIA_PSI = 0.15;

/**
 * Porcentaje de desgaste. Devuelve null cuando falta la profundidad original,
 * que es lo que pasa si la medida no tiene el dato de fábrica cargado.
 */
export function calcularDesgaste(
  profundidadActual: number | null | undefined,
  profundidadOriginal: number | null | undefined,
): number | null {
  if (profundidadActual == null || profundidadOriginal == null) return null;
  if (profundidadOriginal <= 0) return null;
  const bruto = (1 - profundidadActual / profundidadOriginal) * 100;
  // Una llanta no puede tener desgaste negativo ni mayor al 100%
  return Math.min(100, Math.max(0, Math.round(bruto)));
}

/** La llanta está por debajo del mínimo del eje: debe salir de servicio. */
export function bajoMinimo(
  profundidad: number | null | undefined,
  minimoEje: number | null | undefined,
): boolean {
  if (profundidad == null || minimoEje == null) return false;
  return profundidad < minimoEje;
}

/** La presión encontrada se aleja del objetivo más de lo tolerado. */
export function presionFueraDeRango(
  psiEncontrada: number | null | undefined,
  psiObjetivo: number | null | undefined,
  tolerancia: number = TOLERANCIA_PSI,
): boolean {
  if (psiEncontrada == null || psiObjetivo == null || psiObjetivo <= 0) return false;
  return Math.abs(psiEncontrada - psiObjetivo) > psiObjetivo * tolerancia;
}

/** Localiza el eje al que pertenece una posición del diagrama. */
export function ejeDePosicion(
  ejes: readonly DefinicionEje[],
  posicion: number,
): DefinicionEje | null {
  return (
    ejes.find(
      (e) => e.posicionesIzquierda.includes(posicion) || e.posicionesDerecha.includes(posicion),
    ) ?? null
  );
}

/**
 * Posiciones hermanas: las demás del mismo eje. Suelen llevar la misma
 * llanta, y es lo que permite copiar en vez de teclear ocho campos.
 */
export function posicionesHermanas(
  ejes: readonly DefinicionEje[],
  posicion: number,
): number[] {
  const eje = ejeDePosicion(ejes, posicion);
  if (!eje) return [];
  return [...eje.posicionesIzquierda, ...eje.posicionesDerecha].filter((p) => p !== posicion);
}

/** Total de posiciones que define una configuración. */
export function totalPosiciones(ejes: readonly DefinicionEje[]): number {
  return ejes.reduce((n, e) => n + e.posicionesIzquierda.length + e.posicionesDerecha.length, 0);
}

/**
 * Verifica que una configuración de ejes sea coherente: posiciones
 * consecutivas desde 1, sin huecos ni repetidos. Una configuración mal
 * armada produce un diagrama que no corresponde con el vehículo.
 */
export function configuracionCoherente(ejes: readonly DefinicionEje[]): boolean {
  const todas = ejes.flatMap((e) => [...e.posicionesIzquierda, ...e.posicionesDerecha]);
  if (todas.length === 0) return false;
  const unicas = new Set(todas);
  if (unicas.size !== todas.length) return false;
  const ordenadas = [...unicas].sort((a, b) => a - b);
  return ordenadas.every((valor, i) => valor === i + 1);
}
