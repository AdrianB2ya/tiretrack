import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { hayBaseDeDatos, conectarAislado, conBloqueoGlobal, esquemaDe, URL_PRUEBAS } from "./base";
import { ddlDePrueba } from "./generar-esquema";
import { OPCIONES_SESION_UTC } from "../db/utc";
import { correrTrabajos, iniciarTrabajos } from "../trabajos/planificador";

/**
 * El planificador corre COMO EL ROL DE APLICACIÓN, con aislamiento activo.
 *
 * Es lo que demuestra que fija el contexto de cada empresa: sin él, las
 * políticas devuelven cero órdenes y no se cerraría ninguna. Como dueño (el
 * usuario de las pruebas es superusuario) las políticas no aplicarían y la
 * prueba pasaría aunque el contexto faltara.
 *
 * `empresas_para_trabajos()` sale del `rls.sql` REAL, no de una copia.
 */

const disponible = await hayBaseDeDatos();
const ESQUEMA = esquemaDe(import.meta.url);
const TABLAS = [
  "Empresa", "Sede", "Usuario", "UsuarioSede", "Vehiculo", "Consecutivo",
  "OrdenServicio", "OrdenEstadoHistorial", "ProgramacionRecurrente", "Auditoria",
];
const RELOJ = () => new Date("2026-09-14T15:00:00.000Z");

function seccionDeRls(nombre: string): string {
  const texto = readFileSync(join(__dirname, "..", "..", "prisma", "rls.sql"), "utf-8");
  const inicio = texto.indexOf(`-- @seccion:${nombre}`);
  const fin = texto.indexOf(`-- @fin:${nombre}`);
  if (inicio < 0 || fin < 0) throw new Error(`No se encontró la sección ${nombre} en rls.sql`);
  // La función fija su search_path a `public`; aquí las tablas viven en el
  // esquema de la prueba.
  return texto.slice(inicio, fin).replace("SET search_path = public", `SET search_path = "${ESQUEMA}"`);
}

let admin: pg.Client;
let pool: pg.Pool;

