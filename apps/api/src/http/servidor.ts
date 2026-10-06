import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import {
  zAdjuntarFoto,
  zCambiarEstado,
  zComandoActualizarOrden,
  zCrearCliente,
  zCrearConfiguracionEje,
  zEjeDefinicion,
  zCrearDiseno,
  zCrearMarca,
  zCrearOrden,
  zActivarCuenta,
  zCambiarTecnicoProgramacion,
  zCrearProgramacion,
  zCrearRecomendacion,
  zResolverRecomendacion,
  zCrearSede,
  zCrearSedeCliente,
  zCrearUsuario,
  zCrearVehiculo,
  zFiltroInforme,
  zId,
  zFirma,
  zInstante,
  zReasignar,
  zTextoCorto,
} from "@tiretrack/contracts";

/**
 * Quita las claves con valor undefined. Zod marca lo opcional como
 * `T | undefined`; los servicios declaran sus entradas sin esa posibilidad.
 */
function sinIndefinidos<T extends Record<string, unknown>>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;
}

const zVersionConfiguracion = z.object({ ejes: z.array(zEjeDefinicion).min(1), confirmado: z.boolean().optional() });

/** Consulta de la descarga: `desde` es la marca `hasta` que entregó el servidor. */
const zConsultaDescarga = z.object({ desde: zInstante.optional() });
import { fechaEnColombia, puedeAprobar, ROLES, type Rol, type Veredicto } from "@tiretrack/domain";
import type { Claims, ResultadoActivacion, ResultadoLogin } from "../acceso/servicio";
import { ServicioUsuarios } from "../usuarios/servicio";
import { ServicioProgramaciones } from "../programaciones/servicio";
import { ServicioRecomendaciones } from "../recomendaciones/servicio";
import { ServicioDocumento } from "../informe/documento";
import { TrabajosProgramados } from "../trabajos/programados";
import { RepositorioOrdenesPg } from "../ordenes/repositorio";
import { COMANDO, ServicioOrdenes } from "../ordenes/servicio";
import { RepositorioMedicionesPg, ServicioMediciones } from "../mediciones/servicio";
import { RepositorioFotosPg, ServicioFotos } from "../fotos/servicio";
import { ServicioDescarga } from "../descarga/servicio";
import { ServicioCatalogo } from "../catalogo/servicio";
import { ServicioFlota } from "../flota/servicio";
import { RepositorioFlotaPg } from "../flota/repositorio";
import { ServicioInforme } from "../informe/servicio";
import { RepositorioCatalogoPg } from "../catalogo/repositorio";
import type { Almacenamiento } from "../fotos/almacenamiento";

/**
 * Servidor HTTP: la frontera entre el celular y los servicios.
 *
 * Tres garantías lo definen:
 *
 * 1. **Una transacción por petición**, con el contexto de RLS de la empresa.
 *    El aislamiento entre empresas lo aplica PostgreSQL, no este código: si
 *    una ruta olvidara filtrar, la base igual no devolvería filas ajenas.
 *
 * 2. **Idempotencia dentro de la misma transacción.** La clave se reclama
 *    junto con el efecto: nunca queda una operación aplicada sin registrar,
 *    ni registrada sin aplicar. Un rechazo deshace todo, incluida la clave,
 *    para que el reintento se aplique si la causa se corrige.
 *
 * 3. **Los códigos HTTP significan lo que el celular entiende.** Ver
 *    `ESTADO_POR_CODIGO`: un malentendido aquí termina en trabajo apartado.
 *
 * Todas las rutas actuales son de COMANDO: hoy todas las acciones, incluidas
 * las del coordinador, salen del celular por la cola. No se infiere el modo
 * por la presencia de `If-Match` —eso sería una versión "opcional"—. Un panel
 * que edite en línea tendrá rutas propias con la versión obligatoria.
 */

/** Lo que el servidor necesita de la autenticación. Nada más. */
export interface ServicioAuthHttp {
  login(entrada: { email: string; password: string; empresaId?: string; codigo2fa?: string; ip?: string }): Promise<ResultadoLogin>;
  refrescar(refreshToken: string, ctx?: { ip?: string }): Promise<ResultadoLogin>;
  /** Activación con el código que entregó el administrador (5.2). */
  activar(e: {
    email: string; codigo: string; password: string; empresaId?: string; codigo2fa?: string; ip?: string;
  }): Promise<ResultadoActivacion>;
  crearCodigoActivacion(usuarioId: string, ip?: string): Promise<{ codigo: string; expiraEn: Date } | null>;
}

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
  readonly clienteId: string | null;
  readonly vistaCliente: boolean;
}

export interface OpcionesServidor {
  readonly pool: pg.Pool;
  /**
   * Autenticación. Se inyecta ya construida porque necesita **otra
   * conexión**: el login ocurre ANTES de saber la empresa, así que buscar al
   * usuario por correo con el rol de aplicación devuelve cero filas.
   *
   * Se construye sobre un pool con el rol `tiretrack_auth`
   * (`DATABASE_URL_AUTH`), que solo tiene permisos sobre las cinco tablas de
   * acceso. Ver la sección "ROL DE AUTENTICACIÓN" en `prisma/rls.sql`.
   */
  readonly auth: ServicioAuthHttp;
  /** Verifica la firma y vigencia del token de acceso. */
  readonly verificarToken: (token: string) => Claims | null;
  readonly almacen: Almacenamiento;
  readonly reloj?: () => Date;
  /** Registro de peticiones. Apagado en pruebas. */
  readonly registro?: boolean;
}

type Respuesta = { status: number; cuerpo: unknown };

/**
 * Estado HTTP de cada código de rechazo, alineado con cómo interpreta el
 * celular cada respuesta (`clienteHttp.ts`):
 *
 * - 409 → conflicto: el servidor tiene otro estado. El celular lo aparta.
 * - 403 → sin permiso. El celular lo aparta.
 * - 404 → no existe. El celular lo aparta.
 * - 422 → datos que no cumplen las reglas. El celular lo aparta.
 *
 * Un código no listado es 422: se aparta y se puede revisar. Nunca 5xx, que
 * el celular reintentaría indefinidamente con un dato que siempre fallará.
 */
