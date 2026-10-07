/* eslint-disable no-console -- herramienta de línea de comandos: su salida ES la consola */
/**
 * Un código de activación para cada usuario de una empresa.
 *
 *   node --import tsx src/herramientas/codigos-empresa.ts 901.234.567-8
 *
 * Con DIRECT_URL (dueño), DATABASE_URL_AUTH y JWT_SECRET en el entorno, como
 * crear-empresa. Pensada para un entorno de pruebas cargado con la semilla.
 * Cada código anula los anteriores de ese usuario y vence en 72 horas.
 */
import pg from "pg";
import { fechaHoraEnColombia } from "@tiretrack/domain";
import { RepositorioPg } from "../acceso/repositorio";
import { ServicioAuth } from "../acceso/servicio";
import { usuariosDeEmpresa } from "./codigosEmpresa";

const ETIQUETA: Record<string, string> = {
  administrador: "Administrador", coordinador: "Coordinador", tecnico: "Técnico", cliente: "Cliente",
};

async function principal(): Promise<number> {
  const nit = process.argv[2];
  const dueno = process.env["DIRECT_URL"];
  const acceso = process.env["DATABASE_URL_AUTH"];
  const secreto = process.env["JWT_SECRET"];
  if (!nit || !dueno || !acceso || !secreto) {
    console.error("Uso: codigos-empresa.ts NIT  (con DIRECT_URL, DATABASE_URL_AUTH y JWT_SECRET en el entorno)");
    return 2;
  }
  const db = new pg.Client({ connectionString: dueno });
  const poolAcceso = new pg.Pool({ connectionString: acceso, max: 1 });
  await db.connect();
  try {
    const usuarios = await usuariosDeEmpresa(db, nit);
    if (!usuarios) {
      console.error(`No hay ninguna empresa con NIT ${nit}. ¿Corriste la semilla o crear-empresa?`);
      return 1;
    }
    if (usuarios.length === 0) {
      console.error("La empresa no tiene usuarios activos.");
      return 1;
    }
    const auth = new ServicioAuth(new RepositorioPg(poolAcceso), { jwtSecret: secreto });
    let vence = "";
    console.log("Códigos de activación (se muestran una sola vez):\n");
    for (const u of usuarios) {
      const c = await auth.crearCodigoActivacion(u.id);
      if (!c) {
        console.log(`  ${u.email}: no se pudo emitir`);
        continue;
      }
      vence = fechaHoraEnColombia(c.expiraEn);
      console.log(`  ${(ETIQUETA[u.rol] ?? u.rol).padEnd(14)} ${u.nombre.padEnd(22)} ${u.email.padEnd(30)} ${c.codigo}`);
    }
    console.log(`\nVencen: ${vence} (hora de Colombia).`);
    console.log('En la app: "Tengo un código de activación", con el correo y el código. El administrador registra además su app autenticadora.');
    return 0;
  } finally {
    await db.end();
    await poolAcceso.end();
  }
}

principal().then(
  (codigo) => process.exit(codigo),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
