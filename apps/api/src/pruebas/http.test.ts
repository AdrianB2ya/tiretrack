import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { nuevoId } from "@tiretrack/domain";
import { hayBaseDeDatos, poolAislado } from "./base";
import { crearEsquemaCompleto, sembrar, SEMILLA, authFalso } from "./esquemas";
import { construirServidor, enTransaccion } from "../http/servidor";
import type { Claims } from "../acceso/servicio";
import type { Almacenamiento } from "../fotos/almacenamiento";

/**
 * Servidor HTTP contra PostgreSQL real.
 *
 * Lo que se prueba son las garantías del servidor —autenticación,
 * idempotencia, transacción y traducción de códigos—, no las reglas de
 * negocio, que ya tienen sus propias pruebas.
 *
 * Los códigos importan tanto como el efecto: el celular decide con ellos si
 * reintenta, aparta el trabajo o renueva la sesión. Un malentendido aquí
 * termina en trabajo de campo apartado.
 */

const disponible = await hayBaseDeDatos();

/** Tokens de prueba: el token ES el identificador del usuario. */
const TOKENS: Record<string, Claims> = {
  "tok-tecnico": { sub: SEMILLA.tecnico, empresaId: SEMILLA.empresa, rol: "tecnico", clienteId: null },
  "tok-otro": { sub: SEMILLA.otroTecnico, empresaId: SEMILLA.empresa, rol: "tecnico", clienteId: null },
  "tok-coordinador": { sub: SEMILLA.coordinador, empresaId: SEMILLA.empresa, rol: "coordinador", clienteId: null },
  "tok-cliente": { sub: "u-cli", empresaId: SEMILLA.empresa, rol: "cliente", clienteId: SEMILLA.cliente },
  "tok-sin-empresa": { sub: "u-staff", empresaId: null, rol: "superadmin", clienteId: null },
  // El caso peligroso: rol inventado en un token cuyo usuario SÍ es el
  // técnico asignado. Si el servidor no valida el rol, el dominio no tiene
  // por qué rechazarlo.
  "tok-rol-raro": { sub: SEMILLA.tecnico, empresaId: SEMILLA.empresa, rol: "jefe_supremo", clienteId: null },
};

const almacenFalso: Almacenamiento = {
  urlDeSubida: async (ruta) => ({ url: `https://subir.test/${ruta}`, expiraEn: 600 }),
  urlDeLectura: async (ruta) => ({ url: `https://leer.test/${ruta}`, expiraEn: 600 }),
  borrar: async () => undefined,
  existe: async () => true,
};

let pool: pg.Pool;
let app: ReturnType<typeof construirServidor>;
const ORDEN = "ord-http";

function pedir(opciones: {
  metodo?: "POST" | "PUT" | "PATCH";
  ruta: string;
  token?: string | null;
  clave?: string | null;
  cuerpo?: unknown;
}) {
  const cabeceras: Record<string, string> = { "content-type": "application/json" };
  if (opciones.token !== null) cabeceras["authorization"] = `Bearer ${opciones.token ?? "tok-tecnico"}`;
  if (opciones.clave !== null) cabeceras["idempotency-key"] = opciones.clave ?? nuevoId();
  return app.inject({
    method: opciones.metodo ?? "POST",
    url: opciones.ruta,
    headers: cabeceras,
    payload: JSON.stringify(opciones.cuerpo ?? {}),
  });
}

function medicion(posicion: number, extra: Record<string, unknown> = {}) {
  return { id: nuevoId(), posicion, noIdentificada: false, servicios: [], ...extra };
}

async function guardarMedicion(m: Record<string, unknown>, opciones: Parameters<typeof pedir>[0] extends infer _ ? Partial<{ token: string; clave: string }> : never = {}) {
  return pedir({ metodo: "PUT", ruta: `/ordenes/${ORDEN}/mediciones/${m["id"] as string}`, cuerpo: m, ...opciones });
}

async function versionContenido(): Promise<number> {
  const r = await pool.query(`SELECT "versionContenido" FROM "OrdenServicio" WHERE id = $1`, [ORDEN]);
  return r.rows[0].versionContenido;
}

