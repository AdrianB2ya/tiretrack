import type { Conexion, Fila } from "./base";

/**
 * Conexión del dispositivo, sobre `expo-sqlite`.
 *
 * Las pruebas usan `ConexionNode` (conexionNode.ts), sobre `better-sqlite3`:
 * SQLite de verdad —el mismo motor— corriendo en Node. No es un doble: las
 * restricciones, los tipos y las transacciones se comportan igual.
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

// La conexión de pruebas (better-sqlite3) vive en conexionNode.ts: si estuviera
// aquí, Metro la empaquetaría en la app aunque la importación sea dinámica.
