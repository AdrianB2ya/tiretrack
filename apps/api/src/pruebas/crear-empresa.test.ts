import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import bcrypt from "bcryptjs";
import { CATALOGO_SERVICIOS } from "@tiretrack/domain";
import { hayBaseDeDatos, poolAislado } from "./base";
import { crearEsquemaCompleto, TABLAS } from "./esquemas";
import { crearEmpresa } from "../herramientas/crearEmpresa";

/** Alta de una empresa en producción, sin datos de demostración. */

const disponible = await hayBaseDeDatos();

const ALTA = {
  empresa: { nombre: "Asistectire S.A.S.", nit: "901.234.567-8" },
  sede: { nombre: "Fundación", codigo: "fun", ciudad: "Fundación" },
  administrador: { nombre: "Adriana Bedoya", cedula: "1082334556", email: "Admin@Asistectire.com" },
};

describe.skipIf(!disponible)("alta de empresa", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;

  beforeAll(async () => {
    pool = await poolAislado(import.meta.url, 2);
    await crearEsquemaCompleto(pool);
    db = await pool.connect();
  });
  afterAll(async () => {
    db?.release();
    await pool?.end();
  });
  beforeEach(async () => {
    await db.query(`TRUNCATE ${TABLAS.map((t) => `"${t}"`).join(", ")} CASCADE`);
  });

  it("crea empresa, sede, servicios y administrador; nada de demostración", async () => {
    const r = await crearEmpresa(db, ALTA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sede = await db.query(`SELECT codigo FROM "Sede" WHERE "empresaId" = $1`, [r.empresaId]);
    expect(sede.rows).toEqual([{ codigo: "FUN" }]);
    const servicios = await db.query(`SELECT count(*)::int AS n FROM "Servicio" WHERE "empresaId" = $1`, [r.empresaId]);
    expect(servicios.rows[0].n).toBe(CATALOGO_SERVICIOS.length);
    const admin = await db.query(`SELECT email, rol, "passwordHash" FROM "Usuario" WHERE id = $1`, [r.administradorId]);
    expect(admin.rows[0]).toMatchObject({ email: "admin@asistectire.com", rol: "administrador" });
    expect((await db.query(`SELECT count(*)::int AS n FROM "Cliente"`)).rows[0].n).toBe(0);
    expect((await db.query(`SELECT "esPrincipal" FROM "UsuarioSede" WHERE "usuarioId" = $1`, [r.administradorId])).rows).toEqual([{ esPrincipal: true }]);
    // Queda constancia de quién se creó y cómo.
    expect((await db.query(`SELECT accion::text FROM "Auditoria" WHERE "empresaId" = $1`, [r.empresaId])).rows).toEqual([{ accion: "crear" }]);
  });

  it("el administrador nace sin contraseña utilizable: entra con su código", async () => {
    const r = await crearEmpresa(db, ALTA);
    if (!r.ok) throw new Error(r.motivo);
    const { passwordHash } = (await db.query(`SELECT "passwordHash" FROM "Usuario" WHERE id = $1`, [r.administradorId])).rows[0];
    for (const intento of ["", "admin", "123456", ALTA.administrador.cedula]) {
      expect(await bcrypt.compare(intento, passwordHash)).toBe(false);
    }
  });

  it("un NIT repetido no crea nada; datos inválidos tampoco", async () => {
    expect((await crearEmpresa(db, ALTA)).ok).toBe(true);
    const repetida = await crearEmpresa(db, { ...ALTA, sede: { nombre: "Otra", codigo: "OTR" } });
    expect(repetida).toMatchObject({ ok: false, motivo: expect.stringContaining("NIT") });
    const mala = await crearEmpresa(db, { ...ALTA, empresa: { nombre: "X", nit: "1" } });
    expect(mala.ok).toBe(false);
    expect((await db.query(`SELECT count(*)::int AS n FROM "Empresa"`)).rows[0].n).toBe(1);
  });

  it("si algo falla a mitad, no queda una empresa a medias", async () => {
    // Una sede con un código que la base rechaza después de crear la empresa.
    await db.query(`CREATE OR REPLACE FUNCTION falla_sede() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falla'; END $$ LANGUAGE plpgsql`);
    await db.query(`CREATE TRIGGER falla BEFORE INSERT ON "Sede" FOR EACH ROW EXECUTE FUNCTION falla_sede()`);
    try {
      await expect(crearEmpresa(db, ALTA)).rejects.toThrow();
      expect((await db.query(`SELECT count(*)::int AS n FROM "Empresa"`)).rows[0].n).toBe(0);
    } finally {
      await db.query(`DROP TRIGGER falla ON "Sede"`);
    }
  });
});
