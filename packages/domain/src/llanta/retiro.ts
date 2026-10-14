import { type Veredicto, PERMITIDO, negar } from "../tipos";

/**
 * Retiro y fallas (R10, brecha B).
 *
 * Por qué sale una llanta es lo que permite saber qué marca rinde y cuál
 * falla. Un campo libre produce veinte formas de escribir "corte": por eso
 * es una lista, con código estable (lo que viaja) y etiqueta (lo que se ve).
 *
 * Las **fallas** (no el desgaste normal) exigen foto: sin evidencia no hay
 * análisis de causa ni reclamo de garantía que prospere.
 */

export const MOTIVOS_RETIRO = [
  "desgaste_normal",
  "desgaste_irregular",
  "corte",
  "impacto",
  "separacion",
  "falla_reencauche",
  "pinchazo",
  "vencida",
  "otro",
] as const;
export type MotivoRetiro = (typeof MOTIVOS_RETIRO)[number];

export const ETIQUETA_MOTIVO_RETIRO: Record<MotivoRetiro, string> = {
  desgaste_normal: "Desgaste normal",
  desgaste_irregular: "Desgaste irregular",
  corte: "Corte",
  impacto: "Impacto",
  separacion: "Separación",
  falla_reencauche: "Falla de reencauche",
  pinchazo: "Pinchazo",
  vencida: "Vencida por DOT",
  otro: "Otro",
};

/** Las que son una falla: piden foto y pueden dar lugar a un reclamo. */
export const MOTIVOS_FALLA: readonly MotivoRetiro[] = [
  "desgaste_irregular", "corte", "impacto", "separacion", "falla_reencauche",
];

export function esFalla(m: string | null | undefined): boolean {
  return MOTIVOS_FALLA.includes(m as MotivoRetiro);
}

/**
 * Posiciones cuya llanta salió por una falla y no tienen foto. Impiden enviar
 * la orden: la evidencia se toma frente a la llanta, después ya no se puede.
 */
export function retirosSinFoto(
  desmontadas: readonly { posicion: number; motivoRetiro: string | null | undefined }[],
  fotosPorPosicion: ReadonlyMap<number, number>,
): number[] {
  return desmontadas
    .filter((d) => esFalla(d.motivoRetiro) && (fotosPorPosicion.get(d.posicion) ?? 0) === 0)
    .map((d) => d.posicion)
    .sort((a, b) => a - b);
}

// ── Garantías y reclamos ────────────────────────────────────────────────────

export const ESTADOS_RECLAMO = ["abierto", "enviado", "aprobado", "rechazado", "cerrado"] as const;
export type EstadoReclamo = (typeof ESTADOS_RECLAMO)[number];

export const ETIQUETA_ESTADO_RECLAMO: Record<EstadoReclamo, string> = {
  abierto: "Abierto",
  enviado: "Enviado al proveedor",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  cerrado: "Cerrado",
};

const SIGUIENTES: Record<EstadoReclamo, readonly EstadoReclamo[]> = {
  abierto: ["enviado", "cerrado"],
  enviado: ["aprobado", "rechazado"],
  aprobado: ["cerrado"],
  rechazado: ["cerrado"],
  cerrado: [],
};

export function siguientesReclamo(e: EstadoReclamo): readonly EstadoReclamo[] {
  return SIGUIENTES[e] ?? [];
}

export function evaluarCambioReclamo(desde: EstadoReclamo, hacia: EstadoReclamo, valorReconocido?: number | null): Veredicto {
  if (!siguientesReclamo(desde).includes(hacia)) {
    return negar("TRANSICION_INVALIDA", `Un reclamo ${ETIQUETA_ESTADO_RECLAMO[desde].toLowerCase()} no pasa a ${ETIQUETA_ESTADO_RECLAMO[hacia].toLowerCase()}`);
  }
  // Aprobado sin decir cuánto se reconoció no sirve para cobrar.
  if (hacia === "aprobado" && (valorReconocido == null || valorReconocido < 0)) {
    return negar("VALOR_REQUERIDO", "Di cuánto reconoció el proveedor");
  }
  return PERMITIDO;
}
