import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import { TAMANO_MAXIMO_BYTES, MINUTOS_URL_LECTURA, MINUTOS_URL_SUBIDA } from "@tiretrack/domain";
import type { Almacenamiento, UrlFirmada } from "./almacenamiento";

/**
 * Almacenamiento en el disco del servidor, **solo para desarrollo**.
 *
 * Sin una cuenta de R2 las fotos no salían del celular: el almacenamiento
 * tenía valores de relleno. Con esto se prueba el flujo completo en una red
 * local, sin instalar nada más.
 *
 * Imita a R2 en lo que la app ve: el servidor entrega una **URL firmada que
 * vence**, el celular sube por `PUT` con su tipo, y una URL vencida o
 * alterada responde **403** —que el celular ya interpreta como "pide otra"—.
 * Así lo que se prueba en local es el mismo camino que en producción.
 *
 * La configuración impide usarlo en producción: el archivo pasaría por la API
 * (lo que R2 evita) y viviría en un disco que no tiene copia.
 */

export const PREFIJO_ARCHIVOS = "/archivos-locales";

type Operacion = "subir" | "leer";

export class AlmacenamientoDisco implements Almacenamiento {
  private readonly carpeta: string;

  constructor(
    private readonly opciones: {
      /** Dónde se guardan los archivos. */
      readonly carpeta: string;
      /** Como la ve el celular: http://192.168.x.x:4000, no localhost. */
      readonly urlBase: string;
      readonly secreto: string;
      readonly reloj?: () => Date;
    },
  ) {
    this.carpeta = resolve(opciones.carpeta);
  }

  private ahora(): number {
    return Math.floor((this.opciones.reloj?.() ?? new Date()).getTime() / 1000);
  }

  private firmar(op: Operacion, ruta: string, expira: number, tipo: string, max: number): string {
    return createHmac("sha256", this.opciones.secreto).update(`${op}\n${ruta}\n${expira}\n${tipo}\n${max}`).digest("hex");
  }

  private url(op: Operacion, ruta: string, minutos: number, tipo = "", max = 0): UrlFirmada {
    const expiraEn = this.ahora() + minutos * 60;
    const q = new URLSearchParams({ op, exp: String(expiraEn), tipo, max: String(max), firma: this.firmar(op, ruta, expiraEn, tipo, max) });
    const camino = ruta.split("/").map(encodeURIComponent).join("/");
    return { url: `${this.opciones.urlBase.replace(/\/$/, "")}${PREFIJO_ARCHIVOS}/${camino}?${q}`, expiraEn };
  }

  async urlDeSubida(ruta: string, tipoMime: string, tamanoBytes: number): Promise<UrlFirmada> {
    return this.url("subir", ruta, MINUTOS_URL_SUBIDA, tipoMime, tamanoBytes);
  }

  async urlDeLectura(ruta: string): Promise<UrlFirmada> {
    return this.url("leer", ruta, MINUTOS_URL_LECTURA);
  }

  async borrar(ruta: string): Promise<void> {
    const archivo = this.archivoDe(ruta);
    if (archivo) await rm(archivo, { force: true });
  }

  async existe(ruta: string): Promise<boolean> {
    const archivo = this.archivoDe(ruta);
    if (!archivo) return false;
    try {
      return (await stat(archivo)).isFile();
    } catch {
      return false;
    }
  }

  /**
   * La ruta dentro de la carpeta, o null si intenta salirse de ella
   * (`../`, rutas absolutas). La firma ya lo impide; esto es la segunda
   * cerradura, por si algún día se firmara una ruta armada con datos ajenos.
   */
  archivoDe(ruta: string): string | null {
    if (!ruta || isAbsolute(ruta) || ruta.split(/[\\/]/).includes("..")) return null;
    const archivo = resolve(join(this.carpeta, ruta));
    return archivo.startsWith(this.carpeta + sep) ? archivo : null;
  }

