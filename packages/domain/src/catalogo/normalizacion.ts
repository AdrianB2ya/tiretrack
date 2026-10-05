/**
 * Normalización del catálogo de marcas, diseños y medidas.
 *
 * Si cada técnico escribe la marca a mano, en tres meses hay "Michelin",
 * "michelin", "MICHELIN" y "Michellin" como cuatro marcas distintas, y la
 * pregunta que justifica el producto —qué marca dura más— deja de tener
 * respuesta. Por eso se busca antes de dejar crear.
 */

/** Minúsculas y sin tildes. Para búsquedas. */
export function normalizar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Además sin espacios, guiones ni puntos. Para comparar identidad. */
export function clave(texto: string): string {
  return normalizar(texto).replace(/[\s\-_.]/g, "");
}

/**
 * Distancia de edición acotada. Detecta "Michelín" vs "Michelin" o
 * "XZY3" vs "XZY-3". Corta pronto cuando las longitudes son muy distintas,
 * porque se ejecuta en cada tecla que escribe el técnico.
 */
export function distancia(a: string, b: string, maxDiferencia = 3): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > maxDiferencia) return maxDiferencia + 1;
  if (m === 0) return n;
  if (n === 0) return m;

  let previa: number[] = Array.from({ length: n + 1 }, (_, j) => j);

  for (let i = 1; i <= m; i++) {
    const actual: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(
        (previa[j] ?? 0) + 1,
        (actual[j - 1] ?? 0) + 1,
        (previa[j - 1] ?? 0) + costo,
      );
    }
    previa = actual;
  }
  return previa[n] ?? 0;
}

export interface EntradaCatalogo {
  readonly id: string;
  readonly nombre: string;
}

export interface ResultadoBusqueda<T extends EntradaCatalogo> {
  /** Coincidencia exacta ignorando tildes, espacios y guiones. */
  readonly duplicado: T | null;
  /** Muy parecidas: se muestran antes de permitir crear. */
  readonly parecidas: readonly T[];
  /** false cuando ya existe idéntica. */
  readonly puedeCrear: boolean;
}

export const LARGO_MINIMO_CREAR = 2;
export const DISTANCIA_SIMILITUD = 2;

/**
 * Evalúa un nombre nuevo contra el catálogo existente.
 *
 * El duplicado exacto se bloquea. El parecido se advierte pero se permite:
 * "Michelin" y "Michelim" podrían ser marcas distintas de verdad, y bloquear
 * de más obliga al técnico a inventar variantes para poder guardar.
 */
export function evaluarNombreNuevo<T extends EntradaCatalogo>(
  nombre: string,
  existentes: readonly T[],
  maxParecidas = 3,
): ResultadoBusqueda<T> {
  const limpio = nombre.trim();
  if (limpio.length < LARGO_MINIMO_CREAR) {
    return { duplicado: null, parecidas: [], puedeCrear: false };
  }

  const claveNueva = clave(limpio);
  const duplicado = existentes.find((e) => clave(e.nombre) === claveNueva) ?? null;
  if (duplicado) {
    return { duplicado, parecidas: [], puedeCrear: false };
  }

  const parecidas =
    limpio.length >= 3
      ? existentes
          .filter((e) => distancia(clave(e.nombre), claveNueva) <= DISTANCIA_SIMILITUD)
          .slice(0, maxParecidas)
      : [];

  return { duplicado: null, parecidas, puedeCrear: true };
}

/** Filtra por coincidencia parcial, ignorando tildes y mayúsculas. */
export function buscar<T extends EntradaCatalogo>(
  termino: string,
  existentes: readonly T[],
): T[] {
  if (!termino.trim()) return [...existentes];
  const t = normalizar(termino);
  return existentes.filter((e) => normalizar(e.nombre).includes(t));
}
