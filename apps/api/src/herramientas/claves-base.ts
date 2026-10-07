/* eslint-disable no-console -- herramienta de línea de comandos: su salida ES la consola */
/**
 * Pone claves nuevas a los usuarios de la API y entrega las dos direcciones
 * para Render (DATABASE_URL y DATABASE_URL_AUTH), ya probadas.
 *
 *   $env:DIRECT_URL = "postgresql://neondb_owner:…@…/neondb?sslmode=require"
 *   node --import tsx src/herramientas/claves-base.ts
 *
 * Sirve también para cambiar las claves si se filtraron: después hay que
 * actualizar las dos variables en Render.
 */
import { ROLES_API, restablecerClaves } from "./clavesBase";

async function principal(): Promise<number> {
  const dueno = process.env["DIRECT_URL"];
  if (!dueno) {
    console.error('Falta DIRECT_URL. En PowerShell: $env:DIRECT_URL = "la dirección del dueño (URL_DUENO)"');
    return 2;
  }
  const { direcciones } = await restablecerClaves(dueno, [ROLES_API.app, ROLES_API.auth]);
  console.log("Claves nuevas puestas y probadas: las dos direcciones entran.\n");
  console.log("Copia cada una en Render → Environment, sin comillas:\n");
  console.log(`DATABASE_URL=${direcciones[ROLES_API.app]}\n`);
  console.log(`DATABASE_URL_AUTH=${direcciones[ROLES_API.auth]}\n`);
  console.log("Guárdalas también en tu gestor de contraseñas. Las anteriores ya no sirven.");
  return 0;
}

principal().then(
  (codigo) => process.exit(codigo),
  (e: unknown) => {
    console.error(`No se cambió nada útil: ${(e as Error).message}`);
    process.exit(1);
  },
);
