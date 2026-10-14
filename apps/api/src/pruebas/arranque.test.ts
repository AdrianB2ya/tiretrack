import { CorreoResend } from "../correo/correo";
import { describe, it, expect, afterEach } from "vitest";
import { leerConfig, ErrorDeConfiguracion } from "../config";
import { arrancar } from "../server";
import { URL_PRUEBAS, hayBaseDeDatos } from "./base";

/**
 * Configuración y arranque.
 *
 * La configuración se valida entera al arrancar: una variable mal puesta debe
 * detener el despliegue, no fallarle a un técnico a las seis de la mañana.
 */

const disponible = await hayBaseDeDatos();

const SECRETO = "K7x9mQ2pR4vT8wY1zA3bC5dE6fG0hJ2k";

const BASE = {
  DATABASE_URL: "postgresql://tiretrack_app:clave@localhost:5432/tiretrack",
  DATABASE_URL_AUTH: "postgresql://tiretrack_auth:clave@localhost:5432/tiretrack",
  JWT_SECRET: SECRETO,
  S3_BUCKET: "fotos",
  S3_ACCESS_KEY_ID: "llave",
  S3_SECRET_ACCESS_KEY: "secreta",
};

function problemasDe(entorno: Record<string, string | undefined>): string[] {
  try {
    leerConfig(entorno);
    return [];
  } catch (e) {
    if (e instanceof ErrorDeConfiguracion) return e.problemas;
    throw e;
  }
}

