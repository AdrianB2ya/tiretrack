import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type pg from "pg";
import { z } from "zod";
import { CATALOGO_SERVICIOS, nuevoId } from "@tiretrack/domain";
import { zCrearSede, zUsuarioBase } from "@tiretrack/contracts";

/**
 * Alta de una empresa en producción: la empresa, su primera sede, los
 * servicios del catálogo y su administrador.
 *
 * La semilla (`prisma/seed.ts`) carga datos de demostración —clientes,
 * vehículos, usuarios con contraseña conocida— y no sirve para producción.
 * Esto crea solo lo indispensable. Lo demás (sedes, usuarios, clientes,
 * plantillas) lo hace el administrador desde la app.
 *
 * El administrador **nace sin contraseña utilizable**, igual que los usuarios
 * creados desde la app: recibe un código de activación de un solo uso y
 * elige la suya. Nadie más la conoce, tampoco quien corrió esto.
 *
 * Corre con la conexión del dueño (no hay empresa todavía, así que no hay
 * contexto de RLS que fijar) y en una sola transacción: o queda todo o nada.
 */

export const zAltaEmpresa = z.object({
  empresa: z.object({ nombre: z.string().trim().min(2).max(120), nit: z.string().trim().min(5).max(20) }),
  sede: zCrearSede.pick({ nombre: true, codigo: true }).extend({ ciudad: z.string().trim().max(80).optional() }),
  // Las mismas reglas que un usuario creado desde la app (sin sus refinamientos de rol).
  administrador: zUsuarioBase.pick({ nombre: true, cedula: true, email: true, telefono: true }),
});
export type AltaEmpresa = z.infer<typeof zAltaEmpresa>;

export type ResultadoAlta =
  | { ok: true; empresaId: string; sedeId: string; administradorId: string }
  | { ok: false; motivo: string };

/** El código lo emite el servicio de acceso, el único que guarda su huella. */
export type EmitirCodigo = (usuarioId: string) => Promise<{ codigo: string; expiraEn: Date } | null>;

export async function crearEmpresa(db: pg.PoolClient | pg.Client, entrada: unknown): Promise<ResultadoAlta> {
  const p = zAltaEmpresa.safeParse(entrada);
  if (!p.success) return { ok: false, motivo: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const d = p.data;

  const nitRepetido = await db.query(`SELECT 1 FROM "Empresa" WHERE nit = $1`, [d.empresa.nit]);
  if (nitRepetido.rowCount) return { ok: false, motivo: `Ya existe una empresa con NIT ${d.empresa.nit}` };
  const ids = { empresa: nuevoId(), sede: nuevoId(), admin: nuevoId() };
  const hashInutilizable = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);

  await db.query("BEGIN");
  try {
    await db.query(`INSERT INTO "Empresa" (id, nombre, nit) VALUES ($1,$2,$3)`, [ids.empresa, d.empresa.nombre, d.empresa.nit]);
    await db.query(
      `INSERT INTO "Sede" (id, "empresaId", nombre, codigo, ciudad) VALUES ($1,$2,$3,$4,$5)`,
      [ids.sede, ids.empresa, d.sede.nombre, d.sede.codigo, d.sede.ciudad ?? null],
    );
    // El servidor valida cada servicio marcado contra los de la empresa: sin
    // estas filas toda medición con servicios se rechazaría.
    for (const [i, s] of CATALOGO_SERVICIOS.entries()) {
      await db.query(
        `INSERT INTO "Servicio" (id, "empresaId", codigo, nombre, "porLlanta", orden) VALUES ($1,$2,$3,$4,$5,$6)`,
        [nuevoId(), ids.empresa, s.codigo, s.nombre, s.porLlanta, i],
      );
    }
    await db.query(
      `INSERT INTO "Usuario" (id, "empresaId", nombre, cedula, email, telefono, "passwordHash", rol)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'administrador')`,
      [ids.admin, ids.empresa, d.administrador.nombre, d.administrador.cedula, d.administrador.email,
        d.administrador.telefono ?? null, hashInutilizable],
    );
    await db.query(`INSERT INTO "UsuarioSede" ("usuarioId", "sedeId", "esPrincipal") VALUES ($1,$2,true)`, [ids.admin, ids.sede]);
    await db.query(
      `INSERT INTO "Auditoria" (id, "empresaId", rol, accion, entidad, "entidadId", detalle)
       VALUES ($1,$2,'superadmin','crear','empresa',$2,$3)`,
      [nuevoId(), ids.empresa, JSON.stringify({ origen: "alta_de_empresa", administrador: d.administrador.email })],
    );
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
  return { ok: true, empresaId: ids.empresa, sedeId: ids.sede, administradorId: ids.admin };
}
