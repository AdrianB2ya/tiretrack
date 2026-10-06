import type pg from "pg";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { puedeAsignarRol, puedeGestionarUsuarios, type Rol, type Veredicto } from "@tiretrack/domain";
import type { z } from "zod";
import type { zCrearUsuario } from "@tiretrack/contracts";

type CrearUsuario = z.infer<typeof zCrearUsuario>;

/**
 * Usuarios y sedes de la empresa (5.2). Solo el administrador.
 *
 * Corre con el rol de aplicación y bajo RLS: el administrador solo ve y
 * crea dentro de su empresa. El código de activación NO se crea aquí: la
 * tabla de tokens solo admite el token propio con este rol, así que lo emite
 * el servicio de acceso.
 */

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; veredicto: Veredicto };
const fallo = (codigo: string, mensaje: string): Resultado<never> => ({ ok: false, veredicto: { permitido: false, codigo, mensaje } });
const sinPermiso = fallo("SIN_PERMISO", "Solo el administrador gestiona usuarios y sedes");

export interface UsuarioListado {
  readonly id: string;
  readonly nombre: string;
  readonly email: string;
  readonly rol: string;
  readonly activo: boolean;
  readonly clienteId: string | null;
  readonly sedes: string[];
  /** Nunca ha entrado: o no activó, o el código venció. */
  readonly sinActivar: boolean;
}

export interface SedeListada {
  readonly id: string;
  readonly nombre: string;
  readonly codigo: string;
  readonly ciudad: string | null;
  readonly activa: boolean;
}

const esDuplicado = (e: unknown) => (e as { code?: string }).code === "23505";

export class ServicioUsuarios {
  constructor(private readonly db: pg.PoolClient | pg.Client) {}

  async listar(ctx: Contexto): Promise<Resultado<UsuarioListado[]>> {
    if (!puedeGestionarUsuarios(ctx.rol)) return sinPermiso;
    const r = await this.db.query<Record<string, unknown>>(
      `SELECT u.id, u.nombre, u.email, u.rol::text AS rol, u.activo, u."clienteId",
              u."ultimoAcceso" IS NULL AS "sinActivar",
              coalesce(array_agg(us."sedeId") FILTER (WHERE us."sedeId" IS NOT NULL), '{}') AS sedes
         FROM "Usuario" u
         LEFT JOIN "UsuarioSede" us ON us."usuarioId" = u.id
        WHERE u."empresaId" = $1
        GROUP BY u.id
        ORDER BY u.nombre`,
      [ctx.empresaId],
    );
    // Se eligen los campos uno por uno: nunca el hash ni el secreto de 2FA.
    return {
      ok: true,
      valor: r.rows.map((f) => ({
        id: String(f["id"]),
        nombre: String(f["nombre"]),
        email: String(f["email"]),
        rol: String(f["rol"]),
        activo: Boolean(f["activo"]),
        clienteId: (f["clienteId"] as string) ?? null,
        sedes: (f["sedes"] as string[]) ?? [],
        sinActivar: Boolean(f["sinActivar"]),
      })),
    };
  }

  /**
   * Crea el usuario sin contraseña utilizable: el hash es de un secreto al
   * azar que nadie conoce. Entra con el código de activación, que elige su
   * propia contraseña.
   */
  async crear(ctx: Contexto, d: CrearUsuario): Promise<Resultado<{ id: string }>> {
    const permiso = puedeAsignarRol(ctx.rol, d.rol);
    if (!permiso.permitido) return { ok: false, veredicto: permiso };

    // Las sedes tienen que ser de la empresa: bajo RLS, las ajenas no se ven.
    const sedes = await this.db.query(`SELECT id FROM "Sede" WHERE id = ANY($1::text[]) AND activa`, [d.sedes]);
    if (sedes.rowCount !== d.sedes.length) return fallo("SEDE_NO_EXISTE", "Alguna sede no existe o está desactivada");
    if (d.rol === "cliente") {
      const c = await this.db.query(`SELECT 1 FROM "Cliente" WHERE id = $1`, [d.clienteId]);
      if (c.rowCount === 0) return fallo("CLIENTE_NO_EXISTE", "El cliente no existe");
    }

    const hashInutilizable = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
    try {
      await this.db.query(
        `INSERT INTO "Usuario" (id, "empresaId", nombre, cedula, email, telefono, "passwordHash", rol, "clienteId")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"Rol",$9)`,
        [d.id, ctx.empresaId, d.nombre, d.cedula, d.email, d.telefono ?? null, hashInutilizable, d.rol,
         d.rol === "cliente" ? d.clienteId : null],
      );
    } catch (e) {
      if (esDuplicado(e)) return fallo("CORREO_DUPLICADO", "Ya hay un usuario con ese correo en la empresa");
      throw e;
    }
    const principal = d.sedePrincipal ?? d.sedes[0];
    for (const sedeId of d.sedes) {
      await this.db.query(
        `INSERT INTO "UsuarioSede" ("usuarioId", "sedeId", "esPrincipal") VALUES ($1,$2,$3)`,
        [d.id, sedeId, sedeId === principal],
      );
    }
    return { ok: true, valor: { id: d.id } };
  }

  /** Existe y es de la empresa (bajo RLS, uno ajeno no se ve: 404, no 403). */
  async existe(ctx: Contexto, usuarioId: string): Promise<Resultado<true>> {
    if (!puedeGestionarUsuarios(ctx.rol)) return sinPermiso;
    const r = await this.db.query(`SELECT 1 FROM "Usuario" WHERE id = $1 AND "empresaId" = $2`, [usuarioId, ctx.empresaId]);
    return r.rowCount ? { ok: true, valor: true } : fallo("NO_EXISTE", "El usuario no existe");
  }

  async sedes(ctx: Contexto): Promise<Resultado<SedeListada[]>> {
    if (!puedeGestionarUsuarios(ctx.rol)) return sinPermiso;
    const r = await this.db.query<Record<string, unknown>>(
      `SELECT id, nombre, codigo, ciudad, activa FROM "Sede" WHERE "empresaId" = $1 ORDER BY nombre`,
      [ctx.empresaId],
    );
    return {
      ok: true,
      valor: r.rows.map((f) => ({
        id: String(f["id"]), nombre: String(f["nombre"]), codigo: String(f["codigo"]),
        ciudad: (f["ciudad"] as string) ?? null, activa: Boolean(f["activa"]),
      })),
    };
  }

  /** El código entra en el folio (OS-FUN-000123): único en la empresa. */
  async crearSede(
    ctx: Contexto,
    d: { id: string; nombre: string; codigo: string; ciudad?: string; departamento?: string; direccion?: string },
  ): Promise<Resultado<{ id: string }>> {
    if (!puedeGestionarUsuarios(ctx.rol)) return sinPermiso;
    try {
      await this.db.query(
        `INSERT INTO "Sede" (id, "empresaId", nombre, codigo, ciudad, departamento, direccion)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [d.id, ctx.empresaId, d.nombre, d.codigo, d.ciudad ?? null, d.departamento ?? null, d.direccion ?? null],
      );
    } catch (e) {
      if (esDuplicado(e)) return fallo("CODIGO_DUPLICADO", "Ya hay una sede con ese código");
      throw e;
    }
    return { ok: true, valor: { id: d.id } };
  }
}
