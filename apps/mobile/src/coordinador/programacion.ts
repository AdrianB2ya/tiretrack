import {
  CADA_MAXIMO,
  FRECUENCIAS,
  diasHabilesEntre,
  proximasVisitas,
  revisarProgramacion,
  type Frecuencia,
  type TipoServicio,
} from "@tiretrack/domain";
import { zCrearProgramacion, zFechaISO, type CrearProgramacion } from "@tiretrack/contracts";

/**
 * Programación recurrente en la app (4.4): el coordinador decide que un
 * vehículo se revise cada cierto tiempo; el servidor genera las órdenes y se
 * las asigna al técnico fijo.
 *
 * Antes de guardar se muestran las próximas visitas, calculadas con la MISMA
 * función del dominio que usa el trabajo programado: lo que el coordinador ve
 * es lo que va a pasar.
 */

export interface FormularioProgramacion {
  readonly sedeId: string | null;
  readonly clienteId: string | null;
  readonly sedeClienteId: string | null;
  readonly vehiculoId: string | null;
  readonly tecnicoId: string | null;
  readonly tipo: TipoServicio;
  readonly frecuencia: Frecuencia;
  /** Texto del campo: se valida al revisar. */
  readonly cada: string;
  readonly inicio: string;
}

export type CampoProgramacion = keyof FormularioProgramacion;
export type ProblemaProgramacion = { campo: CampoProgramacion; mensaje: string };

export function programacionVacia(hoy: string, sedes: readonly string[]): FormularioProgramacion {
  return {
    sedeId: sedes.length === 1 ? (sedes[0] ?? null) : null,
    clienteId: null,
    sedeClienteId: null,
    vehiculoId: null,
    tecnicoId: null,
    tipo: "preventivo",
    frecuencia: "mensual",
    cada: "1",
    inicio: hoy,
  };
}

/** Cambiar un nivel de la cascada limpia los que dependen de él (como la orden nueva). */
export function cambiarProgramacion<K extends CampoProgramacion>(
  f: FormularioProgramacion,
  campo: K,
  valor: FormularioProgramacion[K],
): FormularioProgramacion {
  const n = { ...f, [campo]: valor };
  if (campo === "clienteId") return { ...n, sedeClienteId: null, vehiculoId: null };
  if (campo === "sedeClienteId") return { ...n, vehiculoId: null };
  // El técnico es de una sede: al cambiarla, el elegido puede no estar.
  if (campo === "sedeId" && f.sedeId !== valor) return { ...n, tecnicoId: null };
  return n;
}

const entero = (s: string): number => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : Number.NaN);

export function revisarFormProgramacion(
  f: FormularioProgramacion,
  hoy: string,
  sedesDelUsuario: readonly string[],
): ProblemaProgramacion[] {
  const p: ProblemaProgramacion[] = [];
  if (!f.sedeId) p.push({ campo: "sedeId", mensaje: "Elige la sede que atiende" });
  else if (!sedesDelUsuario.includes(f.sedeId)) p.push({ campo: "sedeId", mensaje: "Solo puedes programar en tus sedes" });
  if (!f.clienteId) p.push({ campo: "clienteId", mensaje: "Elige el cliente" });
  if (!f.sedeClienteId) p.push({ campo: "sedeClienteId", mensaje: "Elige la sede del cliente" });
  if (!f.vehiculoId) p.push({ campo: "vehiculoId", mensaje: "Elige el vehículo" });
  if (!f.tecnicoId) p.push({ campo: "tecnicoId", mensaje: "Elige el técnico que hará las visitas" });

  // Fecha y periodo: las mismas reglas que el servidor, por componentes.
  if (!zFechaISO.safeParse(f.inicio.trim()).success) {
    p.push({ campo: "inicio", mensaje: "Fecha como AAAA-MM-DD, y que exista" });
  } else {
    const cada = entero(f.cada);
    const v = revisarProgramacion({ inicio: f.inicio.trim(), cada: Number.isNaN(cada) ? 0 : cada }, hoy);
    if (!v.permitido) p.push({ campo: v.codigo === "INICIO_PASADO" ? "inicio" : "cada", mensaje: v.mensaje ?? "" });
  }
  return p;
}

