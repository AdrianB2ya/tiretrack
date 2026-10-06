import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { AlmacenamientoDisco, montarArchivosLocales } from "../fotos/almacenamientoDisco";

/**
 * Almacenamiento en disco para probar en local. Imita a R2 en lo que la app
 * ve —URL firmada que vence, PUT con su tipo, 403 si venció— para que lo que
 * se prueba en el teléfono sea el mismo camino que en producción.
 */

let carpeta: string;
let ahora = new Date("2026-10-06T15:00:00Z");
let almacen: AlmacenamientoDisco;
let app: FastifyInstance;

const RUTA = "emp-1/ord-1/foto-1.jpg";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/** La URL firmada, como la usaría el celular contra este servidor. */
const local = (url: string) => url.replace("http://192.168.40.7:4000", "");

beforeEach(async () => {
  carpeta = await mkdtemp(join(tmpdir(), "tiretrack-fotos-"));
  ahora = new Date("2026-10-06T15:00:00Z");
  almacen = new AlmacenamientoDisco({ carpeta, urlBase: "http://192.168.40.7:4000", secreto: "secreto-de-pruebas", reloj: () => ahora });
  app = Fastify();
  await montarArchivosLocales(app, almacen);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(carpeta, { recursive: true, force: true });
});

const subir = (url: string, cuerpo = JPEG, tipo = "image/jpeg") =>
  app.inject({ method: "PUT", url: local(url), headers: { "content-type": tipo }, payload: cuerpo });

describe("almacenamiento en disco", () => {
  it("la URL apunta a la IP que ve el celular, no a localhost", async () => {
    const { url } = await almacen.urlDeSubida(RUTA, "image/jpeg", JPEG.length);
    expect(url.startsWith("http://192.168.40.7:4000/archivos-locales/emp-1/ord-1/foto-1.jpg?")).toBe(true);
  });

  it("sube, existe, se lee con su propia URL firmada y se borra", async () => {
    const { url } = await almacen.urlDeSubida(RUTA, "image/jpeg", JPEG.length);
    expect((await subir(url)).statusCode).toBe(200);
    expect(await almacen.existe(RUTA)).toBe(true);
    const lectura = await almacen.urlDeLectura(RUTA);
    const r = await app.inject({ method: "GET", url: local(lectura.url) });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("image/jpeg");
    expect(r.rawPayload.equals(JPEG)).toBe(true);
    await almacen.borrar(RUTA);
    expect(await almacen.existe(RUTA)).toBe(false);
  });

  it("una URL vencida responde 403, que el celular entiende como 'pide otra'", async () => {
    const { url } = await almacen.urlDeSubida(RUTA, "image/jpeg", JPEG.length);
    ahora = new Date(ahora.getTime() + 60 * 60_000);
    expect((await subir(url)).statusCode).toBe(403);
    expect(await almacen.existe(RUTA)).toBe(false);
  });

  it("una URL alterada no sirve: ni otra ruta, ni otro tamaño, ni la de lectura para subir", async () => {
    const { url } = await almacen.urlDeSubida(RUTA, "image/jpeg", JPEG.length);
    expect((await subir(url.replace("foto-1", "foto-2"))).statusCode).toBe(403);
    expect((await subir(url.replace(`max=${JPEG.length}`, "max=99999999"))).statusCode).toBe(403);
    const lectura = await almacen.urlDeLectura(RUTA);
    expect((await subir(lectura.url)).statusCode).toBe(403);
  });

  it("solo acepta el tipo y el tamaño que se autorizaron", async () => {
    const { url } = await almacen.urlDeSubida(RUTA, "image/jpeg", 4);
    expect((await subir(url, JPEG, "image/png")).statusCode).toBe(403);
    expect((await subir(url)).statusCode).toBe(413);
  });

  it("no se sale de su carpeta", async () => {
    expect(almacen.archivoDe("../fuera.jpg")).toBeNull();
    expect(almacen.archivoDe("emp-1/../../fuera.jpg")).toBeNull();
    expect(almacen.archivoDe("/etc/passwd")).toBeNull();
    // Aunque la firma fuera válida para esa ruta, no se escribe fuera (la
    // ruta con ".." ni siquiera llega: se normaliza y no coincide).
    const { url } = await almacen.urlDeSubida("../fuera.jpg", "image/jpeg", JPEG.length);
    expect((await subir(url)).statusCode).not.toBe(200);
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(carpeta, "..", "fuera.jpg"))).toBe(false);
  });
});