describe("configuración", () => {
  it("acepta una configuración completa", () => {
    expect(problemasDe(BASE)).toEqual([]);
  });

  it("informa TODOS los problemas juntos, no de a uno", () => {
    // Descubrirlos uno por uno obliga a repetir el despliegue tantas veces
    // como variables falten.
    const p = problemasDe({ JWT_SECRET: SECRETO });
    expect(p.length).toBeGreaterThanOrEqual(4);
    expect(p.join(" ")).toContain("DATABASE_URL");
    expect(p.join(" ")).toContain("S3_BUCKET");
  });

  describe("correo (R13)", () => {
    it("sin configurar no pide nada: queda desactivado", () => {
      expect(problemasDe(BASE)).toEqual([]);
    });

    it("con resend exige la llave y el remitente, junto con lo demás", () => {
      expect(problemasDe({ ...BASE, CORREO: "resend" })).toEqual([
        "RESEND_API_KEY: requerida con CORREO=resend",
        'CORREO_REMITENTE: requerida con CORREO=resend (ej. "Asistectire <avisos@dominio.co>")',
      ]);
      expect(problemasDe({ ...BASE, CORREO: "resend", RESEND_API_KEY: "re_x", CORREO_REMITENTE: "Asistectire" })).toEqual([
        "CORREO_REMITENTE: no contiene un correo válido",
      ]);
      expect(
        problemasDe({ ...BASE, CORREO: "resend", RESEND_API_KEY: "re_x", CORREO_REMITENTE: "Asistectire <avisos@asistectire.co>" }),
      ).toEqual([]);
    });

    it("el transporte de Resend manda el adjunto en base64 y traduce el rechazo", async () => {
      const llamadas: { url: string; cuerpo: Record<string, unknown>; auth: string }[] = [];
      let status = 200;
      const http = async (url: string, init: { headers: Record<string, string>; body: string }) => {
        llamadas.push({ url, cuerpo: JSON.parse(init.body), auth: init.headers["authorization"] ?? "" });
        return { ok: status < 300, status, text: async () => "" };
      };
      const c = new CorreoResend("re_llave", "Asistectire <avisos@asistectire.co>", http);
      const ok = await c.enviar({ para: ["a@b.co"], asunto: "A", texto: "T", adjuntos: [{ nombre: "x.csv", contenido: Buffer.from("hola"), tipo: "text/csv" }] });
      expect(ok).toEqual({ ok: true });
      expect(llamadas[0]).toMatchObject({
        url: "https://api.resend.com/emails",
        auth: "Bearer re_llave",
        cuerpo: { from: "Asistectire <avisos@asistectire.co>", to: ["a@b.co"], attachments: [{ filename: "x.csv", content: "aG9sYQ==" }] },
      });
      status = 403;
      expect(await c.enviar({ para: ["a@b.co"], asunto: "A", texto: "T" })).toEqual({ ok: false, mensaje: "El proveedor de correo rechazó el envío (403)" });
    });
  });

  describe("almacenamiento de fotos", () => {
    const disco = { DATABASE_URL: BASE.DATABASE_URL, DATABASE_URL_AUTH: BASE.DATABASE_URL_AUTH, JWT_SECRET: SECRETO, ALMACENAMIENTO: "disco" };

    it("en disco no pide las llaves de R2, pero sí cómo ve el celular al servidor", () => {
      expect(problemasDe({ ...disco, URL_PUBLICA: "http://192.168.40.7:4000" })).toEqual([]);
      expect(problemasDe(disco).join(" ")).toContain("URL_PUBLICA");
    });

    it("con localhost se rechaza: desde el teléfono, localhost es el teléfono", () => {
      expect(problemasDe({ ...disco, URL_PUBLICA: "http://localhost:4000" }).join(" ")).toMatch(/localhost/);
    });

    it("en producción el disco se rechaza", () => {
      const p = problemasDe({ ...disco, URL_PUBLICA: "http://192.168.40.7:4000", NODE_ENV: "production" });
      expect(p.join(" ")).toMatch(/solo para desarrollo/);
    });

    it("sus problemas salen junto con los demás, aunque otra variable falle", () => {
      // Los refinamientos de zod no corren si el esquema ya falló: estos
      // aparecerían recién en un segundo despliegue.
      const p = problemasDe({ ALMACENAMIENTO: "disco", NODE_ENV: "production" });
      expect(p.join(" ")).toContain("DATABASE_URL");
      expect(p.join(" ")).toMatch(/solo para desarrollo/);
    });
  });

  it("rechaza un secreto corto", () => {
    // Con el secreto se falsifican tokens de cualquier empresa: es la llave
    // del aislamiento entre clientes.
    expect(problemasDe({ ...BASE, JWT_SECRET: "corto" })[0]).toContain("32 caracteres");
  });

  it("rechaza los secretos de ejemplo que alguien deja puestos", () => {
    // Repetir una palabra hasta llegar a 32 caracteres no la hace un
    // secreto: la comparación exacta dejaba pasar "changemechangeme...".
    for (const malo of ["changeme", "CHANGEME", "password", "12345678", "clave-secreta"]) {
      const p = problemasDe({ ...BASE, JWT_SECRET: malo.repeat(8).slice(0, 40) });
      expect(p.length, malo).toBeGreaterThan(0);
    }
  });

  it("rechaza un secreto repetitivo aunque no use palabras conocidas", () => {
      // "abababab..." tiene 32 caracteres y solo dos distintos.
      expect(problemasDe({ ...BASE, JWT_SECRET: "ab".repeat(20) })).not.toEqual([]);
  });

  it("acepta un secreto al azar de verdad", () => {
    expect(problemasDe({ ...BASE, JWT_SECRET: "K7x9mQ2pR4vT8wY1zA3bC5dE6fG0hJ2k" })).toEqual([]);
  });

  it("rechaza lo que no es una URL de PostgreSQL", () => {
    expect(problemasDe({ ...BASE, DATABASE_URL: "mysql://x" })[0]).toContain("PostgreSQL");
  });

  it("el puerto tiene un valor por defecto razonable", () => {
    expect(leerConfig(BASE).PORT).toBe(4000);
  });

  it("un puerto inválido no pasa", () => {
    expect(problemasDe({ ...BASE, PORT: "99999" })).not.toEqual([]);
  });

  it("la región de S3 por defecto sirve para R2", () => {
    expect(leerConfig(BASE).S3_REGION).toBe("auto");
  });

  describe("separación de roles de base de datos", () => {
    const mismoUsuario = {
      ...BASE,
      DATABASE_URL_AUTH: "postgresql://tiretrack_app:clave@localhost:5432/tiretrack",
    };

    it("en producción, usar el mismo usuario para ambas conexiones es un error", () => {
      // Si son el mismo, el rol de acceso no limita nada y un fallo en el
      // login vuelve a alcanzar toda la base.
      const p = problemasDe({ ...mismoUsuario, NODE_ENV: "production" });
      expect(p[0]).toContain("tiretrack_auth");
    });

    it("fuera de producción se permite, pero se deja constancia", () => {
      // En una máquina de desarrollo no siempre hay dos roles creados.
      const c = leerConfig({ ...mismoUsuario, NODE_ENV: "development" });
      expect(c.rolesSeparados).toBe(false);
    });

    it("con roles distintos queda marcado como separado", () => {
      expect(leerConfig(BASE).rolesSeparados).toBe(true);
    });
  });
});

