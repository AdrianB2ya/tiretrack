import { evaluarCambioReclamo, fechaEnColombia, type EstadoReclamo, type Rol, type Veredicto } from "@tiretrack/domain";
import type { z } from "zod";
import type { zCambioReclamo, zCrearReclamo, zFiltroCausas } from "@tiretrack/contracts";

/**
 * Retiro y fallas (R10): reclamos de garantía y causas de retiro.
 *
 * El reclamo nace de una llanta que falló y sigue su curso con el proveedor:
 * abierto → enviado → aprobado (con lo que reconoció) o rechazado → cerrado.
 * Las notas se acumulan con fecha: es la conversación con el proveedor.
 *
 * Las causas de retiro salen de lo que el técnico anotó al desmontar: por
 * motivo, por marca, por posición y por vehículo. Es lo que dice qué marca
 * rinde y qué eje se come las llantas.
 */

interface Consultable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; veredicto: Veredicto };
const fallo = (codigo: string, mensaje: string): Resultado<never> => ({ ok: false, veredicto: { permitido: false, codigo, mensaje } });
const esOficina = (r: Rol) => r === "administrador" || r === "coordinador";
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export class ServicioReclamos {
  constructor(
    private readonly db: Consultable,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async listar(estado?: string): Promise<Record<string, unknown>[]> {
    const r = await this.db.query<Record<string, unknown>>(
      `SELECT r.id, r.proveedor, r."motivoRetiro", r.estado, to_char(r.fecha,'YYYY-MM-DD') AS fecha,
              r."valorReconocido", r.notas, r."llantaId",
              coalesce(l."numeroInterno", l.serial) AS llanta, c.nombre AS "clienteNombre"
         FROM "Reclamo" r
         JOIN "Llanta" l ON l.id = r."llantaId"
         JOIN "Cliente" c ON c.id = r."clienteId"
        WHERE ($1::text IS NULL OR r.estado = $1)
        ORDER BY (r.estado IN ('cerrado')), r.fecha DESC
        LIMIT 300`,
      [estado ?? null],
    );
    return r.rows.map((f) => ({ ...f, valorReconocido: num(f["valorReconocido"]) }));
  }

  async crear(ctx: Contexto, e: z.infer<typeof zCrearReclamo>): Promise<Resultado<{ id: string }>> {
    if (!esOficina(ctx.rol)) return fallo("SIN_PERMISO", "Los reclamos los lleva la oficina");
    const l = (await this.db.query<{ clienteId: string }>(`SELECT "clienteId" FROM "Llanta" WHERE id = $1`, [e.llantaId])).rows[0];
    if (!l) return fallo("NO_EXISTE", "La llanta no existe");
    const abierto = await this.db.query(
      `SELECT 1 FROM "Reclamo" WHERE "llantaId" = $1 AND estado <> 'cerrado'`,
      [e.llantaId],
    );
    if (abierto.rows.length > 0) return fallo("YA_EXISTE", "Esta llanta ya tiene un reclamo en curso");
    await this.db.query(
      `INSERT INTO "Reclamo" (id,"empresaId","llantaId","clienteId",proveedor,"motivoRetiro",estado,fecha,notas,"creadoPorId")
       VALUES ($1,$2,$3,$4,$5,$6,'abierto',$7::date,$8,$9)`,
      [e.id, ctx.empresaId, e.llantaId, l.clienteId, e.proveedor.trim(), e.motivoRetiro, fechaEnColombia(this.reloj()),
       e.notas ? this.nota(e.notas) : null, ctx.usuarioId],
    );
    return { ok: true, valor: { id: e.id } };
  }

  async cambiarEstado(ctx: Contexto, id: string, c: z.infer<typeof zCambioReclamo>): Promise<Resultado<{ estado: string }>> {
    if (!esOficina(ctx.rol)) return fallo("SIN_PERMISO", "Los reclamos los lleva la oficina");
    const r = (await this.db.query<{ estado: EstadoReclamo; notas: string | null }>(
      `SELECT estado, notas FROM "Reclamo" WHERE id = $1 FOR UPDATE`, [id],
    )).rows[0];
    if (!r) return fallo("NO_EXISTE", "No existe");
    const v = evaluarCambioReclamo(r.estado, c.estado, c.valorReconocido ?? null);
    if (!v.permitido) return { ok: false, veredicto: v };
    const notas = c.nota ? [r.notas, this.nota(c.nota)].filter(Boolean).join("\n") : r.notas;
    await this.db.query(
      `UPDATE "Reclamo" SET estado = $2, "valorReconocido" = coalesce($3, "valorReconocido"), notas = $4 WHERE id = $1`,
      [id, c.estado, c.valorReconocido ?? null, notas],
    );
    return { ok: true, valor: { estado: c.estado } };
  }

  /**
   * Causas de retiro del período. El cliente ve solo lo aprobado o cerrado de
   * su flota (como en su portal; RLS hace el resto).
   */
  async causas(ctx: Contexto, f: z.infer<typeof zFiltroCausas>) {
    const cond = [`lr."desMotivoRetiro" IS NOT NULL`, `o.estado <> 'anulada'`];
    const p: unknown[] = [];
    if (f.desde) cond.push(`o.fecha >= $${p.push(f.desde)}::date`);
    if (f.hasta) cond.push(`o.fecha <= $${p.push(f.hasta)}::date`);
    if (f.clienteId) cond.push(`o."clienteId" = $${p.push(f.clienteId)}`);
    if (ctx.rol === "cliente") cond.push(`o.estado::text IN ('pendiente_cliente','cerrada')`);
    const base = `FROM "LlantaRegistro" lr
      JOIN "OrdenServicio" o ON o.id = lr."ordenId"
      LEFT JOIN "Marca" m ON m.id = lr."desMarcaId"
      LEFT JOIN "Marca" mc ON mc.id = m."reemplazadaPorId"
      LEFT JOIN "Vehiculo" v ON v.id = o."vehiculoId"
      WHERE ${cond.join(" AND ")}`;
    const agrupar = async (expr: string) =>
      (await this.db.query<{ grupo: string | null; motivo: string; cantidad: number }>(
        `SELECT ${expr} AS grupo, lr."desMotivoRetiro" AS motivo, count(*)::int AS cantidad ${base}
          GROUP BY 1, 2 ORDER BY 3 DESC, 1`,
        p,
      )).rows;
    const porMotivo = (await this.db.query<{ motivo: string; cantidad: number }>(
      `SELECT lr."desMotivoRetiro" AS motivo, count(*)::int AS cantidad ${base} GROUP BY 1 ORDER BY 2 DESC`,
      p,
    )).rows;
    return {
      total: porMotivo.reduce((a, x) => a + x.cantidad, 0),
      porMotivo,
      // La marca unificada se cuenta como la correcta (revisión del catálogo).
      porMarca: await agrupar(`coalesce(mc.nombre, m.nombre, 'Sin marca')`),
      porPosicion: await agrupar(`CASE WHEN lr.posicion > 100 THEN 'R' || (lr.posicion - 100) ELSE lr.posicion::text END`),
      porVehiculo: await agrupar(`coalesce(o."vehiculoCodigo", v.codigo)`),
    };
  }

  private nota(texto: string): string {
    return `${fechaEnColombia(this.reloj())}: ${texto.trim()}`;
  }
}
