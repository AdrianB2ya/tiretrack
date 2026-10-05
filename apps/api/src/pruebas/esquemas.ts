import type pg from "pg";
import type { ServicioAuthHttp } from "../http/servidor";
import { ddlDePrueba } from "./generar-esquema";

/**
 * Esquema compartido para las pruebas que cruzan varios servicios: el
 * servidor HTTP y la prueba de punta a punta.
 *
 * Es más simple que el de Prisma —sin RLS ni todas las restricciones— pero
 * NUNCA más amplio: la prueba de conformidad (conformidad-esquema.test.ts)
 * exige que cada tabla y columna exista en el esquema real. Por eso vive en
 * un archivo que esa prueba también revisa.
 *
 * Conserva las restricciones que importan para lo que se prueba: el índice
 * único por posición y la llave foránea a la configuración de ejes.
 */
/**
 * Tablas que necesitan las pruebas que cruzan servicios.
 *
 * El orden importa para el DROP en cascada, no para el CREATE: no se generan
 * claves foráneas salvo las que se piden en `RESTRICCIONES`.
 */
export const TABLAS = [
  "Empresa", "Sede", "Usuario", "UsuarioSede", "Cliente", "SedeCliente",
  "ConfiguracionEje", "PosicionEje", "Vehiculo",
  "Marca", "Diseno", "DisenoMedida", "Servicio", "Consecutivo",
  "OrdenServicio", "OrdenEstadoHistorial", "LlantaRegistro", "LlantaServicio",
  "Foto", "OperacionAplicada", "Auditoria",
] as const;

/**
 * Restricciones que las pruebas necesitan de verdad.
 *
 * No se generan todas las del esquema real: lo que importa es que estén las
 * que alguna prueba verifica. El índice único de posición es el que detiene
 * la carrera entre dos celulares, y la foránea compuesta es la que impide
 * registrar una posición que el vehículo no tiene.
 */
const RESTRICCIONES: Record<string, string[]> = {
  PosicionEje: [`UNIQUE ("configuracionEjeId", numero)`],
  LlantaRegistro: [
    `UNIQUE ("ordenId", posicion)`,
    `FOREIGN KEY ("configuracionEjeId", posicion)
       REFERENCES "PosicionEje" ("configuracionEjeId", numero)`,
    `FOREIGN KEY ("ordenId") REFERENCES "OrdenServicio"(id)`,
  ],
  LlantaServicio: [
    `FOREIGN KEY ("llantaRegistroId") REFERENCES "LlantaRegistro"(id) ON DELETE CASCADE`,
  ],
  OrdenServicio: [`UNIQUE ("empresaId", folio)`, `UNIQUE ("empresaId", "clientRequestId")`],
  // El folio atómico usa ON CONFLICT sobre esta clave. Faltaba: ninguna prueba
  // HTTP había creado una orden por la ruta, así que nadie lo notó.
  Consecutivo: [`UNIQUE ("empresaId", "sedeId", tipo)`],
  Foto: [`CONSTRAINT foto_una_sola_referencia CHECK (num_nonnulls("ordenId", "llantaRegistroId") = 1)`],
};

/**
 * Crea el esquema de pruebas GENERADO desde `schema.prisma`.
 *
 * Escribirlo a mano falló tres veces seguidas: la tabla de prueba era más
 * pobre que la real, un servicio consultaba una columna que allí no estaba, y
 * el error solo aparecía cuando algo lo ejecutaba. Generándolo, si la columna
 * existe en Prisma existe en las pruebas.
 */
export async function crearEsquemaCompleto(db: pg.Client | pg.Pool): Promise<void> {
  await db.query(ddlDePrueba([...TABLAS], { extras: RESTRICCIONES }));
}

/** Datos base: una empresa, una sede, un cliente, un vehículo de 4 posiciones. */
/**
 * Identificadores UUID, como los que genera el dispositivo.
 *
 * No son decorativos: los contratos exigen UUID, así que una semilla con
 * `"u-tec2"` haría pasar pruebas que en producción se rechazarían.
 */
export const SEMILLA = {
  empresa: "11111111-1111-4111-8111-000000000001",
  sede: "11111111-1111-4111-8111-000000000002",
  cliente: "11111111-1111-4111-8111-000000000003",
  sedeCliente: "11111111-1111-4111-8111-000000000004",
  vehiculo: "11111111-1111-4111-8111-000000000005",
  configuracion: "11111111-1111-4111-8111-000000000006",
  tecnico: "11111111-1111-4111-8111-000000000007",
  otroTecnico: "11111111-1111-4111-8111-000000000008",
  coordinador: "11111111-1111-4111-8111-000000000009",
} as const;

/**
 * Datos base: una empresa, una sede, un cliente, un vehículo de 4 posiciones.
 *
 * Llena **todas** las columnas obligatorias del esquema real. Antes bastaba
 * con unas pocas porque las tablas de prueba eran más pobres; ahora el
 * esquema se genera y la semilla tiene que parecerse a la realidad.
 */
