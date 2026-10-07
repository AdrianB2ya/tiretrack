import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { nuevoId } from "@tiretrack/domain";
import { hayBaseDeDatos, poolAislado } from "./base";
import { crearEsquemaCompleto, sembrar, SEMILLA, authFalso } from "./esquemas";
import { construirServidor, PREFIJO_API } from "../http/servidor";
import type { Claims } from "../acceso/servicio";
import type { Almacenamiento } from "../fotos/almacenamiento";

/**
 * Ninguna entrada mal formada produce un 500.
 *
 * Un 500 le dice al celular "el servidor falló, reintenta": un dato que
 * siempre va a fallar se reintenta para siempre, gastando datos y batería, y
 * nunca se aparta para que alguien lo vea. Y en el login, un 500 no cuenta
 * como intento fallido.
 *
 * Nació de dos defectos reales: un código de doble factor mal formado hacía
 * reventar la librería de TOTP, y la ruta de ingreso descartaba un campo del
 * contrato. Aquí se recorren TODAS las rutas con entradas malas y se
 * reúnen todos los 500 en una sola corrida, no solo el primero.
 */

const disponible = await hayBaseDeDatos();

const TOKENS: Record<string, Claims> = {
  "tok-tecnico": { sub: SEMILLA.tecnico, empresaId: SEMILLA.empresa, rol: "tecnico", clienteId: null },
  "tok-coordinador": { sub: SEMILLA.coordinador, empresaId: SEMILLA.empresa, rol: "coordinador", clienteId: null },
  "tok-admin": { sub: "11111111-1111-4111-8111-0000000000ad", empresaId: SEMILLA.empresa, rol: "administrador", clienteId: null },
};

const almacenFalso: Almacenamiento = {
  urlDeSubida: async (ruta) => ({ url: `https://subir.test/${ruta}`, expiraEn: 600 }),
  urlDeLectura: async (ruta) => ({ url: `https://leer.test/${ruta}`, expiraEn: 600 }),
  borrar: async () => undefined,
  existe: async () => true,
};

const ORDEN = "11111111-1111-4111-8111-0000000000aa";

/** Cuerpos que un cliente roto, viejo o malicioso podría mandar. */
const CUERPOS_MALOS: unknown[] = [
  null,
  [],
  "texto",
  42,
  true,
  {},
  { id: 5, nombre: 123, estado: [], motivo: {}, email: 9, password: [], codigo2fa: 123456 },
  { id: "no-es-uuid", nombre: "x".repeat(10_000), fecha: "2026-02-31", posicion: -1 },
  { nombre: { anidado: { muy: { hondo: true } } }, servicios: "CALI", sedes: null },
  { clienteId: null, sedeClienteId: 1, configuracionEjeId: [], codigo: {}, kilometraje: "mucho" },
  { profundidad: "NaN", psiEncontrada: Infinity, dot: 1234, marcaId: false, posicion: "7" },
  { tecnicoId: "", motivo: "", estado: "inventado", trazo: 5, consentimiento: [] },
];

const IDS_MALOS = ["abc", "'; DROP TABLE x; --", "x".repeat(500), "%00", "00000000-0000-0000-0000-000000000000"];

const QUERIES_MALAS = [
  "desde=basura",
  "desde=2026-13-45",
  "desde=2026-02-31T99:99:99Z",
  "desde=1&desde=2",
  "hasta=ayer&desde=mañana",
  "clienteId=abc&vehiculoId=';--",
  "inactivos=1&inactivos=2",
  "serial=" + "x".repeat(3000),
];

type Hallazgo = { ruta: string; entrada: string; status: number; cuerpo: string };

