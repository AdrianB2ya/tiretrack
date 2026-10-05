import type pg from "pg";

/**
 * Acceso a datos de autenticación.
 *
 * Se declara como interfaz para que el servicio no dependa de PostgreSQL: las
 * pruebas de la lógica pueden usar una implementación en memoria, y las de
 * integración la real.
 */

export interface UsuarioAcceso {
  readonly id: string;
  readonly empresaId: string | null;
  readonly empresaNombre?: string | null;
  readonly clienteId: string | null;
  readonly nombre: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly rol: string;
  readonly activo: boolean;
  readonly intentosFallidos: number;
  readonly bloqueadoHasta: Date | null;
  readonly dobleFactorActivo: boolean;
  readonly dobleFactorSecreto: string | null;
}

export interface SesionGuardada {
  readonly id: string;
  readonly usuarioId: string;
  readonly expiraEn: Date;
  readonly revocadaEn: Date | null;
}

export interface TokenGuardado {
  readonly id: string;
  readonly usuarioId: string;
  readonly expiraEn: Date;
  readonly usadoEn: Date | null;
}

export interface RepositorioAcceso {
  /** Sin empresaId puede devolver varios: el correo es único por empresa. */
  buscarPorEmail(email: string, empresaId?: string): Promise<UsuarioAcceso[]>;
  buscarPorId(id: string): Promise<UsuarioAcceso | null>;
  actualizarIntentos(usuarioId: string, intentos: number, bloqueadoHasta: Date | null): Promise<void>;
  marcarAcceso(usuarioId: string, ahora: Date): Promise<void>;
  cambiarPassword(usuarioId: string, hash: string, ahora: Date): Promise<void>;

  crearSesion(s: {
    id: string;
    usuarioId: string;
    refreshHash: string;
    expiraEn: Date;
    ip: string | null;
    dispositivo: string | null;
  }): Promise<void>;
  buscarSesionPorHash(hash: string): Promise<SesionGuardada | null>;
  revocarSesion(id: string, ahora: Date): Promise<void>;
  revocarSesionesDeUsuario(usuarioId: string, ahora: Date): Promise<void>;

  crearTokenRecuperacion(t: {
    id: string;
    usuarioId: string;
    tokenHash: string;
    expiraEn: Date;
    ipSolicitud: string | null;
  }): Promise<void>;
  buscarTokenRecuperacion(hash: string): Promise<TokenGuardado | null>;
  marcarTokenUsado(id: string, ahora: Date): Promise<void>;

  registrarAuditoria(a: {
    empresaId?: string | null;
    usuarioId?: string | null;
    accion: string;
    detalle?: unknown;
    ip?: string | undefined;
  }): Promise<void>;
}

/**
 * Implementación sobre PostgreSQL.
 *
 * Usa el rol dueño y NO fija contexto de empresa: la autenticación ocurre
 * antes de saber a qué empresa pertenece quien pregunta, así que es el único
 * punto del sistema que consulta sin el filtro de RLS. Por eso sus consultas
 * son estrechas: buscan por correo o por id, nunca listan.
 */
export class RepositorioPg implements RepositorioAcceso {
  constructor(private readonly db: pg.Client | pg.Pool) {}

  private readonly campos = `
    u.id, u."empresaId", u."clienteId", u.nombre, u.email, u."passwordHash",
    u.rol::text AS rol, u.activo, u."intentosFallidos", u."bloqueadoHasta",
    u."dobleFactorActivo", u."dobleFactorSecreto"
  `;

  async buscarPorEmail(email: string, empresaId?: string): Promise<UsuarioAcceso[]> {
    const sql = `
      SELECT ${this.campos}, e.nombre AS "empresaNombre"
      FROM "Usuario" u
      LEFT JOIN "Empresa" e ON e.id = u."empresaId"
      WHERE lower(u.email) = lower($1)
        AND u."desactivadoEn" IS NULL
        ${empresaId ? 'AND u."empresaId" = $2' : ""}
    `;
    const params = empresaId ? [email, empresaId] : [email];
    const r = await this.db.query<UsuarioAcceso>(sql, params);
    return r.rows;
  }

