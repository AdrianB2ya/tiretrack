import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { nuevoId } from "@tiretrack/domain";
import { zRespuestaLogin } from "@tiretrack/contracts";
import { hayBaseDeDatos, poolAislado } from "./base";
import { crearEsquemaCompleto, sembrar, SEMILLA, authFalso, CODIGO_FALSO } from "./esquemas";
import { construirServidor, enTransaccion, PREFIJO_API } from "../http/servidor";
import { ServicioDocumento } from "../informe/documento";
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
