/**
 * Zona horaria del sistema: Colombia (decisión del usuario, 2026-10-06).
 *
 * "Hoy" es el día en Colombia, no en UTC. Calculado en UTC, después de las
 * 7 p. m. ya era el día siguiente: el archivo exportado llevaba la fecha de
 * mañana, y los plazos de aprobación y las recurrencias podían correrse un día.
 *
 * Colombia no tiene horario de verano desde 1993: el desfase es fijo. Se usa
 * el desfase en vez de `Intl` con `timeZone` porque así da lo mismo en el
 * servidor, en las pruebas y en el celular, sin depender de los datos de
 * zonas que traiga cada motor de JavaScript.
 */

export const ZONA_HORARIA = "America/Bogota";

/** Horas que Colombia va detrás de UTC. */
export const DESFASE_COLOMBIA_HORAS = -5;

/** Día calendario en Colombia (AAAA-MM-DD) del instante dado. */
export function fechaEnColombia(instante: Date = new Date()): string {
  const local = new Date(instante.getTime() + DESFASE_COLOMBIA_HORAS * 3_600_000);
  return local.toISOString().slice(0, 10);
}

/** Día y hora en Colombia (AAAA-MM-DD HH:MM), para mostrar un instante guardado en UTC. */
export function fechaHoraEnColombia(instante: Date | string): string {
  const t = typeof instante === "string" ? new Date(instante) : instante;
  return new Date(t.getTime() + DESFASE_COLOMBIA_HORAS * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}
