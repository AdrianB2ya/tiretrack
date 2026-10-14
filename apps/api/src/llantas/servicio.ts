import {
  claveIdentificador,
  estadoTrasDesmontaje,
  evaluarMovimiento,
  fechaEnColombia,
  nuevoId,
  type EstadoActivo,
  type Rol,
  type TipoMovimiento,
  type Veredicto,
} from "@tiretrack/domain";
import type { z } from "zod";
import { calcularIndicadores } from "../informe/indicadores";
import type { zCrearLlanta, zFiltroLlantas, zMovimientoLlanta, zStockMinimo } from "@tiretrack/contracts";

/**
 * La llanta como activo (R8).
 *
 * Dos caminos llenan la historia de una llanta:
 *
 * 1. **Las órdenes.** Al aprobarse una orden (pasa a esperar al cliente), cada
 *    posición con serial queda como la llanta montada ahí, y cada llanta que
 *    salió pasa al estado que anotó el técnico (desecho, reencauche, bodega).
 *    Así el técnico no hace nada nuevo: lo que ya captura arma el inventario.
 *    Se hace al aprobar y no al capturar porque es el contenido que ya pasó
 *    la revisión; las correcciones de un técnico no llenan la historia de
 *    montajes que nunca ocurrieron.
 * 2. **La oficina.** Altas en bodega (compras) y movimientos que no pasan por
 *    una orden: enviar a reencauche, recibirla con su vida nueva, desechar,
 *    trasladar de sede.
 *
 * Nada se borra: una llanta desechada sigue con su historia.
 */

export interface Consultable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; veredicto: Veredicto };
const fallo = (codigo: string, mensaje: string): Resultado<never> => ({
  ok: false,
  veredicto: { permitido: false, codigo, mensaje },
});
const esOficina = (r: Rol) => r === "administrador" || r === "coordinador";
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

type CrearLlanta = z.infer<typeof zCrearLlanta>;
type Movimiento = z.infer<typeof zMovimientoLlanta>;
type FiltroLlantas = z.infer<typeof zFiltroLlantas>;
type StockMinimo = z.infer<typeof zStockMinimo>;

export interface LlantaListada {
  readonly id: string;
  readonly serial: string | null;
  readonly numeroInterno: string | null;
  readonly numCalor: string | null;
  readonly dot: string | null;
  readonly marca: string | null;
  readonly diseno: string | null;
  readonly medida: string | null;
  readonly estado: EstadoActivo;
  readonly clienteId: string;
  readonly clienteNombre: string;
  readonly sedeId: string | null;
  readonly sedeNombre: string | null;
  readonly vehiculoId: string | null;
  readonly vehiculoCodigo: string | null;
  readonly posicion: number | null;
  readonly vidas: number;
  readonly costo: number | null;
}

const SELECCION = `
  SELECT l.id, l.serial, l."numeroInterno", l."numCalor", l.dot, m.nombre AS marca, d.nombre AS diseno,
         l.medida, l.estado, l."clienteId", c.nombre AS "clienteNombre", l."sedeId", s.nombre AS "sedeNombre",
         l."vehiculoId", v.codigo AS "vehiculoCodigo", l.posicion, l.vidas, l.costo
    FROM "Llanta" l
    JOIN "Cliente" c ON c.id = l."clienteId"
    LEFT JOIN "Sede" s ON s.id = l."sedeId"
    LEFT JOIN "Vehiculo" v ON v.id = l."vehiculoId"
    LEFT JOIN "Marca" m ON m.id = l."marcaId"
    LEFT JOIN "Diseno" d ON d.id = l."disenoId"`;

const aListada = (f: Record<string, unknown>): LlantaListada =>
  ({ ...f, costo: num(f["costo"]), vidas: Number(f["vidas"]), posicion: num(f["posicion"]) }) as unknown as LlantaListada;

