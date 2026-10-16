/**
 * Formatos para leer, no para guardar.
 *
 * Las fechas viajan y se guardan como AAAA-MM-DD; en pantalla se leen mejor
 * como "6 oct 2026" (revisión de diseño: listas enteras mostraban
 * "2026-10-06"). Los campos donde se ESCRIBE una fecha siguen en AAAA-MM-DD.
 */
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-10-06" o "2026-10-06T14:00:00Z" → "6 oct 2026". Lo que no sea fecha se deja igual. */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const mes = MESES[Number(m[2]) - 1];
  return mes ? `${Number(m[3])} ${mes} ${m[1]}` : iso;
}

/** "2026-10-16 09:05" (fechaHoraEnColombia) → "16 oct 2026 · 09:05". */
export function fechaHoraCorta(texto: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(texto);
  return m ? `${fechaCorta(m[1])} · ${m[2]}` : texto;
}