  async buscarPorId(id: string): Promise<UsuarioAcceso | null> {
    const r = await this.db.query<UsuarioAcceso>(
      `SELECT ${this.campos} FROM "Usuario" u WHERE u.id = $1 AND u."desactivadoEn" IS NULL`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async actualizarIntentos(
    usuarioId: string,
    intentos: number,
    bloqueadoHasta: Date | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE "Usuario" SET "intentosFallidos" = $2, "bloqueadoHasta" = $3 WHERE id = $1`,
      [usuarioId, intentos, bloqueadoHasta],
    );
  }

  async marcarAcceso(usuarioId: string, ahora: Date): Promise<void> {
    await this.db.query(`UPDATE "Usuario" SET "ultimoAcceso" = $2 WHERE id = $1`, [
      usuarioId,
      ahora,
    ]);
  }

  async cambiarPassword(usuarioId: string, hash: string, ahora: Date): Promise<void> {
    await this.db.query(
      `UPDATE "Usuario"
         SET "passwordHash" = $2, "passwordActualizadoEn" = $3,
             "intentosFallidos" = 0, "bloqueadoHasta" = NULL
       WHERE id = $1`,
      [usuarioId, hash, ahora],
    );
  }

  async crearSesion(s: {
    id: string;
    usuarioId: string;
    refreshHash: string;
    expiraEn: Date;
    ip: string | null;
    dispositivo: string | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO "SesionUsuario" (id, "usuarioId", "refreshHash", "expiraEn", ip, dispositivo)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [s.id, s.usuarioId, s.refreshHash, s.expiraEn, s.ip, s.dispositivo],
    );
  }

  async buscarSesionPorHash(hash: string): Promise<SesionGuardada | null> {
    const r = await this.db.query<SesionGuardada>(
      `SELECT id, "usuarioId", "expiraEn", "revocadaEn" FROM "SesionUsuario" WHERE "refreshHash" = $1`,
      [hash],
    );
    return r.rows[0] ?? null;
  }

  async revocarSesion(id: string, ahora: Date): Promise<void> {
    await this.db.query(`UPDATE "SesionUsuario" SET "revocadaEn" = $2 WHERE id = $1`, [id, ahora]);
  }

  async revocarSesionesDeUsuario(usuarioId: string, ahora: Date): Promise<void> {
    await this.db.query(
      `UPDATE "SesionUsuario" SET "revocadaEn" = $2 WHERE "usuarioId" = $1 AND "revocadaEn" IS NULL`,
      [usuarioId, ahora],
    );
  }

  async crearTokenRecuperacion(t: {
    id: string;
    usuarioId: string;
    tokenHash: string;
    expiraEn: Date;
    ipSolicitud: string | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO "TokenRecuperacion" (id, "usuarioId", "tokenHash", "expiraEn", "ipSolicitud")
       VALUES ($1, $2, $3, $4, $5)`,
      [t.id, t.usuarioId, t.tokenHash, t.expiraEn, t.ipSolicitud],
    );
  }

  async buscarTokenRecuperacion(hash: string): Promise<TokenGuardado | null> {
    const r = await this.db.query<TokenGuardado>(
      `SELECT id, "usuarioId", "expiraEn", "usadoEn" FROM "TokenRecuperacion" WHERE "tokenHash" = $1`,
      [hash],
    );
    return r.rows[0] ?? null;
  }

  async marcarTokenUsado(id: string, ahora: Date): Promise<void> {
    await this.db.query(`UPDATE "TokenRecuperacion" SET "usadoEn" = $2 WHERE id = $1`, [id, ahora]);
  }

  async registrarAuditoria(a: {
    empresaId?: string | null;
    usuarioId?: string | null;
    accion: string;
    detalle?: unknown;
    ip?: string | undefined;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO "Auditoria" (id, "empresaId", "usuarioId", accion, detalle, ip)
       VALUES (gen_random_uuid()::text, $1, $2, $3::text, $4, $5)`,
      [
        a.empresaId ?? null,
        a.usuarioId ?? null,
        a.accion,
        a.detalle ? JSON.stringify(a.detalle) : null,
        a.ip ?? null,
      ],
    );
  }
}
