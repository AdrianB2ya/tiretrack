/* eslint-disable no-console -- herramienta de línea de comandos: su salida ES la consola */
/**
 * Alta de una empresa en producción, desde la línea de comandos.
 *
 *   node --env-file=.env --import tsx src/herramientas/crear-empresa.ts empresa.json
 *
 * `empresa.json`:
 *
 *   {
 *     "empresa": { "nombre": "Asistectire S.A.S.", "nit": "901.234.567-8" },
 *     "sede": { "nombre": "Fundación", "codigo": "FUN", "ciudad": "Fundación" },
 *     "administrador": { "nombre": "…", "cedula": "…", "email": "…", "telefono": "…" }
 *   }
 *
 * Necesita `DIRECT_URL` (el dueño: no hay empresa todavía para fijar el
 * contexto de RLS) y `DATABASE_URL_AUTH` (el código de activación lo emite
 * el servicio de acceso). Muestra el código **una sola vez**: hay que
 * enviárselo al administrador, que entra con "Tengo un código de activación".
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { fechaHoraEnColombia } from "@tiretrack/domain";
import { RepositorioPg } from "../acceso/repositorio";
import { ServicioAuth } from "../acceso/servicio";
import { crearEmpresa } from "./crearEmpresa";

async function principal(): Promise<number> {
  const archivo = process.argv[2];
  const dueno = process.env["DIRECT_URL"];
  const acceso = process.env["DATABASE_URL_AUTH"];
  const secreto = process.env["JWT_SECRET"];
  if (!archivo || !dueno || !acceso || !secreto) {
    console.error("Uso: crear-empresa.ts empresa.json  (con DIRECT_URL, DATABASE_URL_AUTH y JWT_SECRET en el entorno)");
    return 2;
  }

  const db = new pg.Client({ connectionString: dueno });
  const poolAcceso = new pg.Pool({ connectionString: acceso, max: 1 });
  await db.connect();
  try {
    const r = await crearEmpresa(db, JSON.parse(readFileSync(archivo, "utf8")));
    if (!r.ok) {
      console.error(`No se creó nada: ${r.motivo}`);
      return 1;
    }
    const codigo = await new ServicioAuth(new RepositorioPg(poolAcceso), { jwtSecret: secreto }).crearCodigoActivacion(r.administradorId);
    console.log(`Empresa creada (${r.empresaId}).`);
    if (codigo) {
      console.log(`\nCódigo de activación del administrador: ${codigo.codigo}`);
      console.log(`Vence: ${fechaHoraEnColombia(codigo.expiraEn)} (hora de Colombia). Se muestra una sola vez.`);
      console.log(`En la app: "Tengo un código de activación". Al activar registra su app autenticadora (doble factor).`);
    } else {
      console.log("No se pudo emitir el código: pídelo desde otra cuenta de administrador o vuelve a intentarlo.");
    }
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
