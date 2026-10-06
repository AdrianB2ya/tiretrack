import { type Veredicto, PERMITIDO, negar, type Rol } from "../tipos";
import { FRECUENCIAS, ocurrencia, siguienteHabil, type Frecuencia } from "../tiempo/habiles";

/**
 * Programación recurrente: quién la crea, cómo se describe y qué fechas
 * produce. El servidor y la app usan estas mismas funciones: la vista previa
 * de fechas que ve el coordinador es exactamente lo que el trabajo generará.
 */

/** Programar visitas es operación de oficina: administrador y coordinador. */
export function puedeGestionarProgramaciones(rol: Rol | string): boolean {
  return rol === "administrador" || rol === "coordinador";
}

/** Tope de "cada": más allá, es más claro otra frecuencia (24 meses = 2 años). */
export const CADA_MAXIMO = 24;

const PLURALES: Record<Frecuencia, [string, string]> = {
  dias_habiles: ["Cada día hábil", "días hábiles"],
  dias_calendario: ["Cada día", "días"],
  semanal: ["Cada semana", "semanas"],
  quincenal: ["Cada quince días", "quincenas"],
  mensual: ["Cada mes", "meses"],
};

/** "Cada 2 meses". Escrito entero, no armado por sufijo (ver 4.3, plurales). */
export function describirFrecuencia(frecuencia: Frecuencia, cada: number): string {
  const [uno, varios] = PLURALES[frecuencia];
  return cada <= 1 ? uno : `Cada ${cada} ${varios}`;
}

export const FRECUENCIAS_PROGRAMABLES = FRECUENCIAS;

/**
 * La primera visita: el día de inicio, o el siguiente hábil si cae en fin de
 * semana. Es lo que queda como `proxima` al crear la programación.
 */
export function primeraVisita(inicioISO: string): string {
  return siguienteHabil(inicioISO);
}

/** Las próximas `n` visitas, para mostrarlas antes de guardar. */
export function proximasVisitas(inicioISO: string, frecuencia: Frecuencia, cada: number, n = 3): string[] {
  const fechas = [primeraVisita(inicioISO)];
  for (let k = 1; fechas.length < n && k < n * 4; k++) {
    const f = ocurrencia(inicioISO, frecuencia, cada, k);
    // Dos ocurrencias pueden caer el mismo lunes tras correrse por el fin de
    // semana; se muestra una sola, como hará el trabajo.
    if (f > (fechas[fechas.length - 1] as string)) fechas.push(f);
  }
  return fechas;
}

export interface DatosProgramacion {
  readonly inicio: string;
  readonly cada: number;
}

/** Lo que se puede decidir sin la base: fechas y periodo. */
export function revisarProgramacion(d: DatosProgramacion, hoyISO: string): Veredicto {
  if (!Number.isInteger(d.cada) || d.cada < 1 || d.cada > CADA_MAXIMO) {
    return negar("CADA_INVALIDO", `El periodo va de 1 a ${CADA_MAXIMO}`);
  }
  if (d.inicio < hoyISO) {
    // El trabajo la generaría en su siguiente vuelta, con fecha de hoy: la
    // primera visita no sería la que el coordinador escribió.
    return negar("INICIO_PASADO", "La primera visita no puede ser antes de hoy");
  }
  return PERMITIDO;
}
