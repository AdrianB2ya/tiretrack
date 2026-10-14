import type { Veredicto } from "../tipos";

/**
 * Sesión de soporte del superadmin (R16, brecha F).
 *
 * El superadmin no ve datos de ninguna empresa. Para ayudar a una, abre una
 * sesión de soporte con **motivo, ticket y vencimiento**: recibe un token
 * propio, sin renovación, que muere cuando vence la sesión, y que la base
 * comprueba en cada petición (terminarla corta el acceso en el acto).
 *
 * **Solo lectura**: puede ver y descargar, no modificar. Si soporte pudiera
 * escribir, una medición o una aprobación quedaría a nombre de alguien que
 * no estuvo frente al camión ni firmó nada. Todo lo que salga en la sesión
 * queda en la auditoría marcado como "vía soporte".
 */

export const DURACION_SOPORTE = { minima: 15, maxima: 240, porDefecto: 60 } as const;

/** Las duraciones que ofrece la pantalla, en minutos. */
export const OPCIONES_DURACION_SOPORTE = [30, 60, 120, 240] as const;

export const MINIMO_MOTIVO_SOPORTE = 20;

export function validarSoporte(s: { motivo: string; ticket: string; minutos: number }): Veredicto {
  if (s.motivo.trim().length < MINIMO_MOTIVO_SOPORTE) {
    return {
      permitido: false,
      codigo: "MOTIVO_CORTO",
      mensaje: `Explica para qué entras (al menos ${MINIMO_MOTIVO_SOPORTE} letras): queda en la auditoría de la empresa`,
    };
  }
  const t = s.ticket.trim();
  if (t.length < 3 || t.length > 40) {
    return { permitido: false, codigo: "TICKET_INVALIDO", mensaje: "Escribe el número del ticket de soporte (3 a 40 caracteres)" };
  }
  if (!Number.isInteger(s.minutos) || s.minutos < DURACION_SOPORTE.minima || s.minutos > DURACION_SOPORTE.maxima) {
    return {
      permitido: false,
      codigo: "DURACION_INVALIDA",
      mensaje: `La sesión dura entre ${DURACION_SOPORTE.minima} y ${DURACION_SOPORTE.maxima} minutos`,
    };
  }
  return { permitido: true };
}

/**
 * Qué deja pasar una sesión de soporte: consultas, y terminarla. Lo demás se
 * rechaza en el servidor antes de llegar a cualquier ruta.
 */
export function permitidoEnSoporte(metodo: string, ruta: string): boolean {
  const m = metodo.toUpperCase();
  if (m === "GET" || m === "HEAD") return true;
  return m === "POST" && /\/plataforma\/soporte\/terminar\/?(\?.*)?$/.test(ruta);
}
