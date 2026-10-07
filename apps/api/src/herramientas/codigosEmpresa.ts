import type pg from "pg";

/**
 * Los usuarios activos de una empresa, para emitirles un código de
 * activación a cada uno de una vez.
 *
 * Para un entorno de pruebas cargado con la semilla: sus usuarios nacen sin
 * contraseña utilizable. En vez de inventarles claves, cada uno recibe su
 * código y elige la suya al activar, igual que un usuario creado desde la
 * app; así la prueba recorre el flujo real, doble factor incluido.
 */

export interface UsuarioParaCodigo {
  readonly id: string;
  readonly nombre: string;
  readonly email: string;
  readonly rol: string;
}

/** Por NIT de la empresa (único). El superadmin no es de ninguna empresa: nunca sale. */
export async function usuariosDeEmpresa(db: pg.Client | pg.PoolClient, nit: string): Promise<UsuarioParaCodigo[] | null> {
  const empresa = await db.query<{ id: string }>(`SELECT id FROM "Empresa" WHERE nit = $1`, [nit]);
  if (!empresa.rows[0]) return null;
  const r = await db.query<UsuarioParaCodigo>(
    `SELECT id, nombre, email, rol::text AS rol FROM "Usuario"
      WHERE "empresaId" = $1 AND activo AND rol <> 'superadmin'
      ORDER BY CASE rol WHEN 'administrador' THEN 0 WHEN 'coordinador' THEN 1 WHEN 'tecnico' THEN 2 ELSE 3 END, nombre`,
    [empresa.rows[0].id],
  );
  return r.rows;
}
