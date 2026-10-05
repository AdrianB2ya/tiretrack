import pg from "pg";
import { leerConfig, ErrorDeConfiguracion, type Config } from "./config";
import { construirServidor } from "./http/servidor";
import { ServicioAuth } from "./acceso/servicio";
import { RepositorioPg } from "./acceso/repositorio";
import { AlmacenamientoS3 } from "./fotos/almacenamiento";
import { configurarUtc, OPCIONES_SESION_UTC } from "./db/utc";

/**
 * Arranque del servidor.
 *
 * Tres cosas que no son obvias y que se decidieron a propósito:
 *
 * 1. **Dos pools, dos roles.** El de aplicación ve solo lo de la empresa del
 *    contexto; el de acceso solo puede tocar las cinco tablas de
 *    autenticación. Separarlos es lo que limita el alcance de un fallo en el
 *    login (ver la sección "ROL DE AUTENTICACIÓN" en prisma/rls.sql).
 *
 * 2. **`/salud` y `/listo` son distintos.** Salud dice si el proceso vive;
 *    listo, si puede atender. Si salud consultara la base, un corte de la
 *    base reiniciaría el proceso en bucle sin arreglar nada.
 *
 * 3. **Cierre ordenado.** Al recibir la señal de apagado se deja de aceptar
 *    peticiones, se terminan las que están en curso y recién entonces se
 *    cierran los pools. Cortar a mitad no pierde datos —la transacción se
 *    deshace y el celular reintenta— pero produce rechazos evitables.
 */

export interface Servicios {
  readonly cerrar: () => Promise<void>;
  readonly puerto: number;
}

export async function arrancar(config: Config): Promise<Servicios> {
  // Toda marca de tiempo en UTC, como la guarda Prisma (ver db/utc.ts).
  configurarUtc();
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 20, options: OPCIONES_SESION_UTC });
  // El de acceso es pequeño: solo atiende ingresos y renovaciones.
  const poolAuth = new pg.Pool({ connectionString: config.DATABASE_URL_AUTH, max: 5, options: OPCIONES_SESION_UTC });

  const auth = new ServicioAuth(new RepositorioPg(poolAuth), { jwtSecret: config.JWT_SECRET });

  const app = construirServidor({
    pool,
    auth,
    verificarToken: (t) => auth.verificarToken(t),
    almacen: new AlmacenamientoS3({
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
      region: config.S3_REGION,
      bucket: config.S3_BUCKET,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    }),
    registro: config.NODE_ENV !== "test",
  });

  // Vive el proceso. No consulta la base a propósito.
  app.get("/salud", async () => ({ estado: "vivo" }));

  // Puede atender: se comprueban las DOS conexiones, porque con la de acceso
  // caída nadie podría ingresar aunque todo lo demás funcione.
  app.get("/listo", async (_req, reply) => {
    try {
      await Promise.all([pool.query("SELECT 1"), poolAuth.query("SELECT 1")]);
      return { estado: "listo" };
    } catch {
      return reply.status(503).send({ estado: "sin_base_de_datos" });
    }
  });

  await app.listen({ port: config.PORT, host: "0.0.0.0" });

  // El puerto REAL, no el configurado: con PORT=0 el sistema elige uno libre
  // y el registro debe decir cuál, no "0".
  const direccion = app.server.address();
  const puerto = typeof direccion === "object" && direccion ? direccion.port : config.PORT;

  let cerrando = false;
  const cerrar = async () => {
    if (cerrando) return;
    cerrando = true;
    // Fastify espera a las peticiones en curso antes de resolver.
    await app.close();
    await Promise.all([pool.end(), poolAuth.end()]);
  };

  return { cerrar, puerto };
}

/** Punto de entrada. Se separa de `arrancar` para poder probar el arranque. */
export async function principal(): Promise<void> {
  let config: Config;
  try {
    config = leerConfig();
  } catch (e) {
    if (e instanceof ErrorDeConfiguracion) {
      // Sin rastro de pila: lo que hace falta es la lista de qué corregir.
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  const servicios = await arrancar(config);
  console.warn(`TireTrack escuchando en el puerto ${servicios.puerto}`);

  for (const senal of ["SIGTERM", "SIGINT"] as const) {
    process.once(senal, () => {
      void servicios.cerrar().then(() => process.exit(0));
    });
  }
}

// Solo arranca si se ejecuta directamente, no al importarlo en una prueba.
if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  void principal();
}
