import { MIGRACIONES, SQL_PREPARACION, TABLAS_DE_DATOS, VERSION_ESQUEMA, type Migracion } from "./esquema";

/**
 * Acceso a la base local.
 *
 * Se define como interfaz para poder probar toda la lógica sin un
 * dispositivo: `expo-sqlite` solo existe dentro de la app.
 */

export interface Fila {
  readonly [columna: string]: string | number | null;
}

export interface Conexion {
  ejecutar(sql: string, params?: readonly unknown[]): Promise<{ cambios: number }>;
  consultar<T = Fila>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /** Varias sentencias juntas, para las migraciones. */
  ejecutarLote(sql: string): Promise<void>;
  cerrar(): Promise<void>;
}

export interface ResultadoMigracion {
  readonly aplicadas: number[];
  readonly versionFinal: number;
}

/**
 * Aplica las migraciones pendientes.
 *
 * Cada una va en su propia transacción: si la 3 falla, la 1 y la 2 quedan
 * aplicadas y al reintentar solo se ejecuta la 3. Una migración a medias en
 * el celular de un técnico en Fundación no se puede arreglar a mano.
 */
export async function migrar(
  db: Conexion,
  migraciones: readonly Migracion[] = MIGRACIONES,
): Promise<ResultadoMigracion> {
  await db.ejecutarLote(SQL_PREPARACION);

  const aplicadas = await db.consultar<{ version: number }>(
    "SELECT version FROM migracion_aplicada ORDER BY version",
  );
  const yaEstan = new Set(aplicadas.map((f) => f.version));
  const nuevas: number[] = [];

  for (const m of migraciones) {
    if (yaEstan.has(m.version)) continue;

    await db.ejecutar("BEGIN");
    try {
      await db.ejecutarLote(m.sql);
      await db.ejecutar(
        "INSERT INTO migracion_aplicada (version, nombre, aplicada_en) VALUES (?, ?, ?)",
        [m.version, m.nombre, new Date().toISOString()],
      );
      await db.ejecutar("COMMIT");
      nuevas.push(m.version);
    } catch (e) {
      await db.ejecutar("ROLLBACK").catch(() => undefined);
      throw new Error(`Falló la migración ${m.version} (${m.nombre}): ${(e as Error).message}`);
    }
  }

  return { aplicadas: nuevas, versionFinal: VERSION_ESQUEMA };
}

export async function versionActual(db: Conexion): Promise<number> {
  const r = await db.consultar<{ v: number | null }>(
    "SELECT max(version) AS v FROM migracion_aplicada",
  );
  return r[0]?.v ?? 0;
}

/**
 * Vacía los datos sin tocar el esquema.
 *
 * Se usa al cerrar sesión o al cambiar de empresa: el dispositivo pertenece a
 * un usuario de una empresa, y mezclar datos de dos sería una fuga entre
 * clientes. Borrar es más simple y más seguro que filtrar.
 */
export async function vaciarDatos(db: Conexion): Promise<void> {
  await db.ejecutar("BEGIN");
  try {
    for (const tabla of TABLAS_DE_DATOS) {
      await db.ejecutar(`DELETE FROM ${tabla}`);
    }
    await db.ejecutar("COMMIT");
  } catch (e) {
    await db.ejecutar("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

/**
 * Comprueba que haya trabajo sin enviar antes de permitir cerrar sesión.
 * Borrar la base con mediciones pendientes es perder el trabajo de una
 * jornada, y en campo eso no se recupera.
 */
export async function hayTrabajoSinEnviar(db: Conexion): Promise<{
  operaciones: number;
  fotos: number;
  ordenes: number;
}> {
  const [ops] = await db.consultar<{ n: number }>("SELECT count(*) AS n FROM operacion");
  const [fotos] = await db.consultar<{ n: number }>(
    "SELECT count(*) AS n FROM foto WHERE subida = 0",
  );
  const [ordenes] = await db.consultar<{ n: number }>(
    "SELECT count(*) AS n FROM orden WHERE sincronizada = 0",
  );
  return {
    operaciones: ops?.n ?? 0,
    fotos: fotos?.n ?? 0,
    ordenes: ordenes?.n ?? 0,
  };
}