const ESTADO_POR_CODIGO: Record<string, number> = {
  NO_EXISTE: 404,

  SIN_PERMISO: 403,
  SIN_EMPRESA: 403,
  ROL_DESCONOCIDO: 403,
  SOLO_ASIGNADO: 403,
  VISTA_CLIENTE: 403,
  TECNICO_AJENO_A_SEDE: 403,
  ROL_NO_PERMITIDO: 403,
  ROL_NO_ASIGNABLE: 403,
  SEDE_AJENA: 403,

  CORREO_DUPLICADO: 409,
  NOMBRE_EN_USO: 409,
  YA_REEMPLAZADA: 409,
  // Cambia vehículos en uso: se pide confirmar, no es un error de datos.
  REQUIERE_CONFIRMACION: 409,
  CODIGO_DUPLICADO: 409,
  PROGRAMACION_DUPLICADA: 409,
  // Otra visita ya la marcó hecha o descartada mientras este celular no veía.
  YA_RESUELTA: 409,
  YA_EXISTE: 409,
  // El técnico o el vehículo cambiaron de estado: no es un dato mal escrito.
  TECNICO_NO_DISPONIBLE: 409,
  VEHICULO_INACTIVO: 409,

  CONFLICTO_VERSION: 409,
  FIRMA_DESACTUALIZADA: 409,
  POSICION_OCUPADA: 409,
  MEDICION_REUBICADA: 409,
  // La orden avanzó mientras el técnico seguía sin señal.
  EN_REVISION: 409,
  ORDEN_CERRADA: 409,
  TRANSICION_INVALIDA: 409,
};

function estadoDe(v: Veredicto): number {
  return ESTADO_POR_CODIGO[v.codigo ?? ""] ?? 422;
}

function rechazo(v: Veredicto): Respuesta {
  return {
    status: estadoDe(v),
    cuerpo: { error: { codigo: v.codigo, mensaje: v.mensaje, ...(v.campo ? { campo: v.campo } : {}) } },
  };
}

function datosInvalidos(problemas: { path: (string | number)[]; message: string }[]): Respuesta {
  const primero = problemas[0];
  return {
    status: 422,
    cuerpo: {
      error: {
        codigo: "DATOS_INVALIDOS",
        mensaje: primero?.message ?? "Datos inválidos",
        campo: primero?.path.join("."),
      },
    },
  };
}

/**
 * Filtro del informe desde la consulta de la URL. Lo usan la exportación y la
 * vista previa: si cada una leyera los parámetros a su manera, lo que se ve en
 * pantalla dejaría de ser lo que sale en el archivo.
 */
function filtroInforme(req: FastifyRequest):
  | { ok: true; q: z.infer<typeof zFiltroInforme> }
  | { ok: false; r: Respuesta } {
  // Fechas imposibles o parámetros repetidos respondían 500.
  // Una sola orden llega como texto, varias como lista: se normaliza.
  const crudo = { ...((req.query ?? {}) as Record<string, unknown>) };
  if (typeof crudo["ordenIds"] === "string") crudo["ordenIds"] = [crudo["ordenIds"]];
  const p = zFiltroInforme.safeParse(crudo);
  return p.success ? { ok: true, q: p.data } : { ok: false, r: datosInvalidos(p.error.issues) };
}

const zTrazabilidad = z.object({ serial: zTextoCorto });

// ── Autenticación ───────────────────────────────────────────────────────────

function esRol(valor: string): valor is Rol {
  return (ROLES as readonly string[]).includes(valor);
}

/**
 * Contexto a partir del token.
 *
 * El rol del token es texto libre para el compilador: se valida contra los
 * roles reales antes de confiar en él. Y estas rutas exigen empresa: un token
 * sin empresa (staff de la plataforma) no opera sobre datos de campo.
 */
function contextoDe(claims: Claims): Contexto | { motivo: "SIN_EMPRESA" | "ROL_DESCONOCIDO" } {
  // Estas rutas exigen empresa: un token de staff de la plataforma no opera
  // sobre datos de campo.
  if (!claims.empresaId) return { motivo: "SIN_EMPRESA" };
  // El rol del token es texto libre para el compilador. Sin esta validación,
  // un token con un rol inventado cuyo usuario SÍ sea el técnico asignado
  // pasaría: el dominio no tendría por qué rechazarlo.
  if (!esRol(claims.rol)) return { motivo: "ROL_DESCONOCIDO" };
  return {
    empresaId: claims.empresaId,
    rol: claims.rol,
    usuarioId: claims.sub,
    clienteId: claims.clienteId,
    vistaCliente: claims.rol === "cliente",
  };
}

// ── Transacción con contexto de RLS ─────────────────────────────────────────

/**
 * Ejecuta `fn` dentro de una transacción con el contexto de RLS.
 *
 * `set_config(..., true)` equivale a `SET LOCAL`: el contexto vive solo
 * mientras dura la transacción. Con una conexión reutilizada del pool, un
 * `SET` normal filtraría la empresa de una petición a la siguiente.
 */
export async function enTransaccion<T>(
  pool: pg.Pool,
  ctx: Contexto,
  fn: (db: pg.PoolClient) => Promise<{ confirmar: boolean; valor: T }>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      `SELECT set_config('app.empresa_id', $1, true),
              set_config('app.usuario_id', $2, true),
              set_config('app.rol', $3, true),
              set_config('app.cliente_id', $4, true)`,
      [ctx.empresaId, ctx.usuarioId, ctx.rol, ctx.clienteId ?? ""],
    );
    const r = await fn(db);
    await db.query(r.confirmar ? "COMMIT" : "ROLLBACK");
    return r.valor;
  } catch (e) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    db.release();
  }
}

// ── Servidor ────────────────────────────────────────────────────────────────

/** Prefijo de todas las rutas de la API. */
export const PREFIJO_API = "/api/v1";

