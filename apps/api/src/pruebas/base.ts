import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

/**
 * Utilidades para las pruebas de aislamiento.
 *
 * Estas pruebas necesitan PostgreSQL de verdad: lo que se verifica es que el
 * MOTOR rechace una consulta cruzada. Simularlo con dobles no probaría nada,
 * porque el doble haría exactamente lo que le programemos.
 *
 * Se saltan solas si no hay base disponible, para que `npm test` siga
 * funcionando en una máquina sin Postgres. En CI la base siempre está.
 */

const aqui = dirname(fileURLToPath(import.meta.url));

export const URL_PRUEBAS =
  // Se aceptan los dos nombres: el CI usaba uno y el código leía el otro, así
  // que las pruebas de integración se conectaban por la URL por defecto —o no
  // se conectaban— sin que nadie lo notara.
  process.env.DATABASE_URL_TEST ??
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/tiretrack_test";

/**
 * Cuando está en "1", no hay base significa FALLAR, no saltar.
 *
 * Saltarse las pruebas en silencio es peor que no tenerlas: el resultado dice
 * "pasaron" y nadie mira. En CI la base siempre está, así que su ausencia es
 * un problema de configuración que hay que ver.
 */
export const EXIGE_BASE = process.env.PRUEBAS_EXIGEN_BASE === "1";

/**
 * Esquema propio para cada archivo de pruebas.
 *
 * Ocho archivos creaban y borraban las MISMAS tablas en la misma base, y
 * Vitest ejecuta los archivos en paralelo: que la suite pasara dependía de
 * que no coincidieran en el tiempo. Dos archivos a la vez podían borrarse las
 * tablas mutuamente y producir fallos que no se repiten.
 *
 * Con un esquema por archivo, cada uno trabaja aislado y el paralelismo deja
 * de ser un riesgo. `search_path` hace que el resto del código no cambie.
 *
 * El `search_path` NO incluye `public`. Con `public` detrás, un
 * `DROP TABLE IF EXISTS` sobre un esquema recién creado no encontraba la
 * tabla propia y borraba la de `public` —la de la prueba de aislamiento—, y
 * un `GRANT ... IN SCHEMA public` le daba permisos sobre la auditoría ajena.
 * Con la base vacía, la suite fallaba distinto en cada corrida.
 */
export function esquemaDe(rutaArchivo: string): string {
  const nombre = rutaArchivo.split("/").pop()?.replace(/\.test\.ts$/, "") ?? "pruebas";
  return `prueba_${nombre.replace(/[^a-z0-9_]/gi, "_")}`;
}

/** Conecta con el esquema propio del archivo ya preparado y activo. */
export async function conectarAislado(rutaArchivo: string): Promise<pg.Client> {
  const esquema = esquemaDe(rutaArchivo);
  const cliente = new pg.Client({ connectionString: URL_PRUEBAS });
  await cliente.connect();
  await cliente.query(`CREATE SCHEMA IF NOT EXISTS "${esquema}"`);
  await cliente.query(`SET search_path TO "${esquema}"`);
  return cliente;
}

/** Igual, para un pool: cada conexión nueva entra al mismo esquema. */
export async function poolAislado(rutaArchivo: string, max = 6): Promise<pg.Pool> {
  const esquema = esquemaDe(rutaArchivo);

  // El esquema tiene que existir antes de la primera consulta.
  const preparacion = new pg.Client({ connectionString: URL_PRUEBAS });
  await preparacion.connect();
  await preparacion.query(`CREATE SCHEMA IF NOT EXISTS "${esquema}"`);
  await preparacion.end();

  const pool = new pg.Pool({ connectionString: URL_PRUEBAS, max });
  pool.on("connect", (c) => {
    void c.query(`SET search_path TO "${esquema}"`);
  });
  return pool;
}

/**
 * Serializa la preparación que toca objetos COMPARTIDOS por toda la base:
 * roles, permisos sobre `public`, funciones globales.
 *
 * El esquema por archivo no los aísla. Dos archivos concediendo a la vez sobre
 * el mismo rol o esquema chocan en el catálogo ("tuple concurrently deleted")
 * y la suite falla según quién llegue primero. El bloqueo es de sesión y se
 * suelta siempre, aunque la preparación falle.
 */
const CLAVE_BLOQUEO_GLOBAL = 7_310_461;