describe.skipIf(!disponible)("servidor HTTP", () => {
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
  }, 60_000);

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

  describe("autenticación", () => {
    it("sin token responde 401, que el celular traduce a 'renueva la sesión'", async () => {
      const r = await pedir({ metodo: "PUT", ruta: `/ordenes/${ORDEN}/mediciones/x`, token: null });
      expect(r.statusCode).toBe(401);
    });

    it("con un token inválido, también 401", async () => {
      const r = await guardarMedicion(medicion(1), { token: "inventado" });
      expect(r.statusCode).toBe(401);
    });

    it("un rol que no existe se rechaza aunque el token sea válido", async () => {
      // El rol viene del token como texto libre: se valida contra los reales.
      const r = await guardarMedicion(medicion(1), { token: "tok-rol-raro" });
      expect(r.statusCode).toBe(403);
      // El código importa: si el rechazo viniera de otra regla, esta prueba
      // pasaría sin que el servidor validara nada.
      expect(r.json().error.codigo).toBe("ROL_DESCONOCIDO");
      const f = await pool.query(`SELECT count(*)::int AS n FROM "LlantaRegistro"`);
      expect(f.rows[0].n).toBe(0);
    });

    it("un token sin empresa no opera sobre datos de campo", async () => {
      const r = await guardarMedicion(medicion(1), { token: "tok-sin-empresa" });
      expect(r.statusCode).toBe(403);
      expect(r.json().error.codigo).toBe("SIN_EMPRESA");
    });

    it("sin clave de idempotencia responde 400", async () => {
      // Sin ella no hay forma de distinguir un reintento de algo nuevo.
      const r = await pedir({ metodo: "PUT", ruta: `/ordenes/${ORDEN}/mediciones/x`, clave: null });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.codigo).toBe("SIN_CLAVE");
    });
  });

  describe("acceso", () => {
    const ingresar = (cuerpo: unknown) =>
      app.inject({ method: "POST", url: "/auth/ingresar", headers: { "content-type": "application/json" }, payload: JSON.stringify(cuerpo) });

    it("entrega los tokens con credenciales correctas", async () => {
      const r = await ingresar({ email: "carlos@aistectire.com", password: "correcta" });
      expect(r.statusCode).toBe(200);
      expect(r.json().token).toBeTruthy();
      expect(r.json().refreshToken).toBeTruthy();
    });

    it("NO envía el hash de la contraseña", async () => {
      // El servicio devuelve el usuario completo. Enviarlo entero expondría
      // el hash a todo cliente, y quedaría en registros y cachés.
      const r = await ingresar({ email: "carlos@aistectire.com", password: "correcta" });
      expect(r.body).not.toContain("hashsecreto");
      expect(r.json().usuario.passwordHash).toBeUndefined();
      expect(r.json().usuario.intentosFallidos).toBeUndefined();
    });

    it("envía lo que la app necesita para saber quién entró", async () => {
      const u = (await ingresar({ email: "carlos@aistectire.com", password: "correcta" })).json().usuario;
      expect(u).toEqual({
        id: SEMILLA.tecnico, nombre: "Carlos Méndez", email: "carlos@aistectire.com",
        rol: "tecnico", empresaId: SEMILLA.empresa, clienteId: null,
      });
    });

    it("con credenciales incorrectas responde 401 sin decir qué falló", async () => {
      const r = await ingresar({ email: "carlos@aistectire.com", password: "mala" });
      expect(r.statusCode).toBe(401);
      expect(r.body).not.toMatch(/existe|contraseña incorrecta para/i);
    });

    it("sin correo o contraseña responde 422", async () => {
      expect((await ingresar({ email: "x@y.com" })).statusCode).toBe(422);
    });

    it("si el correo está en dos empresas, pide elegir", async () => {
      const r = await ingresar({ email: "ana@dos-empresas.com", password: "correcta" });
      expect(r.statusCode).toBe(409);
      expect(r.json().error.codigo).toBe("ELEGIR_EMPRESA");
      expect(r.json().empresas).toHaveLength(2);
    });

    it("con la empresa elegida, entra", async () => {
      const r = await ingresar({ email: "ana@dos-empresas.com", password: "correcta", empresaId: SEMILLA.empresa });
      expect(r.statusCode).toBe(200);
    });

    it("renueva la sesión y rota el token de renovación", async () => {
      const r = await app.inject({
        method: "POST", url: "/auth/refrescar",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ refreshToken: "refresh-1" }),
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().refreshToken).toBe("refresh-2");
    });

    it("un token de renovación inválido responde 401", async () => {
      const r = await app.inject({
        method: "POST", url: "/auth/refrescar",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ refreshToken: "robado" }),
      });
      expect(r.statusCode).toBe(401);
    });

    it("ingresar no exige clave de idempotencia", async () => {
      // No es una operación de la cola: repetirlo devuelve una sesión nueva.
      const r = await ingresar({ email: "carlos@aistectire.com", password: "correcta" });
      expect(r.statusCode).not.toBe(400);
    });
  });

  describe("idempotencia", () => {
    it("aplica una medición", async () => {
      const r = await guardarMedicion(medicion(1, { profundidad: 9 }));
      expect(r.statusCode).toBe(200);
      expect(await versionContenido()).toBe(1);
    });

    it("la misma clave otra vez responde YA_APLICADA sin repetir el efecto", async () => {
      // Es el caso real: la operación llegó, la respuesta se perdió.
      const m = medicion(1, { profundidad: 9 });
      const clave = nuevoId();
      await guardarMedicion(m, { clave });
      const repetida = await guardarMedicion(m, { clave });

      expect(repetida.statusCode).toBe(409);
      expect(repetida.json().error.codigo).toBe("YA_APLICADA");
      // Lo que importa: NO subió dos veces. Si lo hiciera, la firma del
      // cliente quedaría invalidada por un reintento.
      expect(await versionContenido()).toBe(1);
    });

    it("devuelve la respuesta original al repetirse", async () => {
      const m = medicion(1);
      const clave = nuevoId();
      const primera = await guardarMedicion(m, { clave });
      const repetida = await guardarMedicion(m, { clave });
      expect(repetida.json().versionContenido).toBe(primera.json().versionContenido);
    });

    it("dos claves distintas son dos operaciones", async () => {
      // Guardar la misma posición dos veces es una corrección legítima.
      const m = medicion(1, { profundidad: 9 });
      await guardarMedicion(m, { clave: nuevoId() });
      const segunda = await guardarMedicion({ ...m, profundidad: 8 }, { clave: nuevoId() });
      expect(segunda.statusCode).toBe(200);
      expect(await versionContenido()).toBe(2);
    });

    it("dos envíos simultáneos con la misma clave: uno aplica, el otro no", async () => {
      const m = medicion(2);
      const clave = nuevoId();
      const [a, b] = await Promise.all([
        guardarMedicion(m, { clave }),
        guardarMedicion(m, { clave }),
      ]);
      const codigos = [a.statusCode, b.statusCode].sort();
      expect(codigos).toEqual([200, 409]);
      expect(await versionContenido()).toBe(1);
    });

    it("un rechazo NO consume la clave: tras corregir la causa se aplica", async () => {
      // Si la consumiera, corregir el problema no serviría de nada: el
      // reintento respondería 'ya aplicada' sin haber aplicado nunca.
      const clave = nuevoId();
      const invalida = await guardarMedicion(medicion(9), { clave });
      expect(invalida.statusCode).toBe(422);

      const buena = await guardarMedicion(medicion(1), { clave });
      expect(buena.statusCode).toBe(200);
    });

    it("un rechazo deshace todo: no queda rastro en la base", async () => {
      await guardarMedicion(medicion(1, { servicios: ["NOEXISTE"] }));
      const f = await pool.query(`SELECT count(*)::int AS n FROM "LlantaRegistro"`);
      expect(f.rows[0].n).toBe(0);
      expect(await versionContenido()).toBe(0);
    });
  });

  describe("traducción de códigos", () => {
    it("datos que no cumplen el contrato: 422", async () => {
      const r = await guardarMedicion(medicion(1, { marcaId: null }));
      expect(r.statusCode).toBe(422);
      expect(r.json().error.codigo).toBe("DATOS_INVALIDOS");
    });

    it("un cuerpo que no es JSON: 422, no 400 ni 500", async () => {
      const r = await app.inject({
        method: "PUT",
        url: `/ordenes/${ORDEN}/mediciones/x`,
        headers: { "content-type": "application/json", authorization: "Bearer tok-tecnico", "idempotency-key": nuevoId() },
        payload: "{roto",
      });
      expect(r.statusCode).toBe(422);
    });

    it("orden inexistente: 404", async () => {
      const m = medicion(1);
      const r = await pedir({ metodo: "PUT", ruta: `/ordenes/no-existe/mediciones/${m.id}`, cuerpo: m });
      expect(r.statusCode).toBe(404);
    });

    it("técnico no asignado: 403", async () => {
      const r = await guardarMedicion(medicion(1), { token: "tok-otro" });
      expect(r.statusCode).toBe(403);
    });

    it("el portal del cliente es de solo lectura: 403", async () => {
      const r = await guardarMedicion(medicion(1), { token: "tok-cliente" });
      expect(r.statusCode).toBe(403);
    });

    it("posición ocupada por otro dispositivo: 409", async () => {
      await guardarMedicion(medicion(1));
      const r = await guardarMedicion(medicion(1));
      expect(r.statusCode).toBe(409);
      expect(r.json().error.codigo).toBe("POSICION_OCUPADA");
    });

    it("la orden avanzó mientras el técnico estaba sin señal: 409", async () => {
      await pool.query(`UPDATE "OrdenServicio" SET estado = 'en_revision' WHERE id = $1`, [ORDEN]);
      const r = await guardarMedicion(medicion(1));
      expect(r.statusCode).toBe(409);
    });

    it("el id de la ruta y el del cuerpo deben coincidir", async () => {
      const m = medicion(1);
      const r = await pedir({ metodo: "PUT", ruta: `/ordenes/${ORDEN}/mediciones/${nuevoId()}`, cuerpo: m });
      expect(r.statusCode).toBe(422);
    });
  });

  describe("rutas de la orden", () => {
    it("firma con la versión del contenido que se firmó", async () => {
      await guardarMedicion(medicion(1));
      const r = await pedir({
        ruta: `/ordenes/${ORDEN}/firma`,
        cuerpo: {
          nombre: "Luis Reyna", cedula: "77221004",
          trazo: "[[[0,0],[10,5]]]", consentimiento: "2026-09-v1",
          versionContenido: await versionContenido(),
        },
      });
      expect(r.statusCode).toBe(200);
      const f = await pool.query(`SELECT "firmaConsentimiento" FROM "OrdenServicio" WHERE id = $1`, [ORDEN]);
      expect(f.rows[0].firmaConsentimiento).toBe("2026-09-v1");
    });

    it("una firma con otro contenido se rechaza con 409", async () => {
      const r = await pedir({
        ruta: `/ordenes/${ORDEN}/firma`,
        cuerpo: {
          nombre: "Luis Reyna", cedula: "77221004", trazo: "[[[0,0],[1,1]]]",
          consentimiento: "2026-09-v1", versionContenido: 99,
        },
      });
      expect(r.statusCode).toBe(409);
      expect(r.json().error.codigo).toBe("FIRMA_DESACTUALIZADA");
    });

    it("sin firma vigente, enviar a revisión se rechaza", async () => {
      // La regla la aplica la máquina de estados, no una versión.
      const r = await pedir({ ruta: `/ordenes/${ORDEN}/estado`, cuerpo: { estado: "en_revision" } });
      expect(r.statusCode).toBe(422);
      expect(r.json().error.codigo).toBe("SIN_FIRMA");
    });

    it("cambia el estado sin enviar versión: es un comando", async () => {
      // Enviar a revisión exige firma vigente: es la regla del negocio, y
      // el comando se valida contra ella, no contra una versión.
      await guardarMedicion(medicion(1));
      await pedir({
        ruta: `/ordenes/${ORDEN}/firma`,
        cuerpo: {
          nombre: "Luis Reyna", cedula: "77221004", trazo: "[[[0,0],[1,1]]]",
          consentimiento: "2026-09-v1", versionContenido: await versionContenido(),
        },
      });
      const r = await pedir({ ruta: `/ordenes/${ORDEN}/estado`, cuerpo: { estado: "en_revision" } });
      expect(r.statusCode).toBe(200);
      expect(r.json().estado).toBe("en_revision");
    });

    it("actualiza kilometraje y hallazgos", async () => {
      const r = await pedir({ metodo: "PATCH", ruta: `/ordenes/${ORDEN}`, cuerpo: { kilometraje: 78900 } });
      expect(r.statusCode).toBe(200);
      const f = await pool.query(`SELECT kilometraje FROM "OrdenServicio" WHERE id = $1`, [ORDEN]);
      expect(f.rows[0].kilometraje).toBe(78900);
    });

    it("adjunta una foto y devuelve la URL para subirla", async () => {
      const r = await pedir({
        ruta: `/ordenes/${ORDEN}/fotos`,
        cuerpo: { id: nuevoId(), nombre: "p1.jpg", tipoMime: "image/jpeg", tamanoBytes: 200_000 },
      });
      expect(r.statusCode).toBe(201);
      expect(r.json().url).toContain("https://subir.test/");
      // Adjuntar cuenta en el contenido; confirmar los bytes no.
      expect(await versionContenido()).toBe(1);
    });

    it("reasigna la orden", async () => {
      const r = await pedir({
        ruta: `/ordenes/${ORDEN}/reasignar`,
        token: "tok-coordinador",
        cuerpo: { tecnicoId: SEMILLA.otroTecnico, motivo: "Cambio de turno" },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().tecnicoId).toBe(SEMILLA.otroTecnico);
    });
  });

  describe("flota e informe", () => {
    // Estos servicios existían desde la fase 1 sin puerta de entrada: la
    // administración y la exportación eran inalcanzables.
    const traer = (ruta: string, token = "tok-coordinador") =>
      app.inject({ method: "GET", url: ruta, headers: { authorization: `Bearer ${token}` } });

    it("lista los clientes", async () => {
      const r = await traer("/flota/clientes");
      expect(r.statusCode).toBe(200);
      expect(r.json()[0].nombre).toBe("Transportes Reyna");
    });

    it("lista las sedes de un cliente y sus vehículos", async () => {
      const sedes = await traer(`/flota/clientes/${SEMILLA.cliente}/sedes`);
      expect(sedes.json()).toHaveLength(1);
      const vehiculos = await traer(`/flota/sedes/${SEMILLA.sedeCliente}/vehiculos`);
      expect(vehiculos.json()[0].codigo).toBe("CA-12");
    });

    it("una consulta no exige clave de idempotencia", async () => {
      // Leer dos veces no cambia nada: pedirla sería ceremonia sin motivo.
      const r = await traer("/flota/clientes");
      expect(r.statusCode).not.toBe(400);
    });

    it("sin sesión no se consulta la flota", async () => {
      const r = await app.inject({ method: "GET", url: "/flota/clientes" });
      expect(r.statusCode).toBe(401);
    });

    it("el técnico no crea vehículos", async () => {
      const r = await pedir({
        ruta: "/flota/vehiculos",
        cuerpo: {
          sedeClienteId: SEMILLA.sedeCliente, configuracionEjeId: SEMILLA.configuracion,
          codigo: "CA-99", nombre: "Nuevo", tipo: "tractocamion",
        },
      });
      expect(r.statusCode).toBe(403);
    });

    it("el coordinador crea un vehículo", async () => {
      const r = await pedir({
        ruta: "/flota/vehiculos",
        token: "tok-coordinador",
        cuerpo: {
          sedeClienteId: SEMILLA.sedeCliente, configuracionEjeId: SEMILLA.configuracion,
          codigo: "CA-99", nombre: "Volqueta 9", tipo: "volqueta",
        },
      });
      expect(r.statusCode).toBe(201);
    });

    /** El informe necesita al menos una medición para tener filas. */
    async function conUnaMedicion() {
      await guardarMedicion(medicion(1, { profundidad: 9, serial: "MX1" }));
    }

    it("sin registros lo dice, en vez de entregar un archivo vacío", async () => {
      // Un archivo con solo encabezados parece que la exportación falló.
      const r = await traer("/informe/exportar");
      expect(r.statusCode).toBe(422);
      expect(r.json().error.codigo).toBe("SIN_REGISTROS");
    });

    it("exporta el informe como archivo, no como JSON", async () => {
      // Lo que el coordinador hace con esto es abrirlo en una hoja de cálculo.
      await conUnaMedicion();
      const r = await traer("/informe/exportar");
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toContain("text/csv");
      expect(r.headers["content-disposition"]).toContain("attachment");
    });

    it("avisa cuántas órdenes van sin cerrar, fuera de los datos", async () => {
      // Un aviso entre las filas ensuciaría la hoja de cálculo.
      await conUnaMedicion();
      const r = await traer("/informe/exportar");
      expect(r.headers["x-ordenes-sin-cerrar"]).toBeDefined();
    });
  });

  describe("contexto de la transacción", () => {
    it("la empresa del token queda disponible para RLS", async () => {
      // El aislamiento lo aplica PostgreSQL con este valor: si no se pusiera,
      // las políticas no filtrarían nada.
      const leido = await enTransaccion(
        pool,
        { empresaId: "emp-x", rol: "tecnico", usuarioId: "u-1", clienteId: null, vistaCliente: false },
        async (db) => {
          const r = await db.query<{ e: string; u: string; rol: string }>(
            `SELECT current_setting('app.empresa_id') AS e,
                    current_setting('app.usuario_id') AS u,
                    current_setting('app.rol') AS rol`,
          );
          return { confirmar: false, valor: r.rows[0] };
        },
      );
      expect(leido).toEqual({ e: "emp-x", u: "u-1", rol: "tecnico" });
    });

    it("el contexto NO sobrevive a la transacción", async () => {
      // Las conexiones se reutilizan: un SET normal filtraría la empresa de
      // una petición a la siguiente.
      const ctx = { empresaId: "emp-y", rol: "tecnico" as const, usuarioId: "u-1", clienteId: null, vistaCliente: false };
      await enTransaccion(pool, ctx, async () => ({ confirmar: true, valor: null }));

      const db = await pool.connect();
      try {
        const r = await db.query<{ e: string }>(`SELECT current_setting('app.empresa_id', true) AS e`);
        expect(r.rows[0]?.e ?? "").not.toBe("emp-y");
      } finally {
        db.release();
      }
    });
  });
});