/** La programación tal como la espera el servidor. Pasa su contrato. */
export function aContratoProgramacion(f: FormularioProgramacion, id: string): CrearProgramacion {
  return zCrearProgramacion.parse({
    id,
    sedeId: f.sedeId,
    clienteId: f.clienteId,
    sedeClienteId: f.sedeClienteId,
    vehiculoId: f.vehiculoId,
    tecnicoId: f.tecnicoId,
    tipo: f.tipo,
    frecuencia: f.frecuencia,
    cada: entero(f.cada),
    inicio: f.inicio.trim(),
  });
}

/** Las próximas visitas, o null mientras la fecha o el periodo no sirvan. */
export function vistaPrevia(f: FormularioProgramacion, n = 3): string[] | null {
  const cada = entero(f.cada);
  if (!zFechaISO.safeParse(f.inicio.trim()).success || Number.isNaN(cada) || cada < 1 || cada > CADA_MAXIMO) return null;
  return proximasVisitas(f.inicio.trim(), f.frecuencia, cada, n);
}

/** Etiqueta del selector y unidad del periodo ("Cada [2] meses"). */
export const OPCIONES_FRECUENCIA: readonly { valor: Frecuencia; etiqueta: string; unidad: string }[] = [
  { valor: "mensual", etiqueta: "Mensual", unidad: "meses" },
  { valor: "quincenal", etiqueta: "Quincenal", unidad: "quincenas" },
  { valor: "semanal", etiqueta: "Semanal", unidad: "semanas" },
  { valor: "dias_habiles", etiqueta: "Días hábiles", unidad: "días hábiles" },
  { valor: "dias_calendario", etiqueta: "Días", unidad: "días" },
];
// Que no falte ninguna frecuencia del dominio (y ninguna sobre).
if (OPCIONES_FRECUENCIA.length !== FRECUENCIAS.length) throw new Error("OPCIONES_FRECUENCIA desalineada con el dominio");

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "lun 15 oct 2026": con el día de la semana, que es como se agenda. */
export function fechaLegible(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface ProgramacionListada {
  readonly id: string;
  readonly sedeId: string;
  readonly sedeCodigo: string;
  readonly clienteNombre: string;
  readonly sedeClienteNombre: string;
  readonly vehiculoCodigo: string;
  readonly vehiculoPlaca: string | null;
  readonly tecnicoId: string;
  readonly tecnicoNombre: string;
  readonly tipo: string;
  readonly descripcion: string;
  readonly proxima: string;
  readonly activa: boolean;
  readonly ultimoAviso: string | null;
}

/**
 * Lo que dice la tarjeta en su línea de estado. Lo que NO se generó va
 * primero y en texto: una programación que no produce nada parece que
 * funciona si nadie dice por qué.
 */
export function estadoProgramacion(
  p: ProgramacionListada,
  hoy: string,
): { tono: "peligro" | "advertencia" | "normal" | "tenue"; texto: string } {
  if (!p.activa) return { tono: "tenue", texto: "Pausada: no genera órdenes" };
  if (p.ultimoAviso) {
    // El aviso viene como "2026-10-06: El técnico está inactivo: elige otro".
    const motivo = p.ultimoAviso.replace(/^\d{4}-\d{2}-\d{2}: /, "");
    const grave = /técnico/i.test(motivo);
    return { tono: grave ? "peligro" : "advertencia", texto: `No se generó: ${motivo}` };
  }
  if (p.proxima <= hoy) return { tono: "normal", texto: "Se genera hoy" };
  const habiles = diasHabilesEntre(hoy, p.proxima);
  return { tono: "normal", texto: `Próxima visita: ${fechaLegible(p.proxima)} (en ${habiles} ${habiles === 1 ? "día hábil" : "días hábiles"})` };
}
