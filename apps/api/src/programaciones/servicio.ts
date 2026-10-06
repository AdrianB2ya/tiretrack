import type pg from "pg";
import {
  describirFrecuencia,
  nuevoId,
  primeraVisita,
  puedeGestionarProgramaciones,
  revisarProgramacion,
  type Frecuencia,
  type Rol,
  type Veredicto,
} from "@tiretrack/domain";
import type { CrearProgramacion } from "@tiretrack/contracts";

/**
 * Programación recurrente (4.4): el coordinador decide que un vehículo se
 * revise cada cierto tiempo, y el trabajo programado genera las órdenes.
 *
 * Corre con el rol de aplicación, bajo RLS. Como en el resto del sistema,
 * **cada quien ve y programa solo en sus sedes** (decisión del usuario,
 * 2026-10-05).
 */

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
const sinPermiso = fallo("SIN_PERMISO", "Solo el administrador y el coordinador programan visitas");
const noExiste = fallo("NO_EXISTE", "La programación no existe");

export interface ProgramacionListada {
  readonly id: string;
  readonly sedeId: string;
  readonly sedeCodigo: string;
  readonly clienteNombre: string;
  readonly sedeClienteNombre: string;
  readonly vehiculoId: string;
  readonly vehiculoCodigo: string;
  readonly vehiculoPlaca: string | null;
  readonly tecnicoId: string;
  readonly tecnicoNombre: string;
  readonly tipo: string;
  readonly frecuencia: Frecuencia;
  readonly cada: number;
  /** "Cada 2 meses". */
  readonly descripcion: string;
  readonly inicio: string;
  readonly proxima: string;
  readonly activa: boolean;
  /** Por qué no se generó la última vez. */
  readonly ultimoAviso: string | null;
}

/** Sedes del usuario: lo que puede ver y programar. */
const SUS_SEDES = `SELECT "sedeId" FROM "UsuarioSede" WHERE "usuarioId" = $1 AND activa`;

export class ServicioProgramaciones {
  constructor(private readonly db: pg.PoolClient | pg.Client) {}

  async listar(ctx: Contexto): Promise<Resultado<ProgramacionListada[]>> {
    if (!puedeGestionarProgramaciones(ctx.rol)) return sinPermiso;
    const r = await this.db.query<Record<string, unknown>>(
      `SELECT p.id, p."sedeId", s.codigo AS "sedeCodigo", c.nombre AS "clienteNombre",
              sc.nombre AS "sedeClienteNombre", p."vehiculoId", v.codigo AS "vehiculoCodigo",
              v.placa AS "vehiculoPlaca", p."tecnicoId", u.nombre AS "tecnicoNombre",
              p.tipo::text AS tipo, p.frecuencia::text AS frecuencia, p.cada,
              to_char(p.inicio,'YYYY-MM-DD') AS inicio, to_char(p.proxima,'YYYY-MM-DD') AS proxima,
              p.activa, p."ultimoAviso"
         FROM "ProgramacionRecurrente" p
         JOIN "Sede" s ON s.id = p."sedeId"
         JOIN "Cliente" c ON c.id = p."clienteId"
         JOIN "SedeCliente" sc ON sc.id = p."sedeClienteId"
         JOIN "Vehiculo" v ON v.id = p."vehiculoId"
         JOIN "Usuario" u ON u.id = p."tecnicoId"
        WHERE p."sedeId" IN (${SUS_SEDES})
        -- Lo que tiene problema primero, luego lo que toca antes; las
        -- pausadas al final.
        ORDER BY p.activa DESC, (p."ultimoAviso" IS NULL), p.proxima, v.codigo`,
      [ctx.usuarioId],
    );
    return {
      ok: true,
      valor: r.rows.map((f) => ({
        id: String(f["id"]),
        sedeId: String(f["sedeId"]),
        sedeCodigo: String(f["sedeCodigo"]),
        clienteNombre: String(f["clienteNombre"]),
        sedeClienteNombre: String(f["sedeClienteNombre"]),
        vehiculoId: String(f["vehiculoId"]),
        vehiculoCodigo: String(f["vehiculoCodigo"]),
        vehiculoPlaca: (f["vehiculoPlaca"] as string | null) ?? null,
        tecnicoId: String(f["tecnicoId"]),
        tecnicoNombre: String(f["tecnicoNombre"]),
        tipo: String(f["tipo"]),
        frecuencia: f["frecuencia"] as Frecuencia,
        cada: Number(f["cada"]),
        descripcion: describirFrecuencia(f["frecuencia"] as Frecuencia, Number(f["cada"])),
        inicio: String(f["inicio"]),
        proxima: String(f["proxima"]),
        activa: Boolean(f["activa"]),
        ultimoAviso: (f["ultimoAviso"] as string | null) ?? null,
      })),
    };
  }

