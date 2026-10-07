import { describe, it, expect, afterAll } from "vitest";
import pg from "pg";
import { hayBaseDeDatos, URL_PRUEBAS } from "./base";
import { direccionPara, generarClave, restablecerClaves } from "../herramientas/clavesBase";

/**
 * Claves de los usuarios de la API: se ponen y se prueban en un paso. Usa
 * roles propios de la prueba, para no tocar las claves locales de
 * tiretrack_app y tiretrack_auth.
 */

const disponible = await hayBaseDeDatos();
const ROLES = ["tt_prueba_claves_app", "tt_prueba_claves_auth"];

describe("direcciones", () => {
  it("cambia solo usuario y clave; servidor, base y parámetros quedan iguales", () => {
    const d = direccionPara("postgresql://neondb_owner:viejo@ep-algo-1.us-east-1.aws.neon.tech/neondb?sslmode=require", "tiretrack_app", "Nuev0_-x");
    expect(d).toBe("postgresql://tiretrack_app:Nuev0_-x@ep-algo-1.us-east-1.aws.neon.tech/neondb?sslmode=require");
  });

  it("las claves no necesitan escaparse en una URL", () => {
    for (let i = 0; i < 50; i++) expect(generarClave()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe.skipIf(!disponible)("restablecer claves", () => {
  const url = URL_PRUEBAS;

  afterAll(async () => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    for (const r of ROLES) await c.query(`DROP ROLE IF EXISTS ${r}`);
    await c.end();
  });

  it("pone claves nuevas y entrega direcciones que entran", async () => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    for (const r of ROLES) await c.query(`DROP ROLE IF EXISTS ${r}; CREATE ROLE ${r} NOLOGIN`);
    await c.end();

    const { direcciones } = await restablecerClaves(url, ROLES);
    for (const r of ROLES) {
      const otra = new pg.Client({ connectionString: direcciones[r] });
      await otra.connect();
      expect((await otra.query("SELECT current_user AS u")).rows[0].u).toBe(r);
      await otra.end();
    }
  });

  it("una clave con comilla no rompe el SQL: se cita, no se concatena", async () => {
    const { direcciones } = await restablecerClaves(url, [ROLES[0]!], () => "con'comilla");
    expect(direcciones[ROLES[0]!]).toContain("con'comilla");
  });
});
