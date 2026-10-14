import { diferenciaDeLados } from "./hallazgos";

/**
 * Indicadores del Excel de levantamiento (R9, pedido del usuario 2026-10-13).
 *
 * Por llanta y por medición:
 *
 * | Columna        | Cálculo                                                  |
 * |----------------|----------------------------------------------------------|
 * | PROF INIC      | La de la referencia (fábrica de la medida); si la llanta ya se reencauchó, la de la banda de su vida actual |
 * | PROF BAJA      | El límite de cambio inmediato de esa posición (R2)       |
 * | PROF MEDIA     | Promedio de las tres medidas tomadas                     |
 * | DIF LADOS      | abs(exterior − interior) (R6)                            |
 * | MM DESGASTE    | inicial − mínima                                         |
 * | MM REMANENTE   | la mínima (es la profundidad de la llanta)               |
 * | % RODADO       | desgaste / (inicial − baja)                              |
 * | REFERENCIA     | por % rodado (fórmula del Excel; de 0 a 50 es INICIO DE CICLO, decisión del usuario) |
 * | KM RECORRIDO   | suma de los tramos montaje → desmontaje, y el tramo abierto hasta el km actual |
 * | KM / mm        | km recorrido / mm de desgaste                            |
 * | PROYECCIÓN     | KM/mm × (inicial − baja): cuántos km dará en total      |
 * | CPK            | costo / km proyectados                                   |
 *
 * Un dato que falta deja el indicador vacío: no se inventa.
 */

const r = (n: number, decimales = 2) => {
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
};

/** La fórmula del Excel, con el 0–1 % que dejaba en FALSO como inicio de ciclo. */
export function referenciaDesgaste(pctRodado: number | null): string | null {
  if (pctRodado === null) return null;
  if (pctRodado > 99) return "FINAL 100%";
  if (pctRodado > 71) return "TENDENCIA DE RENDIMIENTO 71% - 98%";
  if (pctRodado > 50) return "PROYECCIÓN 50% - 70%";
  return "INICIO DE CICLO 0% - 50%";
}

export interface MovimientoKm {
  readonly tipo: string;
  readonly kilometraje: number | null;
  readonly fecha: string;
}

/**
 * Kilómetros que rodó la llanta. Cada montaje abre un tramo y cada
 * desmontaje lo cierra con el odómetro de ESE vehículo: por eso se suma por
 * tramos y no se resta el primer km del último (si la llanta pasó de un
 * camión a otro, los odómetros no se pueden restar entre sí).
 *
 * Un tramo sin km en alguno de sus extremos no se cuenta, y uno negativo
 * (odómetro cambiado) tampoco: mejor un recorrido corto que uno inventado.
 */
export function kmRecorridos(
  movimientos: readonly MovimientoKm[],
  kmActual: number | null,
  hasta?: string,
): { kmMontaje: number | null; kmRecorrido: number | null } {
  const orden = [...movimientos]
    .filter((m) => !hasta || m.fecha <= hasta)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  let abierto: number | null | undefined;
  let total = 0;
  let algun = false;
  let kmMontaje: number | null = null;
  for (const m of orden) {
    if (m.tipo === "montaje") {
      abierto = m.kilometraje;
      kmMontaje = m.kilometraje;
    } else if (m.tipo === "desmontaje" && abierto !== undefined) {
      if (abierto !== null && m.kilometraje !== null && m.kilometraje >= abierto) {
        total += m.kilometraje - abierto;
        algun = true;
      }
      abierto = undefined;
    }
  }
  if (abierto !== undefined && abierto !== null && kmActual !== null && kmActual >= abierto) {
    total += kmActual - abierto;
    algun = true;
  }
  return { kmMontaje: abierto === undefined ? null : kmMontaje, kmRecorrido: algun ? total : null };
}

export interface EntradaIndicadores {
  readonly exterior: number | null;
  readonly centro: number | null;
  readonly interior: number | null;
  /** La mínima: la profundidad de la llanta. */
  readonly remanente: number | null;
  readonly inicial: number | null;
  readonly baja: number | null;
  readonly kmRecorrido: number | null;
  readonly costo: number | null;
}

export interface Indicadores {
  readonly profMedia: number | null;
  readonly difLados: number | null;
  readonly mmDesgaste: number | null;
  readonly pctRodado: number | null;
  readonly referencia: string | null;
  readonly kmPorMm: number | null;
  readonly proyeccionKm: number | null;
  readonly cpk: number | null;
}

export function indicadoresLlanta(e: EntradaIndicadores): Indicadores {
  const tomadas = [e.exterior, e.centro, e.interior].filter((v): v is number => v !== null);
  const profMedia = tomadas.length > 0 ? r(tomadas.reduce((a, b) => a + b, 0) / tomadas.length) : null;
  const mmDesgaste = e.inicial !== null && e.remanente !== null ? r(Math.max(0, e.inicial - e.remanente)) : null;
  const util = e.inicial !== null && e.baja !== null ? e.inicial - e.baja : null;
  const pctRodado = mmDesgaste !== null && util !== null && util > 0 ? r((mmDesgaste / util) * 100, 1) : null;
  const kmPorMm = e.kmRecorrido !== null && mmDesgaste !== null && mmDesgaste > 0 ? r(e.kmRecorrido / mmDesgaste, 0) : null;
  const proyeccionKm = kmPorMm !== null && util !== null && util > 0 ? r(kmPorMm * util, 0) : null;
  const cpk = e.costo !== null && proyeccionKm !== null && proyeccionKm > 0 ? r(e.costo / proyeccionKm, 2) : null;
  return {
    profMedia,
    difLados: diferenciaDeLados({ exterior: e.exterior, interior: e.interior }),
    mmDesgaste,
    pctRodado,
    referencia: referenciaDesgaste(pctRodado),
    kmPorMm,
    proyeccionKm,
    cpk,
  };
}