  async crear(ctx: Contexto, d: CrearProgramacion, hoy: string): Promise<Resultado<{ id: string; proxima: string }>> {
    if (!puedeGestionarProgramaciones(ctx.rol)) return sinPermiso;
    const v = revisarProgramacion(d, hoy);
    if (!v.permitido) return { ok: false, veredicto: v };

    const sede = await this.enSusSedes(ctx, d.sedeId);
    if (!sede) return fallo("SEDE_AJENA", "Solo puedes programar en tus sedes");

    // El vehículo debe ser de esa sede del cliente y estar activo. Las llaves
    // compuestas cubren cliente ↔ sede del cliente, no el vehículo.
    const veh = await this.db.query<{ activo: boolean }>(
      `SELECT activo FROM "Vehiculo" WHERE id = $1 AND "sedeClienteId" = $2`,
      [d.vehiculoId, d.sedeClienteId],
    );
    if (veh.rowCount === 0) return fallo("VEHICULO_NO_CORRESPONDE", "El vehículo no es de esa sede del cliente");
    if (!veh.rows[0]?.activo) return fallo("VEHICULO_INACTIVO", "El vehículo está deshabilitado");

    const tecnico = await this.tecnicoDisponible(d.tecnicoId, d.sedeId);
    if (!tecnico.permitido) return { ok: false, veredicto: tecnico };

    // Dos programaciones del mismo tipo para el mismo vehículo generarían
    // dos órdenes por visita —o una y un aviso de "orden abierta" cada vez—.
    const repetida = await this.db.query(
      `SELECT 1 FROM "ProgramacionRecurrente" WHERE "vehiculoId" = $1 AND tipo = $2::"TipoServicio" AND activa`,
      [d.vehiculoId, d.tipo],
    );
    if ((repetida.rowCount ?? 0) > 0) {
      return fallo("PROGRAMACION_DUPLICADA", "Ese vehículo ya tiene una programación activa de ese tipo");
    }

    const proxima = primeraVisita(d.inicio);
    try {
      await this.db.query(
        `INSERT INTO "ProgramacionRecurrente"
           (id,"empresaId","sedeId","clienteId","sedeClienteId","vehiculoId","tecnicoId","creadoPorId",
            tipo,frecuencia,cada,inicio,proxima)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::"TipoServicio",$10::"Frecuencia",$11,$12::date,$13::date)`,
        [d.id, ctx.empresaId, d.sedeId, d.clienteId, d.sedeClienteId, d.vehiculoId, d.tecnicoId,
         ctx.usuarioId, d.tipo, d.frecuencia, d.cada, d.inicio, proxima],
      );
    } catch (e) {
      const codigo = (e as { code?: string }).code;
      // Reenviar la misma alta (doble toque con mala señal) no duplica.
      if (codigo === "23505") return fallo("YA_EXISTE", "Esa programación ya se creó");
      // Cliente y sede del cliente que no se corresponden: lo detiene la
      // llave compuesta.
      if (codigo === "23503") return fallo("DATOS_NO_CORRESPONDEN", "El cliente, la sede o el técnico no corresponden");
      throw e;
    }
    await this.auditar(ctx, "crear", { programacionId: d.id, vehiculoId: d.vehiculoId, tecnicoId: d.tecnicoId,
      frecuencia: d.frecuencia, cada: d.cada, inicio: d.inicio });
    return { ok: true, valor: { id: d.id, proxima } };
  }

