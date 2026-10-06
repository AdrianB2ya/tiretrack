import { type Veredicto, PERMITIDO, negar, type Rol } from "../tipos";
import { estaAbierta } from "./estados";
import { puedeAprobar } from "./firma";

/**
 * Recomendaciones persistentes: lo que el técnico encuentra y no ejecuta en la
 * visita ("cambiar la posición 3 en la próxima"). Sobreviven al cierre de la
 * orden y reaparecen en la siguiente de ese vehículo hasta que alguien las
 * marca hechas o las descarta.
 *
 * No son contenido firmado: el cliente firma lo que se HIZO, y una
 * recomendación es lo que falta por hacer. Agregarla no invalida la firma.
 */

export const PRIORIDADES_RECOMENDACION = ["urgente", "proxima", "seguimiento"] as const;
export type PrioridadRecomendacion = (typeof PRIORIDADES_RECOMENDACION)[number];
export const ESTADOS_RECOMENDACION = ["abierta", "ejecutada", "descartada"] as const;
export type EstadoRecomendacion = (typeof ESTADOS_RECOMENDACION)[number];

export const ETIQUETA_PRIORIDAD_RECOMENDACION: Record<PrioridadRecomendacion, string> = {
  urgente: "Urgente",
  proxima: "Próxima visita",
  seguimiento: "Seguimiento",
};

export interface ContextoRecomendacion {
  readonly rol: Rol;
  /** Quien pregunta es el técnico asignado a la orden. */
  readonly esTecnicoAsignado: boolean;
  readonly estadoOrden: string;
}

/**
 * Recomendar o resolver se hace sobre una orden abierta, por su técnico o por
 * la oficina. El cliente consulta, no escribe; y una orden cerrada es un
 * documento que no cambia.
 */
export function puedeGestionarRecomendaciones(c: ContextoRecomendacion): Veredicto {
  if (c.rol === "cliente") return negar("SIN_PERMISO", "El cliente consulta las recomendaciones, no las registra");
  if (!estaAbierta(c.estadoOrden as never)) {
    return negar("ORDEN_CERRADA", "La orden ya no está abierta: las recomendaciones se registran en una orden en curso");
  }
  if (!c.esTecnicoAsignado && !puedeAprobar(c.rol)) {
    return negar("SOLO_ASIGNADO", "Solo el técnico asignado o la oficina registran recomendaciones en esta orden");
  }
  return PERMITIDO;
}

/** Más urgentes primero; entre iguales, las más viejas (llevan más esperando). */
export function ordenarRecomendaciones<T extends { prioridad: string; creadaEn: string }>(rs: readonly T[]): T[] {
  const peso = (p: string) => Math.max(0, PRIORIDADES_RECOMENDACION.indexOf(p as PrioridadRecomendacion));
  return [...rs].sort((a, b) => peso(a.prioridad) - peso(b.prioridad) || a.creadaEn.localeCompare(b.creadaEn));
}
