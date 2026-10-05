/**
 * Cuánto y cómo comprimir una foto antes de subirla.
 *
 * Una foto de celular pesa entre 3 y 5 MB. Veintidós de esas son cien
 * megabytes por orden, y la señal en una vía rural no los sube: la foto se
 * queda en la cola para siempre y el técnico nunca sabe por qué.
 *
 * Lo que se decide aquí es puro a propósito. La compresión real la hace el
 * dispositivo, que no se puede probar en Node; el criterio sí, y es donde un
 * error cuesta caro: comprimir de más deja ilegible el serial de una llanta,
 * que es justo lo que la foto tenía que demostrar.
 */

/** Lado mayor máximo. Con 1600 px el flanco de una llanta se lee bien. */
export const LADO_MAXIMO = 1600;

/** Objetivo de tamaño: lo que sube en pocos segundos con señal pobre. */
export const OBJETIVO_BYTES = 200 * 1024;

/**
 * Por debajo de esto no se toca la foto.
 *
 * Recomprimir algo que ya es pequeño pierde calidad sin ganar nada: cada
 * pasada de JPEG degrada, y el serial se lee una sola vez.
 */
export const MINIMO_PARA_COMPRIMIR = 300 * 1024;

/** Calidad mínima aceptable: por debajo, el número de serie se vuelve ilegible. */
export const CALIDAD_MINIMA = 0.5;
export const CALIDAD_INICIAL = 0.7;

export interface Imagen {
  readonly ancho: number;
  readonly alto: number;
  readonly tamanoBytes: number;
}

export interface PlanDeCompresion {
  /** Lado mayor de destino, o null si no hay que redimensionar. */
  readonly redimensionarA: number | null;
  readonly calidad: number;
}

/**
 * Plan para una imagen. `null` significa subirla tal cual.
 */
export function planDeCompresion(imagen: Imagen): PlanDeCompresion | null {
  const ladoMayor = Math.max(imagen.ancho, imagen.alto);
  const grande = ladoMayor > LADO_MAXIMO;
  const pesada = imagen.tamanoBytes > MINIMO_PARA_COMPRIMIR;

  if (!grande && !pesada) return null;

  return {
    redimensionarA: grande ? LADO_MAXIMO : null,
    calidad: CALIDAD_INICIAL,
  };
}

/**
 * Siguiente intento cuando el resultado todavía pesa demasiado.
 *
 * Baja la calidad, nunca por debajo del mínimo legible. Devuelve null cuando
 * ya no se puede bajar más: entonces se sube lo que haya. Una foto grande
 * que tarda es mejor que ninguna foto, y mucho mejor que una ilegible.
 */
export function siguienteIntento(plan: PlanDeCompresion, tamanoLogrado: number): PlanDeCompresion | null {
  if (tamanoLogrado <= OBJETIVO_BYTES) return null;
  const calidad = Math.round((plan.calidad - 0.1) * 100) / 100;
  if (calidad < CALIDAD_MINIMA) return null;
  return { ...plan, calidad };
}

/** Cuánto se ahorró, para mostrarlo y para decidir si valió la pena. */
export function ahorro(original: number, final: number): number {
  if (original <= 0) return 0;
  return Math.max(0, Math.round((1 - final / original) * 100));
}