export class ServicioLlantas {
  constructor(
    private readonly db: Consultable,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  private hoy(): string {
    return fechaEnColombia(this.reloj());
  }

  // ── Consulta ─────────────────────────────────────────────────────────────

  /** El inventario. El cliente ve solo su flota (RLS); la oficina, la empresa. */
  async listar(f: FiltroLlantas = {}): Promise<LlantaListada[]> {
    const cond: string[] = ["l.activa"];
    const p: unknown[] = [];
    if (f.estado) cond.push(`l.estado = $${p.push(f.estado)}`);
    if (f.clienteId) cond.push(`l."clienteId" = $${p.push(f.clienteId)}`);
    if (f.sedeId) cond.push(`l."sedeId" = $${p.push(f.sedeId)}`);
    if (f.vehiculoId) cond.push(`l."vehiculoId" = $${p.push(f.vehiculoId)}`);
    if (f.buscar) {
      const k = `%${claveIdentificador(f.buscar) ?? ""}%`;
      const n = p.push(k);
      cond.push(`(l.serial LIKE $${n} OR upper(replace(l."numeroInterno", '-', '')) LIKE $${n} OR upper(l."numCalor") LIKE $${n})`);
    }
    const r = await this.db.query<Record<string, unknown>>(
      `${SELECCION} WHERE ${cond.join(" AND ")} ORDER BY c.nombre, l.estado, coalesce(l."numeroInterno", l.serial) LIMIT 500`,
      p,
    );
    return r.rows.map(aListada);
  }

  /** La ficha: la llanta, sus vidas, su historia y sus mediciones. */
  async ficha(id: string): Promise<Resultado<{
    llanta: LlantaListada;
    vidas: Record<string, unknown>[];
    movimientos: Record<string, unknown>[];
    mediciones: Record<string, unknown>[];
    indicadores: Awaited<ReturnType<typeof calcularIndicadores>>[number] | null;
  }>> {
    const l = await this.db.query<Record<string, unknown>>(`${SELECCION} WHERE l.id = $1`, [id]);
    if (!l.rows[0]) return fallo("NO_EXISTE", "No existe");
    const vidas = await this.db.query<Record<string, unknown>>(
      `SELECT numero, banda, reencauchadora, costo, "profundidadInicial", to_char(inicio,'YYYY-MM-DD') AS inicio
         FROM "LlantaVida" WHERE "llantaId" = $1 ORDER BY numero`,
      [id],
    );
    const movimientos = await this.db.query<Record<string, unknown>>(
      `SELECT mv.tipo, to_char(mv.fecha,'YYYY-MM-DD') AS fecha, mv.posicion, mv.kilometraje, mv.detalle,
              v.codigo AS "vehiculoCodigo", s.nombre AS "sedeNombre", o.folio
         FROM "LlantaMovimiento" mv
         LEFT JOIN "Vehiculo" v ON v.id = mv."vehiculoId"
         LEFT JOIN "Sede" s ON s.id = mv."sedeId"
         LEFT JOIN "OrdenServicio" o ON o.id = mv."ordenId"
        WHERE mv."llantaId" = $1
        ORDER BY mv.fecha, mv."creadoEn"`,
      [id],
    );
    // Lo que se le midió: el recorrido de su profundidad en el tiempo.
    const mediciones = await this.db.query<Record<string, unknown>>(
      `SELECT to_char(o.fecha,'YYYY-MM-DD') AS fecha, o.folio, coalesce(o."vehiculoCodigo", v.codigo) AS "vehiculoCodigo",
              lr.posicion, lr.profundidad, o.kilometraje,
              lr."profExterior", lr."profCentro", lr."profInterior", lr.costo AS "costoCapturado",
              (SELECT pe."profundidadMinima" FROM "PosicionEje" pe
                WHERE pe."configuracionEjeId" = o."configuracionEjeId" AND pe.numero = lr.posicion) AS "minimoEje",
              (SELECT dmf."profundidadOriginal" FROM "DisenoMedida" dmf
                WHERE dmf."disenoId" = lr."disenoId" AND dmf.medida = lr.medida
                ORDER BY dmf."empresaId" NULLS LAST LIMIT 1) AS "profFabrica"
         FROM "LlantaRegistro" lr
         JOIN "OrdenServicio" o ON o.id = lr."ordenId"
         LEFT JOIN "Vehiculo" v ON v.id = o."vehiculoId"
        WHERE lr."llantaId" = $1
        ORDER BY o.fecha`,
      [id],
    );
    return {
      ok: true,
      valor: {
        llanta: aListada(l.rows[0]),
        vidas: vidas.rows.map((v) => ({ ...v, costo: num(v["costo"]), profundidadInicial: num(v["profundidadInicial"]) })),
        movimientos: movimientos.rows,
        mediciones: mediciones.rows.map((m) => ({ ...m, profundidad: num(m["profundidad"]) })),
        // R9: los indicadores, con la última medición.
        indicadores: await this.indicadoresDe(id, mediciones.rows.at(-1)),
      },
    };
  }

  /**
   * Inventario de bodega por sede y medida, con el mínimo que se quiere tener.
   * Lo que está por debajo del mínimo es lo que hay que comprar.
   */
  async stock(): Promise<{ sedeId: string; sedeNombre: string; medida: string; cantidad: number; minimo: number | null }[]> {
    const r = await this.db.query<Record<string, unknown>>(
      `WITH en_bodega AS (
         SELECT "sedeId", coalesce(medida, 'Sin medida') AS medida, count(*)::int AS cantidad
           FROM "Llanta" WHERE estado = 'bodega' AND activa AND "sedeId" IS NOT NULL
          GROUP BY 1, 2)
       SELECT coalesce(b."sedeId", sm."sedeId") AS "sedeId", s.nombre AS "sedeNombre",
              coalesce(b.medida, sm.medida) AS medida, coalesce(b.cantidad, 0) AS cantidad, sm.cantidad AS minimo
         FROM en_bodega b
         FULL JOIN "StockMinimo" sm ON sm."sedeId" = b."sedeId" AND sm.medida = b.medida
         JOIN "Sede" s ON s.id = coalesce(b."sedeId", sm."sedeId")
        ORDER BY s.nombre, medida`,
    );
    return r.rows.map((f) => ({
      sedeId: String(f["sedeId"]), sedeNombre: String(f["sedeNombre"]), medida: String(f["medida"]),
      cantidad: Number(f["cantidad"]), minimo: num(f["minimo"]),
    }));
  }

  private async indicadoresDe(llantaId: string, ultima: Record<string, unknown> | undefined) {
    if (!ultima) return null;
    const empresa = (await this.db.query<{ e: string }>(`SELECT "empresaId" AS e FROM "Llanta" WHERE id = $1`, [llantaId])).rows[0]?.e;
    if (!empresa) return null;
    const [ind] = await calcularIndicadores(this.db, empresa, [{
      fecha: String(ultima["fecha"]), kilometraje: num(ultima["kilometraje"]), profundidad: num(ultima["profundidad"]),
      profExterior: num(ultima["profExterior"]), profCentro: num(ultima["profCentro"]), profInterior: num(ultima["profInterior"]),
      minimoEje: num(ultima["minimoEje"]), profFabrica: num(ultima["profFabrica"]), llantaActivoId: llantaId,
      costoCapturado: num(ultima["costoCapturado"]),
    }]);
    return ind ?? null;
  }

  // ── Oficina ──────────────────────────────────────────────────────────────

  async crear(ctx: Contexto, e: CrearLlanta): Promise<Resultado<LlantaListada>> {
    if (!esOficina(ctx.rol)) return fallo("SIN_PERMISO", "El inventario lo maneja la oficina");
    const serial = claveIdentificador(e.serial);
    const interno = e.numeroInterno?.trim() || null;
    const repetida = await this.db.query(
      `SELECT 1 FROM "Llanta" WHERE "clienteId" = $1 AND (serial = $2 OR "numeroInterno" = $3)`,
      [e.clienteId, serial, interno],
    );
    if (repetida.rows.length > 0) return fallo("YA_EXISTE", "Ya hay una llanta de este cliente con ese serial o número interno");
    await this.db.query(
      `INSERT INTO "Llanta" (id,"empresaId","clienteId","sedeId","numeroInterno",serial,"numCalor",dot,"marcaId","disenoId",medida,estado,costo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'bodega',$12)`,
      [e.id, ctx.empresaId, e.clienteId, e.sedeId, interno, serial, e.numCalor ?? null, e.dot ?? null,
       e.marcaId ?? null, e.disenoId ?? null, e.medida ?? null, e.costo ?? null],
    );
    await this.vida(ctx, e.id, 0, { costo: e.costo ?? null, profundidadInicial: e.profundidadInicial ?? null });
    await this.movimiento(ctx, e.id, "ingreso", { sedeId: e.sedeId });
    return this.unaListada(e.id);
  }

  async mover(ctx: Contexto, id: string, m: Movimiento): Promise<Resultado<LlantaListada>> {
    if (!esOficina(ctx.rol)) return fallo("SIN_PERMISO", "El inventario lo maneja la oficina");
    const r = await this.db.query<{ estado: EstadoActivo; vidas: number; sedeId: string | null }>(
      `SELECT estado, vidas, "sedeId" FROM "Llanta" WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const l = r.rows[0];
    if (!l) return fallo("NO_EXISTE", "No existe");
    const tipo = m.tipo as TipoMovimiento;
    const v = evaluarMovimiento(l.estado, tipo);
    if (!v.permitido || !v.hacia) return { ok: false, veredicto: v };

    const sede = tipo === "traslado" ? (m.sedeId ?? null) : l.sedeId;
    let vidas = Number(l.vidas);
    if (tipo === "retorno_reencauche") {
      // Vuelve con una vida más: la banda, quién la reencauchó y cuánto costó.
      vidas += 1;
      await this.vida(ctx, id, vidas, {
        banda: m.banda ?? null, reencauchadora: m.reencauchadora ?? null,
        costo: m.costo ?? null, profundidadInicial: m.profundidadInicial ?? null, inicio: m.fecha,
      });
    }
    await this.db.query(
      `UPDATE "Llanta" SET estado = $2, "sedeId" = $3, vidas = $4 WHERE id = $1`,
      [id, v.hacia, sede, vidas],
    );
    await this.movimiento(ctx, id, tipo, { sedeId: sede, detalle: m.detalle ?? null, fecha: m.fecha ?? null });
    return this.unaListada(id);
  }

  async fijarStockMinimo(ctx: Contexto, s: StockMinimo): Promise<Resultado<void>> {
    if (!esOficina(ctx.rol)) return fallo("SIN_PERMISO", "El inventario lo maneja la oficina");
    await this.db.query(
      `INSERT INTO "StockMinimo" (id,"empresaId","sedeId",medida,cantidad) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT ("empresaId","sedeId",medida) DO UPDATE SET cantidad = excluded.cantidad`,
      [nuevoId(), ctx.empresaId, s.sedeId, s.medida.trim(), s.cantidad],
    );
    return { ok: true, valor: undefined };
  }

  // ── Desde las órdenes ────────────────────────────────────────────────────

  /**
   * Al aprobarse una orden: las llantas que se midieron quedan montadas donde
   * estaban, y las que salieron pasan a donde dijo el técnico.
   *
   * Una sola vez por orden: si ya dejó movimientos (se aprobó, la objetaron y
   * se volvió a aprobar), no se repite la historia.
   */
  async procesarOrden(ctx: Contexto, ordenId: string): Promise<{ montadas: number; desmontadas: number }> {
    const hecho = await this.db.query(`SELECT 1 FROM "LlantaMovimiento" WHERE "ordenId" = $1 LIMIT 1`, [ordenId]);
    const resumen = { montadas: 0, desmontadas: 0 };
    if (hecho.rows.length > 0) return resumen;

    const o = (await this.db.query<{ clienteId: string; vehiculoId: string; kilometraje: number | null; fecha: string }>(
      `SELECT "clienteId", "vehiculoId", kilometraje, to_char(fecha,'YYYY-MM-DD') AS fecha FROM "OrdenServicio" WHERE id = $1`,
      [ordenId],
    )).rows[0];
    if (!o) return resumen;

    const filas = (await this.db.query<Record<string, unknown>>(
      `SELECT id, posicion, serial, "numCalor", dot, "marcaId", "disenoId", medida, "noIdentificada", costo,
              "desSerial", "desNumCalor", "desDot", "desMarcaId", "desDisenoId", "desMedida", "desDestino"
         FROM "LlantaRegistro" WHERE "ordenId" = $1 ORDER BY posicion`,
      [ordenId],
    )).rows;
    const lugar = { fecha: o.fecha, vehiculoId: o.vehiculoId, ordenId, kilometraje: o.kilometraje };

    // Primero las que salieron: dejan libre la posición para la que entra.
    for (const f of filas) {
      const serial = claveIdentificador(f["desSerial"] as string | null);
      if (!serial) continue;
      const destino = estadoTrasDesmontaje(f["desDestino"] as string | null);
      const id = await this.buscarOCrear(ctx, o.clienteId, serial, {
        numCalor: f["desNumCalor"], dot: f["desDot"], marcaId: f["desMarcaId"], disenoId: f["desDisenoId"], medida: f["desMedida"],
      }, destino);
      await this.db.query(
        `UPDATE "Llanta" SET estado = $2, "vehiculoId" = NULL, posicion = NULL WHERE id = $1`,
        [id, destino],
      );
      await this.movimiento(ctx, id, "desmontaje", { ...lugar, posicion: Number(f["posicion"]), detalle: (f["desDestino"] as string) ?? null });
      await this.db.query(`UPDATE "LlantaRegistro" SET "desLlantaId" = $2 WHERE id = $1`, [f["id"], id]);
      resumen.desmontadas++;
    }

    // Después las que quedaron montadas.
    for (const f of filas) {
      const serial = claveIdentificador(f["serial"] as string | null);
      if (!serial || f["noIdentificada"]) continue;
      const posicion = Number(f["posicion"]);
      const id = await this.buscarOCrear(ctx, o.clienteId, serial, {
        numCalor: f["numCalor"], dot: f["dot"], marcaId: f["marcaId"], disenoId: f["disenoId"], medida: f["medida"],
      }, "montada");
      const actual = (await this.db.query<{ estado: string; vehiculoId: string | null; posicion: number | null }>(
        `SELECT estado, "vehiculoId", posicion FROM "Llanta" WHERE id = $1`, [id],
      )).rows[0];
      const yaAhi = actual?.estado === "montada" && actual.vehiculoId === o.vehiculoId && actual.posicion === posicion;
      if (!yaAhi) {
        // Otra llanta montada en esa posición y que nadie reportó como salida:
        // se pasa a bodega, para no tener dos montadas en el mismo lugar.
        const ocupante = (await this.db.query<{ id: string }>(
          `SELECT id FROM "Llanta" WHERE "vehiculoId" = $1 AND posicion = $2 AND estado = 'montada' AND id <> $3`,
          [o.vehiculoId, posicion, id],
        )).rows[0];
        if (ocupante) {
          await this.db.query(`UPDATE "Llanta" SET estado = 'bodega', "vehiculoId" = NULL, posicion = NULL WHERE id = $1`, [ocupante.id]);
          await this.movimiento(ctx, ocupante.id, "desmontaje", { ...lugar, posicion, detalle: "Se registró otra llanta en su posición" });
        }
        // Si estaba montada en otro lado, sale de allá (rotación).
        if (actual?.estado === "montada") {
          await this.movimiento(ctx, id, "desmontaje", { ...lugar, vehiculoId: actual.vehiculoId, posicion: actual.posicion, detalle: "Rotación" });
        }
        await this.db.query(
          `UPDATE "Llanta" SET estado = 'montada', "vehiculoId" = $2, posicion = $3, "sedeId" = NULL WHERE id = $1`,
          [id, o.vehiculoId, posicion],
        );
        await this.movimiento(ctx, id, "montaje", { ...lugar, posicion });
        resumen.montadas++;
      }
      await this.db.query(`UPDATE "LlantaRegistro" SET "llantaId" = $2 WHERE id = $1`, [f["id"], id]);
      // R9: el costo capturado en el levantamiento queda en la ficha si no tenía.
      if (f["costo"] !== null && f["costo"] !== undefined) {
        await this.db.query(`UPDATE "Llanta" SET costo = coalesce(costo, $2) WHERE id = $1`, [id, f["costo"]]);
      }
    }
    return resumen;
  }

  // ── Auxiliares ───────────────────────────────────────────────────────────

  /** La llanta de ese serial en la flota del cliente; si no existe, se crea. */
  private async buscarOCrear(
    ctx: Contexto,
    clienteId: string,
    serial: string,
    datos: Record<string, unknown>,
    estadoInicial: EstadoActivo,
  ): Promise<string> {
    const r = await this.db.query<{ id: string }>(`SELECT id FROM "Llanta" WHERE "clienteId" = $1 AND serial = $2`, [clienteId, serial]);
    if (r.rows[0]) return r.rows[0].id;
    const id = nuevoId();
    // Nace fuera de una posición; quien llama la ubica. Si nace "montada", el
    // CHECK exige lugar: se crea en bodega y se monta en el paso siguiente.
    await this.db.query(
      `INSERT INTO "Llanta" (id,"empresaId","clienteId",serial,"numCalor",dot,"marcaId","disenoId",medida,estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, ctx.empresaId, clienteId, serial, datos["numCalor"] ?? null, datos["dot"] ?? null,
       datos["marcaId"] ?? null, datos["disenoId"] ?? null, datos["medida"] ?? null,
       estadoInicial === "montada" ? "bodega" : estadoInicial],
    );
    await this.vida(ctx, id, 0, {});
    return id;
  }

  private async vida(
    ctx: Contexto,
    llantaId: string,
    numero: number,
    v: { banda?: string | null; reencauchadora?: string | null; costo?: number | null; profundidadInicial?: number | null; inicio?: string | undefined },
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO "LlantaVida" (id,"empresaId","llantaId",numero,banda,reencauchadora,costo,"profundidadInicial",inicio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date)`,
      [nuevoId(), ctx.empresaId, llantaId, numero, v.banda ?? null, v.reencauchadora ?? null,
       v.costo ?? null, v.profundidadInicial ?? null, v.inicio ?? this.hoy()],
    );
  }

  private async movimiento(
    ctx: Contexto,
    llantaId: string,
    tipo: TipoMovimiento,
    m: { fecha?: string | null; vehiculoId?: string | null; posicion?: number | null; ordenId?: string | null; kilometraje?: number | null; sedeId?: string | null; detalle?: string | null },
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO "LlantaMovimiento" (id,"empresaId","llantaId",tipo,fecha,"vehiculoId",posicion,"ordenId",kilometraje,"sedeId",detalle,"usuarioId")
       VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12)`,
      [nuevoId(), ctx.empresaId, llantaId, tipo, m.fecha ?? this.hoy(), m.vehiculoId ?? null, m.posicion ?? null,
       m.ordenId ?? null, m.kilometraje ?? null, m.sedeId ?? null, m.detalle ?? null, ctx.usuarioId || null],
    );
  }

  private async unaListada(id: string): Promise<Resultado<LlantaListada>> {
    const r = await this.db.query<Record<string, unknown>>(`${SELECCION} WHERE l.id = $1`, [id]);
    return r.rows[0] ? { ok: true, valor: aListada(r.rows[0]) } : fallo("NO_EXISTE", "No existe");
  }
}
