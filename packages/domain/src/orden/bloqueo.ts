import { type Veredicto, PERMITIDO, negar, type Rol, type EstadoOrden } from "../tipos";

/**
 * Bloqueo de la orden (R7, decisiones del usuario 2026-10-13).
 *
 * El técnico asignado, **con señal**, se lleva la orden antes de salir a
 * trabajar sin ella ("me llevo esta orden"). Mientras la tenga:
 *
 * - la oficina **solo la ve**: para reasignarla, primero la libera (con
 *   motivo, que queda en la auditoría). Anularla sí puede sin liberarla, y
 *   el bloqueo se suelta solo (decisión del usuario, 2026-10-14);
 * - la liberan el administrador o el coordinador, o el propio técnico; y se
 *   libera sola cuando él la envía a revisión.
 *
 * No vence con el tiempo (no lo pidió el usuario). Si la oficina la libera y
 * otro técnico la trabaja, lo que traiga el primero al recuperar señal se
 * rechaza —ya no es el asignado— y queda apartado en su teléfono con el
 * motivo, no borrado.
 */

/** Estados en los que tiene sentido llevársela: por hacer o en curso. */
export const ESTADOS_BLOQUEABLES: readonly EstadoOrden[] = ["programada", "en_proceso"];

/** Un motivo con sustancia, como en las devoluciones: queda en la auditoría. */
export const MOTIVO_MINIMO_LIBERAR = 10;

export interface SituacionBloqueo {
  readonly rol: Rol;
  readonly usuarioId: string;
  readonly tecnicoId: string;
  readonly estado: EstadoOrden;
  readonly bloqueadaPorId: string | null;
}

export function puedeTomarBloqueo(s: SituacionBloqueo): Veredicto {
  if (s.rol !== "tecnico" || s.usuarioId !== s.tecnicoId) {
    return negar("SOLO_ASIGNADO", "Solo el técnico asignado se lleva la orden");
  }
  if (!ESTADOS_BLOQUEABLES.includes(s.estado)) {
    return negar("ESTADO_INVALIDO", "Solo se lleva una orden por hacer o en curso");
  }
  if (s.bloqueadaPorId && s.bloqueadaPorId !== s.usuarioId) {
    return negar("YA_BLOQUEADA", "Otro técnico ya se la llevó");
  }
  // Volver a tomarla siendo quien la tiene no es error: reintentar con mala
  // señal no debe asustar al técnico.
  return PERMITIDO;
}

export function puedeLiberarBloqueo(s: SituacionBloqueo & { motivo?: string | null }): Veredicto {
  if (!s.bloqueadaPorId) return negar("NO_BLOQUEADA", "La orden no está bloqueada");
  if (s.usuarioId === s.bloqueadaPorId) return PERMITIDO;
  if (s.rol !== "administrador" && s.rol !== "coordinador") {
    return negar("SIN_PERMISO", "La liberan el técnico que la tiene, el coordinador o el administrador");
  }
  if ((s.motivo ?? "").trim().length < MOTIVO_MINIMO_LIBERAR) {
    return negar("MOTIVO_REQUERIDO", "Di por qué la liberas: el técnico va a ver que ya no es suya");
  }
  return PERMITIDO;
}

/**
 * Reasignar con la orden en manos de un técnico: primero se libera. Si no, el
 * técnico sigue trabajando sin señal sobre algo que ya cambió. (Anular no lo
 * exige: una anulada no la trabaja nadie.)
 */
export function exigeLiberar(bloqueadaPorId: string | null, usuarioId: string): Veredicto {
  if (bloqueadaPorId && bloqueadaPorId !== usuarioId) {
    return negar("ORDEN_BLOQUEADA", "Un técnico se la llevó para trabajar sin señal. Libérala primero");
  }
  return PERMITIDO;
}
