import type { Conexion, Fila } from "./base";

/**
 * Implementaciones de la conexión.
 *
 * En el dispositivo se usa `expo-sqlite`. En las pruebas se usa
 * `better-sqlite3`, que es **SQLite de verdad** —el mismo motor— corriendo en
 * Node. No es un doble: las restricciones, los tipos y las transacciones se
 * comportan igual, así que una prueba que pasa aquí vale.
 */

// ── Dispositivo ─────────────────────────────────────────────────────────────

/** Forma mínima de expo-sqlite que se usa, para no acoplar a su tipo. */
interface BaseExpo {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: unknown[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, params: unknown[]): Promise<T[]>;
  closeAsync(): Promise<void>;
}

export class ConexionExpo implements Conexion {
  constructor(private readonly db: BaseExpo) {}

  async ejecutar(sql: string, params: readonly unknown[] = []) {
    const r = await this.db.runAsync(sql, [...params]);
    return { cambios: r.changes };
  }

  async consultar<T = Fila>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.db.getAllAsync<T>(sql, [...params]);
  }

  async ejecutarLote(sql: string): Promise<void> {
    await this.db.execAsync(sql);
  }

  async cerrar(): Promise<void> {
    await this.db.closeAsync();
  }
}

/**
 * Abre la base del dispositivo.
 *
 * La importación es dinámica porque `expo-sqlite` no existe fuera de la app:
 * si se importara arriba, las pruebas y cualquier herramienta de Node
 * fallarían al cargar el módulo.
 */
export async function abrirBaseDispositivo(nombre = "tiretrack.db"): Promise<Conexion> {
  const { openDatabaseAsync } = (await import("expo-sqlite")) as unknown as {
    openDatabaseAsync: (n: string) => Promise<BaseExpo>;
  };
  return new ConexionExpo(await openDatabaseAsync(nombre));
}

// ── Pruebas ─────────────────────────────────────────────────────────────────

interface BaseNode {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

/**
 * Conexión sobre better-sqlite3. Misma base de datos que en el dispositivo,
 * distinto enlace: lo que se prueba aquí se comporta igual allá.
 */
export class ConexionNode implements Conexion {
  constructor(private readonly db: BaseNode) {}

  async ejecutar(sql: string, params: readonly unknown[] = []) {
    // BEGIN, COMMIT y ROLLBACK no admiten parámetros ni prepare en algunos
    // controladores: van por exec.
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) {
      this.db.exec(sql);
      return { cambios: 0 };
    }
    const r = this.db.prepare(sql).run(...params);
    return { cambios: r.changes };
  }

  async consultar<T = Fila>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async ejecutarLote(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async cerrar(): Promise<void> {
    this.db.close();
  }
}

/** Base en memoria para pruebas. Cada llamada devuelve una base limpia. */
export async function abrirBaseEnMemoria(): Promise<Conexion> {
  const { default: Database } = (await import("better-sqlite3")) as unknown as {
    default: new (ruta: string) => BaseNode;
  };
  return new ConexionNode(new Database(":memory:"));
}