describe.skipIf(!disponible)("robustez: ninguna entrada mala da 500", () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof construirServidor>;
  const hallazgos: Hallazgo[] = [];

  async function probar(
    metodo: "GET" | "POST" | "PUT" | "PATCH",
    ruta: string,
    opciones: { cuerpo?: unknown; crudo?: string; token?: string | null; entrada: string },
  ) {
    const cabeceras: Record<string, string> = { "content-type": "application/json", "idempotency-key": nuevoId() };
    if (opciones.token !== null) cabeceras["authorization"] = `Bearer ${opciones.token ?? "tok-tecnico"}`;
    const r = await app.inject({
      method: metodo,
      url: PREFIJO_API + ruta,
      headers: cabeceras,
      ...(metodo === "GET" ? {} : { payload: opciones.crudo ?? JSON.stringify(opciones.cuerpo) }),
    });
    if (r.statusCode >= 500) {
      hallazgos.push({ ruta: `${metodo} ${ruta.slice(0, 80)}`, entrada: opciones.entrada.slice(0, 80), status: r.statusCode, cuerpo: r.body.slice(0, 120) });
    }
  }

  beforeAll(async () => {
    pool = await poolAislado(import.meta.url, 6);
    await crearEsquemaCompleto(pool);
    app = construirServidor({
      pool,
      verificarToken: (t) => TOKENS[t] ?? null,
      almacen: almacenFalso,
      auth: authFalso,
      reloj: () => new Date("2026-09-21T10:00:00Z"),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    await sembrar(pool);
    await pool.query(
      `INSERT INTO "OrdenServicio"
         (id,"empresaId","sedeId","clienteId","sedeClienteId","vehiculoId",tecnico_id,
          "configuracionEjeId",tipo,estado,fecha,"creadoPorId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'preventivo','en_proceso','2026-09-21',$7)`,
      [ORDEN, SEMILLA.empresa, SEMILLA.sede, SEMILLA.cliente, SEMILLA.sedeCliente,
       SEMILLA.vehiculo, SEMILLA.tecnico, SEMILLA.configuracion],
    );
  });

  const RUTAS_CON_CUERPO: ["POST" | "PUT" | "PATCH", string, string?][] = [
    ["POST", "/auth/ingresar", null as unknown as string],
    ["POST", "/auth/refrescar", null as unknown as string],
    ["POST", "/ordenes"],
    ["PATCH", `/ordenes/${ORDEN}`],
    ["PUT", `/ordenes/${ORDEN}/mediciones/${nuevoId()}`],
    ["POST", `/ordenes/${ORDEN}/estado`, "tok-coordinador"],
    ["POST", `/ordenes/${ORDEN}/firma`],
    ["POST", `/ordenes/${ORDEN}/reasignar`, "tok-coordinador"],
    ["POST", `/ordenes/${ORDEN}/fotos`],
    ["POST", "/flota/clientes", "tok-coordinador"],
    ["POST", "/flota/sedes", "tok-coordinador"],
    ["POST", "/flota/vehiculos", "tok-coordinador"],
    ["POST", "/catalogo/marcas"],
    ["POST", "/catalogo/disenos"],
    ["POST", `/fotos/${nuevoId()}/confirmar`],
    ["POST", "/auth/activar", null as unknown as string],
    ["POST", "/usuarios", "tok-admin"],
    ["POST", `/usuarios/${nuevoId()}/codigo`, "tok-admin"],
    ["POST", "/sedes", "tok-admin"],
    ["POST", "/configuraciones", "tok-admin"],
    ["POST", `/configuraciones/${nuevoId()}/version`, "tok-admin"],
    ["POST", "/programaciones", "tok-coordinador"],
    ["POST", `/ordenes/${ORDEN}/recomendaciones`],
    ["POST", `/recomendaciones/${nuevoId()}/resolver`],
    ["POST", `/programaciones/${nuevoId()}/tecnico`, "tok-coordinador"],
    ["POST", `/programaciones/${nuevoId()}/desactivar`, "tok-coordinador"],
  ];

  it("cuerpos mal formados en cada ruta que recibe datos", async () => {
    for (const [metodo, ruta, token] of RUTAS_CON_CUERPO) {
      for (const cuerpo of CUERPOS_MALOS) {
        await probar(metodo, ruta, { cuerpo, token: token ?? "tok-tecnico", entrada: JSON.stringify(cuerpo) });
      }
      await probar(metodo, ruta, { crudo: "{ esto no es json", token: token ?? "tok-tecnico", entrada: "json roto" });
    }
  }, 120_000);

  it("identificadores raros en la ruta", async () => {
    for (const id of IDS_MALOS) {
      const e = encodeURIComponent(id);
      await probar("PATCH", `/ordenes/${e}`, { cuerpo: { kilometraje: 1000 }, entrada: id });
      await probar("PUT", `/ordenes/${e}/mediciones/${e}`, { cuerpo: { posicion: 1 }, entrada: id });
      await probar("POST", `/ordenes/${e}/estado`, { cuerpo: { estado: "en_revision" }, entrada: id });
      await probar("POST", `/ordenes/${e}/reasignar`, { cuerpo: { tecnicoId: SEMILLA.otroTecnico, motivo: "Cambio de turno" }, token: "tok-coordinador", entrada: id });
      await probar("GET", `/ordenes/${e}/fotos`, { entrada: id });
      await probar("GET", `/flota/clientes/${e}/sedes`, { entrada: id });
      await probar("GET", `/flota/sedes/${e}/vehiculos`, { entrada: id });
      await probar("POST", `/fotos/${e}/confirmar`, { cuerpo: {}, entrada: id });
      await probar("POST", `/programaciones/${e}/desactivar`, { cuerpo: {}, token: "tok-coordinador", entrada: id });
      await probar("POST", `/catalogo/marcas/${e}/aprobar`, { cuerpo: {}, token: "tok-admin", entrada: id });
      await probar("POST", `/catalogo/disenos/${e}/unificar`, { cuerpo: { destinoId: id }, token: "tok-admin", entrada: id });
      await probar("POST", `/usuarios/${e}/desactivar`, { cuerpo: {}, token: "tok-admin", entrada: id });
      await probar("POST", `/flota/vehiculos/${e}/desactivar`, { cuerpo: {}, token: "tok-coordinador", entrada: id });
      await probar("POST", `/programaciones/${e}/tecnico`, { cuerpo: { tecnicoId: SEMILLA.tecnico }, token: "tok-coordinador", entrada: id });
    }
  }, 120_000);

  it("parámetros de consulta raros", async () => {
    for (const q of QUERIES_MALAS) {
      await probar("GET", `/sincronizacion?${q}`, { entrada: q });
      await probar("GET", `/informe/exportar?${q}`, { token: "tok-coordinador", entrada: q });
      await probar("GET", `/informe/resumen?${q}`, { token: "tok-coordinador", entrada: q });
      await probar("GET", `/informe/trazabilidad?${q}`, { token: "tok-coordinador", entrada: q });
      await probar("GET", `/flota/clientes?${q}`, { entrada: q });
      await probar("GET", `/auditoria?${q}`, { token: "tok-admin", entrada: q });
    }
  }, 120_000);

  // El mensaje lista TODOS los 500, no solo el primero: con uno no se ve el patrón.
  it("resultado: cero respuestas 500", () => {
    expect(hallazgos, `Rutas que respondieron 500:\n${hallazgos.map((h) => `${h.ruta} ← ${h.entrada}: ${h.cuerpo}`).join("\n")}`).toEqual([]);
  });
});