export async function sembrar(db: pg.Client | pg.Pool): Promise<void> {
  const s = SEMILLA;
  await db.query(`TRUNCATE ${TABLAS.map((t) => `"${t}"`).join(", ")} CASCADE`);

  await db.query(`INSERT INTO "Empresa" (id, nombre, nit) VALUES ($1,'Aistectire','900.111.222-3')`, [s.empresa]);
  await db.query(
    `INSERT INTO "Sede" (id,"empresaId",nombre,codigo) VALUES ($1,$2,'Fundación','FUN')`,
    [s.sede, s.empresa],
  );
  await db.query(
    `INSERT INTO "Usuario" (id,"empresaId",nombre,cedula,email,"passwordHash",rol) VALUES
       ($1,$4,'Carlos Méndez','1001','carlos@asistectire.com','x','tecnico'),
       ($2,$4,'Ana Torres','1002','ana@asistectire.com','x','tecnico'),
       ($3,$4,'Jorge Ramírez','1003','jorge@asistectire.com','x','coordinador')`,
    [s.tecnico, s.otroTecnico, s.coordinador, s.empresa],
  );
  await db.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES ($1,$3), ($2,$3)`,
    [s.tecnico, s.otroTecnico, s.sede]);
  await db.query(
    `INSERT INTO "Cliente" (id,"empresaId",nombre,nit) VALUES ($1,$2,'Transportes Reyna','800.123.456-7')`,
    [s.cliente, s.empresa],
  );
  await db.query(`INSERT INTO "SedeCliente" (id,"clienteId",nombre) VALUES ($1,$2,'Planta Fundación')`,
    [s.sedeCliente, s.cliente]);
  await db.query(
    `INSERT INTO "ConfiguracionEje" (id,"empresaId",nombre,"totalPosiciones") VALUES ($1,$2,'4 posiciones',4)`,
    [s.configuracion, s.empresa],
  );
  await db.query(
    `INSERT INTO "Vehiculo" (id,"sedeClienteId","configuracionEjeId",codigo,placa,nombre,tipo,"kmActual")
     VALUES ($1,$2,$3,'CA-12','SXK482','Tractocamión 12','tractocamion',78900)`,
    [s.vehiculo, s.sedeCliente, s.configuracion],
  );
  for (const n of [1, 2, 3, 4]) {
    await db.query(
      `INSERT INTO "PosicionEje"
         (id,"configuracionEjeId",numero,eje,lado,"tipoEje","psiObjetivo","profundidadMinima")
       VALUES ($1,$2,$3,$4,$5,$6,110,3)`,
      [`pe-${n}`, s.configuracion, n, n <= 2 ? 1 : 2,
       n % 2 === 1 ? "izquierdo" : "derecho", n <= 2 ? "direccional" : "traccion"],
    );
  }
  await db.query(
    `INSERT INTO "Marca" (id,"empresaId",nombre,"esGlobal") VALUES ('mar-1',$1,'Michelin',true)`,
    [s.empresa],
  );
  await db.query(
    `INSERT INTO "Diseno" (id,"empresaId","marcaId",nombre,"tipoEje") VALUES ('dis-1',$1,'mar-1','XDN-2','traccion')`,
    [s.empresa],
  );
  await db.query(
    `INSERT INTO "DisenoMedida" (id,"disenoId",medida,"profundidadOriginal") VALUES ('med-1','dis-1','295/80R22.5',16)`,
  );
  await db.query(
    `INSERT INTO "Servicio" (id,"empresaId",codigo,nombre) VALUES
       ('srv-cali',$1,'CALI','Calibración'), ('srv-rota',$1,'ROTA','Rotación')`,
    [s.empresa],
  );
}

/**
 * Autenticación de prueba.
 *
 * Se tipa con la interfaz REAL del servidor, así que el usuario que devuelve
 * incluye el hash de la contraseña y los intentos fallidos, igual que el
 * servicio de verdad. Es lo que permite comprobar que la ruta no los envía
 * al cliente.
 */
const USUARIO_COMPLETO = {
  id: SEMILLA.tecnico,
  empresaId: SEMILLA.empresa,
  clienteId: null,
  nombre: "Carlos Méndez",
  email: "carlos@asistectire.com",
  passwordHash: "$2b$12$hashsecretoquenodebesalir",
  rol: "tecnico",
  activo: true,
  intentosFallidos: 0,
  bloqueadoHasta: null,
  dobleFactorActivo: false,
  dobleFactorSecreto: null,
};

export const authFalso: ServicioAuthHttp = {
  login: async (e) => {
    if (e.email === "ana@dos-empresas.com" && !e.empresaId) {
      return {
        tipo: "elegir_empresa",
        empresas: [
          { id: SEMILLA.empresa, nombre: "Aistectire" },
          { id: "otra", nombre: "Otra" },
        ],
      };
    }
    if (e.password !== "correcta") {
      return {
        tipo: "error",
        veredicto: { permitido: false, codigo: "CREDENCIALES", mensaje: "Correo o contraseña incorrectos" },
      };
    }
    return {
      tipo: "ok",
      token: "tok-tecnico",
      refreshToken: "refresh-1",
      expiraEn: 900,
      usuario: { ...USUARIO_COMPLETO, email: e.email },
    };
  },
  refrescar: async (refreshToken) => {
    if (refreshToken !== "refresh-1") {
      return {
        tipo: "error",
        veredicto: { permitido: false, codigo: "SESION_INVALIDA", mensaje: "Vuelve a ingresar" },
      };
    }
    return {
      tipo: "ok",
      token: "tok-tecnico",
      refreshToken: "refresh-2",
      expiraEn: 900,
      usuario: USUARIO_COMPLETO,
    };
  },
};
