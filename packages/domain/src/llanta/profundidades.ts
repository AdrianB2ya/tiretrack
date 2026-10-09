/**
 * Profundidad medida en tres puntos de la banda: exterior, centro e interior
 * (decisión del usuario, 2026-10-09).
 *
 * La llanta se cambia por su punto más gastado: la **mínima** de las tres es
 * la profundidad de la llanta, la que usan el desgaste, las alertas y el
 * informe. Así todo lo que ya trabajaba con una sola profundidad sigue igual.
 *
 * Basta con medir una: una llanta interna en un eje dual a veces solo deja
 * llegar a un punto. Obligar a las tres empujaría a inventar la que falta.
 */

export const PUNTOS_PROFUNDIDAD = ["exterior", "centro", "interior"] as const;
export type PuntoProfundidad = (typeof PUNTOS_PROFUNDIDAD)[number];

export const ETIQUETA_PUNTO_PROFUNDIDAD: Record<PuntoProfundidad, string> = {
  exterior: "Exterior",
  centro: "Centro",
  interior: "Interior",
};

export type TresProfundidades = Partial<Record<PuntoProfundidad, number | null>>;

/** Las medidas tomadas, en orden exterior → interior. */
export function medidasTomadas(p: TresProfundidades | null | undefined): number[] {
  if (!p) return [];
  return PUNTOS_PROFUNDIDAD.map((k) => p[k]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

/** La profundidad de la llanta: la mínima de las medidas tomadas, o null si no hay ninguna. */
export function profundidadDeReferencia(p: TresProfundidades | null | undefined): number | null {
  const m = medidasTomadas(p);
  return m.length === 0 ? null : Math.min(...m);
}

/** Cuáles faltan, para avisar sin bloquear. */
export function puntosSinMedir(p: TresProfundidades | null | undefined): PuntoProfundidad[] {
  return PUNTOS_PROFUNDIDAD.filter((k) => typeof p?.[k] !== "number");
}

/** "9,5 · 9 · 8,5" con un guion donde no se midió; vacío si no se midió nada. */
export function describirProfundidades(p: TresProfundidades | null | undefined): string {
  if (medidasTomadas(p).length === 0) return "";
  return PUNTOS_PROFUNDIDAD.map((k) => {
    const v = p?.[k];
    return typeof v === "number" ? String(v).replace(".", ",") : "–";
  }).join(" · ");
}