export async function conBloqueoGlobal<T>(cliente: pg.Client, fn: () => Promise<T>): Promise<T> {
  await cliente.query("SELECT pg_advisory_lock($1)", [CLAVE_BLOQUEO_GLOBAL]);
  try {
    return await fn();
  } finally {
    await cliente.query("SELECT pg_advisory_unlock($1)", [CLAVE_BLOQUEO_GLOBAL]);
  }
}

/** true si hay una base a la que conectarse. */
export async function hayBaseDeDatos(): Promise<boolean> {
  // Diez segundos: con dos segundos, una máquina cargada se saltaba la suite
  // entera y el resultado seguía diciendo que todo pasó.
  const cliente = new pg.Client({ connectionString: URL_PRUEBAS, connectionTimeoutMillis: 10_000 });
  try {
    await cliente.connect();
    await cliente.end();
    return true;
  } catch (e) {
    if (EXIGE_BASE) {
      throw new Error(
        `Se exige base de datos (PRUEBAS_EXIGEN_BASE=1) y no se pudo conectar a ${URL_PRUEBAS}: ${(e as Error).message}`,
      );
    }
    return false;
  }
}

/** Contexto de sesión que el backend fija al abrir cada transacción. */
export interface Contexto {
  empresaId?: string;
  rol?: string;
  usuarioId?: string;
  clienteId?: string;
}

/**
 * Divide un script SQL en sentencias respetando los bloques con comillas de
 * dólar ($$ ... $$). Partir solo por punto y coma rompe los bloques DO, que
 * contienen punto y coma dentro.
 */
export function dividirSQL(sql: string): string[] {
  const sentencias: string[] = [];
  let actual = "";
  let etiquetaDolar: string | null = null;
  let i = 0;

  while (i < sql.length) {
    // ¿Empieza o termina un bloque con comillas de dólar?
    if (sql[i] === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        const etiqueta = m[0];
        if (etiquetaDolar === null) etiquetaDolar = etiqueta;
        else if (etiquetaDolar === etiqueta) etiquetaDolar = null;
        actual += etiqueta;
        i += etiqueta.length;
        continue;
      }
    }

    // Comentario de línea fuera de un bloque
    if (etiquetaDolar === null && sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }

    if (etiquetaDolar === null && sql[i] === ";") {
      const limpia = actual.trim();
      if (limpia) sentencias.push(limpia);
      actual = "";
      i++;
      continue;
    }

    actual += sql[i];
    i++;
  }

  const ultima = actual.trim();
  if (ultima) sentencias.push(ultima);
  return sentencias;
}

export class BaseDePruebas {
  private admin!: pg.Client;
  private app!: pg.Client;

  /** Conexión como dueño: crea el esquema y siembra. Se salta el RLS. */
  get comoDueno(): pg.Client {
    return this.admin;
  }

  /** Conexión como la aplicación: sujeta a las políticas. */
  get comoApp(): pg.Client {
    return this.app;
  }

  async iniciar(): Promise<void> {
    this.admin = new pg.Client({ connectionString: URL_PRUEBAS });
    await this.admin.connect();

    await this.crearEsquema();
    await this.aplicarRestricciones();
    await this.aplicarRLS();
    await this.sembrarDosEmpresas();

    // La aplicación se conecta con un rol distinto al dueño: sin eso, FORCE
    // ROW LEVEL SECURITY no tendría efecto y las políticas se saltarían.
    this.app = new pg.Client({ connectionString: URL_PRUEBAS });
    await this.app.connect();
    await this.app.query("SET ROLE tiretrack_app");
  }

  async terminar(): Promise<void> {
    await this.app?.end();
    await this.admin?.end();
  }

  /**
   * Ejecuta una consulta dentro de una transacción con el contexto fijado,
   * igual que hará el backend en cada petición.
   */
  async comoUsuario<T = unknown>(
    ctx: Contexto,
    sql: string,
    valores: unknown[] = [],
  ): Promise<pg.QueryResult<T & pg.QueryResultRow>> {
    await this.app.query("BEGIN");
    try {
      // SET LOCAL: el valor muere con la transacción y no se filtra a la
      // siguiente petición que reutilice esta conexión del pool.
      await this.app.query("SELECT set_config('app.empresa_id', $1, true)", [ctx.empresaId ?? ""]);
      await this.app.query("SELECT set_config('app.rol', $1, true)", [ctx.rol ?? ""]);
      await this.app.query("SELECT set_config('app.usuario_id', $1, true)", [ctx.usuarioId ?? ""]);
      await this.app.query("SELECT set_config('app.cliente_id', $1, true)", [ctx.clienteId ?? ""]);
      const r = await this.app.query(sql, valores);
      await this.app.query("COMMIT");
      return r as pg.QueryResult<T & pg.QueryResultRow>;
    } catch (e) {
      await this.app.query("ROLLBACK");
      throw e;
    }
  }