  /** Pausa: no se borra (nada se borra) y deja de generar órdenes. */
  async desactivar(ctx: Contexto, id: string): Promise<Resultado<{ id: string }>> {
    if (!puedeGestionarProgramaciones(ctx.rol)) return sinPermiso;
    const r = await this.db.query(
      `UPDATE "ProgramacionRecurrente" SET activa = false, "desactivadoEn" = timezone('UTC', now())
        WHERE id = $1 AND activa AND "sedeId" IN (${SUS_SEDES.replace("$1", "$2")})`,
      [id, ctx.usuarioId],
    );
    if ((r.rowCount ?? 0) === 0) return noExiste;
    await this.auditar(ctx, "deshabilitar", { programacionId: id });
    return { ok: true, valor: { id } };
  }

  /**
   * Cambia el técnico fijo. Es la salida cuando el trabajo avisa que el
   * técnico ya no está: limpia el aviso, y la visita pendiente se genera en
   * la siguiente vuelta.
   */
  async cambiarTecnico(ctx: Contexto, id: string, tecnicoId: string): Promise<Resultado<{ id: string }>> {
    if (!puedeGestionarProgramaciones(ctx.rol)) return sinPermiso;
    const p = await this.db.query<{ sedeId: string }>(
      `SELECT "sedeId" FROM "ProgramacionRecurrente"
        WHERE id = $1 AND "sedeId" IN (${SUS_SEDES.replace("$1", "$2")})`,
      [id, ctx.usuarioId],
    );
    const sedeId = p.rows[0]?.sedeId;
    if (!sedeId) return noExiste;
    const tecnico = await this.tecnicoDisponible(tecnicoId, sedeId);
    if (!tecnico.permitido) return { ok: false, veredicto: tecnico };
    await this.db.query(
      `UPDATE "ProgramacionRecurrente" SET "tecnicoId" = $2, "ultimoAviso" = NULL WHERE id = $1`,
      [id, tecnicoId],
    );
    await this.auditar(ctx, "actualizar", { programacionId: id, tecnicoId });
    return { ok: true, valor: { id } };
  }

  private async enSusSedes(ctx: Contexto, sedeId: string): Promise<boolean> {
    const r = await this.db.query(`SELECT 1 FROM (${SUS_SEDES}) s WHERE s."sedeId" = $2`, [ctx.usuarioId, sedeId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Mismo criterio que el trabajo: activo, técnico y asignado a la sede. */
  private async tecnicoDisponible(tecnicoId: string, sedeId: string): Promise<Veredicto> {
    const r = await this.db.query<{ disponible: boolean; enSede: boolean }>(
      `SELECT (u.activo AND u.rol = 'tecnico') AS disponible,
              EXISTS (SELECT 1 FROM "UsuarioSede" us
                       WHERE us."usuarioId" = u.id AND us."sedeId" = $2 AND us.activa) AS "enSede"
         FROM "Usuario" u WHERE u.id = $1`,
      [tecnicoId, sedeId],
    );
    const t = r.rows[0];
    if (!t?.disponible) return { permitido: false, codigo: "TECNICO_NO_DISPONIBLE", mensaje: "Elige un técnico activo" };
    if (!t.enSede) {
      return { permitido: false, codigo: "TECNICO_NO_DISPONIBLE", mensaje: "Ese técnico no trabaja en esa sede" };
    }
    return { permitido: true };
  }

  private async auditar(ctx: Contexto, accion: string, detalle: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `INSERT INTO "Auditoria" (id,"empresaId","usuarioId",rol,accion,detalle)
       VALUES ($1,$2,$3,$4,$5::"AccionAuditoria",$6)`,
      [nuevoId(), ctx.empresaId, ctx.usuarioId, ctx.rol, accion, JSON.stringify({ ...detalle, entidad: "programacion" })],
    );
  }
}