  /** ¿Es válida esta URL para esta operación, ahora? */
  verificar(op: Operacion, ruta: string, q: Record<string, string | undefined>): { tipo: string; max: number } | null {
    const expira = Number(q["exp"]);
    const tipo = q["tipo"] ?? "";
    const max = Number(q["max"] ?? 0);
    const firma = q["firma"] ?? "";
    if (q["op"] !== op || !Number.isInteger(expira) || expira < this.ahora()) return null;
    const esperada = this.firmar(op, ruta, expira, tipo, max);
    const a = Buffer.from(firma, "hex");
    const b = Buffer.from(esperada, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { tipo, max };
  }

  async guardar(ruta: string, bytes: Buffer): Promise<void> {
    const archivo = this.archivoDe(ruta);
    if (!archivo) throw new Error("Ruta inválida");
    await mkdir(dirname(archivo), { recursive: true });
    await writeFile(archivo, bytes);
  }

  async leer(ruta: string): Promise<Buffer | null> {
    const archivo = this.archivoDe(ruta);
    if (!archivo) return null;
    try {
      return await readFile(archivo);
    } catch {
      return null;
    }
  }
}

/**
 * Las rutas que reemplazan al bucket. Van en su propio ámbito de Fastify:
 * aceptan bytes crudos, y ese analizador no debe tocar a las rutas JSON.
 */
export async function montarArchivosLocales(app: FastifyInstance, almacen: AlmacenamientoDisco): Promise<void> {
  await app.register(async (ambito) => {
    // Un poco más que el tope de la foto: el tope lo decide la firma (max).
    ambito.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: TAMANO_MAXIMO_BYTES + 64 * 1024 }, (_req, cuerpo, listo) =>
      listo(null, cuerpo),
    );

    const rutaDe = (url: string) => decodeURIComponent(url.split("?")[0]?.slice(PREFIJO_ARCHIVOS.length + 1) ?? "");
    const prohibido = { error: { codigo: "URL_INVALIDA", mensaje: "La URL venció o no es válida" } };

    ambito.put(`${PREFIJO_ARCHIVOS}/*`, async (req, reply) => {
      const ruta = rutaDe(req.url);
      // 403, como R2 ante una URL vencida: el celular pide otra.
      const ok = almacen.verificar("subir", ruta, req.query as Record<string, string>);
      if (!ok) return reply.status(403).send(prohibido);
      const cuerpo = req.body as Buffer | undefined;
      if (!Buffer.isBuffer(cuerpo) || cuerpo.length === 0) {
        return reply.status(400).send({ error: { codigo: "SIN_ARCHIVO", mensaje: "No llegó el archivo" } });
      }
      // Lo firmado es lo que se acepta: ni otro tipo ni más bytes de los
      // declarados al pedir el permiso.
      if ((req.headers["content-type"] ?? "").split(";")[0] !== ok.tipo) {
        return reply.status(403).send({ error: { codigo: "TIPO_DISTINTO", mensaje: "El tipo no es el autorizado" } });
      }
      if (ok.max > 0 && cuerpo.length > ok.max) {
        return reply.status(413).send({ error: { codigo: "DEMASIADO_GRANDE", mensaje: "Pesa más de lo autorizado" } });
      }
      if (!almacen.archivoDe(ruta)) return reply.status(403).send(prohibido);
      await almacen.guardar(ruta, cuerpo);
      return reply.status(200).send();
    });

    ambito.get(`${PREFIJO_ARCHIVOS}/*`, async (req, reply) => {
      const ruta = rutaDe(req.url);
      if (!almacen.verificar("leer", ruta, req.query as Record<string, string>)) return reply.status(403).send(prohibido);
      const bytes = await almacen.leer(ruta);
      if (!bytes) return reply.status(404).send({ error: { codigo: "NO_EXISTE", mensaje: "No existe" } });
      const tipo = /\.png$/i.test(ruta) ? "image/png" : /\.webp$/i.test(ruta) ? "image/webp" : "image/jpeg";
      return reply.header("content-type", tipo).header("cache-control", "private, max-age=300").send(bytes);
    });
  });
}
