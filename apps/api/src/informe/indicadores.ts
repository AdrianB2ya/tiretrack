import {
  LIMITES_POR_DEFECTO,
  indicadoresLlanta,
  kmRecorridos,
  umbralesDeCambio,
  type LimitesEmpresa,
  type MovimientoKm,
} from "@tiretrack/domain";

/**
 * Indicadores del levantamiento (R9) para las filas del informe.
 *
 * Se calculan en el servidor con las reglas del dominio, a partir de lo que
 * ya hay: la medida del catálogo (profundidad inicial), los límites de la
 * empresa y del eje (profundidad baja), la historia de la llanta como activo
 * (km por tramos, vida actual) y su costo.
 *
 * Tres consultas para todas las filas, no una por fila: con 22 posiciones
 * por orden, por fila serían cientos.
 */

interface Consultable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface FilaParaIndicadores {
  readonly fecha: string;
  readonly kilometraje: number | null;
  readonly profundidad: number | null;
  readonly profExterior?: number | null;
  readonly profCentro?: number | null;
  readonly profInterior?: number | null;
  readonly minimoEje?: number | null;
  readonly profFabrica?: number | null;
  readonly llantaActivoId?: string | null;
  readonly costoCapturado?: number | null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function calcularIndicadores(db: Consultable, empresaId: string, filas: readonly FilaParaIndicadores[]) {
  const lim = (await db.query<{ i: string; p: string }>(
    `SELECT "limiteCambioInmediato" AS i, "limiteProgramarCambio" AS p FROM "Empresa" WHERE id = $1`,
    [empresaId],
  )).rows[0];
  const limites: LimitesEmpresa = lim ? { cambioInmediato: Number(lim.i), programarCambio: Number(lim.p) } : LIMITES_POR_DEFECTO;

  const ids = [...new Set(filas.map((f) => f.llantaActivoId).filter((x): x is string => Boolean(x)))];
  const vidas = new Map<string, { numero: number; costo: number | null; profundidadInicial: number | null; inicio: string }>();
  const costos = new Map<string, number | null>();
  const movs = new Map<string, MovimientoKm[]>();
  if (ids.length > 0) {
    // La vida actual de cada llanta: la de número más alto.
    for (const v of (await db.query<Record<string, unknown>>(
      `SELECT DISTINCT ON ("llantaId") "llantaId", numero, costo, "profundidadInicial", to_char(inicio,'YYYY-MM-DD') AS inicio
         FROM "LlantaVida" WHERE "llantaId" = ANY($1::text[]) ORDER BY "llantaId", numero DESC`,
      [ids],
    )).rows) {
      vidas.set(String(v["llantaId"]), {
        numero: Number(v["numero"]), costo: num(v["costo"]), profundidadInicial: num(v["profundidadInicial"]), inicio: String(v["inicio"]),
      });
    }
    for (const l of (await db.query<Record<string, unknown>>(`SELECT id, costo FROM "Llanta" WHERE id = ANY($1::text[])`, [ids])).rows) {
      costos.set(String(l["id"]), num(l["costo"]));
    }
    for (const m of (await db.query<Record<string, unknown>>(
      `SELECT "llantaId", tipo, kilometraje, to_char(fecha,'YYYY-MM-DD') AS fecha
         FROM "LlantaMovimiento" WHERE "llantaId" = ANY($1::text[]) AND tipo IN ('montaje','desmontaje')
        ORDER BY fecha, "creadoEn"`,
      [ids],
    )).rows) {
      const k = String(m["llantaId"]);
      movs.set(k, [...(movs.get(k) ?? []), { tipo: String(m["tipo"]), kilometraje: num(m["kilometraje"]), fecha: String(m["fecha"]) }]);
    }
  }

  return filas.map((f) => {
    const id = f.llantaActivoId ?? null;
    const vida = id ? vidas.get(id) : undefined;
    const reencauchada = vida !== undefined && vida.numero > 0;
    // Reencauchada, la inicial es la de su banda; si no, la de fábrica de su medida.
    const profInicial = reencauchada && vida.profundidadInicial !== null ? vida.profundidadInicial : (f.profFabrica ?? vida?.profundidadInicial ?? null);
    const profBaja = umbralesDeCambio(f.minimoEje ?? null, limites).inmediato;
    // Los km de la vida actual: desde que empezó.
    const deLaVida = (id ? movs.get(id) ?? [] : []).filter((m) => !reencauchada || m.fecha >= vida.inicio);
    const km = id ? kmRecorridos(deLaVida, f.kilometraje, f.fecha) : { kmMontaje: null, kmRecorrido: null };
    const costo = reencauchada ? vida.costo : ((id ? costos.get(id) : null) ?? f.costoCapturado ?? null);
    const ind = indicadoresLlanta({
      exterior: f.profExterior ?? null, centro: f.profCentro ?? null, interior: f.profInterior ?? null,
      remanente: f.profundidad, inicial: profInicial, baja: profBaja, kmRecorrido: km.kmRecorrido, costo,
    });
    // El montaje que abrió el tramo actual: desde ahí se mide el ritmo de desgaste (R11).
    const montajes = deLaVida.filter((m) => m.tipo === "montaje" && m.fecha <= f.fecha);
    const fechaMontaje = montajes.at(-1)?.fecha ?? null;
    return {
      fechaMontaje,
      profInicial, profBaja, profMedia: ind.profMedia, mmDesgaste: ind.mmDesgaste, pctRodado: ind.pctRodado,
      referencia: ind.referencia, kmMontaje: km.kmMontaje, kmRecorrido: km.kmRecorrido, kmPorMm: ind.kmPorMm,
      proyeccionKm: ind.proyeccionKm, costo, cpk: ind.cpk,
    };
  });
}
