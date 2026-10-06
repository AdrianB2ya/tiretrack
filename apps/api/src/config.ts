import { z } from "zod";

/**
 * Configuración de arranque.
 *
 * Se valida TODA al arrancar, no al primer uso. Una variable mal puesta debe
 * detener el despliegue, no fallarle a un técnico a las seis de la mañana
 * cuando intenta sincronizar su primera orden.
 *
 * Y se informan **todos** los problemas juntos: descubrirlos de a uno obliga
 * a repetir el despliegue tantas veces como variables falten.
 */

/** Secretos que alguien deja puestos "mientras tanto" y nunca cambia. */
const SECRETOS_PROHIBIDOS = ["secret", "changeme", "cambiar", "test", "12345678", "password"];

/**
 * Variedad mínima de caracteres distintos.
 *
 * Comparar contra una lista de palabras prohibidas es demasiado débil:
 * "changemechangemechangemechangeme" tiene 32 caracteres y no está en la
 * lista. Contar los caracteres distintos atrapa cualquier repetición: un
 * secreto al azar de 32 caracteres ronda los 24 distintos; uno repetido,
 * menos de diez.
 */
const VARIEDAD_MINIMA = 12;

const zSecreto = z
  .string()
  .min(32, "debe tener al menos 32 caracteres")
  .refine((v) => !SECRETOS_PROHIBIDOS.some((malo) => v.toLowerCase().includes(malo)), {
    // Con el secreto se pueden falsificar tokens de CUALQUIER empresa: es la
    // llave del aislamiento entre clientes, no una contraseña más.
    message: "contiene un valor de ejemplo; usa un secreto generado al azar",
  })
  .refine((v) => new Set(v).size >= VARIEDAD_MINIMA, {
    message: "se repite demasiado; parece generado a mano y no al azar",
  });

const zUrlPostgres = z
  .string()
  .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
    message: "debe ser una URL de PostgreSQL",
  });

const esquema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // 0 es válido: le pide al sistema un puerto libre (se usa en pruebas).
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),

  /** Rol de aplicación: ve solo lo de la empresa del contexto. */
  DATABASE_URL: zUrlPostgres,
  /**
   * Rol de acceso: solo las cinco tablas de autenticación. El login necesita
   * buscar por correo sin saber la empresa (ver rls.sql).
   */
  DATABASE_URL_AUTH: zUrlPostgres,

  JWT_SECRET: zSecreto,

  /**
   * Dónde van las fotos. "r2" (Cloudflare R2, S3-compatible) en producción;
   * "disco" solo para probar en una red local sin cuenta de R2.
   */
  ALMACENAMIENTO: z.enum(["r2", "disco"]).default("r2"),
  ALMACENAMIENTO_CARPETA: z.string().min(1).default("./archivos-locales"),
  /** Cómo ve el celular al servidor (http://192.168.x.x:4000). Exigida con "disco". */
  URL_PUBLICA: z.string().url().optional(),

  // Exigidas solo con "r2": se comprueban abajo, todas juntas.
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  /**
   * Minutos entre vueltas del cierre tácito y las órdenes recurrentes. 0 los
   * apaga en esta instancia (por ejemplo, si se corren aparte). Más de un día
   * no tiene sentido: el cierre tácito se atrasaría.
   */
  TRABAJOS_CADA_MINUTOS: z.coerce.number().int().min(0).max(1440).default(15),
});

export type Config = z.infer<typeof esquema> & {
  /** Las dos conexiones deben ser roles distintos. */
  readonly rolesSeparados: boolean;
};

export class ErrorDeConfiguracion extends Error {
  constructor(public readonly problemas: string[]) {
    super(`Configuración inválida:\n${problemas.map((p) => `  · ${p}`).join("\n")}`);
    this.name = "ErrorDeConfiguracion";
  }
}

/** Acepta cualquier mapa de variables: así las pruebas no fuerzan tipos. */
export type Entorno = Record<string, string | undefined>;

/**
 * Lo que depende de qué almacenamiento se eligió. Va aparte del esquema y
 * corre SIEMPRE: los refinamientos de zod no se ejecutan si otra variable ya
 * falló, y entonces estos problemas aparecerían en un segundo despliegue.
 */
function problemasDeAlmacenamiento(e: Entorno): string[] {
  const p: string[] = [];
  const tipo = e["ALMACENAMIENTO"] ?? "r2";
  if (tipo === "r2") {
    for (const v of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
      if (!e[v]) p.push(`${v}: requerida con ALMACENAMIENTO=r2`);
    }
  } else if (tipo === "disco") {
    // El disco es para probar en local: en producción el archivo pasaría por
    // la API (lo que R2 evita) y viviría en un disco sin copia.
    if (e["NODE_ENV"] === "production") p.push('ALMACENAMIENTO: "disco" es solo para desarrollo; en producción usa "r2"');
    const url = e["URL_PUBLICA"];
    if (!url) p.push("URL_PUBLICA: requerida con ALMACENAMIENTO=disco (cómo ve el celular al servidor)");
    // Desde el teléfono, localhost es el teléfono: la foto nunca llegaría.
    else if (/localhost|127\.0\.0\.1/.test(url)) p.push("URL_PUBLICA: no puede ser localhost; usa la IP de este equipo en la red local");
  }
  return p;
}

export function leerConfig(entorno: Entorno = process.env): Config {
  const r = esquema.safeParse(entorno);
  const delAlmacenamiento = problemasDeAlmacenamiento(entorno);
  if (!r.success || delAlmacenamiento.length > 0) {
    throw new ErrorDeConfiguracion([
      ...(r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)),
      ...delAlmacenamiento,
    ]);
  }

  const problemas: string[] = [];

  // Si las dos conexiones son el mismo usuario, el rol de acceso no está
  // separando nada: un fallo en el login volvería a alcanzar toda la base.
  const usuarioDe = (url: string) => {
    try {
      return new URL(url).username;
    } catch {
      return "";
    }
  };
  const mismoUsuario = usuarioDe(r.data.DATABASE_URL) === usuarioDe(r.data.DATABASE_URL_AUTH);
  if (mismoUsuario && r.data.NODE_ENV === "production") {
    problemas.push(
      "DATABASE_URL_AUTH: usa el mismo usuario que DATABASE_URL, así que el rol de " +
        "acceso no limita nada. Debe conectarse con tiretrack_auth",
    );
  }

  if (problemas.length > 0) throw new ErrorDeConfiguracion(problemas);

  return { ...r.data, rolesSeparados: !mismoUsuario };
}
