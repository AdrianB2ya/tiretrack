import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { nuevoId } from "@tiretrack/domain";
import { zRespuestaLogin } from "@tiretrack/contracts";
import { hayBaseDeDatos, poolAislado } from "./base";
import { crearEsquemaCompleto, sembrar, SEMILLA, authFalso, CODIGO_FALSO, sesionesRevocadas } from "./esquemas";
import { construirServidor, enTransaccion, PREFIJO_API } from "../http/servidor";
import { ServicioDocumento } from "../informe/documento";
import type { Claims } from "../acceso/servicio";
import type { Almacenamiento } from "../fotos/almacenamiento";
import { CorreoMemoria } from "../correo/correo";

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
  "tok-admin": { sub: "11111111-1111-4111-8111-0000000000ad", empresaId: SEMILLA.empresa, rol: "administrador", clienteId: null },
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
// UUID, como lo genera el dispositivo: un id inventado no pasaría un contrato real.
const ORDEN = "11111111-1111-4111-8111-0000000000bb";

/** Correo en memoria (R13): se ve qué salió sin enviar nada. */
const correo = new CorreoMemoria();

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
    url: PREFIJO_API + opciones.ruta,
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
      correo,
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

  describe("prefijo de la API", () => {
    it("las rutas viven bajo /api/v1, que es lo que usa la app instalada", async () => {
      // La app (eas.json, _layout.tsx) llama a .../api/v1 y el servidor
      // publicaba sin prefijo: todo el tráfico de un APK habría dado 404, y
      // el celular aparta como rechazado lo que recibe 404.
      expect(PREFIJO_API).toBe("/api/v1");
      const con = await app.inject({ method: "GET", url: `${PREFIJO_API}/flota/clientes` });
      const sin = await app.inject({ method: "GET", url: "/flota/clientes" });
      expect(con.statusCode).toBe(401); // existe: pide sesión
      expect(sin.statusCode).toBe(404);
    });
  });

  describe("programación recurrente (4.4)", () => {
    const enviar = (metodo: "GET" | "POST", ruta: string, token: string, cuerpo?: unknown) =>
      app.inject({
        method: metodo,
        url: PREFIJO_API + ruta,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        ...(cuerpo === undefined ? {} : { payload: JSON.stringify(cuerpo) }),
      });
    // El reloj del servidor de pruebas marca el lunes 21 de septiembre.
    const nueva = (extra: Record<string, unknown> = {}) => ({
      id: nuevoId(), sedeId: SEMILLA.sede, clienteId: SEMILLA.cliente, sedeClienteId: SEMILLA.sedeCliente,
      vehiculoId: SEMILLA.vehiculo, tecnicoId: SEMILLA.tecnico, tipo: "preventivo",
      frecuencia: "mensual", cada: 1, inicio: "2026-09-26", ...extra,
    });

    beforeEach(async () => {
      // El coordinador trabaja en la sede: solo programa en las suyas.
      await pool.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES ($1,$2)`, [SEMILLA.coordinador, SEMILLA.sede]);
    });

    it("se puede programar un levantamiento recurrente (R4)", async () => {
      const r = await enviar("POST", "/programaciones", "tok-coordinador", nueva({ tipo: "levantamiento" }));
      expect(r.statusCode).toBe(201);
    });

    it("el coordinador programa; la primera visita pasa del sábado al lunes; queda a su nombre", async () => {
      const p = nueva();
      const r = await enviar("POST", "/programaciones", "tok-coordinador", p);
      expect(r.statusCode).toBe(201);
      expect(r.json().proxima).toBe("2026-09-28");
      const fila = await pool.query(`SELECT "creadoPorId", "tecnicoId" FROM "ProgramacionRecurrente" WHERE id = $1`, [p.id]);
      // El autor sale de la sesión, nunca del cuerpo.
      expect(fila.rows[0]).toEqual({ creadoPorId: SEMILLA.coordinador, tecnicoId: SEMILLA.tecnico });
      const lista = await enviar("GET", "/programaciones", "tok-coordinador");
      expect(lista.json()).toEqual([
        expect.objectContaining({ id: p.id, descripcion: "Cada mes", vehiculoCodigo: "CA-12", tecnicoNombre: "Carlos Méndez" }),
      ]);
    });

    it("el técnico no programa", async () => {
      expect((await enviar("POST", "/programaciones", "tok-tecnico", nueva())).statusCode).toBe(403);
      expect((await enviar("GET", "/programaciones", "tok-tecnico")).statusCode).toBe(403);
    });

    it("no se programa en una sede ajena, ni se ve lo de otras sedes", async () => {
      await pool.query(`DELETE FROM "UsuarioSede" WHERE "usuarioId" = $1`, [SEMILLA.coordinador]);
      const r = await enviar("POST", "/programaciones", "tok-coordinador", nueva());
      expect(r.statusCode).toBe(403);
      expect(r.json().error.codigo).toBe("SEDE_AJENA");
    });

    it("no programa a un técnico de otra sede ni a un coordinador", async () => {
      const r = await enviar("POST", "/programaciones", "tok-coordinador", nueva({ tecnicoId: SEMILLA.coordinador }));
      expect(r.statusCode).toBe(409);
      expect(r.json().error.codigo).toBe("TECNICO_NO_DISPONIBLE");
    });

    it("no programa hacia atrás", async () => {
      const r = await enviar("POST", "/programaciones", "tok-coordinador", nueva({ inicio: "2026-09-20" }));
      expect(r.json().error.codigo).toBe("INICIO_PASADO");
    });

    it("una segunda programación igual para el mismo vehículo se rechaza", async () => {
      await enviar("POST", "/programaciones", "tok-coordinador", nueva());
      const r = await enviar("POST", "/programaciones", "tok-coordinador", nueva());
      expect(r.statusCode).toBe(409);
      expect(r.json().error.codigo).toBe("PROGRAMACION_DUPLICADA");
    });

    it("un vehículo que no es de esa sede del cliente se rechaza", async () => {
      const r = await enviar("POST", "/programaciones", "tok-coordinador", nueva({ vehiculoId: nuevoId() }));
      expect(r.json().error.codigo).toBe("VEHICULO_NO_CORRESPONDE");
    });

    it("pausar la deja en la lista, sin generar; y cambiar el técnico limpia el aviso", async () => {
      const p = nueva();
      await enviar("POST", "/programaciones", "tok-coordinador", p);
      await pool.query(`UPDATE "ProgramacionRecurrente" SET "ultimoAviso" = 'técnico inactivo'`);
      const cambio = await enviar("POST", `/programaciones/${p.id}/tecnico`, "tok-coordinador", { tecnicoId: SEMILLA.otroTecnico });
      expect(cambio.statusCode).toBe(200);
      expect((await enviar("GET", "/programaciones", "tok-coordinador")).json()[0]).toMatchObject({
        tecnicoId: SEMILLA.otroTecnico, ultimoAviso: null,
      });
      expect((await enviar("POST", `/programaciones/${p.id}/desactivar`, "tok-coordinador", {})).statusCode).toBe(200);
      expect((await enviar("GET", "/programaciones", "tok-coordinador")).json()[0].activa).toBe(false);
      // Pausar dos veces: ya no hay nada activo que pausar.
      expect((await enviar("POST", `/programaciones/${p.id}/desactivar`, "tok-coordinador", {})).statusCode).toBe(404);
    });

    it("deja constancia en la auditoría", async () => {
      await enviar("POST", "/programaciones", "tok-coordinador", nueva());
      const a = await pool.query(`SELECT accion::text AS accion, detalle FROM "Auditoria"`);
      expect(a.rows[0]).toMatchObject({ accion: "crear", detalle: expect.objectContaining({ entidad: "programacion" }) });
    });
  });

  describe("usuarios y activación (5.2)", () => {
    const enviar = (metodo: "GET" | "POST", ruta: string, token: string | null, cuerpo?: unknown) =>
      app.inject({
        method: metodo,
        url: PREFIJO_API + ruta,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(cuerpo === undefined ? {} : { payload: JSON.stringify(cuerpo) }),
      });
    const nuevo = (extra: Record<string, unknown> = {}) => ({
      id: nuevoId(), nombre: "Pedro Ruiz", cedula: "1082999111", email: "pedro@asistectire.com",
      rol: "tecnico", sedes: [SEMILLA.sede], ...extra,
    });

    it("el administrador crea un usuario y recibe el código UNA vez", async () => {
      const r = await enviar("POST", "/usuarios", "tok-admin", nuevo());
      expect(r.statusCode).toBe(201);
      expect(r.json().codigo).toBe(CODIGO_FALSO);
      // El código no queda en la tabla de idempotencia: esta ruta no la usa.
      const guardadas = await pool.query(`SELECT count(*)::int AS n FROM "OperacionAplicada" WHERE respuesta::text LIKE $1`, [`%${CODIGO_FALSO}%`]);
      expect(guardadas.rows[0].n).toBe(0);
    });

    it("un usuario cliente se crea con su cliente y sin sedes de la empresa", async () => {
      const u = nuevo({ rol: "cliente", sedes: [], clienteId: SEMILLA.cliente, email: "luis@reyna.com" });
      const r = await enviar("POST", "/usuarios", "tok-admin", u);
      expect(r.statusCode).toBe(201);
      const s = await pool.query(`SELECT count(*)::int AS n FROM "UsuarioSede" WHERE "usuarioId" = $1`, [u.id]);
      expect(s.rows[0].n).toBe(0);
      const c = await pool.query(`SELECT "clienteId" FROM "Usuario" WHERE id = $1`, [u.id]);
      expect(c.rows[0].clienteId).toBe(SEMILLA.cliente);
    });

    it("el usuario nace con sus sedes y sin contraseña utilizable", async () => {
      const u = nuevo();
      await enviar("POST", "/usuarios", "tok-admin", u);
      const s = await pool.query(`SELECT "sedeId", "esPrincipal" FROM "UsuarioSede" WHERE "usuarioId" = $1`, [u.id]);
      expect(s.rows).toEqual([{ sedeId: SEMILLA.sede, esPrincipal: true }]);
    });

    it("el coordinador no da de alta usuarios", async () => {
      expect((await enviar("POST", "/usuarios", "tok-coordinador", nuevo())).statusCode).toBe(403);
    });

    it("un correo repetido en la empresa responde 409, no 500", async () => {
      await enviar("POST", "/usuarios", "tok-admin", nuevo());
      const r = await enviar("POST", "/usuarios", "tok-admin", nuevo());
      expect(r.statusCode).toBe(409);
      expect(r.json().error.codigo).toBe("CORREO_DUPLICADO");
    });

    it("el listado nunca incluye el hash ni el secreto", async () => {
      await enviar("POST", "/usuarios", "tok-admin", nuevo());
      const r = await enviar("GET", "/usuarios", "tok-admin");
      expect(r.statusCode).toBe(200);
      expect(r.body).not.toMatch(/passwordHash|dobleFactorSecreto|$2[aby]$/);
      expect(r.json().find((x: { email: string }) => x.email === "pedro@asistectire.com")?.sinActivar).toBe(true);
    });

    it("un código nuevo para un usuario de la empresa; de otra, 404", async () => {
      const u = nuevo();
      await enviar("POST", "/usuarios", "tok-admin", u);
      expect((await enviar("POST", `/usuarios/${u.id}/codigo`, "tok-admin", {})).statusCode).toBe(200);
      expect((await enviar("POST", `/usuarios/${nuevoId()}/codigo`, "tok-admin", {})).statusCode).toBe(404);
    });

    it("activar: correcto, con doble factor pendiente, y código inválido", async () => {
      const base = { email: "pedro@asistectire.com", codigo: "k7m2 x9qp", password: "CampoFundacion26" };
      expect((await enviar("POST", "/auth/activar", null, base)).json()).toEqual({ activada: true });
      const admin = await enviar("POST", "/auth/activar", null, { ...base, email: "admin@asistectire.com" });
      expect(admin.statusCode).toBe(200);
      expect(admin.json().configurar2fa.uri).toMatch(/^otpauth:/);
      expect((await enviar("POST", "/auth/activar", null, { ...base, codigo: "AAAA-AAAA" })).statusCode).toBe(401);
      // Contraseña corta: la frena el contrato antes de gastar el código.
      expect((await enviar("POST", "/auth/activar", null, { ...base, password: "corta" })).statusCode).toBe(422);
    });

    const plantilla = (extra: Record<string, unknown> = {}) => ({
      id: nuevoId(),
      nombre: "Camión sencillo",
      ejes: [
        { numero: 1, tipoEje: "direccional", psiObjetivo: 110, profundidadMinima: 3, posicionesIzquierda: [1], posicionesDerecha: [2] },
        { numero: 2, tipoEje: "traccion", psiObjetivo: 105, profundidadMinima: 2.5, posicionesIzquierda: [3, 4], posicionesDerecha: [5, 6] },
      ],
      ...extra,
    });

    it("plantillas: el administrador crea una; el coordinador no", async () => {
      const p = plantilla();
      expect((await enviar("POST", "/configuraciones", "tok-admin", p)).statusCode).toBe(201);
      const pos = await pool.query(`SELECT count(*)::int AS n FROM "PosicionEje" WHERE "configuracionEjeId" = $1`, [p.id]);
      expect(pos.rows[0].n).toBe(6);
      expect((await enviar("POST", "/configuraciones", "tok-coordinador", plantilla({ nombre: "Otra" }))).statusCode).toBe(403);
    });

    it("plantillas: un nombre repetido pide versión nueva, no se duplica", async () => {
      await enviar("POST", "/configuraciones", "tok-admin", plantilla());
      const r = await enviar("POST", "/configuraciones", "tok-admin", plantilla());
      expect(r.statusCode).toBe(409);
      expect(r.json().error.codigo).toBe("NOMBRE_EN_USO");
    });

    it("plantillas: posiciones con huecos o repetidas se rechazan", async () => {
      const mala = plantilla({ ejes: [{ numero: 1, tipoEje: "direccional", posicionesIzquierda: [1], posicionesDerecha: [3] }] });
      expect((await enviar("POST", "/configuraciones", "tok-admin", mala)).statusCode).toBe(422);
    });

    it("versión nueva: si cambia vehículos en uso, pide confirmar y después los mueve", async () => {
      // La plantilla de la semilla tiene un vehículo que la usa.
      const ejes = plantilla().ejes;
      const sin = await enviar("POST", `/configuraciones/${SEMILLA.configuracion}/version`, "tok-admin", { ejes });
      expect(sin.statusCode).toBe(409);
      expect(sin.json().error.codigo).toBe("REQUIERE_CONFIRMACION");
      const con = await enviar("POST", `/configuraciones/${SEMILLA.configuracion}/version`, "tok-admin", { ejes, confirmado: true });
      expect(con.statusCode).toBe(201);
      expect(con.json().vehiculosMovidos).toBe(1);
      // Inmutable: la anterior sigue existiendo, ya no vigente.
      const vieja = await pool.query(`SELECT vigente FROM "ConfiguracionEje" WHERE id = $1`, [SEMILLA.configuracion]);
      expect(vieja.rows[0].vigente).toBe(false);
    });

    it("sedes: el administrador crea una, con código único", async () => {
      const sede = { id: nuevoId(), nombre: "Sede Ciénaga", codigo: "cng" };
      const r = await enviar("POST", "/sedes", "tok-admin", sede);
      expect(r.statusCode).toBe(201);
      const fila = await pool.query(`SELECT codigo FROM "Sede" WHERE id = $1`, [sede.id]);
      expect(fila.rows[0].codigo).toBe("CNG");
      const repetida = await enviar("POST", "/sedes", "tok-admin", { ...sede, id: nuevoId() });
      expect(repetida.statusCode).toBe(409);
    });
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
      app.inject({ method: "POST", url: `${PREFIJO_API}/auth/ingresar`, headers: { "content-type": "application/json" }, payload: JSON.stringify(cuerpo) });

    it("entrega los tokens con credenciales correctas", async () => {
      const r = await ingresar({ email: "carlos@asistectire.com", password: "correcta" });
      expect(r.statusCode).toBe(200);
      expect(r.json().token).toBeTruthy();
      expect(r.json().refreshToken).toBeTruthy();
    });

    it("NO envía el hash de la contraseña", async () => {
      // El servicio devuelve el usuario completo. Enviarlo entero expondría
      // el hash a todo cliente, y quedaría en registros y cachés.
      const r = await ingresar({ email: "carlos@asistectire.com", password: "correcta" });
      expect(r.body).not.toContain("hashsecreto");
      expect(r.json().usuario.passwordHash).toBeUndefined();
      expect(r.json().usuario.intentosFallidos).toBeUndefined();
    });

    it("envía lo que la app necesita para saber quién entró", async () => {
      const u = (await ingresar({ email: "carlos@asistectire.com", password: "correcta" })).json().usuario;
      expect(u).toEqual({
        id: SEMILLA.tecnico, nombre: "Carlos Méndez", email: "carlos@asistectire.com",
        rol: "tecnico", empresaId: SEMILLA.empresa, clienteId: null,
        sedes: [SEMILLA.sede], sedePrincipal: null,
      });
    });

    it("la respuesta cumple el contrato de ingreso, sedes incluidas", async () => {
      // El contrato exigía sedes y sedePrincipal y el login no los enviaba:
      // la app guardaba undefined y "¿pertenece a esta sede?" daba siempre no.
      const r = await ingresar({ email: "carlos@asistectire.com", password: "correcta" });
      const p = zRespuestaLogin.safeParse(r.json());
      expect(p.success ? [] : p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
    });

    it("con credenciales incorrectas responde 401 sin decir qué falló", async () => {
      const r = await ingresar({ email: "carlos@asistectire.com", password: "mala" });
      expect(r.statusCode).toBe(401);
      expect(r.body).not.toMatch(/existe|contraseña incorrecta para/i);
    });

    it("sin correo o contraseña responde 422", async () => {
      expect((await ingresar({ email: "x@y.com" })).statusCode).toBe(422);
    });

    it("pasa al servicio TODO lo que el contrato de ingreso admite", async () => {
      // La ruta arma la entrada campo por campo. Se le olvidó codigo2fa: el
      // administrador y el superadmin —para quienes el doble factor es
      // obligatorio— recibían REQUIERE_2FA para siempre, con código válido.
      const recibido: Record<string, unknown>[] = [];
      const espia = construirServidor({
        pool, almacen: almacenFalso,
        auth: { ...authFalso, login: async (e) => { recibido.push({ ...e }); return authFalso.login(e); } },
        verificarToken: () => null,
      });
      await espia.inject({
        method: "POST", url: `${PREFIJO_API}/auth/ingresar`, headers: { "content-type": "application/json" },
        payload: JSON.stringify({ email: "marcela@asistectire.com", password: "correcta", empresaId: SEMILLA.empresa, codigo2fa: "123456" }),
      });
      await espia.close();
      expect(recibido[0]).toMatchObject({
        email: "marcela@asistectire.com", password: "correcta", empresaId: SEMILLA.empresa, codigo2fa: "123456",
      });
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
        method: "POST", url: `${PREFIJO_API}/auth/refrescar`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ refreshToken: "refresh-1" }),
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().refreshToken).toBe("refresh-2");
    });

    it("un token de renovación inválido responde 401", async () => {
      const r = await app.inject({
        method: "POST", url: `${PREFIJO_API}/auth/refrescar`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ refreshToken: "robado" }),
      });
      expect(r.statusCode).toBe(401);
    });

    it("ingresar no exige clave de idempotencia", async () => {
      // No es una operación de la cola: repetirlo devuelve una sesión nueva.
      const r = await ingresar({ email: "carlos@asistectire.com", password: "correcta" });
      expect(r.statusCode).not.toBe(400);
    });
  });

  describe("alertas de llantas", () => {
    const alertas = (token: string) =>
      app.inject({ method: "GET", url: `${PREFIJO_API}/alertas`, headers: { authorization: `Bearer ${token}` } });

    it("la oficina ve las llantas para cambiar de sus sedes, con el vehículo y el cliente", async () => {
      await guardarMedicion(medicion(1, { serial: "MX1", profundidad: 2, dot: "0819" }));
      await pool.query(`UPDATE "OrdenServicio" SET estado = 'cerrada' WHERE id = $1`, [ORDEN]);
      await pool.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES ($1,$2)`, [SEMILLA.coordinador, SEMILLA.sede]);
      const r = await alertas("tok-coordinador");
      expect(r.statusCode).toBe(200);
      const tipos = r.json().map((a: { tipo: string }) => a.tipo).sort();
      // Vencida y gastada son dos motivos distintos para sacarla.
      expect(tipos).toEqual(["dot_vencido", "profundidad_baja"]);
      expect(r.json()[0]).toMatchObject({ posicion: 1, vehiculoCodigo: "CA-12", clienteNombre: "Transportes Reyna" });
    });

    it("de una sede ajena no ve nada, y el técnico no las consulta", async () => {
      await guardarMedicion(medicion(1, { serial: "MX1", profundidad: 2 }));
      await pool.query(`UPDATE "OrdenServicio" SET estado = 'cerrada' WHERE id = $1`, [ORDEN]);
      expect((await alertas("tok-coordinador")).json()).toEqual([]);
      expect((await alertas("tok-tecnico")).statusCode).toBe(403);
    });
  });

  describe("límites de cambio de la empresa (R2)", () => {
    const leer = (token: string) =>
      app.inject({ method: "GET", url: `${PREFIJO_API}/empresa/limites`, headers: { authorization: `Bearer ${token}` } });
    const fijar = (token: string, cuerpo: unknown) =>
      app.inject({
        method: "POST", url: `${PREFIJO_API}/empresa/limites`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: JSON.stringify(cuerpo),
      });

    it("todos los de la empresa los leen; por defecto 3 y 5 mm", async () => {
      const r = await leer("tok-tecnico");
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ cambioInmediato: 3, programarCambio: 5 });
    });

    it("solo el administrador los cambia, y queda en la auditoría con el antes y el después", async () => {
      expect((await fijar("tok-coordinador", { cambioInmediato: 4, programarCambio: 6 })).statusCode).toBe(403);
      const r = await fijar("tok-admin", { cambioInmediato: 4, programarCambio: 6 });
      expect(r.statusCode).toBe(200);
      expect((await leer("tok-tecnico")).json()).toEqual({ cambioInmediato: 4, programarCambio: 6 });
      const aud = await pool.query(`SELECT detalle FROM "Auditoria" WHERE detalle->>'entidad' = 'limites_empresa'`);
      expect(aud.rows[0]?.detalle).toMatchObject({ antes: { cambioInmediato: 3 }, despues: { cambioInmediato: 4 } });
    });

    it("rechaza límites incoherentes", async () => {
      expect((await fijar("tok-admin", { cambioInmediato: 5, programarCambio: 4 })).statusCode).toBe(422);
      expect((await fijar("tok-admin", { cambioInmediato: 0, programarCambio: 4 })).statusCode).toBe(422);
    });

    it("las alertas usan los límites de la empresa cuando el eje no tiene mínimo", async () => {
      await pool.query(`UPDATE "PosicionEje" SET "profundidadMinima" = NULL`);
      await guardarMedicion(medicion(1, { serial: "MX1", profundidad: 5.5 }));
      await pool.query(`UPDATE "OrdenServicio" SET estado = 'cerrada' WHERE id = $1`, [ORDEN]);
      await pool.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES ($1,$2)`, [SEMILLA.coordinador, SEMILLA.sede]);
      const ver = async () =>
        (await app.inject({ method: "GET", url: `${PREFIJO_API}/alertas`, headers: { authorization: "Bearer tok-coordinador" } }))
          .json().map((a: { tipo: string }) => a.tipo);
      expect(await ver()).toEqual([]);
      await fijar("tok-admin", { cambioInmediato: 4, programarCambio: 6 });
      expect(await ver()).toEqual(["programar_cambio"]);
    });
  });

  describe("auditoría (5.4)", () => {
    const ver = (consulta: string, token = "tok-admin") =>
      app.inject({ method: "GET", url: `${PREFIJO_API}/auditoria${consulta}`, headers: { authorization: `Bearer ${token}` } });
    const registrar = (creadoEn: string, accion = "exportar_informe", usuarioId: string | null = SEMILLA.coordinador) =>
      pool.query(
        `INSERT INTO "Auditoria" (id,"empresaId","usuarioId",rol,accion,detalle,"creadoEn") VALUES ($1,$2,$3,'coordinador',$4::"AccionAuditoria",'{}',$5)`,
        [nuevoId(), SEMILLA.empresa, usuarioId, accion, creadoEn],
      );

    it("solo el administrador la consulta", async () => {
      expect((await ver("", "tok-coordinador")).statusCode).toBe(403);
      expect((await ver("", "tok-tecnico")).statusCode).toBe(403);
    });

    it("el día es el de Colombia: lo de las 9 p. m. cuenta para ese día, no para el siguiente", async () => {
      await registrar("2026-10-06T23:30:00Z"); // 6:30 p. m. del 6
      await registrar("2026-10-07T02:00:00Z"); // 9:00 p. m. del 6
      await registrar("2026-10-07T06:00:00Z"); // 1:00 a. m. del 7
      const r6 = await ver("?desde=2026-10-06&hasta=2026-10-06");
      if (r6.statusCode !== 200) throw new Error(r6.body);
      const del6 = r6.json();
      expect(del6.registros).toHaveLength(2);
      expect((await ver("?desde=2026-10-07&hasta=2026-10-07")).json().registros).toHaveLength(1);
    });

    it("dice quién fue con su nombre, y lo automático es de nadie (Sistema)", async () => {
      await registrar("2026-10-06T15:00:00Z");
      await registrar("2026-10-06T16:00:00Z", "cambiar_estado", null);
      const r = (await ver("")).json().registros;
      expect(r[0]).toMatchObject({ accion: "cambiar_estado", usuarioNombre: null });
      expect(r[1]).toMatchObject({ usuarioNombre: "Jorge Ramírez" });
    });

    it("pagina por instante: 55 registros salen en 50 y 5", async () => {
      for (let i = 0; i < 55; i++) await registrar(new Date(Date.UTC(2026, 9, 6, 12, i)).toISOString());
      const primera = (await ver("")).json();
      expect(primera.registros).toHaveLength(50);
      const segunda = (await ver(`?antes=${encodeURIComponent(primera.siguiente)}`)).json();
      expect(segunda.registros).toHaveLength(5);
      expect(segunda.siguiente).toBeNull();
    });

    it("filtra por acción, y una acción inventada es un dato inválido, no un 500", async () => {
      await registrar("2026-10-06T15:00:00Z", "exportar_informe");
      await registrar("2026-10-06T15:01:00Z", "deshabilitar");
      expect((await ver("?accion=deshabilitar")).json().registros).toHaveLength(1);
      expect((await ver("?accion=borrar_todo")).statusCode).toBe(422);
    });
  });

  describe("deshabilitar (nada se borra)", () => {
    const desactivar = (ruta: string, token = "tok-admin") => pedir({ ruta, token, clave: null });

    it("un usuario sin trabajo abierto se desactiva, sus sesiones se revocan y queda en la auditoría", async () => {
      sesionesRevocadas.length = 0;
      const r = await desactivar(`/usuarios/${SEMILLA.otroTecnico}/desactivar`);
      expect(r.statusCode).toBe(200);
      expect((await pool.query(`SELECT activo FROM "Usuario" WHERE id = $1`, [SEMILLA.otroTecnico])).rows[0].activo).toBe(false);
      expect(sesionesRevocadas).toEqual([SEMILLA.otroTecnico]);
      const a = await pool.query(`SELECT accion, detalle FROM "Auditoria" ORDER BY "creadoEn" DESC LIMIT 1`);
      expect(a.rows[0]).toMatchObject({ accion: "deshabilitar", detalle: { usuarioId: SEMILLA.otroTecnico } });

      expect((await desactivar(`/usuarios/${SEMILLA.otroTecnico}/reactivar`)).statusCode).toBe(200);
      expect((await pool.query(`SELECT activo FROM "Usuario" WHERE id = $1`, [SEMILLA.otroTecnico])).rows[0].activo).toBe(true);
    });

    it("con órdenes abiertas no: primero se reasigna; y las sesiones no se tocan", async () => {
      sesionesRevocadas.length = 0;
      const r = await desactivar(`/usuarios/${SEMILLA.tecnico}/desactivar`);
      expect(r.statusCode).toBe(409);
      expect(r.json().error.codigo).toBe("TIENE_ORDENES_ABIERTAS");
      expect(sesionesRevocadas).toEqual([]);
    });

    it("solo el administrador desactiva usuarios", async () => {
      expect((await desactivar(`/usuarios/${SEMILLA.otroTecnico}/desactivar`, "tok-coordinador")).statusCode).toBe(403);
    });

    it("con una orden abierta no se deshabilita ni el vehículo ni su cliente", async () => {
      expect((await desactivar(`/flota/vehiculos/${SEMILLA.vehiculo}/desactivar`, "tok-coordinador")).json().error.codigo).toBe("TIENE_ORDENES_ABIERTAS");
      expect((await desactivar(`/flota/clientes/${SEMILLA.cliente}/desactivar`, "tok-coordinador")).json().error.codigo).toBe("TIENE_ORDENES_ABIERTAS");
    });

    it("de abajo hacia arriba sí: vehículo → sede → cliente", async () => {
      await pool.query(`UPDATE "OrdenServicio" SET estado = 'cerrada' WHERE id = $1`, [ORDEN]);
      // Con sus sedes activas, el cliente todavía no.
      expect((await desactivar(`/flota/clientes/${SEMILLA.cliente}/desactivar`, "tok-coordinador")).json().error.codigo).toBe("TIENE_HIJOS_ACTIVOS");
      expect((await desactivar(`/flota/vehiculos/${SEMILLA.vehiculo}/desactivar`, "tok-coordinador")).statusCode).toBe(200);
      expect((await desactivar(`/flota/sedes/${SEMILLA.sedeCliente}/desactivar`, "tok-coordinador")).statusCode).toBe(200);
      expect((await desactivar(`/flota/clientes/${SEMILLA.cliente}/desactivar`, "tok-coordinador")).statusCode).toBe(200);
      // El técnico opera, no gestiona.
      expect((await desactivar(`/flota/clientes/${SEMILLA.cliente}/desactivar`, "tok-tecnico")).statusCode).toBe(403);
    });
  });

  describe("códigos QR de los vehículos (R15)", () => {
    const qr = (q: string, token = "tok-coordinador") =>
      app.inject({ method: "GET", url: `${PREFIJO_API}/flota/qr${q}`, headers: { authorization: `Bearer ${token}` } });

    it("la oficina baja las etiquetas en PDF y queda en la auditoría", async () => {
      const r = await qr(`?clienteId=${SEMILLA.cliente}`);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.headers["content-type"]).toBe("application/pdf");
      expect(r.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
      const a = await pool.query(`SELECT accion::text AS accion, detalle FROM "Auditoria" ORDER BY "creadoEn" DESC LIMIT 1`);
      expect(a.rows[0]).toMatchObject({ accion: "exportar_listado", detalle: { origen: "qr_vehiculos", vehiculos: 1 } });
    });

    it("el técnico no las imprime; sin vehículos lo dice; un filtro mal formado es 422", async () => {
      expect((await qr("", "tok-tecnico")).statusCode).toBe(403);
      expect((await qr(`?vehiculoId=${nuevoId()}`)).statusCode).toBe(404);
      expect((await qr("?clienteId=x")).statusCode).toBe(422);
    });
  });

  describe("cotización (R14)", () => {
    const ver = (q: string, token = "tok-coordinador") =>
      app.inject({ method: "GET", url: `${PREFIJO_API}/cotizacion${q}`, headers: { authorization: `Bearer ${token}` } });

    it("lista lo que hay que cambiar por medida y urgencia, con el montaje, y sin precios", async () => {
      await guardarMedicion(medicion(1, { serial: "MX1", profundidad: 2 }));
      await guardarMedicion(medicion(2, { serial: "MX2", profundidad: 4.5 }));
      const r = await ver(`?clienteId=${SEMILLA.cliente}`);
      expect(r.statusCode, r.body).toBe(200);
      const c = r.json();
      expect(c.totalLlantas).toBe(2);
      expect(c.llantas.map((l: { urgencia: string; cantidad: number }) => [l.urgencia, l.cantidad])).toEqual([["inmediato", 1], ["programar", 1]]);
      expect(c.servicios[0]).toMatchObject({ concepto: "Montaje", cantidad: 2 });
      expect(c.cliente.nombre).toBeTruthy();
      expect(c.nota).toContain("Valores por definir");
    });

    it("el PDF queda en la auditoría; el técnico no cotiza", async () => {
      await guardarMedicion(medicion(1, { serial: "MX1", profundidad: 2 }));
      const r = await app.inject({ method: "GET", url: `${PREFIJO_API}/cotizacion/pdf`, headers: { authorization: "Bearer tok-coordinador" } });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
      const a = await pool.query(`SELECT detalle FROM "Auditoria" ORDER BY "creadoEn" DESC LIMIT 1`);
      expect(a.rows[0].detalle).toMatchObject({ origen: "pdf_cotizacion", llantas: 1 });
      expect((await ver("", "tok-tecnico")).statusCode).toBe(403);
    });

    it("sin nada que cotizar lo dice, y un filtro mal formado es 422", async () => {
      await guardarMedicion(medicion(1, { serial: "MX1", profundidad: 12 }));
      const r = await app.inject({ method: "GET", url: `${PREFIJO_API}/cotizacion/pdf`, headers: { authorization: "Bearer tok-coordinador" } });
      expect(r.statusCode).toBe(404);
      expect((await ver("?clienteId=no-es-id")).statusCode).toBe(422);
    });

    it("se envía por correo con el PDF adjunto", async () => {
      correo.enviados.length = 0;
      await guardarMedicion(medicion(1, { serial: "MX1", profundidad: 2 }));
      const r = await pedir({ ruta: `/cotizacion/enviar?clienteId=${SEMILLA.cliente}`, token: "tok-coordinador", clave: null, cuerpo: { para: "compras@reyna.co" } });
      expect(r.statusCode, r.body).toBe(200);
      expect(correo.enviados[0]!.asunto).toMatch(/^Cotización · /);
      expect(correo.enviados[0]!.adjuntos?.[0]?.nombre).toMatch(/^cotizacion-.*\.pdf$/);
    });
  });

  describe("envío por correo (R13)", () => {
    const enviar = (ruta: string, cuerpo: unknown, token = "tok-coordinador") =>
      pedir({ ruta, token, clave: null, cuerpo });
    const auditoria = async () => (await pool.query(`SELECT detalle FROM "Auditoria" ORDER BY "creadoEn" DESC LIMIT 1`)).rows[0]?.detalle;

    beforeEach(() => {
      correo.enviados.length = 0;
      correo.fallar = false;
    });

    it("envía el PDF de la orden adjunto y deja los destinatarios en la auditoría", async () => {
      await guardarMedicion(medicion(1, { serial: "MX1", profundidad: 9 }));
      const r = await enviar(`/ordenes/${ORDEN}/pdf/enviar`, { para: "Jefe@Flota.co; jefe@flota.co, otro@flota.co", mensaje: "Buen día" });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().enviadoA).toEqual(["jefe@flota.co", "otro@flota.co"]);
      const m = correo.enviados[0]!;
      expect(m.para).toEqual(["jefe@flota.co", "otro@flota.co"]);
      expect(m.texto.startsWith("Buen día")).toBe(true);
      expect(m.adjuntos?.[0]?.tipo).toBe("application/pdf");
      expect(m.adjuntos?.[0]?.contenido.subarray(0, 5).toString()).toBe("%PDF-");
      expect(await auditoria()).toMatchObject({ origen: "correo_orden", enviadoA: ["jefe@flota.co", "otro@flota.co"] });
    });

    it("el informe sale en CSV o en PDF", async () => {
      await guardarMedicion(medicion(1, { serial: "MX1", profundidad: 9 }));
      const csv = await enviar(`/informe/enviar?ordenIds=${ORDEN}`, { para: ["a@flota.co"], formato: "csv" });
      expect(csv.statusCode, csv.body).toBe(200);
      expect(correo.enviados[0]!.adjuntos?.[0]?.tipo).toBe("text/csv");
      expect(correo.enviados[0]!.texto).toContain("no están cerradas");
      const pdf = await enviar(`/informe/enviar?ordenIds=${ORDEN}`, { para: ["a@flota.co"], formato: "pdf" });
      expect(pdf.statusCode, pdf.body).toBe(200);
      expect(correo.enviados[1]!.adjuntos?.[0]?.tipo).toBe("application/pdf");
    });

    it("si el proveedor falla no queda nada en la auditoría: no salió nada", async () => {
      correo.fallar = true;
      const antes = (await pool.query(`SELECT count(*)::int AS n FROM "Auditoria"`)).rows[0].n;
      const r = await enviar(`/ordenes/${ORDEN}/pdf/enviar`, { para: "a@flota.co" });
      expect(r.statusCode).toBe(422);
      expect(r.json().error.codigo).toBe("CORREO_NO_ENVIADO");
      expect((await pool.query(`SELECT count(*)::int AS n FROM "Auditoria"`)).rows[0].n).toBe(antes);
    });

    it("destinatarios mal escritos se dicen, sin enviar", async () => {
      const r = await enviar(`/ordenes/${ORDEN}/pdf/enviar`, { para: "a@flota.co, mal@" });
      expect(r.statusCode).toBe(422);
      expect(r.json().error.mensaje).toBe("No son correos válidos: mal@");
      expect(correo.enviados).toEqual([]);
    });

    it("las llantas para cambiar van en el cuerpo, sin adjunto; el técnico no las envía", async () => {
      // Solo sus sedes: el coordinador de la semilla no estaba en ninguna.
      await pool.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES ($1,$2) ON CONFLICT DO NOTHING`, [SEMILLA.coordinador, SEMILLA.sede]);
      await guardarMedicion(medicion(1, { serial: "MX1", profundidad: 2 }));
      await pool.query(`UPDATE "OrdenServicio" SET estado = 'cerrada' WHERE id = $1`, [ORDEN]);
      const r = await enviar("/alertas/enviar", { para: "jefe@flota.co" });
      expect(r.statusCode, r.body).toBe(200);
      expect(correo.enviados[0]!.adjuntos).toEqual([]);
      expect(correo.enviados[0]!.texto).toContain("Posición 1");
      expect((await enviar("/alertas/enviar", { para: "jefe@flota.co" }, "tok-tecnico")).statusCode).toBe(403);
    });

    it("una orden que no ve es 404, también por correo", async () => {
      const r = await enviar(`/ordenes/${nuevoId()}/pdf/enviar`, { para: "a@flota.co" });
      expect(r.statusCode).toBe(404);
      expect(correo.enviados).toEqual([]);
    });
  });

  describe("PDF de la orden", () => {
    const pdf = (token: string, orden = ORDEN) =>
      app.inject({ method: "GET", url: `${PREFIJO_API}/ordenes/${orden}/pdf`, headers: { authorization: `Bearer ${token}` } });

    it("se descarga como PDF y queda en la auditoría", async () => {
      await guardarMedicion(medicion(1, { serial: "MX1", profundidad: 9 }));
      const antes = (await pool.query(`SELECT count(*)::int AS n FROM "Auditoria"`)).rows[0].n;
      const r = await pdf("tok-coordinador");
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toBe("application/pdf");
      expect(r.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
      const despues = await pool.query(`SELECT detalle FROM "Auditoria" ORDER BY "creadoEn" DESC LIMIT 1`);
      expect((await pool.query(`SELECT count(*)::int AS n FROM "Auditoria"`)).rows[0].n).toBe(antes + 1);
      expect(despues.rows[0].detalle).toMatchObject({ origen: "pdf_orden", ordenId: ORDEN });
    });

    it("el informe en PDF trae las órdenes elegidas, en un solo archivo, y queda en la auditoría", async () => {
      await guardarMedicion(medicion(1, { serial: "MX1", profundidad: 9 }));
      const r = await app.inject({
        method: "GET", url: `${PREFIJO_API}/informe/pdf?ordenIds=${ORDEN}`, headers: { authorization: "Bearer tok-coordinador" },
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toBe("application/pdf");
      expect(r.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
      const a = await pool.query(`SELECT detalle FROM "Auditoria" ORDER BY "creadoEn" DESC LIMIT 1`);
      expect(a.rows[0].detalle).toMatchObject({ origen: "pdf_informe", ordenes: 1 });
    });

    it("sin órdenes en el filtro responde que no hay, no un PDF vacío", async () => {
      const r = await app.inject({
        method: "GET", url: `${PREFIJO_API}/informe/pdf?ordenIds=${nuevoId()}`, headers: { authorization: "Bearer tok-coordinador" },
      });
      expect(r.statusCode).toBe(404);
      expect(r.json().error.codigo).toBe("SIN_REGISTROS");
    });

    it("usa los datos congelados al aprobar, no los vivos", async () => {
      // Un documento cerrado no cambia porque cambien los datos maestros.
      await pool.query(`UPDATE "OrdenServicio" SET "clienteNombre" = 'Reyna (al aprobar)', "vehiculoCodigo" = 'CA-12-VIEJO' WHERE id = $1`, [ORDEN]);
      await pool.query(`UPDATE "Cliente" SET nombre = 'Reyna renombrada'`);
      const d = await new ServicioDocumento(pool).datos({ rol: "coordinador" }, ORDEN);
      expect(d?.cliente.nombre).toBe("Reyna (al aprobar)");
      expect(d?.vehiculo.codigo).toBe("CA-12-VIEJO");
    });

    it("el cliente no descarga una orden que aún se está trabajando; una inexistente es 404", async () => {
      expect((await pdf("tok-cliente")).statusCode).toBe(404);
      expect((await pdf("tok-coordinador", nuevoId())).statusCode).toBe(404);
    });
  });

  describe("recomendaciones persistentes", () => {
    const recomendar = (extra: Record<string, unknown> = {}, token = "tok-tecnico", orden = ORDEN) =>
      pedir({ ruta: `/ordenes/${orden}/recomendaciones`, token, cuerpo: { id: nuevoId(), vehiculoId: SEMILLA.vehiculo, texto: "Cambiar la posición 3 en la próxima visita", prioridad: "urgente", posicion: 3, ...extra } });
    const descargar = async (token = "tok-tecnico") =>
      (await app.inject({ method: "GET", url: `${PREFIJO_API}/sincronizacion`, headers: { authorization: `Bearer ${token}` } })).json();

    it("el técnico la registra y viaja en la descarga", async () => {
      expect((await recomendar()).statusCode).toBe(201);
      const p = await descargar();
      expect(p.recomendaciones).toEqual([expect.objectContaining({ texto: "Cambiar la posición 3 en la próxima visita", prioridad: "urgente", posicion: 3, estado: "abierta", origenOrdenId: ORDEN })]);
    });

    it("sobrevive al cierre y aparece en la siguiente orden del vehículo, hasta que se resuelve", async () => {
      const id = nuevoId();
      await recomendar({ id });
      await pool.query(`UPDATE "OrdenServicio" SET estado = 'cerrada' WHERE id = $1`, [ORDEN]);
      const siguiente = nuevoId();
      await pool.query(
        `INSERT INTO "OrdenServicio" (id,"empresaId","sedeId","clienteId","sedeClienteId","vehiculoId",tecnico_id,"configuracionEjeId",tipo,estado,fecha,"creadoPorId")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'preventivo','en_proceso','2026-10-06',$7)`,
        [siguiente, SEMILLA.empresa, SEMILLA.sede, SEMILLA.cliente, SEMILLA.sedeCliente, SEMILLA.vehiculo, SEMILLA.tecnico, SEMILLA.configuracion],
      );
      expect((await descargar()).recomendaciones.map((r: { id: string }) => r.id)).toContain(id);
      const r = await pedir({ ruta: `/recomendaciones/${id}/resolver`, cuerpo: { estado: "ejecutada", ordenId: siguiente } });
      expect(r.statusCode).toBe(200);
      const fila = await pool.query(`SELECT estado::text AS estado, "resueltaOrdenId" FROM "Recomendacion" WHERE id = $1`, [id]);
      expect(fila.rows[0]).toEqual({ estado: "ejecutada", resueltaOrdenId: siguiente });
      // Reenviar la misma resolución no es un error (el celular reintenta).
      expect((await pedir({ ruta: `/recomendaciones/${id}/resolver`, cuerpo: { estado: "ejecutada", ordenId: siguiente } })).statusCode).toBe(200);
    });

    it("una orden cerrada ya no recibe recomendaciones, y el cliente no las registra", async () => {
      await pool.query(`UPDATE "OrdenServicio" SET estado = 'cerrada' WHERE id = $1`, [ORDEN]);
      expect((await recomendar()).statusCode).toBe(409);
      await pool.query(`UPDATE "OrdenServicio" SET estado = 'en_proceso' WHERE id = $1`, [ORDEN]);
      expect((await recomendar({}, "tok-cliente")).statusCode).toBe(403);
    });

    it("no se registra para otro vehículo que el de la orden", async () => {
      const r = await recomendar({ vehiculoId: nuevoId() });
      expect(r.json().error.codigo).toBe("VEHICULO_NO_CORRESPONDE");
    });
  });

  describe("ver las fotos desde otro teléfono", () => {
    // Cada teléfono veía solo las fotos que tomó: el coordinador aprobaba sin
    // ver la evidencia.
    async function fotoConfirmada(cuerpo: Record<string, unknown>) {
      const id = nuevoId();
      expect((await pedir({ ruta: `/ordenes/${ORDEN}/fotos`, cuerpo: { id, nombre: "f.jpg", tipoMime: "image/jpeg", tamanoBytes: 1000, ...cuerpo } })).statusCode).toBe(201);
      expect((await pedir({ ruta: `/fotos/${id}/confirmar`, cuerpo: {} })).statusCode).toBe(200);
      return id;
    }
    const ver = (token: string) =>
      app.inject({ method: "GET", url: `${PREFIJO_API}/ordenes/${ORDEN}/fotos`, headers: { authorization: `Bearer ${token}` } });

    it("el coordinador ve la evidencia de la orden y de cada posición, con URL de lectura", async () => {
      const general = await fotoConfirmada({});
      const m = medicion(2, { serial: "MX2" });
      await guardarMedicion(m);
      const dePosicion = await fotoConfirmada({ medicionId: m.id });
      const r = await ver("tok-coordinador");
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual([
        expect.objectContaining({ id: general, posicion: null, url: expect.stringContaining("https://leer.test/") }),
        expect.objectContaining({ id: dePosicion, posicion: 2 }),
      ]);
    });

    it("una foto sin confirmar no existe para nadie", async () => {
      await pedir({ ruta: `/ordenes/${ORDEN}/fotos`, cuerpo: { id: nuevoId(), nombre: "f.jpg", tipoMime: "image/jpeg", tamanoBytes: 1000 } });
      expect((await ver("tok-coordinador")).json()).toEqual([]);
    });

    it("el cliente no ve la evidencia de una orden que aún se está trabajando", async () => {
      await fotoConfirmada({});
      expect((await ver("tok-cliente")).statusCode).toBe(404);
      await pool.query(`UPDATE "OrdenServicio" SET estado = 'pendiente_cliente' WHERE id = $1`, [ORDEN]);
      expect((await ver("tok-cliente")).json()).toHaveLength(1);
    });

    it("una orden que no existe es 404", async () => {
      const r = await app.inject({ method: "GET", url: `${PREFIJO_API}/ordenes/${nuevoId()}/fotos`, headers: { authorization: "Bearer tok-coordinador" } });
      expect(r.statusCode).toBe(404);
    });
  });

  describe("llanta desmontada", () => {
    it("se guarda, se descarga y llega al informe", async () => {
      // El contrato la aceptaba y el servidor no la guardaba: se perdía sin
      // aviso y las columnas de la desmontada del informe quedaban vacías.
      const desmontada = { posicionOrigen: 1, serial: "VIEJA-1", dot: "1520", profundidad: 2.5, destino: "Reencauche", detalle: "Corte leve" };
      const r = await guardarMedicion(medicion(1, { serial: "NUEVA-1", profundidad: 16, servicios: ["ROTA"], desmontada }));
      expect(r.statusCode).toBe(200);
      const fila = await pool.query(
        `SELECT "desPosicionOrigen", "desSerial", "desDot", "desProfundidad"::float AS prof, "desDestino", "desDetalle"
           FROM "LlantaRegistro" WHERE "ordenId" = $1`,
        [ORDEN],
      );
      expect(fila.rows[0]).toEqual({ desPosicionOrigen: 1, desSerial: "VIEJA-1", desDot: "1520", prof: 2.5, desDestino: "Reencauche", desDetalle: "Corte leve" });

      const paquete = await app.inject({ method: "GET", url: `${PREFIJO_API}/sincronizacion`, headers: { authorization: "Bearer tok-tecnico" } });
      const m = paquete.json().mediciones.find((x: { posicion: number }) => x.posicion === 1);
      expect(m.desmontada).toMatchObject({ serial: "VIEJA-1", destino: "Reencauche", profundidad: 2.5 });

      const csv = await app.inject({ method: "GET", url: `${PREFIJO_API}/informe/exportar`, headers: { authorization: "Bearer tok-coordinador" } });
      expect(csv.body).toContain("VIEJA-1");
      expect(csv.body).toContain("Reencauche");
    });

    it("corregir la posición sin desmontada la quita: se reemplaza, no se mezcla", async () => {
      const m = medicion(1, { desmontada: { serial: "VIEJA-1", destino: "Desecho" } });
      await guardarMedicion(m);
      await guardarMedicion({ ...m, desmontada: undefined });
      const fila = await pool.query(`SELECT "desSerial" FROM "LlantaRegistro" WHERE "ordenId" = $1`, [ORDEN]);
      expect(fila.rows[0].desSerial).toBeNull();
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
        url: `${PREFIJO_API}/ordenes/${ORDEN}/mediciones/x`,
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

  describe("la llanta como activo (R8)", () => {
    const traer = (ruta: string, token = "tok-coordinador") =>
      app.inject({ method: "GET", url: PREFIJO_API + ruta, headers: { authorization: `Bearer ${token}` } });

    it("la historia de las llantas se arma al CERRAR la orden (lo aprueba el cliente), no al aprobarla la oficina", async () => {
      const g = await guardarMedicion(medicion(1, { serial: "MX-500" }));
      expect(g.statusCode, g.body).toBeLessThan(300);
      // A revisión, con la firma vigente sobre el contenido actual.
      await pool.query(
        `UPDATE "OrdenServicio" SET estado = 'en_revision', "firmaNombre" = 'Luis', "firmaCedula" = '77',
                "firmaVersion" = "versionContenido" WHERE id = $1`,
        [ORDEN],
      );
      await pool.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES ($1,$2)`, [SEMILLA.coordinador, SEMILLA.sede]);
      const r = await pedir({ ruta: `/ordenes/${ORDEN}/estado`, token: "tok-coordinador", cuerpo: { estado: "pendiente_cliente" } });
      expect(r.statusCode, r.body).toBe(200);
      expect((await traer(`/llantas?vehiculoId=${SEMILLA.vehiculo}`)).json()).toEqual([]);
      const c = await pedir({ ruta: `/ordenes/${ORDEN}/estado`, token: "tok-cliente", cuerpo: { estado: "cerrada" } });
      expect(c.statusCode, c.body).toBe(200);
      const lista = await traer(`/llantas?vehiculoId=${SEMILLA.vehiculo}`);
      expect(lista.json()).toEqual([expect.objectContaining({ serial: "MX500", estado: "montada", posicion: 1, vehiculoCodigo: "CA-12" })]);
      const ficha = await traer(`/llantas/${lista.json()[0].id}`);
      expect(ficha.json().movimientos.map((m: { tipo: string }) => m.tipo)).toEqual(["montaje"]);
      // A nombre de Sistema, no del cliente que aprobó.
      const autor = await pool.query(`SELECT "usuarioId" FROM "LlantaMovimiento" WHERE "ordenId" = $1`, [ORDEN]);
      expect(autor.rows).toEqual([{ usuarioId: null }]);
    });

    it("la oficina da de alta en bodega y la mueve; el técnico solo consulta", async () => {
      const id = nuevoId();
      const cuerpo = { id, clienteId: SEMILLA.cliente, sedeId: SEMILLA.sede, numeroInterno: "A-17", medida: "11R22.5" };
      expect((await pedir({ ruta: "/llantas", token: "tok-tecnico", clave: null, cuerpo })).statusCode).toBe(403);
      expect((await pedir({ ruta: "/llantas", token: "tok-coordinador", clave: null, cuerpo })).statusCode).toBe(201);
      const mal = await pedir({ ruta: `/llantas/${id}/movimientos`, token: "tok-coordinador", clave: null, cuerpo: { tipo: "retorno_reencauche" } });
      expect(mal.statusCode).toBe(409);
      const bien = await pedir({ ruta: `/llantas/${id}/movimientos`, token: "tok-coordinador", clave: null, cuerpo: { tipo: "envio_reencauche" } });
      expect(bien.json().estado).toBe("reencauche");
      expect((await traer("/llantas?estado=reencauche", "tok-tecnico")).json()).toHaveLength(1);
    });

    it("sin serial ni número interno no hay activo", async () => {
      const r = await pedir({ ruta: "/llantas", token: "tok-coordinador", clave: null, cuerpo: { id: nuevoId(), clienteId: SEMILLA.cliente, sedeId: SEMILLA.sede } });
      expect(r.statusCode).toBe(422);
    });
  });

  describe("códigos de activación en lote", () => {
    const lote = (usuarioIds: unknown, token = "tok-admin") => pedir({ ruta: "/usuarios/codigos", token, clave: null, cuerpo: { usuarioIds } });

    it("un código por usuario elegido, de la empresa y activo; nunca para uno mismo", async () => {
      const yo = TOKENS["tok-admin"]!.sub;
      const r = await lote([SEMILLA.tecnico, SEMILLA.otroTecnico, yo, nuevoId()]);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().codigos.map((c: { usuarioId: string }) => c.usuarioId).sort()).toEqual([SEMILLA.tecnico, SEMILLA.otroTecnico].sort());
      expect(r.json().codigos[0]).toMatchObject({ codigo: CODIGO_FALSO, nombre: expect.any(String) });
    });

    it("solo el administrador, y de a 50 como máximo", async () => {
      expect((await lote([SEMILLA.tecnico], "tok-coordinador")).statusCode).toBe(403);
      expect((await lote(Array.from({ length: 51 }, () => nuevoId()))).statusCode).toBe(422);
      expect((await lote([])).statusCode).toBe(422);
    });
  });

  describe("carga masiva (R12)", () => {
    const cargar = (tipo: string, csv: string, token = "tok-coordinador") =>
      pedir({ ruta: `/carga/${tipo}`, token, clave: null, cuerpo: { csv } });
    const contar = async (tabla: string) => (await pool.query(`SELECT count(*)::int AS n FROM "${tabla}"`)).rows[0].n as number;

    it("carga clientes, sedes y vehículos; lo que ya existe se reconoce y no se duplica", async () => {
      const csv = [
        "CLIENTE;NIT;SEDE;CODIGO;PLACA;DESCRIPCION;PLANTILLA;KM",
        "Transportes Reyna;800.123.456-7;Planta Norte;CA-50;ABC123;Tractocamión;4 posiciones;1.200",
        "Carga Andina;900.555.111-2;Bodega;CN-1;;Furgón;4 posiciones;",
      ].join("\n");
      const r = await cargar("flota", csv);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().creados).toEqual({ clientes: 1, sedes: 2, vehiculos: 2 });
      const otra = await cargar("flota", csv);
      expect(otra.json()).toMatchObject({ creados: { clientes: 0, sedes: 0, vehiculos: 0 }, existentes: 2 });
    });

    it("con un solo error no se carga nada, y se dice qué fila", async () => {
      const antes = await contar("Cliente");
      const r = await cargar("flota", [
        "CLIENTE;NIT;SEDE;CODIGO;DESCRIPCION;PLANTILLA",
        "Carga Andina;900.555.111-2;Bodega;CN-1;Furgón;4 posiciones",
        "Otra;900.555.222-3;Bodega;CN-2;Furgón;No existe",
      ].join("\n"));
      expect(r.statusCode).toBe(422);
      expect(r.json().errores).toEqual([{ fila: 3, mensaje: 'No hay una plantilla de ejes vigente llamada "No existe"' }]);
      expect(await contar("Cliente")).toBe(antes);
    });

    it("carga llantas en bodega y el catálogo", async () => {
      const ll = await cargar("llantas", "NIT CLIENTE;SEDE;NUMERO INTERNO;SERIAL;MEDIDA;COSTO\n800.123.456-7;FUN;A-1;MX-1;295/80r22.5;1.850.000\n");
      expect(ll.statusCode, ll.body).toBe(200);
      expect(ll.json().creados).toEqual({ llantas: 1 });
      const cat = await cargar("catalogo", "MARCA;DISEÑO;TIPO EJE;MEDIDA;PROF FABRICA\nDouble Coin;RT500;traccion;11R22.5;18,5\n");
      expect(cat.statusCode, cat.body).toBe(200);
      expect(cat.json().creados).toEqual({ marcas: 1, disenos: 1, medidas: 1 });
    });

    describe("órdenes anteriores (2026-10-17)", () => {
      const ENCABEZADO = "NUMERO ANTERIOR;FECHA;SEDE;NIT CLIENTE;VEHICULO;KM;TECNICO;POSICION;MARCA;DISEÑO;MEDIDA;SERIAL;DOT;PROF EXT;PROF CEN;PROF INT;PSI ENCONTRADA";
      const csv = (...filas: string[]) => [ENCABEZADO, ...filas].join("\n");
      const unaOrden = csv(
        "1234;14/03/2025;FUN;800.123.456-7;sxk 482;65.400;Pedro Ruiz;1;Michelin;XDN-2;295/80r22.5;HX-1;3624;12,5;12;11,5;100",
        "1234;14/03/2025;FUN;800.123.456-7;sxk 482;65.400;Pedro Ruiz;2;;;;;;9;;;",
      );
      // El coordinador de la semilla no está en ninguna sede.
      const enSede = () => pool.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES ($1,$2) ON CONFLICT DO NOTHING`, [SEMILLA.coordinador, SEMILLA.sede]);

      it("entra cerrada, histórica, con folio HIS y su número anterior; arma la llanta desde esa fecha", async () => {
        await enSede();
        const r = await cargar("ordenes", unaOrden);
        expect(r.statusCode, r.body).toBe(200);
        expect(r.json().creados).toEqual({ ordenes: 1, mediciones: 2 });
        const o = (await pool.query(
          `SELECT id, folio, estado, historica, "referenciaAnterior", to_char(fecha,'YYYY-MM-DD') AS fecha, kilometraje,
                  "tecnicoNombre", "vehiculoCodigo", "firmaNombre", tecnico_id
             FROM "OrdenServicio" WHERE historica`,
        )).rows[0];
        expect(o).toMatchObject({
          folio: "HIS-FUN-000001", estado: "cerrada", historica: true, referenciaAnterior: "1234", fecha: "2025-03-14",
          kilometraje: 65400, tecnicoNombre: "Pedro Ruiz", vehiculoCodigo: "CA-12", firmaNombre: null, tecnico_id: SEMILLA.coordinador,
        });
        const meds = (await pool.query(
          `SELECT posicion, serial, profundidad::float AS p, "noIdentificada", "motivoNoIdentificada" FROM "LlantaRegistro" WHERE "ordenId" = $1 ORDER BY posicion`,
          [o.id],
        )).rows;
        // La mínima de las tres; sin marca ni serial, no identificada (no se inventa).
        expect(meds).toEqual([
          { posicion: 1, serial: "HX-1", p: 11.5, noIdentificada: false, motivoNoIdentificada: null },
          { posicion: 2, serial: null, p: 9, noIdentificada: true, motivoNoIdentificada: "otro" },
        ]);
        const llanta = (await pool.query(
          `SELECT l.estado, l.posicion, to_char(v.inicio,'YYYY-MM-DD') AS inicio
             FROM "Llanta" l JOIN "LlantaVida" v ON v."llantaId" = l.id WHERE l.serial = 'HX1'`,
        )).rows[0];
        expect(llanta).toEqual({ estado: "montada", posicion: 1, inicio: "2025-03-14" });
        // El consecutivo real no se tocó.
        const os = await pool.query(`SELECT valor FROM "Consecutivo" WHERE tipo = 'OS'`);
        expect(os.rows).toEqual([]);
        // El cliente la recibe en su portal, marcada.
        const d = await app.inject({ method: "GET", url: `${PREFIJO_API}/sincronizacion`, headers: { authorization: "Bearer tok-cliente" } });
        expect(d.statusCode, d.body).toBe(200);
        expect(d.json().ordenes.find((x: { id: string }) => x.id === o.id)).toMatchObject({ historica: true, referenciaAnterior: "1234" });
      });

      it("un repuesto (R1) también se carga y queda montado como repuesto", async () => {
        // Lo destapó la prueba de las plantillas con datos: el esquema de
        // pruebas seguía con la llave vieja por posición y el 101 no entraba.
        await enSede();
        const r = await cargar("ordenes", csv("9;2025-03-14;FUN;800.123.456-7;CA-12;;;R1;Michelin;;;HX-R;;16;;;"));
        expect(r.statusCode, r.body).toBe(200);
        const m = (await pool.query(`SELECT posicion, "posicionEnEje" FROM "LlantaRegistro"`)).rows;
        expect(m).toEqual([{ posicion: 101, posicionEnEje: null }]);
        expect((await pool.query(`SELECT posicion FROM "Llanta" WHERE serial = 'HXR'`)).rows).toEqual([{ posicion: 101 }]);
      });

      it("volver a subir el mismo archivo no duplica", async () => {
        await enSede();
        expect((await cargar("ordenes", unaOrden)).statusCode).toBe(200);
        const otra = await cargar("ordenes", unaOrden);
        expect(otra.json()).toMatchObject({ creados: { ordenes: 0, mediciones: 0 }, existentes: 1 });
        expect((await pool.query(`SELECT count(*)::int AS n FROM "OrdenServicio" WHERE historica`)).rows[0].n).toBe(1);
      });

      it("se procesan de la más vieja a la más nueva, aunque el archivo venga desordenado", async () => {
        await enSede();
        const r = await cargar("ordenes", csv(
          "B;2025-06-01;FUN;800.123.456-7;CA-12;70000;;1;Michelin;;;HX-2;;8;;;",
          "A;2025-01-10;FUN;800.123.456-7;CA-12;60000;;1;Michelin;;;HX-1;;14;;;",
        ));
        expect(r.statusCode, r.body).toBe(200);
        // La de junio deja montada a HX-2 y saca a HX-1 de la posición 1.
        const est = (await pool.query(`SELECT serial, estado, posicion FROM "Llanta" ORDER BY serial`)).rows;
        expect(est).toEqual([
          // En la ficha el serial va normalizado (sin guiones), como siempre.
          { serial: "HX1", estado: "bodega", posicion: null },
          { serial: "HX2", estado: "montada", posicion: 1 },
        ]);
        const folios = (await pool.query(`SELECT folio, "referenciaAnterior" AS ref FROM "OrdenServicio" WHERE historica ORDER BY fecha`)).rows;
        expect(folios).toEqual([{ folio: "HIS-FUN-000001", ref: "A" }, { folio: "HIS-FUN-000002", ref: "B" }]);
      });

      it("una orden vieja no mueve las llantas de un vehículo que ya tiene una más reciente procesada", async () => {
        await enSede();
        expect((await cargar("ordenes", csv("B;2025-06-01;FUN;800.123.456-7;CA-12;;;1;Michelin;;;HX-2;;8;;;"))).statusCode).toBe(200);
        const r = await cargar("ordenes", csv("A;2025-01-10;FUN;800.123.456-7;CA-12;;;1;Michelin;;;HX-2;;14;;;"));
        expect(r.statusCode, r.body).toBe(200);
        const est = (await pool.query(`SELECT serial, estado, posicion FROM "Llanta"`)).rows;
        expect(est).toEqual([{ serial: "HX2", estado: "montada", posicion: 1 }]);
        // Su medición sí queda enlazada a la llanta (aparece en su ficha).
        const enlazadas = await pool.query(`SELECT count(*)::int AS n FROM "LlantaRegistro" WHERE "llantaId" IS NOT NULL`);
        expect(enlazadas.rows[0].n).toBe(2);
      });

      it("con un vehículo o una posición que no existen no se carga nada, y se dice la fila", async () => {
        await enSede();
        const r = await cargar("ordenes", csv(
          "1;2025-03-14;FUN;800.123.456-7;CA-12;;;9;;;;;;;;;",
          "2;2025-03-14;FUN;800.123.456-7;ZZZ-1;;;1;;;;;;;;;",
        ));
        expect(r.statusCode).toBe(422);
        expect(r.json().errores).toEqual([
          { fila: 2, mensaje: "El vehículo CA-12 no tiene la posición 9" },
          { fila: 3, mensaje: 'Transportes Reyna no tiene un vehículo "ZZZ-1" (código o placa)' },
        ]);
        expect((await pool.query(`SELECT count(*)::int AS n FROM "OrdenServicio" WHERE historica`)).rows[0].n).toBe(0);
      });

      it("quien carga tiene que pertenecer a la sede (la orden queda a su nombre)", async () => {
        const r = await cargar("ordenes", unaOrden);
        expect(r.statusCode).toBe(422);
        expect(r.json().errores[0].mensaje).toBe("Para cargar órdenes de la sede FUN tienes que pertenecer a ella (Usuarios → tus sedes)");
      });
    });

    it("el técnico no hace cargas masivas", async () => {
      const r = await cargar("catalogo", "MARCA;DISEÑO;TIPO EJE;MEDIDA\nX;Y;traccion;11R22.5\n", "tok-tecnico");
      expect(r.statusCode).toBe(422);
      expect(r.json().errores[0].mensaje).toBe("La carga masiva la hace la oficina");
    });
  });

  describe("retiro y garantías (R10)", () => {
    const traer = (ruta: string, token = "tok-coordinador") =>
      app.inject({ method: "GET", url: PREFIJO_API + ruta, headers: { authorization: `Bearer ${token}` } });

    it("el motivo de retiro se guarda y alimenta las causas de retiro", async () => {
      const g = await guardarMedicion(medicion(2, { serial: "MX-NUEVA", desmontada: { serial: "MX-VIEJA", motivoRetiro: "corte", destino: "Desecho" } }));
      expect(g.statusCode, g.body).toBeLessThan(300);
      const fila = await pool.query(`SELECT "desMotivoRetiro" FROM "LlantaRegistro" WHERE "ordenId" = $1`, [ORDEN]);
      expect(fila.rows[0].desMotivoRetiro).toBe("corte");
      const causas = (await traer("/informe/causas-retiro")).json();
      expect(causas.total).toBe(1);
      expect(causas.porMotivo).toEqual([{ motivo: "corte", cantidad: 1 }]);
      expect(causas.porPosicion).toEqual([{ grupo: "2", motivo: "corte", cantidad: 1 }]);
    });

    it("el tablero agrupa el rendimiento y proyecta compras (R11)", async () => {
      await guardarMedicion(medicion(1, { serial: "MX-1", profundidades: { exterior: 9, centro: 9, interior: 9 } }));
      const r = await traer("/tablero");
      expect(r.statusCode).toBe(200);
      const t = r.json();
      expect(t.llantas).toBe(1);
      expect(t.porPosicion[0]).toMatchObject({ grupo: "1", llantas: 1 });
      expect(t.compras).toMatchObject({ sinEstimar: 1 });
    });

    it("el tablero da la vida útil real de las llantas que terminaron su vida, por marca", async () => {
      await pool.query(
        `INSERT INTO "Llanta" (id,"empresaId","clienteId",serial,estado,"marcaId","disenoId") VALUES
           ('ll-vida-1',$1,$2,'VU1','desecho','mar-1','dis-1'),
           ('ll-vida-2',$1,$2,'VU2','montada','mar-1','dis-1')`,
        [SEMILLA.empresa, SEMILLA.cliente],
      );
      await pool.query(
        `INSERT INTO "LlantaMovimiento" (id,"empresaId","llantaId",tipo,fecha,kilometraje) VALUES
           ('mv-v1',$1,'ll-vida-1','montaje','2025-01-10',1000),
           ('mv-v2',$1,'ll-vida-1','desmontaje','2026-09-01',101000),
           ('mv-v3',$1,'ll-vida-2','montaje','2025-01-10',1000)`,
        [SEMILLA.empresa],
      );
      const t = (await traer("/tablero")).json();
      // La que sigue montada no cuenta: aún no terminó su vida.
      expect(t.vidaUtil).toEqual({
        retiradas: 1,
        porMarca: [{ grupo: "Michelin", llantas: 1, kmPromedio: 100000 }],
        porDiseno: [{ grupo: "Michelin XDN-2", llantas: 1, kmPromedio: 100000 }],
      });
    });

    it("un motivo inventado no pasa el contrato", async () => {
      const g = await guardarMedicion(medicion(2, { desmontada: { serial: "X", motivoRetiro: "mala suerte" } }));
      expect(g.statusCode).toBe(422);
    });

    it("el reclamo de garantía sigue su curso; aprobar exige el valor reconocido", async () => {
      const llanta = nuevoId();
      await pedir({ ruta: "/llantas", token: "tok-coordinador", clave: null, cuerpo: { id: llanta, clienteId: SEMILLA.cliente, sedeId: SEMILLA.sede, numeroInterno: "A-9" } });
      const id = nuevoId();
      const crear = await pedir({ ruta: "/reclamos", token: "tok-coordinador", clave: null, cuerpo: { id, llantaId: llanta, proveedor: "Michelin", motivoRetiro: "separacion", notas: "Separación de banda a 40.000 km" } });
      expect(crear.statusCode).toBe(201);
      const otra = await pedir({ ruta: "/reclamos", token: "tok-coordinador", clave: null, cuerpo: { id: nuevoId(), llantaId: llanta, proveedor: "Michelin", motivoRetiro: "separacion" } });
      expect(otra.statusCode).toBe(409);
      const estado = (cuerpo: unknown) => pedir({ ruta: `/reclamos/${id}/estado`, token: "tok-coordinador", clave: null, cuerpo });
      expect((await estado({ estado: "aprobado" })).statusCode).toBe(409);
      expect((await estado({ estado: "enviado", nota: "Enviado al distribuidor" })).statusCode).toBe(200);
      expect((await estado({ estado: "aprobado" })).statusCode).toBe(422);
      expect((await estado({ estado: "aprobado", valorReconocido: 600000 })).statusCode).toBe(200);
      const lista = (await traer("/reclamos")).json();
      expect(lista[0]).toMatchObject({ estado: "aprobado", valorReconocido: 600000, llanta: "A-9" });
      expect(lista[0].notas).toContain("Enviado al distribuidor");
    });
  });

  describe("bloqueo de la orden (R7)", () => {
    const bloquear = (token: string) => pedir({ ruta: `/ordenes/${ORDEN}/bloqueo`, token, clave: null });
    const liberar = (token: string, motivo?: string) =>
      pedir({ ruta: `/ordenes/${ORDEN}/bloqueo/liberar`, token, clave: null, cuerpo: motivo ? { motivo } : {} });
    const reasignar = () =>
      pedir({ ruta: `/ordenes/${ORDEN}/reasignar`, token: "tok-coordinador", cuerpo: { tecnicoId: SEMILLA.otroTecnico, motivo: "Cambio de turno" } });

    it("el técnico se la lleva; la oficina no la reasigna sin liberarla primero, y liberar exige motivo", async () => {
      expect((await bloquear("tok-tecnico")).statusCode).toBe(200);
      const f = await pool.query(`SELECT "bloqueadaPorId", "bloqueadaEn" FROM "OrdenServicio" WHERE id = $1`, [ORDEN]);
      expect(f.rows[0].bloqueadaPorId).toBe(SEMILLA.tecnico);
      expect(f.rows[0].bloqueadaEn).not.toBeNull();

      const r = await reasignar();
      expect(r.statusCode).toBe(409);
      expect(r.json().error.codigo).toBe("ORDEN_BLOQUEADA");

      expect((await liberar("tok-coordinador", "ok")).statusCode).toBe(422);
      expect((await liberar("tok-coordinador", "Carlos perdió el teléfono")).statusCode).toBe(200);
      const aud = await pool.query(`SELECT detalle FROM "Auditoria" WHERE detalle->>'bloqueo' = 'liberado'`);
      expect(aud.rows[0]?.detalle).toMatchObject({ teniaId: SEMILLA.tecnico, motivo: "Carlos perdió el teléfono" });
      expect((await reasignar()).statusCode).toBe(200);
    });

    it("solo el técnico asignado se la lleva; volver a tomarla no es error", async () => {
      expect((await bloquear("tok-coordinador")).statusCode).toBe(403);
      expect((await bloquear("tok-tecnico")).statusCode).toBe(200);
      expect((await bloquear("tok-tecnico")).statusCode).toBe(200);
    });

    it("el coordinador anula una orden bloqueada sin liberarla, y el bloqueo se suelta", async () => {
      await bloquear("tok-tecnico");
      const r = await pedir({ ruta: `/ordenes/${ORDEN}/estado`, token: "tok-coordinador", cuerpo: { estado: "anulada", motivo: "Vehículo vendido" } });
      expect(r.statusCode, r.body).toBe(200);
      const f = await pool.query(`SELECT estado::text AS estado, "bloqueadaPorId" FROM "OrdenServicio" WHERE id = $1`, [ORDEN]);
      expect(f.rows[0]).toEqual({ estado: "anulada", bloqueadaPorId: null });
    });

    it("el técnico la suelta sin motivo", async () => {
      await bloquear("tok-tecnico");
      expect((await liberar("tok-tecnico")).statusCode).toBe(200);
      const f = await pool.query(`SELECT "bloqueadaPorId" FROM "OrdenServicio" WHERE id = $1`, [ORDEN]);
      expect(f.rows[0].bloqueadaPorId).toBeNull();
    });
  });

  describe("flota e informe", () => {
    // Estos servicios existían desde la fase 1 sin puerta de entrada: la
    // administración y la exportación eran inalcanzables.
    const traer = (ruta: string, token = "tok-coordinador") =>
      app.inject({ method: "GET", url: PREFIJO_API + ruta, headers: { authorization: `Bearer ${token}` } });

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
      const r = await app.inject({ method: "GET", url: `${PREFIJO_API}/flota/clientes` });
      expect(r.statusCode).toBe(401);
    });

    it("el técnico no crea vehículos", async () => {
      const r = await pedir({
        ruta: "/flota/vehiculos",
        cuerpo: {
          // El id lo genera el cliente: el contrato lo exige.
          id: nuevoId(), sedeClienteId: SEMILLA.sedeCliente, configuracionEjeId: SEMILLA.configuracion,
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
          // El id lo genera el cliente: el contrato lo exige.
          id: nuevoId(), sedeClienteId: SEMILLA.sedeCliente, configuracionEjeId: SEMILLA.configuracion,
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

    it("una orden para un vehículo con otra abierta se crea y avisa, no se rechaza", async () => {
      // CLAUDE.md, 1.6: "avisa, no bloquea" —puede ser un correctivo urgente—.
      // El servicio pedía confirmar con un campo que el contrato no tiene: el
      // celular nunca podía confirmar, y la orden quedaba apartada para siempre.
      const r = await pedir({
        ruta: "/ordenes",
        token: "tok-coordinador",
        cuerpo: {
          id: nuevoId(), clientRequestId: nuevoId(), sedeId: SEMILLA.sede, clienteId: SEMILLA.cliente,
          sedeClienteId: SEMILLA.sedeCliente, vehiculoId: SEMILLA.vehiculo, tecnicoId: SEMILLA.tecnico,
          configuracionEjeId: SEMILLA.configuracion, tipo: "correctivo", fecha: "2026-09-21",
          sinConductor: true,
        },
      });
      expect(r.statusCode).toBe(201);
      expect(r.json().aviso).toBeTruthy();
    });

    it("exporta SOLO las órdenes elegidas a mano", async () => {
      // La ruta validaba ordenIds y no lo pasaba al servicio: elegir tres
      // órdenes exportaba la cartera entera del cliente.
      await conUnaMedicion();
      const otra = nuevoId();
      const r = await traer(`/informe/exportar?ordenIds=${otra}`);
      expect(r.statusCode).toBe(422);
      expect(r.json().error.codigo).toBe("SIN_REGISTROS");
      const propia = await traer(`/informe/exportar?ordenIds=${ORDEN}&ordenIds=${otra}`);
      expect(propia.statusCode).toBe(200);
    });

    it("respeta el filtro por estado de la llanta", async () => {
      await conUnaMedicion();
      const r = await traer("/informe/exportar?estadoLlanta=inexistente");
      expect(r.statusCode).toBe(422);
      expect(r.json().error.codigo).toBe("SIN_REGISTROS");
    });

    it("avisa cuántas órdenes van sin cerrar, fuera de los datos", async () => {
      // Un aviso entre las filas ensuciaría la hoja de cálculo.
      await conUnaMedicion();
      const r = await traer("/informe/exportar");
      expect(r.headers["x-ordenes-sin-cerrar"]).toBeDefined();
    });

    it("el cliente ve en el informe solo lo que espera su aprobación y lo cerrado", async () => {
      // Decisión del usuario: el cliente y el técnico ven el informe. Lo que
      // se sigue midiendo o revisando es preliminar: no se le muestra.
      await conUnaMedicion();
      const enProceso = await app.inject({ method: "GET", url: `${PREFIJO_API}/informe/resumen`, headers: { authorization: "Bearer tok-cliente" } });
      expect(enProceso.json()).toMatchObject({ registros: 0 });
      await pool.query(`UPDATE "OrdenServicio" SET estado = 'pendiente_cliente' WHERE id = $1`, [ORDEN]);
      const lista = await app.inject({ method: "GET", url: `${PREFIJO_API}/informe/resumen`, headers: { authorization: "Bearer tok-cliente" } });
      expect(lista.json()).toMatchObject({ registros: 1 });
      // El técnico ve las suyas, en cualquier estado.
      await pool.query(`UPDATE "OrdenServicio" SET estado = 'en_proceso' WHERE id = $1`, [ORDEN]);
      expect((await traer("/informe/resumen")).json()).toMatchObject({ registros: 1 });
    });

    it("la vista previa cuenta lo mismo que saldría en el archivo", async () => {
      await conUnaMedicion();
      await guardarMedicion(medicion(2, { profundidad: 7, serial: "MX2" }));
      const r = await traer("/informe/resumen");
      expect(r.statusCode).toBe(200);
      const v = r.json();
      expect(v).toMatchObject({ registros: 2, ordenes: 1, sinCerrar: 1 });
      expect(v.filas.map((f: { posicion: number }) => f.posicion)).toEqual([1, 2]);
      expect(v.filas[0]).toMatchObject({ serial: "MX1", profundidad: 9 });
    });

    it("la vista previa usa los mismos filtros que la exportación", async () => {
      // Si leyeran los parámetros distinto, lo que se ve no sería lo que sale.
      await conUnaMedicion();
      const r = await traer(`/informe/resumen?ordenIds=${nuevoId()}`);
      expect(r.json()).toMatchObject({ registros: 0, filas: [] });
      expect((await traer("/informe/resumen?desde=2026-02-31")).statusCode).toBe(422);
    });

    it("la vista previa no queda en la auditoría: no sale ningún archivo", async () => {
      await conUnaMedicion();
      const antes = await pool.query(`SELECT count(*)::int AS n FROM "Auditoria"`);
      await traer("/informe/resumen");
      const despues = await pool.query(`SELECT count(*)::int AS n FROM "Auditoria"`);
      expect(despues.rows[0].n).toBe(antes.rows[0].n);
      await traer("/informe/exportar");
      const exportado = await pool.query(`SELECT count(*)::int AS n FROM "Auditoria"`);
      expect(exportado.rows[0].n).toBe(antes.rows[0].n + 1);
    });

    it("sigue una llanta por su serial", async () => {
      await conUnaMedicion();
      const r = await traer("/informe/trazabilidad?serial=mx1");
      expect(r.statusCode).toBe(200);
      expect(r.json().pasos).toEqual([expect.objectContaining({ posicion: 1, profundidad: 9 })]);
      expect((await traer("/informe/trazabilidad")).statusCode).toBe(422);
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
