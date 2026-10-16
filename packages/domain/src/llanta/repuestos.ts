/**
 * Llantas de repuesto.
 *
 * No están en el diagrama de ejes: cada vehículo lleva las que lleva (una,
 * dos, ninguna) y eso no depende de la plantilla. El técnico las agrega en la
 * orden y el vehículo recuerda cuántas tiene para la siguiente visita.
 *
 * Se guardan como posiciones numeradas aparte: el Repuesto 1 es la posición
 * 101, el 2 la 102… Así todo lo que ya funciona por posición (una medición
 * por posición, la llanta desmontada, la historia del activo, el informe)
 * sirve igual sin una tabla nueva, y nunca chocan con una posición de eje
 * (una plantilla no pasa de 60).
 */

export const BASE_REPUESTO = 100;
/** Más de diez repuestos en un vehículo sería un error de dedo. */
export const MAX_REPUESTOS = 10;

export function esRepuesto(posicion: number): boolean {
  return posicion > BASE_REPUESTO && posicion <= BASE_REPUESTO + MAX_REPUESTOS;
}

/** 101 → 1. */
export function numeroRepuesto(posicion: number): number {
  return posicion - BASE_REPUESTO;
}

/** 1 → 101. */
export function posicionRepuesto(numero: number): number {
  return BASE_REPUESTO + numero;
}

/** "Repuesto 1" o "Posición 3". */
export function nombrePosicion(posicion: number): string {
  return esRepuesto(posicion) ? `Repuesto ${numeroRepuesto(posicion)}` : `Posición ${posicion}`;
}

/** Para tablas y casillas: "R1" o "3". */
export function etiquetaPosicion(posicion: number): string {
  return esRepuesto(posicion) ? `R${numeroRepuesto(posicion)}` : String(posicion);
}

/**
 * Cuántos repuestos se muestran en una orden: los que el vehículo recuerda,
 * o más si en esta orden ya se midió uno más allá (el técnico lo agregó).
 */
export function repuestosDeLaOrden(recordados: number, posicionesMedidas: readonly number[]): number {
  const medidos = posicionesMedidas.filter(esRepuesto).map(numeroRepuesto);
  return Math.min(MAX_REPUESTOS, Math.max(recordados, 0, ...medidos));
}

/**
 * Lo que el vehículo recordará después de una inspección completa: hasta el
 * último repuesto que se midió. Si uno no se midió (ya no lo lleva), deja de
 * aparecer en la siguiente visita. Un correctivo no cambia nada: se revisan
 * unas pocas llantas, no todo el vehículo.
 */
export function repuestosTrasInspeccion(
  tipo: string,
  recordados: number,
  posicionesMedidas: readonly number[],
): number {
  const medidos = posicionesMedidas.filter(esRepuesto).map(numeroRepuesto);
  const ultimo = Math.max(0, ...medidos);
  if (tipo === "correctivo") return Math.max(recordados, ultimo);
  return ultimo;
}

/** "la posición 3" o "el repuesto 1", para frases. */
export function posicionEnFrase(posicion: number): string {
  return esRepuesto(posicion) ? `el repuesto ${numeroRepuesto(posicion)}` : `la posición ${posicion}`;
}

/** De la etiqueta corta a la larga: "R1" → "Repuesto 1", "3" → "Posición 3". */
export function nombreDeEtiqueta(etiqueta: string): string {
  return /^R\d+$/.test(etiqueta) ? `Repuesto ${etiqueta.slice(1)}` : `Posición ${etiqueta}`;
}