describe.skipIf(!disponible)("arranque del servidor", () => {
  let cerrar: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await cerrar?.();
    cerrar = null;
  });

  async function levantar(extra: Record<string, string> = {}) {
    const config = leerConfig({
      ...BASE,
      DATABASE_URL: URL_PRUEBAS,
      DATABASE_URL_AUTH: URL_PRUEBAS,
      NODE_ENV: "test",
      // Puerto 0: el sistema operativo elige uno libre.
      PORT: "0",
      ...extra,
    });

    const s = await arrancar(config);
    cerrar = s.cerrar;
    return s;
  }

  it("levanta y responde que está vivo", async () => {
    const s = await levantar();
    const r = await fetch(`http://127.0.0.1:${s.puerto}/salud`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { estado: string }).estado).toBe("vivo");
  });

  it("informa el puerto que el sistema asignó, no el configurado", async () => {
    // Con PORT=0 el sistema elige uno libre; decir "0" en el registro deja a
    // quien despliega sin saber dónde quedó escuchando.
    const s = await levantar();
    expect(s.puerto).toBeGreaterThan(0);
  });

  it("responde que está listo cuando la base contesta", async () => {
    const s = await levantar();
    const r = await fetch(`http://127.0.0.1:${s.puerto}/listo`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { estado: string }).estado).toBe("listo");
  });

  describe("con la base de datos caída", () => {
    /** Apunta a un puerto donde no hay nada escuchando. */
    const BASE_CAIDA = "postgresql://nadie:nada@127.0.0.1:5499/tiretrack";

    it("sigue diciendo que está VIVO", async () => {
      // Si la salud dependiera de la base, un corte reiniciaría el proceso
      // en bucle sin arreglar nada.
      const s = await levantar({ DATABASE_URL: BASE_CAIDA, DATABASE_URL_AUTH: BASE_CAIDA });
      const r = await fetch(`http://127.0.0.1:${s.puerto}/salud`);
      expect(r.status).toBe(200);
    });

    it("pero dice que NO está listo", async () => {
      // Es lo que hace que el orquestador deje de enviarle peticiones sin
      // matar el proceso.
      const s = await levantar({ DATABASE_URL: BASE_CAIDA, DATABASE_URL_AUTH: BASE_CAIDA });
      const r = await fetch(`http://127.0.0.1:${s.puerto}/listo`);
      expect(r.status).toBe(503);
    });

    it("con la conexión de acceso caída tampoco está listo", async () => {
      // Sin ella nadie puede ingresar, aunque todo lo demás funcione.
      const s = await levantar({ DATABASE_URL_AUTH: BASE_CAIDA });
      const r = await fetch(`http://127.0.0.1:${s.puerto}/listo`);
      expect(r.status).toBe(503);
    });

    it("arrancar no falla aunque la base no responda", async () => {
      // El servidor debe levantar y reportarse no-listo; si muriera al
      // arrancar, un reinicio de la base dejaría la API caída para siempre.
      await expect(
        levantar({ DATABASE_URL: BASE_CAIDA, DATABASE_URL_AUTH: BASE_CAIDA }),
      ).resolves.toBeTruthy();
    });
  });

  it("cerrar dos veces no falla", async () => {
    const s = await levantar();
    await s.cerrar();
    await expect(s.cerrar()).resolves.toBeUndefined();
    cerrar = null;
  });

  it("después de cerrar, ya no atiende", async () => {
    const s = await levantar();
    const puerto = s.puerto;
    await s.cerrar();
    cerrar = null;
    await expect(fetch(`http://127.0.0.1:${puerto}/salud`)).rejects.toThrow();
  });
});
