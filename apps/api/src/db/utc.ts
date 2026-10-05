import pg from "pg";

/**
 * Toda marca de tiempo, en UTC.
 *
 * Las columnas `DateTime` de Prisma son `timestamp(3)` SIN zona horaria, y
 * Prisma guarda ahí la hora UTC. Pero el resto de escritores no seguía esa
 * convención en una máquina con otra zona horaria —el servidor de desarrollo
 * está en America/Bogota—:
 *
 *   - `now()` en PostgreSQL escribía la hora LOCAL de la sesión.
 *   - `pg` enviaba las fechas de JavaScript en hora local y la columna, al no
 *     tener zona, descartaba el desfase.
 *   - `pg` leía esas columnas como hora local.
 *
 * Mezcladas, las comparaciones quedaban corridas cinco horas: la descarga
 * incremental, los plazos de aprobación y el vencimiento de los tokens. En
 * un servidor en UTC todo coincidía de casualidad.
 *
 * Esto fija la convención de Prisma para todos, en un solo sitio.
 */

/** Opciones de arranque de cada conexión: la sesión en UTC, para que now() escriba UTC. */
export const OPCIONES_SESION_UTC = "-c timezone=UTC";

const TIMESTAMP_SIN_ZONA = 1114;
let configurado = false;

/** Fechas de JavaScript enviadas y leídas como UTC. Idempotente. */
export function configurarUtc(): void {
  if (configurado) return;
  configurado = true;
  pg.defaults.parseInputDatesAsUTC = true;
  // Sin esto, "2026-10-05 17:44:34" se leería como hora local.
  pg.types.setTypeParser(TIMESTAMP_SIN_ZONA, (v: string) => new Date(`${v.replace(" ", "T")}Z`));
}
