import {
  fechaEnColombia,
  kmRecorridos,
  proyeccionDeCompras,
  rendimientoPor,
  ultimaPorLlanta,
  vidaUtilPor,
  type FilaTablero,
  type LlantaRetirada,
  type MovimientoKm,
} from "@tiretrack/domain";
import type { ServicioInforme, Contexto } from "./servicio";

/**
 * Tablero de la flota (R11): rendimiento por marca, diseño y posición, y la
 * proyección de compras. Sale de las mismas filas del informe —con sus
 * indicadores ya calculados— para que una cifra del tablero se pueda
 * rastrear hasta su fila en el CSV.
 *
 * El alcance es el del informe: la oficina, sus órdenes; el técnico, las
 * suyas; el cliente, lo aprobado o cerrado de su flota (RLS).
 */
interface Consulta {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Las llantas que TERMINARON su vida en el período (desechadas o enviadas a
 * reencauche, con su desmontaje dentro del rango) y lo que rodaron en ella,
 * por tramos y con el odómetro de cada vehículo (`kmRecorridos`, el mismo de
 * los indicadores). Marca y diseño unificados cuentan como el correcto.
 * Mismo alcance por rol: RLS (el cliente, sus llantas).
 */
export async function llantasRetiradas(
  db: Consulta,
  filtro: { desde?: string; hasta?: string; clienteId?: string },
): Promise<LlantaRetirada[]> {
  const llantas = (await db.query<{ id: string; marca: string | null; diseno: string | null }>(
    `SELECT l.id, coalesce(mr.nombre, ma.nombre) AS marca, coalesce(dr.nombre, d.nombre) AS diseno
       FROM "Llanta" l
       LEFT JOIN "Marca" ma ON ma.id = l."marcaId"
       LEFT JOIN "Marca" mr ON mr.id = ma."reemplazadaPorId"
       LEFT JOIN "Diseno" d ON d.id = l."disenoId"
       LEFT JOIN "Diseno" dr ON dr.id = d."reemplazadoPorId"
      WHERE l.estado IN ('desecho', 'reencauche')
        AND ($1::text IS NULL OR l."clienteId" = $1)
        AND EXISTS (SELECT 1 FROM "LlantaMovimiento" m
                     WHERE m."llantaId" = l.id AND m.tipo = 'desmontaje'
                       AND ($2::date IS NULL OR m.fecha >= $2::date)
                       AND ($3::date IS NULL OR m.fecha <= $3::date))`,
    [filtro.clienteId ?? null, filtro.desde ?? null, filtro.hasta ?? null],
  )).rows;
  if (llantas.length === 0) return [];
  const ids = llantas.map((l) => l.id);
  // La vida que terminó: la de número más alto (al volver de reencauche nace otra).
  const inicioVida = new Map<string, string | null>();
  for (const v of (await db.query<{ llantaId: string; numero: number; inicio: string }>(
    `SELECT DISTINCT ON ("llantaId") "llantaId", numero, to_char(inicio,'YYYY-MM-DD') AS inicio
       FROM "LlantaVida" WHERE "llantaId" = ANY($1::text[]) ORDER BY "llantaId", numero DESC`,
    [ids],
  )).rows) {
    inicioVida.set(v.llantaId, Number(v.numero) > 0 ? v.inicio : null);
  }
  const movs = new Map<string, MovimientoKm[]>();
  for (const m of (await db.query<{ llantaId: string; tipo: string; kilometraje: unknown; fecha: string }>(
    `SELECT "llantaId", tipo, kilometraje, to_char(fecha,'YYYY-MM-DD') AS fecha
       FROM "LlantaMovimiento" WHERE "llantaId" = ANY($1::text[]) AND tipo IN ('montaje','desmontaje')
      ORDER BY fecha, "creadoEn"`,
    [ids],
  )).rows) {
    const km = m.kilometraje === null ? null : Number(m.kilometraje);
    movs.set(m.llantaId, [...(movs.get(m.llantaId) ?? []), { tipo: m.tipo, kilometraje: Number.isFinite(km) ? km : null, fecha: m.fecha }]);
  }
  return llantas.map((l) => {
    const desde = inicioVida.get(l.id) ?? null;
    const deLaVida = (movs.get(l.id) ?? []).filter((m) => !desde || m.fecha >= desde);
    // Ya no está montada: sin km "actual" que sumar, solo los tramos cerrados.
    return { marca: l.marca, diseno: l.diseno ? `${l.marca ?? ""} ${l.diseno}`.trim() : null, km: kmRecorridos(deLaVida, null).kmRecorrido };
  });
}

export async function tableroDeFlota(
  informe: ServicioInforme,
  ctx: Contexto,
  filtro: { desde?: string; hasta?: string; clienteId?: string },
  hoy: Date,
  db?: Consulta,
) {
  const filas = await informe.consultar(ctx, filtro);
  const tablero: FilaTablero[] = filas
    .filter((f) => !f.noIdentificada)
    .map((f) => ({
      llantaId: (f as { llantaActivoId?: string | null }).llantaActivoId ?? null,
      vehiculo: f.vehiculoCodigo,
      posicion: f.posicion,
      fecha: f.fecha,
      marca: f.marca,
      diseno: f.diseno,
      medida: f.medida,
      remanente: f.profundidad,
      profBaja: f.indicadores?.profBaja ?? null,
      mmDesgaste: f.indicadores?.mmDesgaste ?? null,
      kmPorMm: f.indicadores?.kmPorMm ?? null,
      proyeccionKm: f.indicadores?.proyeccionKm ?? null,
      cpk: f.indicadores?.cpk ?? null,
      fechaMontaje: f.indicadores?.fechaMontaje ?? null,
    }));
  const ultimas = ultimaPorLlanta(tablero);
  return {
    llantas: ultimas.length,
    porMarca: rendimientoPor(ultimas, (f) => f.marca),
    porDiseno: rendimientoPor(ultimas, (f) => (f.diseno ? `${f.marca ?? ""} ${f.diseno}`.trim() : null)),
    porPosicion: rendimientoPor(ultimas, (f) => String(f.posicion)),
    compras: proyeccionDeCompras(ultimas, fechaEnColombia(hoy)),
    // Brecha C: lo que rindieron de verdad las que ya salieron.
    ...(db
      ? await (async () => {
          const retiradas = await llantasRetiradas(db, filtro);
          return {
            vidaUtil: {
              retiradas: retiradas.length,
              porMarca: vidaUtilPor(retiradas, (l) => l.marca),
              porDiseno: vidaUtilPor(retiradas, (l) => l.diseno),
            },
          };
        })()
      : {}),
  };
}
