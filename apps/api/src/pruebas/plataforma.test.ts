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
const TABLAS = [
  "Empresa", "Sede", "Usuario", "UsuarioSede", "Servicio", "Auditoria", "SesionUsuario", "TokenRecuperacion", "SesionSuplantacion",
  "Marca", "Diseno", "DisenoMedida",
];
const SUPER = "11111111-1111-4111-8111-00000000005a";

const TOKENS: Record<string, Claims> = {
  "tok-super": { sub: SUPER, empresaId: null, rol: "superadmin", clienteId: null },
  "tok-admin": { sub: "11111111-1111-4111-8111-0000000000ad", empresaId: "22222222-2222-4222-8222-00000000000a", rol: "administrador", clienteId: null },
};

const ALTA = {
  empresa: { nombre: "Llantas del Norte S.A.S.", nit: "900.777.111-2" },
  sede: { nombre: "Valledupar", codigo: "vdp", ciudad: "Valledupar" },
  administrador: { nombre: "Laura Gómez", cedula: "1065443322", email: "laura@llantasnorte.co" },
};

/** Un tramo de rls.sql entre dos marcas de texto: el SQL real, no una copia. */
function tramoDeRls(desde: string, hasta: string): string {
  const texto = readFileSync(join(__dirname, "..", "..", "prisma", "rls.sql"), "utf-8");
  const i = texto.indexOf(desde);
  const j = texto.indexOf(hasta, i);
  if (i < 0 || j < 0) throw new Error(`No se encontró el tramo ${desde} en rls.sql`);
  return texto.slice(i, j);
}

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
      await admin.query(seccionDeRls("soporte"));
      // Las funciones de contexto y las políticas REALES del catálogo, más la
      // sección nueva: la prueba ve lo mismo que producción.
      await admin.query(tramoDeRls("CREATE OR REPLACE FUNCTION app_empresa_id", "-- ── La propia tabla de empresas"));
      await admin.query(tramoDeRls('ALTER TABLE "Marca" ENABLE', "-- ── Auditoría: se lee"));
      await admin.query(seccionDeRls("plataforma_catalogo"));
    });
    // Aislamiento como en producción sobre las tablas que el alta escribe.
    for (const t of ["Empresa", "Sede", "Usuario", "Servicio", "Auditoria", "SesionSuplantacion"]) {
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
    app = construirServidor({
      pool,
      // Los tokens de soporte se "firman" en memoria con lo que pidió la ruta.
      auth: { ...authFalso, firmarSoporte: (d) => {
        const t = `tok-soporte-${d.sesionId}`;
        TOKENS[t] = { sub: d.superadminId, empresaId: d.empresaId, rol: "administrador", clienteId: null, soporte: d.sesionId };
        return t;
      } },
      verificarToken: (t) => TOKENS[t] ?? null,
      almacen: new AlmacenamientoMemoria(),
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await admin?.end();
  });

  beforeEach(async () => {
    await admin.query(`TRUNCATE ${TABLAS.map((t) => `"${t}"`).join(",")} CASCADE`);
    await admin.query(`INSERT INTO "Empresa" (id,nombre,nit) VALUES ('22222222-2222-4222-8222-00000000000a','Asistectire','901.234.567-8'), ('22222222-2222-4222-8222-00000000000b','Otra','902')`);
    await admin.query(
      `INSERT INTO "Usuario" (id,"empresaId",nombre,cedula,email,"passwordHash",rol) VALUES ($1,NULL,'Plataforma','1','super@asistectire.co','x','superadmin')`,
      [SUPER],
    );
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
      await c.query(`SELECT set_config('app.rol', 'administrador', true), set_config('app.empresa_id', '22222222-2222-4222-8222-00000000000a', true)`);
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

  describe("catálogo general", () => {
    const EMPRESA = "22222222-2222-4222-8222-00000000000a";
    const nuevo = () => crypto.randomUUID();

    it("el superadmin arma marca → diseño → medida del catálogo general, y las empresas lo ven", async () => {
      const marca = nuevo();
      const diseno = nuevo();
      expect((await pedir("POST", "/plataforma/catalogo/marcas", "tok-super", { id: marca, nombre: "Continental" })).statusCode).toBe(201);
      expect((await pedir("POST", "/plataforma/catalogo/disenos", "tok-super", { id: diseno, marcaId: marca, nombre: "HSR2", tipoEje: "direccional" })).statusCode).toBe(201);
      const m = await pedir("POST", "/plataforma/catalogo/medidas", "tok-super", { disenoId: diseno, medida: "295/80R22.5", profundidadOriginal: 15 });
      expect(m.statusCode, m.body).toBe(201);
      expect(m.json()).toMatchObject({ medida: "295/80R22.5", empresaId: null });
      const fila = await admin.query(`SELECT "esGlobal", "empresaId" FROM "Marca" WHERE id = $1`, [marca]);
      expect(fila.rows).toEqual([{ esGlobal: true, empresaId: null }]);
      // Una empresa la ve (es del catálogo general).
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(`SELECT set_config('app.rol', 'administrador', true), set_config('app.empresa_id', $1, true)`, [EMPRESA]);
        expect((await c.query(`SELECT nombre FROM "Marca"`)).rows).toEqual([{ nombre: "Continental" }]);
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
      // Corregir la profundidad de fábrica de una medida general.
      expect((await pedir("POST", `/plataforma/catalogo/medidas/${m.json().id}/profundidad`, "tok-super", { profundidadOriginal: 16 })).statusCode).toBe(200);
    });

    it("una empresa no puede escribir el catálogo general, ni el superadmin a nombre de una empresa", async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(`SELECT set_config('app.rol', 'administrador', true), set_config('app.empresa_id', $1, true)`, [EMPRESA]);
        await expect(c.query(`INSERT INTO "Marca" (id, "empresaId", nombre, "esGlobal") VALUES ($1, NULL, 'Global falsa', true)`, [nuevo()]))
          .rejects.toThrow(/row-level security|política|policy/i);
        await c.query("ROLLBACK");
        await c.query("BEGIN");
        await c.query(`SELECT set_config('app.rol', 'superadmin', true), set_config('app.empresa_id', '', true)`);
        await expect(c.query(`INSERT INTO "Marca" (id, "empresaId", nombre, "esGlobal") VALUES ($1, $2, 'De la empresa', false)`, [nuevo(), EMPRESA]))
          .rejects.toThrow(/row-level security|política|policy/i);
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
    });

    it("el duplicado exacto se bloquea también en el catálogo general; un administrador no entra aquí", async () => {
      await pedir("POST", "/plataforma/catalogo/marcas", "tok-super", { id: nuevo(), nombre: "Michelin" });
      const r = await pedir("POST", "/plataforma/catalogo/marcas", "tok-super", { id: nuevo(), nombre: "michelín" });
      expect(r.statusCode).toBe(409);
      expect(r.json().error.codigo).toBe("YA_EXISTE");
      expect((await pedir("GET", "/plataforma/catalogo/marcas", "tok-admin")).statusCode).toBe(403);
    });
  });

  describe("sesión de soporte", () => {
  const SESION = { empresaId: "22222222-2222-4222-8222-00000000000a", motivo: "El administrador no ve sus órdenes de ayer", ticket: "SOP-1042", minutos: 60 };
  const abrir = async () => {
    const r = await pedir("POST", "/plataforma/soporte", "tok-super", SESION);
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { token: string; sesionId: string; expiraEn: string };
  };

  it("abrir exige motivo y ticket, y deja constancia en la auditoría de esa empresa", async () => {
    expect((await pedir("POST", "/plataforma/soporte", "tok-super", { ...SESION, motivo: "ver" })).statusCode).toBe(422);
    expect((await pedir("POST", "/plataforma/soporte", "tok-admin", SESION)).statusCode).toBe(403);
    const s = await abrir();
    const a = await admin.query(`SELECT accion::text, "empresaId", detalle FROM "Auditoria" WHERE accion = 'suplantar_empresa'`);
    expect(a.rows).toEqual([
      { accion: "suplantar_empresa", empresaId: "22222222-2222-4222-8222-00000000000a", detalle: expect.objectContaining({ motivo: SESION.motivo, ticket: "SOP-1042", sesionSoporte: s.sesionId }) },
    ]);
  });

  it("con la sesión abierta se consulta; escribir se rechaza antes de llegar a la ruta", async () => {
    const s = await abrir();
    expect((await pedir("GET", "/auditoria", s.token)).statusCode).toBe(200);
    const w = await pedir("POST", "/usuarios", s.token, { nombre: "X" });
    expect(w.statusCode).toBe(403);
    expect(w.json().error.codigo).toBe("SOPORTE_SOLO_LECTURA");
    // Un token de soporte no abre otra sesión de soporte.
    expect((await pedir("POST", "/plataforma/soporte", s.token, SESION)).statusCode).toBe(403);
  });

  it("terminarla corta el acceso en el acto, y queda marcada como vía soporte", async () => {
    const s = await abrir();
    expect((await pedir("POST", "/plataforma/soporte/terminar", s.token, {})).statusCode).toBe(200);
    const r = await pedir("GET", "/auditoria", s.token);
    expect(r.statusCode).toBe(401);
    expect(r.json().error.codigo).toBe("SOPORTE_TERMINADO");
    const fin = await admin.query(`SELECT "viaSuplantacion" FROM "Auditoria" WHERE detalle->>'terminada' = 'true'`);
    expect(fin.rows).toEqual([{ viaSuplantacion: true }]);
  });

  it("vencida no sirve aunque el token siga firmado", async () => {
    const s = await abrir();
    await admin.query(`UPDATE "SesionSuplantacion" SET "expiraEn" = now() - interval '1 minute'`);
    expect((await pedir("GET", "/auditoria", s.token)).statusCode).toBe(401);
  });

  it("toda auditoría escrita con la sesión puesta queda marcada, sin que el código lo recuerde", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.empresa_id', '22222222-2222-4222-8222-00000000000a', true), set_config('app.soporte_id', 'ses-1', true)`);
      await c.query(`INSERT INTO "Auditoria" (id,"empresaId",accion,detalle) VALUES ('a-1','22222222-2222-4222-8222-00000000000a','exportar_informe','{"origen":"pdf_orden"}')`);
      await c.query("COMMIT");
    } finally {
      c.release();
    }
    const a = await admin.query(`SELECT "viaSuplantacion", detalle FROM "Auditoria" WHERE id = 'a-1'`);
    expect(a.rows[0]).toEqual({ viaSuplantacion: true, detalle: { origen: "pdf_orden", sesionSoporte: "ses-1" } });
  });
  });
});

if (!disponible) describe("plataforma: empresas", () => {
  it("omitidos: falta PostgreSQL", () => {
    expect(disponible).toBe(false);
  });
});