describe.skipIf(!disponible)("planificador de trabajos", () => {
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
      await admin.query(seccionDeRls("trabajos"));
    });
    // Aislamiento como en producción, sobre las tablas que el trabajo lee.
    for (const t of ["Empresa", "OrdenServicio", "ProgramacionRecurrente"]) {
      const columna = t === "Empresa" ? "id" : `"empresaId"`;
      await admin.query(`
        ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY;
        CREATE POLICY aislamiento_empresa ON "${t}"
          USING (${columna} = nullif(current_setting('app.empresa_id', true), ''))
          WITH CHECK (${columna} = nullif(current_setting('app.empresa_id', true), ''));
      `);
    }
    // Cada conexión del pool entra como el rol de aplicación, no como dueño.
    pool = new pg.Pool({
      connectionString: URL_PRUEBAS,
      max: 4,
      options: `${OPCIONES_SESION_UTC} -c search_path=${ESQUEMA} -c role=tiretrack_app`,
    });
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin.query(`TRUNCATE ${TABLAS.map((t) => `"${t}"`).join(",")} CASCADE`);
    await admin.query(`INSERT INTO "Empresa" (id,nombre,nit,activa) VALUES
      ('emp-a','Asistectire','900',true), ('emp-b','Otra','901',true), ('emp-c','Baja','902',false)`);
    for (const e of ["emp-a", "emp-b", "emp-c"]) {
      await admin.query(
        `INSERT INTO "OrdenServicio"
           (id,"empresaId","sedeId","clienteId","sedeClienteId","vehiculoId",tecnico_id,
            "configuracionEjeId",folio,tipo,estado,fecha,"limiteCliente","creadoPorId")
         VALUES ($1,$2,'s','c','sc','v','t','cfg',$3,'preventivo','pendiente_cliente','2026-09-01','2026-09-10','u')`,
        [`orden-${e}`, e, `OS-${e}`],
      );
    }
  });

  const estados = async () =>
    Object.fromEntries(
      (await admin.query(`SELECT "empresaId", estado::text AS estado FROM "OrdenServicio" ORDER BY 1`)).rows.map(
        (r) => [r.empresaId, r.estado],
      ),
    );

  it("el rol de aplicación sin contexto no ve ninguna empresa, salvo por la función", async () => {
    expect((await pool.query(`SELECT count(*)::int AS n FROM "Empresa"`)).rows[0].n).toBe(0);
    const r = await pool.query(`SELECT id FROM empresas_para_trabajos() AS id`);
    // Solo las activas, y solo su id.
    expect(r.rows).toEqual([{ id: "emp-a" }, { id: "emp-b" }]);
  });

  it("recorre cada empresa activa con su contexto y cierra lo vencido de todas", async () => {
    const r = await correrTrabajos(pool, RELOJ);
    expect(r).toMatchObject({ empresas: 2, saltadas: 0, errores: [] });
    expect(r.cierres.exitosos).toBe(2);
    // La empresa dada de baja no se toca.
    expect(await estados()).toEqual({ "emp-a": "cerrada", "emp-b": "cerrada", "emp-c": "pendiente_cliente" });
  });

  it("no deja el contexto de una empresa pegado en el pool", async () => {
    // Una conexión devuelta con app.empresa_id puesto la heredaría la
    // siguiente petición: vería los datos de otra empresa.
    await correrTrabajos(pool, RELOJ);
    const vistas = await Promise.all(
      [1, 2, 3, 4].map(() => pool.query(`SELECT coalesce(current_setting('app.empresa_id', true), '') AS e`)),
    );
    expect(vistas.map((v) => v.rows[0].e)).toEqual(["", "", "", ""]);
  });

  it("si otra instancia tiene la empresa, se la salta en vez de esperar", async () => {
    await admin.query(`SELECT pg_advisory_lock(hashtext('trabajos-programados'), hashtext('emp-a'))`);
    try {
      const r = await correrTrabajos(pool, RELOJ);
      expect(r.saltadas).toBe(1);
      expect(await estados()).toMatchObject({ "emp-a": "pendiente_cliente", "emp-b": "cerrada" });
    } finally {
      await admin.query(`SELECT pg_advisory_unlock(hashtext('trabajos-programados'), hashtext('emp-a'))`);
    }
  });

  it("el fallo de una empresa no impide las demás", async () => {
    await admin.query(`
      CREATE OR REPLACE FUNCTION fallar_a() RETURNS trigger AS $$
      BEGIN IF NEW."empresaId" = 'emp-a' THEN RAISE EXCEPTION 'fallo simulado'; END IF; RETURN NEW; END
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER t_fallar_a BEFORE UPDATE ON "OrdenServicio" FOR EACH ROW EXECUTE FUNCTION fallar_a();
    `);
    try {
      const r = await correrTrabajos(pool, RELOJ);
      expect(r.cierres).toMatchObject({ exitosos: 1, fallidos: 1 });
      expect((await estados())["emp-b"]).toBe("cerrada");
    } finally {
      await admin.query(`DROP TRIGGER IF EXISTS t_fallar_a ON "OrdenServicio"`);
    }
  });

  it("arranca solo, registra lo que hizo y se detiene esperando la ronda en curso", async () => {
    const registro = { info: vi.fn(), error: vi.fn() };
    const detener = iniciarTrabajos({ pool, intervaloMs: 3_600_000, retrasoInicialMs: 0, registro, reloj: RELOJ });
    await vi.waitFor(() => expect(registro.info).toHaveBeenCalled(), { timeout: 10_000 });
    await detener();
    expect(registro.info.mock.calls[0]?.[0]).toMatchObject({ cierresTacitos: 2 });
    expect(registro.error).not.toHaveBeenCalled();
  });

  it("un error al listar las empresas se registra, no tumba el proceso", async () => {
    const roto = new pg.Pool({ connectionString: "postgresql://nadie:x@127.0.0.1:1/nada", connectionTimeoutMillis: 500 });
    const registro = { info: vi.fn(), error: vi.fn() };
    const detener = iniciarTrabajos({ pool: roto, intervaloMs: 3_600_000, retrasoInicialMs: 0, registro });
    await vi.waitFor(() => expect(registro.error).toHaveBeenCalled(), { timeout: 10_000 });
    await detener();
    await roto.end();
  });
});
