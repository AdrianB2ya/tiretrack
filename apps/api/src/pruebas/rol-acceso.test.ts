import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hayBaseDeDatos, conectarAislado, esquemaDe, conBloqueoGlobal } from "./base";

/**
 * Aislamiento del rol de autenticación.
 *
 * El login busca al usuario por correo SIN saber la empresa, así que necesita
 * ver usuarios de cualquiera. La pregunta es cuánto más puede ver: esta
 * prueba fija el alcance de un fallo en el módulo de acceso.
 *
 * Ejecuta la sección `@seccion:acceso` del `rls.sql` REAL, no una copia: una
 * copia se desincroniza y la prueba pasaría mientras producción queda mal.
 */

const disponible = await hayBaseDeDatos();

/** Extrae una sección marcada del script real. */
function seccionDeRls(nombre: string): string {
  const texto = readFileSync(join(__dirname, "..", "..", "prisma", "rls.sql"), "utf-8");
  const inicio = texto.indexOf(`-- @seccion:${nombre}`);
  const fin = texto.indexOf(`-- @fin:${nombre}`);
  if (inicio < 0 || fin < 0) throw new Error(`No se encontró la sección ${nombre} en rls.sql`);
  return texto.slice(inicio, fin);
}

let admin: pg.Client;

/** Ejecuta una consulta haciéndose pasar por un rol, y devuelve el error si lo hay. */
async function como(rol: string, sql: string, params: unknown[] = []) {
  await admin.query("BEGIN");
  try {
    await admin.query(`SET LOCAL ROLE ${rol}`);
    const r = await admin.query(sql, params);
    return { ok: true as const, filas: r.rows };
  } catch (e) {
    return { ok: false as const, error: (e as { code?: string; message: string }) };
  } finally {
    await admin.query("ROLLBACK");
  }
}