  private async crearEsquema(): Promise<void> {
    // Esquema mínimo equivalente al de Prisma. No se usa `prisma migrate`
    // porque los binarios no están disponibles en todos los entornos; lo que
    // se prueba aquí es el comportamiento de las políticas, no el generador.
    await this.admin.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;

      CREATE TABLE "Empresa" (
        id text PRIMARY KEY,
        nombre text NOT NULL,
        nit text UNIQUE NOT NULL,
        activa boolean NOT NULL DEFAULT true
      );

      CREATE TABLE "Sede" (
        id text PRIMARY KEY,
        "empresaId" text NOT NULL REFERENCES "Empresa"(id),
        nombre text NOT NULL,
        codigo text NOT NULL,
        UNIQUE ("empresaId", codigo),
        UNIQUE (id, "empresaId")
      );

      CREATE TABLE "Usuario" (
        id text PRIMARY KEY,
        "empresaId" text REFERENCES "Empresa"(id),
        nombre text NOT NULL,
        cedula text NOT NULL,
        email text NOT NULL,
        "passwordHash" text NOT NULL,
        rol text NOT NULL,
        "clienteId" text,
        UNIQUE ("empresaId", email)
      );

      CREATE TABLE "UsuarioSede" (
        "usuarioId" text NOT NULL REFERENCES "Usuario"(id),
        "sedeId" text NOT NULL REFERENCES "Sede"(id),
        "esPrincipal" boolean NOT NULL DEFAULT false,
        PRIMARY KEY ("usuarioId", "sedeId")
      );

      CREATE TABLE "Cliente" (
        id text PRIMARY KEY,
        "empresaId" text NOT NULL REFERENCES "Empresa"(id),
        nombre text NOT NULL,
        nit text NOT NULL,
        UNIQUE ("empresaId", nit),
        UNIQUE (id, "empresaId")
      );

      CREATE TABLE "SedeCliente" (
        id text PRIMARY KEY,
        "clienteId" text NOT NULL REFERENCES "Cliente"(id),
        nombre text NOT NULL,
        UNIQUE (id, "clienteId")
      );

      CREATE TABLE "ConfiguracionEje" (
        id text PRIMARY KEY,
        "empresaId" text NOT NULL REFERENCES "Empresa"(id),
        nombre text NOT NULL,
        version integer NOT NULL DEFAULT 1,
        "totalPosiciones" integer NOT NULL,
        UNIQUE (id, "empresaId")
      );

      CREATE TABLE "PosicionEje" (
        id text PRIMARY KEY,
        "configuracionEjeId" text NOT NULL REFERENCES "ConfiguracionEje"(id),
        numero integer NOT NULL,
        UNIQUE ("configuracionEjeId", numero)
      );

      CREATE TABLE "Vehiculo" (
        id text PRIMARY KEY,
        "sedeClienteId" text NOT NULL REFERENCES "SedeCliente"(id),
        "configuracionEjeId" text NOT NULL REFERENCES "ConfiguracionEje"(id),
        codigo text NOT NULL
      );

      CREATE TABLE "Marca" (
        id text PRIMARY KEY,
        "empresaId" text REFERENCES "Empresa"(id),
        nombre text NOT NULL,
        "esGlobal" boolean NOT NULL DEFAULT false
      );

      CREATE TABLE "OrdenServicio" (
        id text PRIMARY KEY,
        "empresaId" text NOT NULL REFERENCES "Empresa"(id),
        "sedeId" text NOT NULL REFERENCES "Sede"(id),
        "clienteId" text NOT NULL REFERENCES "Cliente"(id),
        "sedeClienteId" text NOT NULL REFERENCES "SedeCliente"(id),
        "vehiculoId" text NOT NULL REFERENCES "Vehiculo"(id),
        tecnico_id text NOT NULL REFERENCES "Usuario"(id),
        "configuracionEjeId" text NOT NULL REFERENCES "ConfiguracionEje"(id),
        folio text,
        estado text NOT NULL DEFAULT 'borrador',
        version integer NOT NULL DEFAULT 0,
        UNIQUE (id, "configuracionEjeId")
      );

      CREATE TABLE "LlantaRegistro" (
        id text PRIMARY KEY,
        "ordenId" text NOT NULL REFERENCES "OrdenServicio"(id) ON DELETE CASCADE,
        "configuracionEjeId" text NOT NULL,
        posicion integer NOT NULL,
        "capturadoPorId" text NOT NULL REFERENCES "Usuario"(id),
        UNIQUE ("ordenId", posicion)
      );

      CREATE TABLE "Auditoria" (
        id text PRIMARY KEY,
        "empresaId" text REFERENCES "Empresa"(id),
        "usuarioId" text,
        accion text NOT NULL,
        "creadoEn" timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  private async aplicarRestricciones(): Promise<void> {
    // Las llaves compuestas de manual.sql que aplican al esquema reducido.
    await this.admin.query(`
      ALTER TABLE "OrdenServicio"
        ADD CONSTRAINT orden_cliente_empresa_fk
        FOREIGN KEY ("clienteId", "empresaId") REFERENCES "Cliente" (id, "empresaId");

      ALTER TABLE "OrdenServicio"
        ADD CONSTRAINT orden_sede_empresa_fk
        FOREIGN KEY ("sedeId", "empresaId") REFERENCES "Sede" (id, "empresaId");

      ALTER TABLE "OrdenServicio"
        ADD CONSTRAINT orden_sedecliente_cliente_fk
        FOREIGN KEY ("sedeClienteId", "clienteId") REFERENCES "SedeCliente" (id, "clienteId");

      ALTER TABLE "OrdenServicio"
        ADD CONSTRAINT orden_tecnico_sede_fk
        FOREIGN KEY (tecnico_id, "sedeId") REFERENCES "UsuarioSede" ("usuarioId", "sedeId");

      ALTER TABLE "LlantaRegistro"
        ADD CONSTRAINT llanta_orden_configuracion_fk
        FOREIGN KEY ("ordenId", "configuracionEjeId")
        REFERENCES "OrdenServicio" (id, "configuracionEjeId");
    `);
  }

  private async aplicarRLS(): Promise<void> {
    const sql = readFileSync(join(aqui, "../../prisma/rls.sql"), "utf8");

    // Se ejecutan TODAS las sentencias. Intentar adivinar cuáles aplican
    // filtrando por nombre de tabla fue un error: la expresión regular tomaba
    // la palabra equivocada dentro de los bloques DO y dejaba tablas enteras
    // sin RLS, con las pruebas pasando en falso.
    //
    // Se toleran solo los errores de "no existe": el esquema de pruebas es
    // reducido y no tiene todas las tablas del esquema real.
    await conBloqueoGlobal(this.admin, async () => {
      for (const sentencia of dividirSQL(sql)) {
        try {
          await this.admin.query(sentencia);
        } catch (e) {
          const msg = (e as Error).message;
          if (!/does not exist|no existe/i.test(msg)) {
            throw new Error(`Falló al aplicar RLS: ${msg}\n--- sentencia ---\n${sentencia.slice(0, 300)}`);
          }
        }
      }
    });

    await this.verificarRLSActivo();
  }

  /**
   * Comprueba que las tablas del esquema de pruebas hayan quedado con RLS
   * activo y forzado. Sin esta verificación, un fallo silencioso al aplicar
   * las políticas haría que las pruebas de aislamiento pasaran en verde
   * mientras el aislamiento no existe.
   */
  private async verificarRLSActivo(): Promise<void> {
    const r = await this.admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
    `);

    const sinProteger = r.rows.filter((t) => !t.relrowsecurity || !t.relforcerowsecurity);
    if (sinProteger.length > 0) {
      throw new Error(
        `Estas tablas quedaron sin RLS forzado: ${sinProteger.map((t) => t.relname).join(", ")}`,
      );
    }
  }

  /** Dos empresas con datos equivalentes: es lo que permite probar el cruce. */
  private async sembrarDosEmpresas(): Promise<void> {
    for (const [emp, suf] of [
      ["emp-a", "a"],
      ["emp-b", "b"],
    ] as const) {
      await this.admin.query(
        `INSERT INTO "Empresa" (id, nombre, nit) VALUES ($1, $2, $3)`,
        [emp, `Empresa ${suf.toUpperCase()}`, `900-${suf}`],
      );
      await this.admin.query(
        `INSERT INTO "Sede" (id, "empresaId", nombre, codigo) VALUES ($1, $2, $3, $4)`,
        [`sede-${suf}`, emp, `Sede ${suf}`, suf.toUpperCase()],
      );
      await this.admin.query(
        `INSERT INTO "Usuario" (id, "empresaId", nombre, cedula, email, "passwordHash", rol)
         VALUES ($1, $2, $3, $4, $5, 'hash', 'tecnico')`,
        [`tec-${suf}`, emp, `Técnico ${suf}`, `100${suf}`, `tec-${suf}@x.com`],
      );
      await this.admin.query(
        `INSERT INTO "Usuario" (id, "empresaId", nombre, cedula, email, "passwordHash", rol)
         VALUES ($1, $2, $3, $4, $5, 'hash', 'coordinador')`,
        [`coo-${suf}`, emp, `Coordinador ${suf}`, `200${suf}`, `coo-${suf}@x.com`],
      );
      await this.admin.query(
        `INSERT INTO "UsuarioSede" ("usuarioId", "sedeId") VALUES ($1, $2), ($3, $2)`,
        [`tec-${suf}`, `sede-${suf}`, `coo-${suf}`],
      );
      await this.admin.query(
        `INSERT INTO "Cliente" (id, "empresaId", nombre, nit) VALUES ($1, $2, $3, $4)`,
        [`cli-${suf}`, emp, "Transportes Reyna", "800.112.334-1"],
      );
      await this.admin.query(
        `INSERT INTO "SedeCliente" (id, "clienteId", nombre) VALUES ($1, $2, $3)`,
        [`sc-${suf}`, `cli-${suf}`, "Planta principal"],
      );
      await this.admin.query(
        `INSERT INTO "ConfiguracionEje" (id, "empresaId", nombre, "totalPosiciones")
         VALUES ($1, $2, 'Tractocamión', 22)`,
        [`cfg-${suf}`, emp],
      );
      await this.admin.query(
        `INSERT INTO "PosicionEje" (id, "configuracionEjeId", numero) VALUES ($1, $2, 1)`,
        [`pos-${suf}-1`, `cfg-${suf}`],
      );
      await this.admin.query(
        `INSERT INTO "Vehiculo" (id, "sedeClienteId", "configuracionEjeId", codigo)
         VALUES ($1, $2, $3, 'CA-12')`,
        [`veh-${suf}`, `sc-${suf}`, `cfg-${suf}`],
      );
      await this.admin.query(
        `INSERT INTO "OrdenServicio"
           (id, "empresaId", "sedeId", "clienteId", "sedeClienteId", "vehiculoId",
            tecnico_id, "configuracionEjeId", folio, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'en_proceso')`,
        [
          `ord-${suf}`, emp, `sede-${suf}`, `cli-${suf}`, `sc-${suf}`,
          `veh-${suf}`, `tec-${suf}`, `cfg-${suf}`, `OS-${suf.toUpperCase()}-000001`,
        ],
      );
    }

    // Marca global: visible para las dos empresas
    await this.admin.query(
      `INSERT INTO "Marca" (id, "empresaId", nombre, "esGlobal") VALUES ('mar-glob', NULL, 'Michelin', true)`,
    );
    // Marca propia de la empresa A
    await this.admin.query(
      `INSERT INTO "Marca" (id, "empresaId", nombre, "esGlobal") VALUES ('mar-a', 'emp-a', 'Reencauchadora A', false)`,
    );
  }
}

/** Cliente usuario del portal, para las pruebas de acceso externo. */
export const CTX_COORDINADOR_A = { empresaId: "emp-a", rol: "coordinador", usuarioId: "coo-a" };
export const CTX_COORDINADOR_B = { empresaId: "emp-b", rol: "coordinador", usuarioId: "coo-b" };
export const CTX_TECNICO_A = { empresaId: "emp-a", rol: "tecnico", usuarioId: "tec-a" };
export const CTX_SIN_CONTEXTO = {};
