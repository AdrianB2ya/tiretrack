/**
 * Tablero de la flota (R11, brecha C).
 *
 * Responde tres preguntas con lo que ya se mide:
 *
 * 1. **¿Qué marca rinde?** Costo por km, km por mm y proyección, por marca,
 *    por diseño y por posición. Se ordena por CPK: lo que importa al dueño de
 *    la flota es cuánto le cuesta cada kilómetro, no cuánto costó la llanta.
 * 2. **¿Qué hay que comprar y cuándo?** Con el ritmo al que se gasta cada
 *    llanta (mm por día desde que se montó), cuándo llega a su profundidad
 *    baja: en 30, 60 o 90 días, agrupado por medida, que es como se compra.
 * 3. Lo mismo para el cliente, en su portal: es lo que vende el servicio.
 *
 * Cada llanta cuenta una vez, con su última medición.
 */

export interface FilaTablero {
  /** El activo; sin él (llanta sin serial), vehículo y posición. */
  readonly llantaId: string | null;
  readonly vehiculo: string | null;
  readonly posicion: number;
  readonly fecha: string;
  readonly marca: string | null;
  readonly diseno: string | null;
  readonly medida: string | null;
  readonly remanente: number | null;
  readonly profBaja: number | null;
  readonly mmDesgaste: number | null;
  readonly kmPorMm: number | null;
  readonly proyeccionKm: number | null;
  readonly cpk: number | null;
  readonly fechaMontaje: string | null;
}

/** La última medición de cada llanta (o de cada posición, si no se identificó). */
export function ultimaPorLlanta(filas: readonly FilaTablero[]): FilaTablero[] {
  const porClave = new Map<string, FilaTablero>();
  for (const f of filas) {
    const k = f.llantaId ?? `${f.vehiculo ?? "?"}#${f.posicion}`;
    const previa = porClave.get(k);
    if (!previa || f.fecha > previa.fecha) porClave.set(k, f);
  }
  return [...porClave.values()];
}

const promedio = (xs: readonly (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const r = (n: number | null, d = 0) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

export interface Rendimiento {
  readonly grupo: string;
  readonly llantas: number;
  readonly kmPorMm: number | null;
  readonly proyeccionKm: number | null;
  readonly cpk: number | null;
}

/** Agrupa y promedia; los de menor costo por km primero, los sin dato al final. */
export function rendimientoPor(filas: readonly FilaTablero[], clave: (f: FilaTablero) => string | null): Rendimiento[] {
  const grupos = new Map<string, FilaTablero[]>();
  for (const f of filas) {
    const k = clave(f) ?? "Sin dato";
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  return [...grupos.entries()]
    .map(([grupo, fs]) => ({
      grupo,
      llantas: fs.length,
      kmPorMm: r(promedio(fs.map((f) => f.kmPorMm))),
      proyeccionKm: r(promedio(fs.map((f) => f.proyeccionKm))),
      cpk: r(promedio(fs.map((f) => f.cpk)), 2),
    }))
    .sort((a, b) => (a.cpk ?? Infinity) - (b.cpk ?? Infinity) || b.llantas - a.llantas || a.grupo.localeCompare(b.grupo));
}

const dias = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);

/**
 * Fecha estimada en que la llanta llega a su profundidad baja, al ritmo al
 * que se gastó desde que se montó. null si falta algo para estimarlo (no se
 * inventa) o si no se ha gastado nada todavía.
 */
export function proyectarCambio(f: FilaTablero): string | null {
  if (f.remanente === null || f.profBaja === null || f.mmDesgaste === null || !f.fechaMontaje) return null;
  const transcurridos = dias(f.fechaMontaje, f.fecha);
  if (transcurridos <= 0 || f.mmDesgaste <= 0) return null;
  const mmPorDia = f.mmDesgaste / transcurridos;
  const restantes = Math.max(0, (f.remanente - f.profBaja) / mmPorDia);
  const fecha = new Date(Date.parse(`${f.fecha}T00:00:00Z`) + Math.round(restantes) * 86_400_000);
  return fecha.toISOString().slice(0, 10);
}

export interface Compras {
  /** Ya en su profundidad baja (o por debajo): cambio inmediato. */
  readonly yaPedidas: { medida: string; cantidad: number }[];
  readonly en30: { medida: string; cantidad: number }[];
  readonly en60: { medida: string; cantidad: number }[];
  readonly en90: { medida: string; cantidad: number }[];
  /** Llantas sin datos suficientes para estimar (no se inventa). */
  readonly sinEstimar: number;
}

function porMedida(fs: readonly FilaTablero[]) {
  const m = new Map<string, number>();
  for (const f of fs) m.set(f.medida ?? "Sin medida", (m.get(f.medida ?? "Sin medida") ?? 0) + 1);
  return [...m.entries()].map(([medida, cantidad]) => ({ medida, cantidad })).sort((a, b) => b.cantidad - a.cantidad || a.medida.localeCompare(b.medida));
}

/** Proyección de compras: cuántas llantas de cada medida habrá que cambiar y cuándo. */
export function proyeccionDeCompras(filas: readonly FilaTablero[], hoy: string): Compras {
  const ya: FilaTablero[] = [];
  const en = { 30: [] as FilaTablero[], 60: [] as FilaTablero[], 90: [] as FilaTablero[] };
  let sinEstimar = 0;
  for (const f of filas) {
    if (f.remanente !== null && f.profBaja !== null && f.remanente <= f.profBaja) {
      ya.push(f);
      continue;
    }
    const cuando = proyectarCambio(f);
    if (!cuando) {
      sinEstimar++;
      continue;
    }
    const faltan = dias(hoy, cuando);
    if (faltan <= 30) en[30].push(f);
    else if (faltan <= 60) en[60].push(f);
    else if (faltan <= 90) en[90].push(f);
  }
  return { yaPedidas: porMedida(ya), en30: porMedida(en[30]), en60: porMedida(en[60]), en90: porMedida(en[90]), sinEstimar };
}

// ── Vida útil (brecha C) ────────────────────────────────────────────────────

/** Una llanta que terminó su vida: desechada o enviada a reencauche. */
export interface LlantaRetirada {
  readonly marca: string | null;
  readonly diseno: string | null;
  /** Kilómetros que rodó en esa vida; null si no se registraron odómetros. */
  readonly km: number | null;
}

export interface VidaUtil {
  readonly grupo: string;
  /** Retiradas con km conocido: las que entran en el promedio. */
  readonly llantas: number;
  readonly kmPromedio: number;
}

/**
 * Vida útil REAL: lo que rodaron las llantas que ya terminaron su vida. La
 * proyección es lo que rendiría la que sigue montada; esta es lo que rindió
 * la que ya salió. Sin km registrados no se promedia: no se inventa. La de
 * mayor vida primero.
 */
export function vidaUtilPor(retiradas: readonly LlantaRetirada[], clave: (l: LlantaRetirada) => string | null): VidaUtil[] {
  const grupos = new Map<string, number[]>();
  for (const l of retiradas) {
    if (l.km === null) continue;
    const k = clave(l) ?? "Sin dato";
    grupos.set(k, [...(grupos.get(k) ?? []), l.km]);
  }
  return [...grupos.entries()]
    .map(([grupo, kms]) => ({ grupo, llantas: kms.length, kmPromedio: Math.round(kms.reduce((a, b) => a + b, 0) / kms.length) }))
    .sort((a, b) => b.kmPromedio - a.kmPromedio || a.grupo.localeCompare(b.grupo));
}