export function construirServidor(op: OpcionesServidor): FastifyInstance {
  const raiz = Fastify({ logger: op.registro ?? false, bodyLimit: 512 * 1024 });
  const reloj = op.reloj ?? (() => new Date());

  /** Servicios atados a la conexión de la transacción de esta petición. */
  function servicios(db: pg.PoolClient) {
    const cliente = db as unknown as pg.Client;
    const repoOrdenes = new RepositorioOrdenesPg(cliente);
    return {
      ordenes: new ServicioOrdenes(repoOrdenes, reloj),
      mediciones: new ServicioMediciones(new RepositorioMedicionesPg(db), reloj),
      catalogo: new ServicioCatalogo(new RepositorioCatalogoPg(cliente), reloj),
      flota: new ServicioFlota(new RepositorioFlotaPg(cliente)),
      informe: new ServicioInforme(db, reloj),
      usuarios: new ServicioUsuarios(db),
      programaciones: new ServicioProgramaciones(db),
      recomendaciones: new ServicioRecomendaciones(db),
      // Solo lectura de alertas: no abre transacciones propias.
      alertas: new TrabajosProgramados(db, reloj),
      /** La conexión de la transacción, para consultas pequeñas de una ruta. */
      consulta: db,
      fotos: new ServicioFotos(
        new RepositorioFotosPg(cliente),
        op.almacen,
        (ordenId) => repoOrdenes.marcarContenidoCambiado(ordenId),
        reloj,
      ),
    };
  }

  type Servicios = ReturnType<typeof servicios>;
  type Manejador = (s: Servicios, ctx: Contexto, req: FastifyRequest) => Promise<Respuesta>;

  /**
   * Operación que modifica datos: autenticada, idempotente y transaccional.
   */
  function operacion(manejador: Manejador) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const auth = req.headers.authorization;
      const claims = auth?.startsWith("Bearer ") ? op.verificarToken(auth.slice(7)) : null;
      // 401 le dice al celular "renueva la sesión y reintenta".
      if (!claims) {
        return reply.status(401).send({ error: { codigo: "NO_AUTENTICADO", mensaje: "Sesión inválida o vencida" } });
      }
      const posible = contextoDe(claims);
      if ("motivo" in posible) {
        const mensaje =
          posible.motivo === "SIN_EMPRESA"
            ? "Esta sesión no opera sobre datos de campo"
            : "El rol de la sesión no es válido";
        return reply.status(403).send({ error: { codigo: posible.motivo, mensaje } });
      }
      const ctx = posible;

      // Sin clave no hay forma de distinguir un reintento de una operación
      // nueva: se aplicaría dos veces. El celular siempre la envía.
      const clave = req.headers["idempotency-key"];
      if (typeof clave !== "string" || clave.length === 0 || clave.length > 200) {
        return reply.status(400).send({ error: { codigo: "SIN_CLAVE", mensaje: "Falta el encabezado Idempotency-Key" } });
      }

      const r = await enTransaccion<Respuesta>(op.pool, ctx, async (db) => {
        // Reclamar la clave. Si otra petición con la misma clave está en
        // curso, este INSERT espera a que termine: si confirmó, hay
        // conflicto; si se deshizo, esta reclama y aplica.
        const reclamo = await db.query(
          `INSERT INTO "OperacionAplicada" ("empresaId", clave, "creadaEn")
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING clave`,
          [ctx.empresaId, clave, reloj()],
        );
        if (reclamo.rows.length === 0) {
          const previa = await db.query<{ respuesta: { cuerpo?: Record<string, unknown> } | null }>(
            `SELECT respuesta FROM "OperacionAplicada" WHERE "empresaId" = $1 AND clave = $2`,
            [ctx.empresaId, clave],
          );
          const original = previa.rows[0]?.respuesta?.cuerpo ?? {};
          return {
            confirmar: false,
            valor: {
              status: 409,
              cuerpo: { ...original, error: { codigo: "YA_APLICADA", mensaje: "Esta operación ya se aplicó" } },
            },
          };
        }

        const respuesta = await manejador(servicios(db), ctx, req);

        // Solo lo exitoso queda registrado. Un rechazo deshace todo,
        // incluida la clave: tras corregir la causa, el reintento se aplica.
        if (respuesta.status >= 300) return { confirmar: false, valor: respuesta };

        await db.query(
          `UPDATE "OperacionAplicada" SET respuesta = $3 WHERE "empresaId" = $1 AND clave = $2`,
          [ctx.empresaId, clave, JSON.stringify({ status: respuesta.status, cuerpo: respuesta.cuerpo })],
        );
        return { confirmar: true, valor: respuesta };
      });

      return reply.status(r.status).send(r.cuerpo);
    };
  }

  const params = (req: FastifyRequest) => req.params as Record<string, string>;

  /**
   * Consulta: autenticada y con el contexto de RLS, sin clave de
   * idempotencia. Leer dos veces no cambia nada, así que exigirla sería
   * pedir ceremonia sin motivo.
   */
  function consulta(manejador: (s: Servicios, ctx: Contexto, req: FastifyRequest) => Promise<Respuesta>) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const auth = req.headers.authorization;
      const claims = auth?.startsWith("Bearer ") ? op.verificarToken(auth.slice(7)) : null;
      if (!claims) {
        return reply.status(401).send({ error: { codigo: "NO_AUTENTICADO", mensaje: "Sesión inválida o vencida" } });
      }
      const posible = contextoDe(claims);
      if ("motivo" in posible) {
        return reply.status(403).send({ error: { codigo: posible.motivo, mensaje: "Esta sesión no consulta datos de campo" } });
      }
      const ctx = posible;

      const r = await enTransaccion<Respuesta>(op.pool, ctx, async (db) => ({
        // Una consulta no escribe: la transacción se deshace siempre.
        confirmar: false,
        valor: await manejador(servicios(db), ctx, req),
      }));
      return reply.status(r.status).send(r.cuerpo);
    };
  }

  // Todas las rutas de la API van bajo /api/v1: versionarla permite
  // cambiarla después sin romper los APK ya instalados. /salud y /listo
  // quedan en la raíz (los agrega server.ts) porque los consulta la
  // infraestructura, no la app.
  void raiz.register(async (app) => {
    /**
   * Administración en línea (usuarios y sedes): autenticada y transaccional,
   * pero SIN la tabla de idempotencia. Esa tabla guarda la respuesta, y la
   * respuesta de crear un usuario lleva el código de activación: quedaría en
   * claro en la base. Repetir un alta no duplica: el correo es único.
   */
  async function comoAdministracion(req: FastifyRequest, manejador: Manejador): Promise<Respuesta> {
    const auth = req.headers.authorization;
    const claims = auth?.startsWith("Bearer ") ? op.verificarToken(auth.slice(7)) : null;
    if (!claims) return { status: 401, cuerpo: { error: { codigo: "NO_AUTENTICADO", mensaje: "Sesión inválida o vencida" } } };
    const posible = contextoDe(claims);
    if ("motivo" in posible) {
      return { status: 403, cuerpo: { error: { codigo: posible.motivo, mensaje: "Esta sesión no administra la empresa" } } };
    }
    const ctx = posible;
    return enTransaccion<Respuesta>(op.pool, ctx, async (db) => {
      const respuesta = await manejador(servicios(db), ctx, req);
      return { confirmar: respuesta.status < 300, valor: respuesta };
    });
  }

  function administracion(manejador: Manejador) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const r = await comoAdministracion(req, manejador);
      return reply.status(r.status).send(r.cuerpo);
    };
  }

  // ── Acceso ──
    //
    // No llevan clave de idempotencia: ingresar no es una operación de la cola,
    // y repetir un login simplemente devuelve una sesión nueva.

    /**
     * Sedes del usuario, para la respuesta de ingreso.
     *
     * El contrato (zUsuarioSesion) las exige y el login no las enviaba. Viven en
     * UsuarioSede, fuera de las cinco tablas del rol de acceso: en vez de
     * ampliarle los permisos, se leen con el rol de aplicación, ya con la
     * empresa conocida y bajo RLS. Sin empresa (superadmin) no hay sedes.
     */
    async function sedesDe(usuario: { id: string; empresaId: string | null; rol: string; clienteId: string | null }) {
      const ctx = contextoDe({ sub: usuario.id, empresaId: usuario.empresaId, rol: usuario.rol, clienteId: usuario.clienteId } as Claims);
      if ("motivo" in ctx) return { sedes: [] as string[], sedePrincipal: null as string | null };
      const filas = await enTransaccion(op.pool, ctx, async (db) => ({
        confirmar: false,
        valor: (
          await db.query<{ sedeId: string; esPrincipal: boolean }>(
            `SELECT "sedeId", "esPrincipal" FROM "UsuarioSede" WHERE "usuarioId" = $1 ORDER BY "sedeId"`,
            [usuario.id],
          )
        ).rows,
      }));
      return {
        sedes: filas.map((f) => f.sedeId),
        sedePrincipal: filas.find((f) => f.esPrincipal)?.sedeId ?? null,
      };
    }

    /** Traduce el resultado del servicio a la respuesta HTTP. */
    async function respuestaDeAcceso(r: ResultadoLogin, reply: FastifyReply) {
      if (r.tipo === "ok") {
        // Se eligen los campos uno por uno. El usuario del servicio incluye el
        // HASH DE LA CONTRASEÑA y el contador de intentos fallidos: enviarlo
        // entero expondría el hash a todo cliente, y quedaría en registros y
        // cachés. Un hash no es la contraseña, pero se puede atacar sin límite
        // de intentos.
        return reply.status(200).send({
          token: r.token,
          refreshToken: r.refreshToken,
          expiraEn: r.expiraEn,
          usuario: {
            id: r.usuario.id,
            nombre: r.usuario.nombre,
            email: r.usuario.email,
            rol: r.usuario.rol,
            empresaId: r.usuario.empresaId,
            clienteId: r.usuario.clienteId,
            ...(await sedesDe(r.usuario)),
          },
        });
      }
      if (r.tipo === "elegir_empresa") {
        // El mismo correo existe en varias empresas: la app pregunta cuál.
        return reply.status(409).send({ error: { codigo: "ELEGIR_EMPRESA" }, empresas: r.empresas });
      }
      // Credenciales, bloqueo por intentos, usuario inactivo. Siempre 401 para
      // no revelar cuál de esas cosas fue.
      return reply.status(401).send({
        error: { codigo: r.veredicto.codigo ?? "CREDENCIALES", mensaje: r.veredicto.mensaje },
      });
    }

    app.post("/auth/ingresar", async (req, reply) => {
      const cuerpo = (req.body ?? {}) as Record<string, unknown>;
      const email = typeof cuerpo["email"] === "string" ? cuerpo["email"] : "";
      const password = typeof cuerpo["password"] === "string" ? cuerpo["password"] : "";
      if (!email || !password) {
        return reply.status(422).send({ error: { codigo: "DATOS_INVALIDOS", mensaje: "Faltan el correo o la contraseña" } });
      }
      const r = await op.auth.login({
        email,
        password,
        ...(typeof cuerpo["empresaId"] === "string" ? { empresaId: cuerpo["empresaId"] } : {}),
        // Sin esto, quien tiene doble factor obligatorio no podía entrar nunca.
        ...(typeof cuerpo["codigo2fa"] === "string" ? { codigo2fa: cuerpo["codigo2fa"] } : {}),
        ...(req.ip ? { ip: req.ip } : {}),
      });
      return respuestaDeAcceso(r, reply);
    });

    app.post("/auth/refrescar", async (req, reply) => {
      const cuerpo = (req.body ?? {}) as Record<string, unknown>;
      const refreshToken = typeof cuerpo["refreshToken"] === "string" ? cuerpo["refreshToken"] : "";
      if (!refreshToken) {
        return reply.status(422).send({ error: { codigo: "DATOS_INVALIDOS", mensaje: "Falta el token de renovación" } });
      }
      const r = await op.auth.refrescar(refreshToken, { ...(req.ip ? { ip: req.ip } : {}) });
      return respuestaDeAcceso(r, reply);
    });

    /**
     * Activación de la cuenta con el código del administrador. Pública, como
     * el ingreso: quien activa todavía no tiene sesión.
     */
    app.post("/auth/activar", async (req, reply) => {
      const p = zActivarCuenta.safeParse(req.body);
      if (!p.success) {
        const r = datosInvalidos(p.error.issues);
        return reply.status(r.status).send(r.cuerpo);
      }
      const r = await op.auth.activar({ ...sinIndefinidos(p.data), ...(req.ip ? { ip: req.ip } : {}) });
      if (r.tipo === "ok") return reply.status(200).send({ activada: true });
      if (r.tipo === "configurar_2fa") {
        // No es un error: el rol exige doble factor y hay que registrarlo.
        return reply.status(200).send({ configurar2fa: { secreto: r.secreto, uri: r.uri } });
      }
      if (r.tipo === "elegir_empresa") {
        return reply.status(409).send({ error: { codigo: "ELEGIR_EMPRESA" }, empresas: r.empresas });
      }
      const debil = r.veredicto.codigo?.startsWith("PASSWORD");
      return reply.status(debil ? 422 : 401).send({ error: { codigo: r.veredicto.codigo, mensaje: r.veredicto.mensaje } });
    });


    // ── Rutas ──

    /**
     * Descarga: lo que el celular necesita para trabajar sin señal.
     *
     * Es de LECTURA, así que no lleva clave de idempotencia ni modifica nada;
     * pero sí corre dentro de la transacción con el contexto de RLS, porque el
     * aislamiento entre empresas no se puede saltar ni para leer.
     */
    app.get("/sincronizacion", async (req, reply) => {
      const auth = req.headers.authorization;
      const claims = auth?.startsWith("Bearer ") ? op.verificarToken(auth.slice(7)) : null;
      if (!claims) {
        return reply.status(401).send({ error: { codigo: "NO_AUTENTICADO", mensaje: "Sesión inválida o vencida" } });
      }
      const posible = contextoDe(claims);
      if ("motivo" in posible) {
        return reply.status(403).send({ error: { codigo: posible.motivo, mensaje: "Esta sesión no descarga datos de campo" } });
      }
      const ctx = posible;
      // Un desde mal formado llegaba a PostgreSQL y respondía 500.
      const consulta = zConsultaDescarga.safeParse(req.query ?? {});
      if (!consulta.success) {
        const r = datosInvalidos(consulta.error.issues);
        return reply.status(r.status).send(r.cuerpo);
      }
      const desde = consulta.data.desde;

      const paquete = await enTransaccion(op.pool, ctx, async (db) => ({
        confirmar: false,
        valor: await new ServicioDescarga(db, reloj).paquete(ctx, desde),
      }));
      return reply.status(200).send(paquete);
    });

    app.post("/ordenes", operacion(async (s, ctx, req) => {
      const p = zCrearOrden.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      // Un vehículo con otra orden abierta AVISA, no bloquea (CLAUDE.md, 1.6):
      // puede ser un correctivo urgente. La orden del celular es un comando: se
      // decidió en campo y, cuando por fin se envía, no hay a quién preguntarle
      // —igual que con las marcas creadas en campo—. Pedir confirmación aquí la
      // dejaba apartada para siempre.
      const r = await s.ordenes.crear(ctx, { ...p.data, confirmarDuplicada: true });
      if (!r.ok) return rechazo(r.veredicto);
      return {
        status: 201,
        cuerpo: {
          id: r.valor.orden.id,
          folio: r.valor.orden.folio,
          // Otra orden abierta para el mismo vehículo: se avisa, no se bloquea.
          ...(r.valor.avisoVehiculoOcupado ? { aviso: r.valor.avisoVehiculoOcupado } : {}),
        },
      };
    }));

    app.patch("/ordenes/:id", operacion(async (s, ctx, req) => {
      const p = zComandoActualizarOrden.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.ordenes.actualizarDatos(ctx, params(req).id as string, COMANDO, sinIndefinidos(p.data));
      if (!r.ok) return rechazo(r.veredicto);
      return { status: 200, cuerpo: { versionContenido: r.valor.versionContenido } };
    }));

    app.put("/ordenes/:id/mediciones/:medicionId", operacion(async (s, ctx, req) => {
      const { id, medicionId } = params(req);
      const cuerpo = req.body as Record<string, unknown>;
      // El id de la URL y el del cuerpo deben coincidir: si no, algo en el
      // cliente está mal armado y no conviene adivinar cuál manda.
      if (cuerpo?.["id"] !== undefined && cuerpo["id"] !== medicionId) {
        return datosInvalidos([{ path: ["id"], message: "El id del cuerpo no coincide con el de la ruta" }]);
      }
      const r = await s.mediciones.guardar(ctx, id as string, { ...cuerpo, id: medicionId });
      if (!r.ok) return rechazo(r.veredicto);
      return { status: 200, cuerpo: r.valor };
    }));

    app.post("/ordenes/:id/estado", operacion(async (s, ctx, req) => {
      const p = zCambiarEstado.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.ordenes.cambiarEstado(ctx, params(req).id as string, COMANDO, p.data.estado, {
        ...(p.data.motivo ? { motivo: p.data.motivo } : {}),
      });
      if (!r.ok) return rechazo(r.veredicto);
      return { status: 200, cuerpo: { estado: r.valor.estado } };
    }));

    app.post("/ordenes/:id/firma", operacion(async (s, ctx, req) => {
      const p = zFirma.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.ordenes.firmar(ctx, params(req).id as string, COMANDO, p.data);
      if (!r.ok) return rechazo(r.veredicto);
      return { status: 200, cuerpo: { firmaVersion: r.valor.firmaVersion } };
    }));

    app.post("/ordenes/:id/reasignar", operacion(async (s, ctx, req) => {
      const p = zReasignar.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.ordenes.reasignar(ctx, params(req).id as string, COMANDO, p.data.tecnicoId, p.data.motivo);
      if (!r.ok) return rechazo(r.veredicto);
      return { status: 200, cuerpo: { tecnicoId: r.valor.tecnicoId } };
    }));

    // ── Recomendaciones persistentes ──
    // Operaciones de la cola: se registran sin señal y llegan después.

    app.post("/ordenes/:id/recomendaciones", operacion(async (s, ctx, req) => {
      const p = zCrearRecomendacion.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.recomendaciones.crear(ctx, params(req).id as string, p.data);
      return r.ok ? { status: 201, cuerpo: r.valor } : rechazo(r.veredicto);
    }));

    app.post("/recomendaciones/:id/resolver", operacion(async (s, ctx, req) => {
      const p = zResolverRecomendacion.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.recomendaciones.resolver(ctx, params(req).id as string, p.data);
      return r.ok ? { status: 200, cuerpo: r.valor } : rechazo(r.veredicto);
    }));

    /**
     * PDF de la orden: la constancia del servicio. Es una salida de datos,
     * así que queda en la auditoría como las exportaciones; por eso la
     * transacción se confirma (una consulta la desharía).
     */
    app.get("/ordenes/:id/pdf", async (req, reply) => {
      const auth = req.headers.authorization;
      const claims = auth?.startsWith("Bearer ") ? op.verificarToken(auth.slice(7)) : null;
      if (!claims) return reply.status(401).send({ error: { codigo: "NO_AUTENTICADO", mensaje: "Sesión inválida" } });
      const posible = contextoDe(claims);
      if ("motivo" in posible) return reply.status(403).send({ error: { codigo: posible.motivo, mensaje: "Esta sesión no ve órdenes" } });
      const ctx = posible;
      const id = zId.safeParse(params(req).id);
      if (!id.success) return reply.status(404).send({ error: { codigo: "NO_EXISTE", mensaje: "La orden no existe" } });

      const r = await enTransaccion(op.pool, ctx, async (db) => {
        const documento = new ServicioDocumento(db);
        const datos = await documento.datos(ctx, id.data);
        if (!datos) return { confirmar: false, valor: null };
        await new ServicioInforme(db, reloj).registrarAuditoria(ctx, "exportar_informe", {
          origen: "pdf_orden", ordenId: id.data, folio: datos.orden.folio, estado: datos.orden.estado,
        });
        // Hora de Colombia, como todo "hoy" del sistema.
        const generadoEn = new Date(reloj().getTime() - 5 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
        return { confirmar: true, valor: { pdf: await documento.pdf(datos, generadoEn), nombre: documento.nombreArchivo(datos) } };
      });
      if (!r) return reply.status(404).send({ error: { codigo: "NO_EXISTE", mensaje: "La orden no existe" } });
      return reply
        .status(200)
        .header("content-type", "application/pdf")
        .header("content-disposition", `attachment; filename="${r.nombre}"`)
        .send(r.pdf);
    });

    /**
     * Llantas para cambiar: DOT vencido o por vencer, profundidad bajo el
     * mínimo de su eje. Se calculaban en el servidor y no se le mostraban a
     * nadie. Solo la oficina, y solo sus sedes.
     */
    app.get("/alertas", consulta(async (s, ctx) => {
      if (!puedeAprobar(ctx.rol)) return { status: 403, cuerpo: { error: { codigo: "SIN_PERMISO", mensaje: "Las alertas son de la oficina" } } };
      const db = s.consulta;
      const alertas = await s.alertas.revisarAlertas(ctx.empresaId, { soloSedesDe: ctx.usuarioId });
      const ids = [...new Set(alertas.map((a) => a.vehiculoId))];
      const vehiculos = ids.length === 0 ? [] : (await db.query<{ id: string; codigo: string; placa: string | null; cliente: string }>(
        `SELECT v.id, v.codigo, v.placa, c.nombre AS cliente FROM "Vehiculo" v
           JOIN "SedeCliente" sc ON sc.id = v."sedeClienteId" JOIN "Cliente" c ON c.id = sc."clienteId"
          WHERE v.id = ANY($1::text[])`,
        [ids],
      )).rows;
      const porId = new Map(vehiculos.map((v) => [v.id, v]));
      return {
        status: 200,
        cuerpo: alertas.map((a) => ({
          ...a,
          vehiculoCodigo: porId.get(a.vehiculoId)?.codigo ?? a.vehiculoId,
          vehiculoPlaca: porId.get(a.vehiculoId)?.placa ?? null,
          clienteNombre: porId.get(a.vehiculoId)?.cliente ?? "",
        })),
      };
    }));

    /** La evidencia de la orden, con URL de lectura que vence. */
    app.get("/ordenes/:id/fotos", consulta(async (s, ctx, req) => {
      const id = zId.safeParse(params(req).id);
      if (!id.success) return { status: 404, cuerpo: { error: { codigo: "NO_EXISTE", mensaje: "La orden no existe" } } };
      const r = await s.fotos.evidencia(ctx, id.data);
      return r.ok ? { status: 200, cuerpo: r.valor } : rechazo(r.veredicto);
    }));

    app.post("/ordenes/:id/fotos", operacion(async (s, ctx, req) => {
      const p = zAdjuntarFoto.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.fotos.adjuntarFoto(ctx, {
        id: p.data.id,
        ordenId: params(req).id as string,
        ...(p.data.medicionId ? { llantaRegistroId: p.data.medicionId } : {}),
        nombreArchivo: p.data.nombre,
        tipoMime: p.data.tipoMime,
        tamanoBytes: p.data.tamanoBytes,
      });
      if (!r.ok) return rechazo(r.veredicto);
      // La URL firmada para subir los bytes; vence en minutos.
      return { status: 201, cuerpo: { fotoId: r.valor.fotoId, url: r.valor.url, expiraEn: r.valor.expiraEn } };
    }));

    // ── Flota ──
    //
    // Los servicios existían desde la fase 1 y no tenían puerta de entrada: la
    // administración era inalcanzable desde cualquier cliente.

    app.get("/flota/clientes", consulta(async (s, ctx, req) => {
      const incluirInactivos = (req.query as { inactivos?: string })?.inactivos === "1";
      return { status: 200, cuerpo: await s.flota.listarClientes(ctx, incluirInactivos) };
    }));

    app.get("/flota/clientes/:id/sedes", consulta(async (s, ctx, req) => ({
      status: 200,
      cuerpo: await s.flota.sedesDeCliente(ctx, params(req).id as string),
    })));

    app.get("/flota/sedes/:id/vehiculos", consulta(async (s, ctx, req) => ({
      status: 200,
      cuerpo: await s.flota.vehiculosDeSede(ctx, params(req).id as string),
    })));

    app.post("/flota/clientes", operacion(async (s, ctx, req) => {
      const p = zCrearCliente.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.flota.crearCliente(ctx, sinIndefinidos(p.data));
      if (!r.ok) return rechazo(r.veredicto);
      return { status: 201, cuerpo: r.valor };
    }));

    app.post("/flota/sedes", operacion(async (s, ctx, req) => {
      const p = zCrearSedeCliente.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.flota.crearSedeCliente(ctx, sinIndefinidos(p.data));
      if (!r.ok) return rechazo(r.veredicto);
      return { status: 201, cuerpo: r.valor };
    }));

    app.post("/flota/vehiculos", operacion(async (s, ctx, req) => {
      const p = zCrearVehiculo.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.flota.crearVehiculo(ctx, sinIndefinidos(p.data));
      if (!r.ok) return rechazo(r.veredicto);
      return { status: 201, cuerpo: r.valor };
    }));

    // ── Informe ──

    /**
     * Exportación del informe en el formato del taller.
     *
     * Devuelve el archivo, no JSON: lo que el coordinador hace con esto es
     * abrirlo en una hoja de cálculo.
     */
    app.get("/informe/exportar", async (req, reply) => {
      const auth = req.headers.authorization;
      const claims = auth?.startsWith("Bearer ") ? op.verificarToken(auth.slice(7)) : null;
      if (!claims) return reply.status(401).send({ error: { codigo: "NO_AUTENTICADO", mensaje: "Sesión inválida" } });
      const posible = contextoDe(claims);
      if ("motivo" in posible) {
        return reply.status(403).send({ error: { codigo: posible.motivo, mensaje: "Esta sesión no exporta informes" } });
      }
      const ctx = posible;
      const filtro = filtroInforme(req);
      if (!filtro.ok) return reply.status(filtro.r.status).send(filtro.r.cuerpo);
      const q = filtro.q;

      const r = await enTransaccion(op.pool, ctx, async (db) => {
        // Todo el filtro, no una lista escrita a mano: esa lista omitía
        // ordenIds y estadoLlanta, y elegir tres órdenes exportaba la cartera
        // entera del cliente —y la auditoría registraba filtros que no eran—.
        const exportado = await new ServicioInforme(db, reloj).exportar(ctx, sinIndefinidos(q));
        // Se confirma: la exportación ESCRIBE su constancia en la auditoría.
        // Con la transacción deshecha (como una consulta), ninguna exportación
        // quedaba registrada y la auditoría decía que nunca salió nada.
        return { confirmar: exportado.ok, valor: exportado };
      });

      if (!r.ok) return reply.status(estadoDe(r.veredicto)).send({ error: { codigo: r.veredicto.codigo, mensaje: r.veredicto.mensaje } });
      return reply
        .status(200)
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${r.valor.nombreArchivo}"`)
        // Cuántas órdenes quedaron sin cerrar va en un encabezado: el archivo
        // es para la hoja de cálculo y no debe llevar avisos entre los datos.
        .header("x-ordenes-sin-cerrar", String(r.valor.sinCerrar))
        .send(r.valor.contenido);
    });

    /**
     * Lo mismo que saldría en el archivo, resumido para la pantalla: se
     * revisa el filtro antes de exportar. Mismos filtros que la exportación,
     * leídos por la misma función, para que lo que se ve sea lo que sale.
     */
    app.get("/informe/resumen", consulta(async (s, ctx, req) => {
      const filtro = filtroInforme(req);
      if (!filtro.ok) return filtro.r;
      return { status: 200, cuerpo: await s.informe.vistaPrevia(ctx, sinIndefinidos(filtro.q)) };
    }));

    /** Recorrido de una llanta por su serial: dónde estuvo y cuánto se gastó. */
    app.get("/informe/trazabilidad", consulta(async (s, ctx, req) => {
      const p = zTrazabilidad.safeParse(req.query ?? {});
      if (!p.success) return datosInvalidos(p.error.issues);
      return { status: 200, cuerpo: await s.informe.trazabilidad(ctx, p.data.serial) };
    }));

    // ── Catálogo ──
    //
    // El técnico crea marcas y diseños en campo, cuando la llanta que tiene
    // enfrente no está en la lista. Sin estas rutas, esas operaciones recibían
    // un 404 y quedaban apartadas: la marca nunca llegaba al servidor.

    app.post("/catalogo/marcas", operacion(async (s, ctx, req) => {
      // creadaEnCampo se ignora aunque venga: lo decide el ROL (tarea 1.4).
      const p = zCrearMarca.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.catalogo.crearMarca(ctx, {
        nombre: p.data.nombre,
        id: p.data.id,
        // El técnico ya decidió en el celular, donde vio las parecidas. Volver
        // a preguntarle desde el servidor no tiene a quién preguntarle: la
        // operación se envía cuando él ya no está mirando.
        forzar: true,
      });
      if (!r.ok) return rechazo(r.veredicto);
      return { status: 201, cuerpo: { id: r.valor.marca.id } };
    }));

    app.post("/catalogo/disenos", operacion(async (s, ctx, req) => {
      const p = zCrearDiseno.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.catalogo.crearDiseno(ctx, {
        marcaId: p.data.marcaId,
        nombre: p.data.nombre,
        id: p.data.id,
        tipoEje: p.data.tipoEje,
        forzar: true,
      });
      if (!r.ok) return rechazo(r.veredicto);
      return { status: 201, cuerpo: { id: r.valor.diseno.id } };
    }));

    app.post("/fotos/:id/confirmar", operacion(async (s, ctx, req) => {
      const r = await s.fotos.confirmarSubida(ctx, params(req).id as string);
      if (!r.ok) return rechazo(r.veredicto);
      return { status: 200, cuerpo: { confirmada: true } };
    }));
    // ── Usuarios y sedes (5.2) ──

    app.get("/usuarios", administracion(async (s, ctx) => {
      const r = await s.usuarios.listar(ctx);
      return r.ok ? { status: 200, cuerpo: r.valor } : rechazo(r.veredicto);
    }));

    /**
     * Alta: crea el usuario bajo RLS y, ya confirmado, el servicio de acceso
     * emite el código. Si esto último fallara, el usuario existe sin código y
     * el administrador puede pedir uno nuevo: no hay nada que deshacer.
     */
    app.post("/usuarios", async (req, reply) => {
      const p = zCrearUsuario.safeParse(req.body);
      if (!p.success) {
        const r = datosInvalidos(p.error.issues);
        return reply.status(r.status).send(r.cuerpo);
      }
      const creado = await comoAdministracion(req, async (s, ctx) => {
        const r = await s.usuarios.crear(ctx, p.data);
        return r.ok ? { status: 201, cuerpo: { id: r.valor.id } } : rechazo(r.veredicto);
      });
      if (creado.status >= 300) return reply.status(creado.status).send(creado.cuerpo);
      const id = (creado.cuerpo as { id: string }).id;
      const codigo = await op.auth.crearCodigoActivacion(id, req.ip);
      return reply.status(201).send({ id, ...(codigo ? { codigo: codigo.codigo, expiraEn: codigo.expiraEn } : {}) });
    });

    /** Código nuevo: alta que venció, o ayuda para recuperar la cuenta. */
    app.post("/usuarios/:id/codigo", async (req, reply) => {
      const id = params(req).id as string;
      const visto = await comoAdministracion(req, async (s, ctx) => {
        const r = await s.usuarios.existe(ctx, id);
        return r.ok ? { status: 200, cuerpo: {} } : rechazo(r.veredicto);
      });
      if (visto.status >= 300) return reply.status(visto.status).send(visto.cuerpo);
      const codigo = await op.auth.crearCodigoActivacion(id, req.ip);
      if (!codigo) return reply.status(404).send({ error: { codigo: "NO_EXISTE", mensaje: "El usuario no existe" } });
      return reply.status(200).send({ codigo: codigo.codigo, expiraEn: codigo.expiraEn });
    });

    // ── Plantillas de ejes: solo administrador; son estructura ──

    app.post("/configuraciones", administracion(async (s, ctx, req) => {
      const p = zCrearConfiguracionEje.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.flota.crearConfiguracion(ctx, { id: p.data.id, nombre: p.data.nombre, ejes: p.data.ejes.map(sinIndefinidos) });
      return r.ok ? { status: 201, cuerpo: { id: r.valor.id } } : rechazo(r.veredicto);
    }));

    /**
     * Nunca se edita en sitio: versión nueva. Si cambia vehículos en uso,
     * responde REQUIERE_CONFIRMACION y se reenvía con confirmado: true.
     */
    app.post("/configuraciones/:id/version", administracion(async (s, ctx, req) => {
      const p = zVersionConfiguracion.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.flota.nuevaVersion(ctx, {
        configuracionAnteriorId: params(req).id as string,
        ejes: p.data.ejes.map(sinIndefinidos),
        ...(p.data.confirmado ? { confirmado: true } : {}),
      });
      if (!r.ok) return rechazo(r.veredicto);
      return { status: 201, cuerpo: { id: r.valor.configuracion.id, vehiculosMovidos: r.valor.vehiculosMovidos } };
    }));

    app.get("/sedes", administracion(async (s, ctx) => {
      const r = await s.usuarios.sedes(ctx);
      return r.ok ? { status: 200, cuerpo: r.valor } : rechazo(r.veredicto);
    }));

    app.post("/sedes", administracion(async (s, ctx, req) => {
      const p = zCrearSede.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.usuarios.crearSede(ctx, sinIndefinidos(p.data));
      return r.ok ? { status: 201, cuerpo: r.valor } : rechazo(r.veredicto);
    }));

    // ── Programación recurrente (4.4) ──
    //
    // En línea, como la administración: es trabajo de oficina, y el
    // coordinador necesita saber en el momento si quedó o por qué no.

    app.get("/programaciones", administracion(async (s, ctx) => {
      const r = await s.programaciones.listar(ctx);
      return r.ok ? { status: 200, cuerpo: r.valor } : rechazo(r.veredicto);
    }));

    app.post("/programaciones", administracion(async (s, ctx, req) => {
      const p = zCrearProgramacion.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      // "Hoy" en Colombia: una programación para hoy hecha a las 8 p. m. no
      // es "en el pasado".
      const r = await s.programaciones.crear(ctx, p.data, fechaEnColombia(reloj()));
      return r.ok ? { status: 201, cuerpo: r.valor } : rechazo(r.veredicto);
    }));

    app.post("/programaciones/:id/desactivar", administracion(async (s, ctx, req) => {
      const id = zId.safeParse(params(req).id);
      if (!id.success) return datosInvalidos(id.error.issues);
      const r = await s.programaciones.desactivar(ctx, id.data);
      return r.ok ? { status: 200, cuerpo: r.valor } : rechazo(r.veredicto);
    }));

    app.post("/programaciones/:id/tecnico", administracion(async (s, ctx, req) => {
      const id = zId.safeParse(params(req).id);
      const p = zCambiarTecnicoProgramacion.safeParse(req.body);
      if (!id.success) return datosInvalidos(id.error.issues);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.programaciones.cambiarTecnico(ctx, id.data, p.data.tecnicoId);
      return r.ok ? { status: 200, cuerpo: r.valor } : rechazo(r.veredicto);
    }));
  }, { prefix: PREFIJO_API });

  // Cualquier error no previsto: 500 sin detalles internos. La transacción
  // ya se deshizo, así que la clave no quedó consumida y el reintento del
  // celular puede aplicarse.
  raiz.setErrorHandler((error, _req, reply) => {
    if ((error as { statusCode?: number }).statusCode === 400) {
      return reply.status(422).send({ error: { codigo: "DATOS_INVALIDOS", mensaje: "El cuerpo no es JSON válido" } });
    }
    raiz.log.error(error);
    return reply.status(500).send({ error: { codigo: "ERROR_INTERNO", mensaje: "Error del servidor. Se reintentará" } });
  });

  return raiz;
}
