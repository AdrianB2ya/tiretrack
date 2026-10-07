import { randomBytes } from "node:crypto";
import pg from "pg";

/**
 * Claves de los dos usuarios con los que entra la API (tiretrack_app y
 * tiretrack_auth), puestas y comprobadas en un solo paso.
 *
 * En el primer despliegue (Render + Neon) se ponían a mano en el editor SQL
 * y se copiaban a las direcciones de conexión: un espacio o una clave cruzada
 * daba "password authentication failed" y no había forma de saber cuál de
 * los dos lados estaba mal. Aquí la clave nunca se escribe a mano: se genera,
 * se aplica con la conexión del dueño, se prueba entrando con ella y solo
 * entonces se entrega la dirección lista.
 */

export const ROLES_API = { app: "tiretrack_app", auth: "tiretrack_auth" } as const;

/** Letras, números, guion y guion bajo: entra en una URL sin escaparse. */
export function generarClave(): string {
  return randomBytes(24).toString("base64url");
}

/** La dirección del dueño con otro usuario y clave; el servidor y el resto, iguales. */
export function direccionPara(urlDueno: string, usuario: string, clave: string): string {
  const u = new URL(urlDueno);
  u.username = usuario;
  u.password = clave;
  return u.toString();
}

export interface ResultadoClaves {
  readonly direcciones: Record<string, string>;
}

/**
 * Pone una clave nueva a cada rol y comprueba que entra. Si alguno no entra,
 * lanza el error con el rol: no entrega direcciones que no funcionan.
 */
export async function restablecerClaves(
  urlDueno: string,
  roles: readonly string[],
  generar: () => string = generarClave,
): Promise<ResultadoClaves> {
  const dueno = new pg.Client({ connectionString: urlDueno });
  await dueno.connect();
  const direcciones: Record<string, string> = {};
  try {
    for (const rol of roles) {
      const clave = generar();
      // ALTER ROLE no admite parámetros: el rol y la clave se citan con las
      // funciones de PostgreSQL, no concatenando texto a mano.
      const sql = await dueno.query<{ s: string }>(
        `SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS s`,
        [rol, clave],
      );
      await dueno.query(sql.rows[0]!.s);
      direcciones[rol] = direccionPara(urlDueno, rol, clave);
    }
  } finally {
    await dueno.end();
  }
  for (const rol of roles) {
    const c = new pg.Client({ connectionString: direcciones[rol] });
    try {
      await c.connect();
      await c.query("SELECT 1");
    } catch (e) {
      throw new Error(`La clave nueva de ${rol} no entra: ${(e as Error).message}`);
    } finally {
      await c.end().catch(() => undefined);
    }
  }
  return { direcciones };
}
