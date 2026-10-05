import type { Conexion, Fila } from "./base";

/**
 * Conexión para PRUEBAS, sobre `better-sqlite3`: SQLite de verdad —el mismo
 * motor que en el dispositivo— corriendo en Node.
 *
 * Vive aparte de `conexion.ts` a propósito. Metro resuelve también las
 * importaciones dinámicas al empaquetar: mientras esto estaba en el mismo
 * archivo que la conexión del dispositivo, la app arrastraba
 * `better-sqlite3` —que necesita `fs` y no existe en un teléfono— y el
 * paquete para Android no se podía construir. Nada de la app importa este
 * archivo; solo las pruebas.
 */

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
