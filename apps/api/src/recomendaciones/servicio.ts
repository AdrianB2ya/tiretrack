import { nuevoId, puedeGestionarRecomendaciones, type Rol, type Veredicto } from "@tiretrack/domain";
import type { z } from "zod";
import type { zCrearRecomendacion, zResolverRecomendacion } from "@tiretrack/contracts";

/**
 * Recomendaciones persistentes (regla del negocio): lo que el técnico
 * encuentra y no ejecuta sobrevive al cierre y reaparece en la siguiente orden
 * de ese vehículo. La tabla existía desde la 1.1 sin nada que la usara.
 *
 * Llegan como operaciones de la cola (se registran sin señal), así que todo es
 * idempotente por id: reintentar no duplica. Corre bajo RLS: una orden que
 * quien pregunta no ve no existe (404, no 403).
 */

type CrearRecomendacion = z.infer<typeof zCrearRecomendacion>;
type ResolverRecomendacion = z.infer<typeof zResolverRecomendacion>;

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; veredicto: Veredicto };
const fallo = (codigo: string, mensaje: string): Resultado<never> => ({ ok: false, veredicto: { permitido: false, codigo, mensaje } });

export interface RecomendacionVista {
  readonly id: string;
  readonly vehiculoId: string;
  readonly posicion: number | null;
  readonly texto: string;
  readonly prioridad: string;
  readonly estado: string;
  readonly origenOrdenId: string;
  readonly resueltaOrdenId: string | null;
  readonly creadaEn: string;
}

/** Lo único que se necesita de la conexión: la descarga pasa la suya. */
export interface Consulta {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export class ServicioRecomendaciones {
  constructor(private readonly db: Consulta) {}

  /** La orden, si quien pregunta la ve, con lo que hace falta para decidir. */
  private async orden(id: string) {
    const r = await this.db.query<{ vehiculoId: string; clienteId: string; empresaId: string; estado: string; tecnicoId: string }>(
      `SELECT "vehiculoId", "clienteId", "empresaId", estado::text AS estado, tecnico_id AS "tecnicoId"
         FROM "OrdenServicio" WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async crear(ctx: Contexto, ordenId: string, d: CrearRecomendacion): Promise<Resultado<{ id: string }>> {
    const o = await this.orden(ordenId);
    if (!o) return fallo("NO_EXISTE", "La orden no existe");
    const v = puedeGestionarRecomendaciones({ rol: ctx.rol, esTecnicoAsignado: o.tecnicoId === ctx.usuarioId, estadoOrden: o.estado });
    if (!v.permitido) return { ok: false, veredicto: v };
    // La recomendación es del vehículo de ESTA orden: otro vehículo sería un
    // dato cruzado entre camiones.
    if (d.vehiculoId !== o.vehiculoId) return fallo("VEHICULO_NO_CORRESPONDE", "La recomendación no es del vehículo de esta orden");

    // Idempotente por id: el celular reintenta si no vio la respuesta.
    await this.db.query(
      `INSERT INTO "Recomendacion"
         (id, "empresaId", "clienteId", "vehiculoId", posicion, texto, prioridad, "origenOrdenId", "creadaPorId")
       VALUES ($1,$2,$3,$4,$5,$6,$7::"PrioridadRecomendacion",$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [d.id, o.empresaId, o.clienteId, o.vehiculoId, d.posicion ?? null, d.texto, d.prioridad, ordenId, ctx.usuarioId],
    );
    await this.auditar(ctx, "crear", { recomendacionId: d.id, ordenId });
    return { ok: true, valor: { id: d.id } };
  }

  /**
   * Hecha o descartada, desde una orden abierta del MISMO vehículo: es en esa
   * visita donde se ejecutó o se decidió no hacerla.
   */
  async resolver(ctx: Contexto, id: string, d: ResolverRecomendacion): Promise<Resultado<{ id: string }>> {
    const rec = await this.db.query<{ vehiculoId: string; estado: string; resueltaOrdenId: string | null }>(
      `SELECT "vehiculoId", estado::text AS estado, "resueltaOrdenId" FROM "Recomendacion" WHERE id = $1`,
      [id],
    );
    const r = rec.rows[0];
    if (!r) return fallo("NO_EXISTE", "La recomendación no existe");
    // Reintento de la misma resolución: ya está, no es un error.
    if (r.estado === d.estado && r.resueltaOrdenId === d.ordenId) return { ok: true, valor: { id } };
    if (r.estado !== "abierta") return fallo("YA_RESUELTA", "La recomendación ya se resolvió en otra visita");

    const o = await this.orden(d.ordenId);
    if (!o) return fallo("NO_EXISTE", "La orden no existe");
    const v = puedeGestionarRecomendaciones({ rol: ctx.rol, esTecnicoAsignado: o.tecnicoId === ctx.usuarioId, estadoOrden: o.estado });
    if (!v.permitido) return { ok: false, veredicto: v };
    if (o.vehiculoId !== r.vehiculoId) return fallo("VEHICULO_NO_CORRESPONDE", "La orden es de otro vehículo");

    await this.db.query(
      `UPDATE "Recomendacion" SET estado = $2::"EstadoRecomendacion", "resueltaEn" = timezone('UTC', now()), "resueltaOrdenId" = $3
        WHERE id = $1 AND estado = 'abierta'`,
      [id, d.estado, d.ordenId],
    );
    await this.auditar(ctx, "actualizar", { recomendacionId: id, estado: d.estado, ordenId: d.ordenId });
    return { ok: true, valor: { id } };
  }

  /**
   * Para la descarga: las abiertas de esos vehículos, más las que se crearon
   * o resolvieron en esas órdenes (para verlas en la orden donde ocurrieron).
   */
  async paraOrdenes(ordenIds: readonly string[]): Promise<RecomendacionVista[]> {
    if (ordenIds.length === 0) return [];
    const r = await this.db.query<Record<string, unknown>>(
      `SELECT r.id, r."vehiculoId", r.posicion, r.texto, r.prioridad::text AS prioridad, r.estado::text AS estado,
              r."origenOrdenId", r."resueltaOrdenId", to_char(r."creadaEn" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "creadaEn"
         FROM "Recomendacion" r
        WHERE (r.estado = 'abierta'
               AND r."vehiculoId" IN (SELECT "vehiculoId" FROM "OrdenServicio" WHERE id = ANY($1::text[])))
           OR r."origenOrdenId" = ANY($1::text[])
           OR r."resueltaOrdenId" = ANY($1::text[])
        ORDER BY r."creadaEn"`,
      [ordenIds],
    );
    return r.rows.map((f) => ({
      id: String(f["id"]),
      vehiculoId: String(f["vehiculoId"]),
      posicion: f["posicion"] === null ? null : Number(f["posicion"]),
      texto: String(f["texto"]),
      prioridad: String(f["prioridad"]),
      estado: String(f["estado"]),
      origenOrdenId: String(f["origenOrdenId"]),
      resueltaOrdenId: (f["resueltaOrdenId"] as string | null) ?? null,
      creadaEn: String(f["creadaEn"]),
    }));
  }

  private async auditar(ctx: Contexto, accion: string, detalle: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `INSERT INTO "Auditoria" (id,"empresaId","usuarioId",rol,accion,detalle) VALUES ($1,$2,$3,$4,$5::"AccionAuditoria",$6)`,
      [nuevoId(), ctx.empresaId, ctx.usuarioId, ctx.rol, accion, JSON.stringify({ ...detalle, entidad: "recomendacion" })],
    );
  }
}
