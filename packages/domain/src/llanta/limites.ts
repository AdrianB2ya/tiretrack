import { type Veredicto, PERMITIDO, negar } from "../tipos";

/**
 * Límites de cambio de llanta, por empresa (R2, decisión del usuario
 * 2026-10-13: "hay empresas que manejan diferentes límites").
 *
 * Dos niveles, como el informe que pidió el usuario:
 *
 * - **Cambio inmediato** (en rojo): la llanta llegó a su profundidad baja,
 *   la mínima con la que puede rodar. Es también la "PROF BAJA" del Excel de
 *   levantamiento, contra la que se calcula el % rodado.
 * - **Programar cambio** (preventivo): todavía rueda, pero hay que comprarla
 *   y agendar la visita.
 *
 * El mínimo de cada eje en la plantilla manda sobre el de la empresa cuando
 * está definido: el direccional suele exigir más que el de arrastre. Si no lo
 * tiene, vale el de la empresa.
 *
 * El límite **se incluye**: "llantas con 3 mm en rojo" (palabras del usuario)
 * es 3 mm o menos.
 */

export interface LimitesEmpresa {
  /** mm: a esta profundidad o menos, cambio inmediato. */
  readonly cambioInmediato: number;
  /** mm: por encima del inmediato y hasta aquí, programar el cambio. */
  readonly programarCambio: number;
}

/** Los del ejemplo del usuario: 3 mm en rojo; 5 mm para programar. */
export const LIMITES_POR_DEFECTO: LimitesEmpresa = { cambioInmediato: 3, programarCambio: 5 };

export const NIVELES_CAMBIO = ["cambio_inmediato", "programar_cambio"] as const;
export type NivelCambio = (typeof NIVELES_CAMBIO)[number];

export const ETIQUETA_NIVEL_CAMBIO: Record<NivelCambio, string> = {
  cambio_inmediato: "CAMBIO INMEDIATO",
  programar_cambio: "PROGRAMAR CAMBIO",
};

export function validarLimites(l: LimitesEmpresa): Veredicto {
  if (!(l.cambioInmediato > 0)) return negar("LIMITE_INVALIDO", "El límite de cambio inmediato debe ser mayor que 0 mm");
  if (!(l.programarCambio > l.cambioInmediato)) {
    return negar("LIMITE_INVALIDO", "Programar el cambio tiene que empezar por encima del cambio inmediato");
  }
  if (l.programarCambio > 30) return negar("LIMITE_INVALIDO", "Más de 30 mm no es una profundidad de cambio");
  return PERMITIDO;
}

export interface Umbrales {
  readonly inmediato: number;
  readonly programar: number;
}

/** Los de una posición: el mínimo de su eje si lo tiene; si no, el de la empresa. */
export function umbralesDeCambio(minimoEje: number | null | undefined, l: LimitesEmpresa): Umbrales {
  if (minimoEje == null) return { inmediato: l.cambioInmediato, programar: l.programarCambio };
  // Con el mínimo del eje, la banda preventiva de la empresa se corre con él:
  // un direccional que exige 4 mm se programa desde 6, no desde 5.
  const banda = l.programarCambio - l.cambioInmediato;
  return { inmediato: minimoEje, programar: Math.max(l.programarCambio, minimoEje + banda) };
}

/** null si la llanta está bien o no se midió: un dato faltante no es un dato malo. */
export function nivelDeCambio(profundidad: number | null | undefined, u: Umbrales): NivelCambio | null {
  if (profundidad == null || profundidad < 0) return null;
  if (profundidad <= u.inmediato) return "cambio_inmediato";
  if (profundidad <= u.programar) return "programar_cambio";
  return null;
}
