import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { hayBaseDeDatos, conectarAislado, conBloqueoGlobal, esquemaDe, URL_PRUEBAS } from "./base";
import { ddlDePrueba } from "./generar-esquema";
import { authFalso, CODIGO_FALSO } from "./esquemas";
import { OPCIONES_SESION_UTC } from "../db/utc";
import { construirServidor, PREFIJO_API } from "../http/servidor";
import { AlmacenamientoMemoria } from "../fotos/almacenamiento";
import type { Claims } from "../acceso/servicio";

/**
 * Plataforma (R16): el superadmin da de alta y lista empresas desde la app.
 *
 * Corre COMO EL ROL DE APLICACIÓN con aislamiento activo, como en producción:
 * es lo que demuestra que el alta pasa las políticas fijando el contexto de
 * la empresa nueva, y que las funciones de rls.sql solo responden a un
 * contexto de superadmin. Como dueño, las políticas no aplicarían.
 */

const disponible = await hayBaseDeDatos();
const ESQUEMA = esquemaDe(import.meta.url);
const TABLAS = ["Empresa", "Sede", "Usuario", "UsuarioSede", "Servicio", "Auditoria", "SesionUsuario", "TokenRecuperacion"];
const SUPER = "11111111-1111-4111-8111-00000000005a";

const TOKENS: Record<string, Claims> = {
  "tok-super": { sub: SUPER, empresaId: null, rol: "superadmin", clienteId: null },
  "tok-admin": { sub: "11111111-1111-4111-8111-0000000000ad", empresaId: "emp-a", rol: "administrador", clienteId: null },
};

const ALTA = {
  empresa: { nombre: "Llantas del Norte S.A.S.", nit: "900.777.111-2" },
  sede: { nombre: "Valledupar", codigo: "vdp", ciudad: "Valledupar" },
  administrador: { nombre: "Laura Gómez", cedula: "1065443322", email: "laura@llantasnorte.co" },
};

function seccionDeRls(nombre: string): string {
  const texto = readFileSync(join(__dirname, "..", "..", "prisma", "rls.sql"), "utf-8");
  const inicio = texto.indexOf(`-- @seccion:${nombre}`);
  const fin = texto.indexOf(`-- @fin:${nombre}`);
  if (inicio < 0 || fin < 0) throw new Error(`No se encontró la sección ${nombre} en rls.sql`);
  return texto.slice(inicio, fin).replaceAll("SET search_path = public", `SET search_path = "${ESQUEMA}"`);
}

let admin: pg.Client;
let pool: pg.Pool;
let app: FastifyInstance;

const pedir = (metodo: "GET" | "POST", ruta: string, token: string, cuerpo?: unknown) =>
  app.inject({
    method: metodo,
    url: PREFIJO_API + ruta,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(cuerpo ? { payload: JSON.stringify(cuerpo) } : {}),
  });

describe.skipIf(!disponible)("plataforma: empresas", () => {
  beforeAll(async () => {
    admin = await conectarAislado(import.meta.url);
    await admin.query(ddlDePrueba(TABLAS));
    await conBloqueoGlobal(admin, async () => {
      await admin.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiretrack_app') THEN
            CREATE ROLE tiretrack_app NOLOGIN;
          END IF;
        END $$;
        GRANT USAGE ON SCHEMA "${ESQUEMA}" TO tiretrack_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${ESQUEMA}" TO tiretrack_app;
      `);
      await admin.query(seccionDeRls("plataforma"));
    });
    // Aislamiento como en producción sobre las tablas que el alta escribe.
    for (const t of ["Empresa", "Sede", "Usuario", "Servicio", "Auditoria"]) {
      const columna = t === "Empresa" ? "id" : `"empresaId"`;
      await admin.query(`
        ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY;
        CREATE POLICY aislamiento_empresa ON "${t}"
          USING (${columna} = nullif(current_setting('app.empresa_id', true), ''))
          WITH CHECK (${columna} = nullif(current_setting('app.empresa_id', true), ''));
      `);
    }
    pool = new pg.Pool({
      connectionString: URL_PRUEBAS,
      max: 3,
      options: `${OPCIONES_SESION_UTC} -c search_path=${ESQUEMA} -c role=tiretrack_app`,
    });
    app = construirServidor({ pool, auth: authFalso, verificarToken: (t) => TOKENS[t] ?? null, almacen: new AlmacenamientoMemoria() });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await admin?.end();
  });

  beforeEach(async () => {
    await admin.query(`TRUNCATE ${TABLAS.map((t) => `"${t}"`).join(",")} CASCADE`);
    await admin.query(`INSERT INTO "Empresa" (id,nombre,nit) VALUES ('emp-a','Asistectire','901.234.567-8'), ('emp-b','Otra','902')`);
  });

  it("el superadmin ve todas las empresas; un administrador no", async () => {
    const r = await pedir("GET", "/plataforma/empresas", "tok-super");
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().map((e: { nombre: string }) => e.nombre)).toEqual(["Asistectire", "Otra"]);
    expect((await pedir("GET", "/plataforma/empresas", "tok-admin")).statusCode).toBe(403);
  });

  it("las funciones no responden a un contexto que no es de superadmin", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.rol', 'administrador', true), set_config('app.empresa_id', 'emp-a', true)`);
      expect((await c.query(`SELECT count(*)::int AS n FROM empresas_para_plataforma()`)).rows[0].n).toBe(0);
      expect((await c.query(`SELECT nit_de_empresa_en_uso('902') AS u`)).rows[0].u).toBe(false);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });

  it("da de alta la empresa con el rol de aplicación, bajo RLS, y entrega el código del administrador", async () => {
    const r = await pedir("POST", "/plataforma/empresas", "tok-super", ALTA);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ codigo: CODIGO_FALSO });
    const e = await admin.query(`SELECT nombre FROM "Empresa" WHERE id = $1`, [r.json().empresaId]);
    expect(e.rows).toEqual([{ nombre: "Llantas del Norte S.A.S." }]);
    const a = await admin.query(`SELECT "usuarioId", detalle FROM "Auditoria" WHERE "empresaId" = $1`, [r.json().empresaId]);
    expect(a.rows[0]).toMatchObject({ usuarioId: SUPER, detalle: { origen: "alta_desde_la_app" } });
    expect((await pedir("GET", "/plataforma/empresas", "tok-super")).json()).toHaveLength(3);
  });

  it("un NIT ya registrado —escrito distinto— no crea otra empresa", async () => {
    const r = await pedir("POST", "/plataforma/empresas", "tok-super", { ...ALTA, empresa: { nombre: "Copia", nit: "901234567-8" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.codigo).toBe("EMPRESA_EXISTENTE");
    expect((await admin.query(`SELECT count(*)::int AS n FROM "Empresa"`)).rows[0].n).toBe(2);
  });

  it("datos incompletos son 422, y un administrador no da de alta empresas", async () => {
    expect((await pedir("POST", "/plataforma/empresas", "tok-super", { empresa: { nombre: "X" } })).statusCode).toBe(422);
    expect((await pedir("POST", "/plataforma/empresas", "tok-admin", ALTA)).statusCode).toBe(403);
  });
});

if (!disponible) describe("plataforma: empresas", () => {
  it("omitidos: falta PostgreSQL", () => {
    expect(disponible).toBe(false);
  });
});