describe.skipIf(!disponible)("rol de autenticación", () => {
  beforeAll(async () => {
    admin = await conectarAislado(import.meta.url);
    await conBloqueoGlobal(admin, preparar);
  }, 60_000);

  async function preparar() {
    // Esquema mínimo con las piezas que la sección toca, más una tabla
    // operativa para comprobar que el rol de acceso NO la alcanza.
    await admin.query(`
      DROP TABLE IF EXISTS "Auditoria", "TokenRecuperacion", "SesionUsuario",
                           "OrdenServicio", "Usuario", "Empresa" CASCADE;
      CREATE TABLE "Empresa" (id text PRIMARY KEY, nombre text NOT NULL);
      CREATE TABLE "Usuario" (
        id text PRIMARY KEY, "empresaId" text, email text NOT NULL,
        "passwordHash" text NOT NULL, "intentosFallidos" int NOT NULL DEFAULT 0
      );
      CREATE TABLE "SesionUsuario" (id text PRIMARY KEY, "usuarioId" text NOT NULL, "revocadaEn" timestamptz);
      CREATE TABLE "TokenRecuperacion" (id text PRIMARY KEY, "usuarioId" text NOT NULL);
      CREATE TABLE "Auditoria" (id text PRIMARY KEY, "empresaId" text, accion text);
      CREATE TABLE "OrdenServicio" (id text PRIMARY KEY, "empresaId" text NOT NULL, folio text);

      INSERT INTO "Empresa" VALUES ('emp-1','Aistectire'), ('emp-2','Otra');
      INSERT INTO "Usuario" (id,"empresaId",email,"passwordHash") VALUES
        ('u-1','emp-1','carlos@uno.com','hash1'), ('u-2','emp-2','ana@dos.com','hash2');
      INSERT INTO "OrdenServicio" VALUES ('ord-1','emp-1','OS-FUN-1');

      -- Rol de aplicación y aislamiento por empresa, como en producción.
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiretrack_app') THEN
          CREATE ROLE tiretrack_app NOLOGIN;
        END IF;
      END $$;

      CREATE OR REPLACE FUNCTION app_empresa_id() RETURNS text
        LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.empresa_id', true), '') $$;

      ALTER TABLE "Usuario" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "Usuario" FORCE ROW LEVEL SECURITY;
      CREATE POLICY aislamiento_empresa ON "Usuario"
        USING ("empresaId" = app_empresa_id()) WITH CHECK ("empresaId" = app_empresa_id());

      ALTER TABLE "OrdenServicio" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "OrdenServicio" FORCE ROW LEVEL SECURITY;
      CREATE POLICY aislamiento_empresa ON "OrdenServicio"
        USING ("empresaId" = app_empresa_id()) WITH CHECK ("empresaId" = app_empresa_id());

      ALTER TABLE "SesionUsuario" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "SesionUsuario" FORCE ROW LEVEL SECURITY;
      ALTER TABLE "TokenRecuperacion" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "TokenRecuperacion" FORCE ROW LEVEL SECURITY;
      ALTER TABLE "Auditoria" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "Auditoria" FORCE ROW LEVEL SECURITY;
    `);

    // Los roles necesitan entrar al esquema de esta prueba: los permisos de
    // producción se conceden sobre "public", y aquí las tablas viven aparte
    // para que los archivos de prueba no se pisen entre sí.
    await admin.query(
      `GRANT USAGE ON SCHEMA "${esquemaDe(import.meta.url)}" TO tiretrack_app, tiretrack_auth`,
    );
    // El rol de aplicación recibe las tablas, igual que en producción; el de
    // acceso NO: sus permisos son tabla por tabla y los concede la sección
    // real del script, que es justo lo que esta prueba verifica.
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${esquemaDe(import.meta.url)}" TO tiretrack_app`,
    );

    // Y ahora la sección REAL del script de producción.
    await admin.query(seccionDeRls("acceso"));
  }

  afterAll(async () => {
    await admin?.end();
  });

  describe("puede hacer su trabajo", () => {
    it("encuentra a un usuario por correo sin saber la empresa", async () => {
      // Es justo lo que el aislamiento por empresa impedía.
      const r = await como("tiretrack_auth", `SELECT id FROM "Usuario" WHERE email = $1`, ["carlos@uno.com"]);
      expect(r.ok && r.filas).toHaveLength(1);
    });

    it("ve usuarios de cualquier empresa", async () => {
      const r = await como("tiretrack_auth", `SELECT id FROM "Usuario" ORDER BY id`);
      expect(r.ok && r.filas.map((f) => f.id)).toEqual(["u-1", "u-2"]);
    });

    it("cuenta los intentos fallidos", async () => {
      const r = await como("tiretrack_auth", `UPDATE "Usuario" SET "intentosFallidos" = 1 WHERE id = 'u-1'`);
      expect(r.ok).toBe(true);
    });

    it("crea y revoca sesiones", async () => {
      expect((await como("tiretrack_auth", `INSERT INTO "SesionUsuario" VALUES ('s-1','u-1',null)`)).ok).toBe(true);
      expect((await como("tiretrack_auth", `UPDATE "SesionUsuario" SET "revocadaEn" = now()`)).ok).toBe(true);
    });

    it("registra en auditoría", async () => {
      expect((await como("tiretrack_auth", `INSERT INTO "Auditoria" VALUES ('a-1','emp-1','login')`)).ok).toBe(true);
    });

    it("lee las empresas, para preguntar con cuál entrar", async () => {
      expect((await como("tiretrack_auth", `SELECT nombre FROM "Empresa"`)).ok).toBe(true);
    });
  });

  describe("no puede hacer nada más", () => {
    it("NO alcanza las órdenes de servicio", async () => {
      // El alcance de un fallo en el módulo de acceso: cinco tablas, no la
      // base entera. Con BYPASSRLS esto habría devuelto la orden.
      const r = await como("tiretrack_auth", `SELECT folio FROM "OrdenServicio"`);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error.code).toBe("42501"); // permiso denegado
    });

    it("NO borra usuarios", async () => {
      const r = await como("tiretrack_auth", `DELETE FROM "Usuario" WHERE id = 'u-1'`);
      expect(r.ok).toBe(false);
    });

    it("NO crea usuarios: eso es administración, no autenticación", async () => {
      const r = await como("tiretrack_auth", `INSERT INTO "Usuario" VALUES ('u-9','emp-1','x@y.com','h',0)`);
      expect(r.ok).toBe(false);
    });

    it("NO altera ni borra la auditoría", async () => {
      // Un registro que se puede alterar no sirve como evidencia.
      expect((await como("tiretrack_auth", `UPDATE "Auditoria" SET accion = 'otra'`)).ok).toBe(false);
      expect((await como("tiretrack_auth", `DELETE FROM "Auditoria"`)).ok).toBe(false);
    });
  });

  describe("el rol de aplicación sigue aislado", () => {
    it("sin contexto de empresa no ve ningún usuario", async () => {
      // Es el comportamiento que rompía el login, y debe seguir intacto para
      // el resto de la aplicación.
      const r = await como("tiretrack_app", `SELECT id FROM "Usuario"`);
      expect(r.ok && r.filas).toEqual([]);
    });

    it("con su empresa ve solo los suyos", async () => {
      await admin.query("BEGIN");
      try {
        await admin.query(`SET LOCAL ROLE tiretrack_app`);
        await admin.query(`SELECT set_config('app.empresa_id','emp-1',true)`);
        const r = await admin.query(`SELECT id FROM "Usuario"`);
        expect(r.rows.map((f) => f.id)).toEqual(["u-1"]);
      } finally {
        await admin.query("ROLLBACK");
      }
    });

    it("el rol de acceso NO hereda las políticas de empresa", async () => {
      // Su política es permisiva y se combina con OR; si fuera restrictiva,
      // el login seguiría sin ver a nadie.
      await admin.query("BEGIN");
      try {
        await admin.query(`SET LOCAL ROLE tiretrack_auth`);
        await admin.query(`SELECT set_config('app.empresa_id','emp-2',true)`);
        const r = await admin.query(`SELECT id FROM "Usuario" WHERE email = 'carlos@uno.com'`);
        expect(r.rows).toHaveLength(1);
      } finally {
        await admin.query("ROLLBACK");
      }
    });
  });
});
