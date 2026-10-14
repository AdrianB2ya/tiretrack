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
  zCrearMedida,
  zProfundidadOriginal,
  zLimitesEmpresa,
  zCrearLlanta,
  zMovimientoLlanta,
  zFiltroLlantas,
  zStockMinimo,
  zCrearReclamo,
  zCambioReclamo,
  zFiltroCausas,
  zCrearMarca,
  zCrearOrden,
  zActivarCuenta,
  zCambiarTecnicoProgramacion,
  zConsultaAuditoria,
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
  zLiberarBloqueo,
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
import { DURACION_SOPORTE, nuevoId, permitidoEnSoporte, validarSoporte, correoCotizacion, correoInforme, correoLlantasParaCambio, correoOrden, fechaEnColombia, type LlantaParaAviso, MAX_DESTINATARIOS, MAX_ORDENES_PDF, puedeAprobar, revisarDestinatarios, puedeVerAuditoria, ROLES, TIPOS_CARGA, type Rol, type TipoCarga, type Veredicto } from "@tiretrack/domain";
import type { Claims, ResultadoActivacion, ResultadoLogin } from "../acceso/servicio";
import { ServicioUsuarios } from "../usuarios/servicio";
import { ServicioEmpresa } from "../empresa/servicio";
import { ServicioLlantas } from "../llantas/servicio";
import { ServicioReclamos } from "../llantas/reclamos";
import { tableroDeFlota } from "../informe/tablero";
import { ServicioCarga } from "../carga/servicio";
import { crearEmpresa } from "../herramientas/crearEmpresa";
import { MAX_ETIQUETAS, pdfEtiquetas, vehiculosParaEtiquetas } from "../flota/etiquetasQr";
import { cotizacionDe, pdfCotizacion } from "../informe/cotizacion";
import { CorreoDesactivado, type Correo } from "../correo/correo";
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
import { POR_PAGINA_AUDITORIA, ServicioInforme, type FiltroInforme } from "../informe/servicio";
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
  revocarSesionesDe(usuarioId: string): Promise<void>;
  /** Token de la sesión de soporte del superadmin (R16). */
  firmarSoporte(d: { superadminId: string; empresaId: string; sesionId: string; expiraEn: Date }): string;
}

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
  readonly clienteId: string | null;
  readonly vistaCliente: boolean;
  /** Sesión de soporte del superadmin (R16): marca la auditoría desde la base. */
  readonly soporteId?: string;
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
  /** Envío de informes por correo (R13). Sin él, desactivado. */
  readonly correo?: Correo;
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
  // Trabajo abierto: primero se reasigna o se cierra.
  TIENE_ORDENES_ABIERTAS: 409,
  TIENE_HIJOS_ACTIVOS: 409,
  TIENE_PROGRAMACIONES: 409,
  UNO_MISMO: 409,
  // Revisión del catálogo.
  MISMA_ENTRADA: 409,
  NO_PROPIA: 409,
  YA_UNIFICADA: 409,
  DESTINO_INACTIVO: 409,
  OTRA_MARCA: 409,
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
  // Bloqueo (R7): no es un dato mal escrito, es el estado de la orden.
  YA_BLOQUEADA: 409,
  ORDEN_BLOQUEADA: 409,
  NO_BLOQUEADA: 409,
  ESTADO_INVALIDO: 409,
  // Inventario (R8): el estado de la llanta no permite ese paso.
  MOVIMIENTO_INVALIDO: 409,
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
const zUnificarCatalogo = z.object({ destinoId: zId });

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
    ...(claims.soporte ? { soporteId: claims.soporte } : {}),
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
              set_config('app.cliente_id', $4, true),
              set_config('app.soporte_id', $5, true)`,
      [ctx.empresaId, ctx.usuarioId, ctx.rol, ctx.clienteId ?? "", ctx.soporteId ?? ""],
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
  const correo: Correo = op.correo ?? new CorreoDesactivado();

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
      empresa: new ServicioEmpresa(db),
      llantas: new ServicioLlantas(db, reloj),
      reclamos: new ServicioReclamos(db, reloj),
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
     * Sesión de soporte del superadmin (R16): SOLO LECTURA y viva. Antes de
     * cualquier ruta: un token de soporte que intenta escribir se rechaza
     * aquí, y uno de una sesión terminada o vencida no pasa aunque el token
     * siga firmado. Una sola consulta, y solo para estos tokens.
     */
    app.addHook("onRequest", async (req, reply) => {
      const auth = req.headers.authorization;
      const claims = auth?.startsWith("Bearer ") ? op.verificarToken(auth.slice(7)) : null;
      if (!claims?.soporte || !claims.empresaId) return;
      if (!permitidoEnSoporte(req.method, req.url)) {
        return reply.status(403).send({
          error: { codigo: "SOPORTE_SOLO_LECTURA", mensaje: "La sesión de soporte es de solo lectura: lo que haya que cambiar lo hace la empresa" },
        });
      }
      const ctx: Contexto = { empresaId: claims.empresaId, rol: "superadmin", usuarioId: claims.sub, clienteId: null, vistaCliente: false };
      const viva = await enTransaccion(op.pool, ctx, async (db) => ({
        confirmar: false,
        valor: (await db.query(
          `SELECT 1 FROM "SesionSuplantacion"
            WHERE id = $1 AND "superadminId" = $2 AND "empresaId" = $3 AND "terminadaEn" IS NULL AND "expiraEn" > now()`,
          [claims.soporte, claims.sub, claims.empresaId],
        )).rows.length > 0,
      }));
      if (!viva) {
        return reply.status(401).send({ error: { codigo: "SOPORTE_TERMINADO", mensaje: "La sesión de soporte terminó o venció" } });
      }
    });

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
      // R8: CERRADA, lo que se midió arma la historia de cada llanta (decisión
      // del usuario, 2026-10-14: al cierre, no al aprobar: una orden objetada
      // vuelve al técnico y todavía puede cambiar). En la misma transacción: o
      // queda el cierre con su inventario, o nada.
      //
      // Quien cierra es el cliente, y la base no le deja escribir datos
      // operativos (cliente_no_escribe). La historia la escribe el SISTEMA:
      // el rol del contexto cambia solo para esta llamada y se restituye.
      if (r.valor.estado === "cerrada") {
        await s.consulta.query(`SELECT set_config('app.rol', 'sistema', true)`);
        await s.llantas.procesarOrden({ empresaId: ctx.empresaId, rol: ctx.rol, usuarioId: "" }, r.valor.id);
        await s.consulta.query(`SELECT set_config('app.rol', $1, true)`, [ctx.rol]);
      }
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

    // ── Bloqueo de la orden (R7) ──
    // En línea: sin señal no se puede pedir ni comprobar un bloqueo. El
    // técnico se la lleva ANTES de salir; la oficina la libera con motivo.

    app.post("/ordenes/:id/bloqueo", administracion(async (s, ctx, req) => {
      const id = params(req).id as string;
      const r = await s.ordenes.tomarBloqueo(ctx, id);
      if (!r.ok) return rechazo(r.veredicto);
      await s.informe.registrarAuditoria(ctx, "actualizar", { entidad: "orden", id, bloqueo: "tomado" });
      return { status: 200, cuerpo: { bloqueadaPorId: r.valor.bloqueadaPorId, bloqueadaEn: r.valor.bloqueadaEn } };
    }));

    app.post("/ordenes/:id/bloqueo/liberar", administracion(async (s, ctx, req) => {
      const p = zLiberarBloqueo.safeParse(req.body ?? {});
      if (!p.success) return datosInvalidos(p.error.issues);
      const id = params(req).id as string;
      const r = await s.ordenes.liberarBloqueo(ctx, id, p.data.motivo ?? null);
      if (!r.ok) return rechazo(r.veredicto);
      await s.informe.registrarAuditoria(ctx, "actualizar", {
        entidad: "orden", id, bloqueo: "liberado", teniaId: r.valor.teniaId, motivo: p.data.motivo ?? null,
      });
      return { status: 200, cuerpo: { bloqueadaPorId: null } };
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
        const x = await pdfDeOrden(db, ctx, id.data, { origen: "pdf_orden" });
        return { confirmar: x.ok, valor: x };
      });
      if (!r.ok) return reply.status(r.status).send(r.cuerpo);
      return reply
        .status(200)
        .header("content-type", "application/pdf")
        .header("content-disposition", `attachment; filename="${r.archivo.nombre}"`)
        .send(r.archivo.contenido);
    });

    /**
     * Llantas para cambiar: DOT vencido o por vencer, profundidad bajo el
     * mínimo de su eje. Se calculaban en el servidor y no se le mostraban a
     * nadie. Solo la oficina, y solo sus sedes.
     */
    // ── La llanta como activo (R8) ──
    // En línea: es gestión de inventario en la oficina, no captura de campo.

    app.get("/llantas", consulta(async (s, _ctx, req) => {
      const p = zFiltroLlantas.safeParse(req.query ?? {});
      if (!p.success) return datosInvalidos(p.error.issues);
      return { status: 200, cuerpo: await s.llantas.listar(p.data) };
    }));

    app.get("/llantas/stock", consulta(async (s) => ({ status: 200, cuerpo: await s.llantas.stock() })));

    app.get("/llantas/:id", consulta(async (s, _ctx, req) => {
      const id = zId.safeParse(params(req).id);
      if (!id.success) return { status: 404, cuerpo: { error: { codigo: "NO_EXISTE", mensaje: "No existe" } } };
      const r = await s.llantas.ficha(id.data);
      return r.ok ? { status: 200, cuerpo: r.valor } : rechazo(r.veredicto);
    }));

    app.post("/llantas", administracion(async (s, ctx, req) => {
      const p = zCrearLlanta.safeParse(req.body ?? {});
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.llantas.crear(ctx, p.data);
      if (!r.ok) return rechazo(r.veredicto);
      await s.informe.registrarAuditoria(ctx, "crear", { entidad: "llanta", id: p.data.id });
      return { status: 201, cuerpo: r.valor };
    }));

    app.post("/llantas/:id/movimientos", administracion(async (s, ctx, req) => {
      const id = zId.safeParse(params(req).id);
      if (!id.success) return { status: 404, cuerpo: { error: { codigo: "NO_EXISTE", mensaje: "No existe" } } };
      const p = zMovimientoLlanta.safeParse(req.body ?? {});
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.llantas.mover(ctx, id.data, p.data);
      if (!r.ok) return rechazo(r.veredicto);
      await s.informe.registrarAuditoria(ctx, "actualizar", { entidad: "llanta", id: id.data, movimiento: p.data.tipo });
      return { status: 200, cuerpo: r.valor };
    }));

    app.post("/llantas/stock-minimo", administracion(async (s, ctx, req) => {
      const p = zStockMinimo.safeParse(req.body ?? {});
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.llantas.fijarStockMinimo(ctx, p.data);
      return r.ok ? { status: 200, cuerpo: {} } : rechazo(r.veredicto);
    }));

    // ── Retiro y garantías (R10) ──

    // ── Archivos que salen: descarga y correo (R13) ──
    // La misma generación y la misma auditoría para descargar y para enviar.

    type Archivo = { nombre: string; contenido: Buffer; tipo: string; ordenes: number; sinCerrar: number; folio: string; vehiculo: string };
    type Salida = { ok: true; archivo: Archivo } | { ok: false; status: number; cuerpo: unknown };
    const errorSalida = (status: number, codigo: string, mensaje: string): Salida => ({ ok: false, status, cuerpo: { error: { codigo, mensaje } } });
    // Hora de Colombia, como todo "hoy" del sistema.
    const generadoEn = () => new Date(reloj().getTime() - 5 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");

    async function pdfDeOrden(db: pg.PoolClient, ctx: Contexto, ordenId: string, auditoria: Record<string, unknown>): Promise<Salida> {
      const documento = new ServicioDocumento(db);
      const datos = await documento.datos(ctx, ordenId);
      if (!datos) return errorSalida(404, "NO_EXISTE", "La orden no existe");
      await new ServicioInforme(db, reloj).registrarAuditoria(ctx, "exportar_informe", {
        ordenId, folio: datos.orden.folio, estado: datos.orden.estado, ...auditoria,
      });
      return {
        ok: true,
        archivo: {
          nombre: documento.nombreArchivo(datos), contenido: await documento.pdf(datos, generadoEn()), tipo: "application/pdf",
          ordenes: 1, sinCerrar: datos.orden.estado === "cerrada" ? 0 : 1,
          folio: datos.orden.folio ?? datos.orden.codigoReferencia ?? "sin folio", vehiculo: datos.vehiculo.codigo,
        },
      };
    }

    async function pdfDeInforme(db: pg.PoolClient, ctx: Contexto, q: FiltroInforme, auditoria: Record<string, unknown>): Promise<Salida> {
      const informe = new ServicioInforme(db, reloj);
      // Las órdenes que el filtro encuentra (con RLS: solo las visibles).
      const ids = [...new Set((await informe.consultar(ctx, q)).map((x) => x.ordenId).filter((x): x is string => Boolean(x)))];
      if (ids.length === 0) return errorSalida(404, "SIN_REGISTROS", "No hay órdenes con ese filtro");
      if (ids.length > MAX_ORDENES_PDF) {
        return errorSalida(422, "DEMASIADAS_ORDENES", `Son ${ids.length} órdenes: elige hasta ${MAX_ORDENES_PDF} para el PDF, o exporta el CSV`);
      }
      const documento = new ServicioDocumento(db);
      const lista = [];
      // Una a una sobre la misma conexión: pg no admite consultas simultáneas en ella.
      for (const id of ids) {
        const d = await documento.datos(ctx, id);
        if (d) lista.push(d);
      }
      if (lista.length === 0) return errorSalida(404, "SIN_REGISTROS", "No hay órdenes con ese filtro");
      const folios = lista.map((d) => d.orden.folio ?? d.orden.codigoReferencia ?? "sin folio");
      const sinCerrar = lista.filter((d) => d.orden.estado !== "cerrada").length;
      await informe.registrarAuditoria(ctx, "exportar_informe", {
        ordenes: lista.length, folios: folios.slice(0, 20), sinCerrar, filtros: q, ...auditoria,
      });
      const hoy = fechaEnColombia(reloj());
      return {
        ok: true,
        archivo: {
          nombre: lista.length === 1 ? documento.nombreArchivo(lista[0]!) : `ordenes-${hoy}.pdf`,
          contenido: await documento.pdfVarias(lista, `Órdenes de servicio ${hoy}`, generadoEn()),
          tipo: "application/pdf", ordenes: lista.length, sinCerrar, folio: "", vehiculo: "",
        },
      };
    }

    async function csvDeInforme(db: pg.PoolClient, ctx: Contexto, q: FiltroInforme, auditoria: Record<string, unknown>): Promise<Salida> {
      const x = await new ServicioInforme(db, reloj).exportar(ctx, q, "informe", auditoria);
      if (!x.ok) return errorSalida(estadoDe(x.veredicto), x.veredicto.codigo ?? "RECHAZADO", x.veredicto.mensaje ?? "No se pudo exportar");
      return {
        ok: true,
        archivo: {
          nombre: x.valor.nombreArchivo, contenido: Buffer.from(x.valor.contenido, "utf8"), tipo: "text/csv",
          ordenes: x.valor.ordenes, sinCerrar: x.valor.sinCerrar, folio: "", vehiculo: "",
        },
      };
    }

    /** Quién envía y de qué empresa: van en el texto del correo. */
    async function remitenteDe(db: pg.PoolClient, ctx: Contexto) {
      const r = await db.query<{ empresa: string; quien: string | null }>(
        `SELECT e.nombre AS empresa, (SELECT u.nombre FROM "Usuario" u WHERE u.id = $2) AS quien FROM "Empresa" e WHERE e.id = $1`,
        [ctx.empresaId, ctx.usuarioId],
      );
      return { empresa: r.rows[0]?.empresa ?? "", quien: r.rows[0]?.quien ?? "un usuario" };
    }

    /**
     * Envía dentro de la transacción: si el proveedor falla, se deshace
     * también la constancia de la auditoría (no salió nada). Los
     * destinatarios quedan en la auditoría.
     */
    async function enviarArchivo(
      req: FastifyRequest,
      reply: FastifyReply,
      origen: string,
      generar: (db: pg.PoolClient, ctx: Contexto, auditoria: Record<string, unknown>) => Promise<Salida>,
      armar: (a: Archivo, r: { empresa: string; quien: string }, mensaje?: string) => { asunto: string; texto: string },
    ) {
      const auth = req.headers.authorization;
      const claims = auth?.startsWith("Bearer ") ? op.verificarToken(auth.slice(7)) : null;
      if (!claims) return reply.status(401).send({ error: { codigo: "NO_AUTENTICADO", mensaje: "Sesión inválida" } });
      const posible = contextoDe(claims);
      if ("motivo" in posible) return reply.status(403).send({ error: { codigo: posible.motivo, mensaje: "Esta sesión no envía informes" } });
      const ctx = posible;
      if (!correo.configurado) {
        return reply.status(422).send({
          error: { codigo: "CORREO_NO_CONFIGURADO", mensaje: 'El envío por correo no está activado. Usa "Compartir" para enviarlo por WhatsApp u otra app.' },
        });
      }
      const cuerpo = (req.body ?? {}) as { para?: unknown; mensaje?: unknown };
      const para = typeof cuerpo.para === "string" || Array.isArray(cuerpo.para) ? (cuerpo.para as string | string[]) : "";
      const mensaje = typeof cuerpo.mensaje === "string" ? cuerpo.mensaje.slice(0, 1000) : undefined;
      const dest = revisarDestinatarios(Array.isArray(para) ? para.filter((x): x is string => typeof x === "string") : para);
      if (dest.invalidos.length > 0 || dest.validos.length === 0 || dest.validos.length > MAX_DESTINATARIOS) {
        return reply.status(422).send({
          error: {
            codigo: "DESTINATARIOS_INVALIDOS",
            mensaje: dest.invalidos.length > 0 ? `No son correos válidos: ${dest.invalidos.join(", ")}` : `Entre 1 y ${MAX_DESTINATARIOS} destinatarios`,
          },
        });
      }
      const r = await enTransaccion(op.pool, ctx, async (db): Promise<{ confirmar: boolean; valor: Salida }> => {
        const x = await generar(db, ctx, { origen, enviadoA: dest.validos });
        if (!x.ok) return { confirmar: false, valor: x };
        const quien = await remitenteDe(db, ctx);
        const texto = armar(x.archivo, quien, mensaje);
        const env = await correo.enviar({
          para: dest.validos, ...texto,
          // Un listado que va en el cuerpo del correo no lleva adjunto.
          adjuntos: x.archivo.contenido.length > 0 ? [{ nombre: x.archivo.nombre, contenido: x.archivo.contenido, tipo: x.archivo.tipo }] : [],
        });
        if (!env.ok) return { confirmar: false, valor: errorSalida(422, "CORREO_NO_ENVIADO", env.mensaje) };
        return { confirmar: true, valor: x };
      });
      if (!r.ok) return reply.status(r.status).send(r.cuerpo);
      return reply.status(200).send({ enviadoA: dest.validos });
    }

    app.post("/ordenes/:id/pdf/enviar", async (req, reply) => {
      const id = zId.safeParse(params(req).id);
      if (!id.success) return reply.status(404).send({ error: { codigo: "NO_EXISTE", mensaje: "La orden no existe" } });
      return enviarArchivo(req, reply, "correo_orden", (db, ctx, aud) => pdfDeOrden(db, ctx, id.data, aud), (a, r, mensaje) =>
        correoOrden({ empresa: r.empresa, folio: a.folio, vehiculo: a.vehiculo, quien: r.quien, ...(mensaje ? { mensaje } : {}) }),
      );
    });

    /** "Llantas para cambiar" de sus sedes, en el cuerpo del correo. Solo la oficina. */
    app.post("/alertas/enviar", async (req, reply) => {
      let llantas: LlantaParaAviso[] = [];
      return enviarArchivo(
        req,
        reply,
        "correo_alertas",
        async (db, ctx, auditoria) => {
          if (!puedeAprobar(ctx.rol)) return errorSalida(403, "SIN_PERMISO", "Las alertas son de la oficina");
          const alertas = await new TrabajosProgramados(db, reloj).revisarAlertas(ctx.empresaId, { soloSedesDe: ctx.usuarioId });
          if (alertas.length === 0) return errorSalida(404, "SIN_REGISTROS", "No hay llantas para cambiar");
          const ids = [...new Set(alertas.map((a) => a.vehiculoId))];
          const vehiculos = (await db.query<{ id: string; codigo: string; cliente: string }>(
            `SELECT v.id, v.codigo, c.nombre AS cliente FROM "Vehiculo" v
               JOIN "SedeCliente" sc ON sc.id = v."sedeClienteId" JOIN "Cliente" c ON c.id = sc."clienteId"
              WHERE v.id = ANY($1::text[])`,
            [ids],
          )).rows;
          const porId = new Map(vehiculos.map((v) => [v.id, v]));
          llantas = alertas.map((a) => ({
            vehiculo: porId.get(a.vehiculoId)?.codigo ?? a.vehiculoId,
            cliente: porId.get(a.vehiculoId)?.cliente ?? "",
            posicion: a.posicion,
            motivo: a.mensaje,
          }));
          await new ServicioInforme(db, reloj).registrarAuditoria(ctx, "exportar_informe", { llantas: llantas.length, ...auditoria });
          return {
            ok: true,
            archivo: { nombre: "", contenido: Buffer.alloc(0), tipo: "text/plain", ordenes: 0, sinCerrar: 0, folio: "", vehiculo: "" },
          };
        },
        (_a, r, mensaje) =>
          correoLlantasParaCambio({ empresa: r.empresa, fecha: fechaEnColombia(reloj()), llantas, quien: r.quien, ...(mensaje ? { mensaje } : {}) }),
      );
    });

    // ── Plataforma (R16): alta y listado de empresas ──
    // Solo el superadmin. No tiene empresa: con RLS no ve ninguna, y para
    // listarlas y comprobar el NIT usa dos funciones estrechas de rls.sql que
    // solo responden a un contexto de superadmin.

    const superadminDe = (req: FastifyRequest): { ok: true; usuarioId: string } | { ok: false; status: number; cuerpo: unknown } => {
      const auth = req.headers.authorization;
      const claims = auth?.startsWith("Bearer ") ? op.verificarToken(auth.slice(7)) : null;
      if (!claims) return { ok: false, status: 401, cuerpo: { error: { codigo: "NO_AUTENTICADO", mensaje: "Sesión inválida" } } };
      if (claims.rol !== "superadmin" || claims.empresaId) {
        return { ok: false, status: 403, cuerpo: { error: { codigo: "SIN_PERMISO", mensaje: "Solo la plataforma administra empresas" } } };
      }
      return { ok: true, usuarioId: claims.sub };
    };

    app.get("/plataforma/empresas", async (req, reply) => {
      const s = superadminDe(req);
      if (!s.ok) return reply.status(s.status).send(s.cuerpo);
      const ctx: Contexto = { empresaId: "", rol: "superadmin", usuarioId: s.usuarioId, clienteId: null, vistaCliente: false };
      const filas = await enTransaccion(op.pool, ctx, async (db) => ({
        confirmar: false,
        valor: (await db.query(`SELECT id, nombre, nit, activa, to_char("creadoEn", 'YYYY-MM-DD') AS "creadaEn" FROM empresas_para_plataforma()`)).rows,
      }));
      return reply.status(200).send(filas);
    });

    app.post("/plataforma/empresas", async (req, reply) => {
      const s = superadminDe(req);
      if (!s.ok) return reply.status(s.status).send(s.cuerpo);
      const db = await op.pool.connect();
      let r: Awaited<ReturnType<typeof crearEmpresa>>;
      try {
        r = await crearEmpresa(db, req.body ?? {}, { comoSuperadmin: s.usuarioId });
      } catch (e) {
        // Un código de sede o un correo que choca con una clave única: es un
        // dato repetido, no una falla del servidor.
        if ((e as { code?: string }).code === "23505") {
          return reply.status(409).send({ error: { codigo: "YA_EXISTE", mensaje: "Algún dato ya está registrado (código de sede o correo)" } });
        }
        throw e;
      } finally {
        db.release();
      }
      if (!r.ok) {
        const repetido = r.motivo.startsWith("Ya existe");
        return reply.status(repetido ? 409 : 422).send({ error: { codigo: repetido ? "EMPRESA_EXISTENTE" : "DATOS_INVALIDOS", mensaje: r.motivo } });
      }
      // Ya confirmada: el código lo emite el servicio de acceso, el único que
      // guarda su huella. Se muestra una sola vez.
      const codigo = await op.auth.crearCodigoActivacion(r.administradorId);
      return reply.status(200).send({
        empresaId: r.empresaId,
        administradorId: r.administradorId,
        codigo: codigo?.codigo ?? null,
        expiraEn: codigo?.expiraEn.toISOString() ?? null,
      });
    });

    // ── Catálogo GENERAL (plataforma) ──
    // El superadmin crea y corrige las marcas, diseños y medidas que ven todas
    // las empresas. Antes se llenaba con SQL en Neon. La base solo lo permite
    // con un contexto de superadmin (rls.sql, @seccion:plataforma_catalogo).
    // No queda en la auditoría de ninguna empresa: no es dato de una empresa.

    async function enCatalogoGeneral(
      req: FastifyRequest,
      reply: FastifyReply,
      fn: (catalogo: ServicioCatalogo, ctx: Contexto) => Promise<Respuesta>,
      confirmar: boolean,
    ) {
      const s = superadminDe(req);
      if (!s.ok) return reply.status(s.status).send(s.cuerpo);
      const ctx: Contexto = { empresaId: "", rol: "superadmin", usuarioId: s.usuarioId, clienteId: null, vistaCliente: false };
      const r = await enTransaccion(op.pool, ctx, async (db) => {
        const x = await fn(new ServicioCatalogo(new RepositorioCatalogoPg(db), reloj), ctx);
        return { confirmar: confirmar && x.status < 300, valor: x };
      });
      return reply.status(r.status).send(r.cuerpo);
    }

    app.get("/plataforma/catalogo/marcas", (req, reply) =>
      enCatalogoGeneral(req, reply, async (c, ctx) => ({ status: 200, cuerpo: await c.marcasVisibles(ctx) }), false));

    app.get("/plataforma/catalogo/marcas/:id/disenos", (req, reply) =>
      enCatalogoGeneral(req, reply, async (c, ctx) => {
        const id = zId.safeParse(params(req).id);
        return id.success ? { status: 200, cuerpo: await c.disenosDeMarca(ctx, id.data) } : { status: 200, cuerpo: [] };
      }, false));

    app.get("/plataforma/catalogo/disenos/:id/medidas", (req, reply) =>
      enCatalogoGeneral(req, reply, async (c, ctx) => {
        const id = zId.safeParse(params(req).id);
        return id.success ? { status: 200, cuerpo: await c.medidasDeDiseno(ctx, id.data) } : { status: 200, cuerpo: [] };
      }, false));

    // Lo parecido ya se avisó en la pantalla (la misma comparación del
    // dominio): aquí se crea con `forzar`. El duplicado exacto sigue bloqueado.
    app.post("/plataforma/catalogo/marcas", (req, reply) =>
      enCatalogoGeneral(req, reply, async (c, ctx) => {
        const p = zCrearMarca.safeParse(req.body ?? {});
        if (!p.success) return datosInvalidos(p.error.issues);
        const r = await c.crearMarca(ctx, { id: p.data.id, nombre: p.data.nombre, forzar: true });
        return r.ok ? { status: 201, cuerpo: r.valor.marca } : rechazo(r.veredicto);
      }, true));

    app.post("/plataforma/catalogo/disenos", (req, reply) =>
      enCatalogoGeneral(req, reply, async (c, ctx) => {
        const p = zCrearDiseno.safeParse(req.body ?? {});
        if (!p.success) return datosInvalidos(p.error.issues);
        const r = await c.crearDiseno(ctx, { id: p.data.id, marcaId: p.data.marcaId, nombre: p.data.nombre, tipoEje: p.data.tipoEje, forzar: true });
        return r.ok ? { status: 201, cuerpo: r.valor.diseno } : rechazo(r.veredicto);
      }, true));

    app.post("/plataforma/catalogo/medidas", (req, reply) =>
      enCatalogoGeneral(req, reply, async (c, ctx) => {
        const p = zCrearMedida.safeParse(req.body ?? {});
        if (!p.success) return datosInvalidos(p.error.issues);
        const r = await c.agregarMedida(ctx, sinIndefinidos(p.data));
        return r.ok ? { status: 201, cuerpo: r.valor } : rechazo(r.veredicto);
      }, true));

    app.post("/plataforma/catalogo/medidas/:id/profundidad", (req, reply) =>
      enCatalogoGeneral(req, reply, async (c, ctx) => {
        const id = zId.safeParse(params(req).id);
        if (!id.success) return { status: 404, cuerpo: { error: { codigo: "NO_EXISTE", mensaje: "No existe" } } };
        const p = zProfundidadOriginal.safeParse(req.body ?? {});
        if (!p.success) return datosInvalidos(p.error.issues);
        const r = await c.fijarProfundidadOriginal(ctx, id.data, p.data.profundidadOriginal);
        return r.ok ? { status: 200, cuerpo: {} } : rechazo(r.veredicto);
      }, true));

    // ── Sesión de soporte (R16) ──

    app.post("/plataforma/soporte", async (req, reply) => {
      const s = superadminDe(req);
      if (!s.ok) return reply.status(s.status).send(s.cuerpo);
      const b = (req.body ?? {}) as { empresaId?: unknown; motivo?: unknown; ticket?: unknown; minutos?: unknown };
      const id = zId.safeParse(b.empresaId);
      if (!id.success) return reply.status(422).send({ error: { codigo: "DATOS_INVALIDOS", mensaje: "Elige la empresa" } });
      const datos = {
        motivo: typeof b.motivo === "string" ? b.motivo.trim() : "",
        ticket: typeof b.ticket === "string" ? b.ticket.trim() : "",
        minutos: typeof b.minutos === "number" ? b.minutos : DURACION_SOPORTE.porDefecto,
      };
      const v = validarSoporte(datos);
      if (!v.permitido) return reply.status(422).send({ error: { codigo: v.codigo, mensaje: v.mensaje } });
      const ahora = reloj();
      const expiraEn = new Date(ahora.getTime() + datos.minutos * 60_000);
      const sesionId = nuevoId();
      // Con el contexto de ESA empresa: la sesión y su constancia pasan las
      // políticas como filas de la empresa a la que se entra.
      const ctx: Contexto = { empresaId: id.data, rol: "superadmin", usuarioId: s.usuarioId, clienteId: null, vistaCliente: false };
      const empresa = await enTransaccion(op.pool, ctx, async (db) => {
        const e = (await db.query<{ nombre: string }>(`SELECT nombre FROM "Empresa" WHERE id = $1 AND activa`, [id.data])).rows[0];
        if (!e) return { confirmar: false, valor: null };
        await db.query(
          `INSERT INTO "SesionSuplantacion" (id, "superadminId", "empresaId", motivo, "ticketSoporte", "iniciadaEn", "expiraEn")
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [sesionId, s.usuarioId, id.data, datos.motivo, datos.ticket, ahora, expiraEn],
        );
        await new ServicioInforme(db, reloj).registrarAuditoria(ctx, "suplantar_empresa", {
          sesionSoporte: sesionId, motivo: datos.motivo, ticket: datos.ticket, expiraEn: expiraEn.toISOString(),
        });
        return { confirmar: true, valor: e };
      });
      if (!empresa) return reply.status(404).send({ error: { codigo: "NO_EXISTE", mensaje: "La empresa no existe o está inactiva" } });
      const token = op.auth.firmarSoporte({ superadminId: s.usuarioId, empresaId: id.data, sesionId, expiraEn });
      return reply.status(200).send({ token, sesionId, expiraEn: expiraEn.toISOString(), empresa: { id: id.data, nombre: empresa.nombre } });
    });

    /** Terminar antes de que venza: el token deja de servir en el acto. */
    app.post("/plataforma/soporte/terminar", async (req, reply) => {
      const auth = req.headers.authorization;
      const claims = auth?.startsWith("Bearer ") ? op.verificarToken(auth.slice(7)) : null;
      if (!claims?.soporte || !claims.empresaId) {
        return reply.status(403).send({ error: { codigo: "SIN_PERMISO", mensaje: "No hay una sesión de soporte abierta" } });
      }
      const ctx: Contexto = {
        empresaId: claims.empresaId, rol: "superadmin", usuarioId: claims.sub, clienteId: null, vistaCliente: false, soporteId: claims.soporte,
      };
      await enTransaccion(op.pool, ctx, async (db) => {
        await db.query(`UPDATE "SesionSuplantacion" SET "terminadaEn" = $2 WHERE id = $1 AND "terminadaEn" IS NULL`, [claims.soporte, reloj()]);
        await new ServicioInforme(db, reloj).registrarAuditoria(ctx, "suplantar_empresa", { sesionSoporte: claims.soporte, terminada: true });
        return { confirmar: true, valor: undefined };
      });
      return reply.status(200).send({});
    });

    // ── Código QR del vehículo (R15) ──
    // Etiquetas para imprimir: la oficina, que es quien las pega en la flota.
    // Es un listado de la flota (códigos y placas): queda en la auditoría.

    app.get("/flota/qr", async (req, reply) => {
      const auth = req.headers.authorization;
      const claims = auth?.startsWith("Bearer ") ? op.verificarToken(auth.slice(7)) : null;
      if (!claims) return reply.status(401).send({ error: { codigo: "NO_AUTENTICADO", mensaje: "Sesión inválida" } });
      const posible = contextoDe(claims);
      if ("motivo" in posible) return reply.status(403).send({ error: { codigo: posible.motivo, mensaje: "Esta sesión no imprime códigos" } });
      const ctx = posible;
      if (ctx.rol !== "administrador" && ctx.rol !== "coordinador") {
        return reply.status(403).send({ error: { codigo: "SIN_PERMISO", mensaje: "Los códigos QR los imprime la oficina" } });
      }
      const q = (req.query ?? {}) as Record<string, unknown>;
      const filtro: { clienteId?: string; sedeClienteId?: string; vehiculoId?: string } = {};
      for (const k of ["clienteId", "sedeClienteId", "vehiculoId"] as const) {
        if (q[k] === undefined || q[k] === "") continue;
        const id = zId.safeParse(q[k]);
        if (!id.success) return reply.status(422).send({ error: { codigo: "DATOS_INVALIDOS", mensaje: "Filtro inválido" } });
        filtro[k] = id.data;
      }
      const r = await enTransaccion(op.pool, ctx, async (db): Promise<{ confirmar: boolean; valor: Salida }> => {
        const vehiculos = await vehiculosParaEtiquetas(db, filtro);
        if (vehiculos.length === 0) return { confirmar: false, valor: errorSalida(404, "SIN_REGISTROS", "No hay vehículos activos con ese filtro") };
        if (vehiculos.length > MAX_ETIQUETAS) {
          return { confirmar: false, valor: errorSalida(422, "DEMASIADOS_VEHICULOS", `Más de ${MAX_ETIQUETAS} vehículos: elige un cliente o una sede`) };
        }
        await new ServicioInforme(db, reloj).registrarAuditoria(ctx, "exportar_listado", {
          origen: "qr_vehiculos", vehiculos: vehiculos.length, filtros: filtro,
        });
        return {
          confirmar: true,
          valor: {
            ok: true,
            archivo: {
              nombre: `codigos-qr-${fechaEnColombia(reloj())}.pdf`, contenido: await pdfEtiquetas(vehiculos), tipo: "application/pdf",
              ordenes: 0, sinCerrar: 0, folio: "", vehiculo: "",
            },
          },
        };
      });
      if (!r.ok) return reply.status(r.status).send(r.cuerpo);
      return reply
        .status(200)
        .header("content-type", "application/pdf")
        .header("content-disposition", `attachment; filename="${r.archivo.nombre}"`)
        .send(r.archivo.contenido);
    });

    // ── Cotización (R14) ──
    // Solo la oficina: la cotización la hace la empresa para su cliente.

    const filtroCotizacion = (req: FastifyRequest): { ok: true; f: { clienteId?: string; vehiculoId?: string } } | { ok: false } => {
      const q = (req.query ?? {}) as Record<string, unknown>;
      const f: { clienteId?: string; vehiculoId?: string } = {};
      for (const k of ["clienteId", "vehiculoId"] as const) {
        if (q[k] === undefined || q[k] === "") continue;
        const id = zId.safeParse(q[k]);
        if (!id.success) return { ok: false };
        f[k] = id.data;
      }
      return { ok: true, f };
    };

    async function pdfDeCotizacion(db: pg.PoolClient, ctx: Contexto, filtro: { clienteId?: string; vehiculoId?: string }, auditoria: Record<string, unknown>): Promise<Salida> {
      if (!puedeAprobar(ctx.rol)) return errorSalida(403, "SIN_PERMISO", "La cotización la hace la oficina");
      const d = await cotizacionDe(db, new ServicioInforme(db, reloj), ctx, filtro, reloj());
      if (d.llantas.length === 0 && d.servicios.length === 0) return errorSalida(404, "SIN_REGISTROS", "No hay nada que cotizar con ese filtro");
      await new ServicioInforme(db, reloj).registrarAuditoria(ctx, "exportar_informe", {
        llantas: d.totalLlantas, filtros: filtro, ...auditoria,
      });
      return {
        ok: true,
        archivo: {
          nombre: `cotizacion-${d.fecha}.pdf`, contenido: await pdfCotizacion(d), tipo: "application/pdf",
          ordenes: 0, sinCerrar: 0, folio: d.cliente?.nombre ?? "", vehiculo: "",
        },
      };
    }

    app.get("/cotizacion", consulta(async (s, ctx, req) => {
      if (!puedeAprobar(ctx.rol)) return { status: 403, cuerpo: { error: { codigo: "SIN_PERMISO", mensaje: "La cotización la hace la oficina" } } };
      const f = filtroCotizacion(req);
      if (!f.ok) return { status: 422, cuerpo: { error: { codigo: "DATOS_INVALIDOS", mensaje: "Filtro inválido" } } };
      return { status: 200, cuerpo: await cotizacionDe(s.consulta, s.informe, ctx, f.f, reloj()) };
    }));

    app.get("/cotizacion/pdf", async (req, reply) => {
      const auth = req.headers.authorization;
      const claims = auth?.startsWith("Bearer ") ? op.verificarToken(auth.slice(7)) : null;
      if (!claims) return reply.status(401).send({ error: { codigo: "NO_AUTENTICADO", mensaje: "Sesión inválida" } });
      const posible = contextoDe(claims);
      if ("motivo" in posible) return reply.status(403).send({ error: { codigo: posible.motivo, mensaje: "Esta sesión no cotiza" } });
      const ctx = posible;
      const f = filtroCotizacion(req);
      if (!f.ok) return reply.status(422).send({ error: { codigo: "DATOS_INVALIDOS", mensaje: "Filtro inválido" } });
      const r = await enTransaccion(op.pool, ctx, async (db) => {
        const x = await pdfDeCotizacion(db, ctx, f.f, { origen: "pdf_cotizacion" });
        return { confirmar: x.ok, valor: x };
      });
      if (!r.ok) return reply.status(r.status).send(r.cuerpo);
      return reply
        .status(200)
        .header("content-type", "application/pdf")
        .header("content-disposition", `attachment; filename="${r.archivo.nombre}"`)
        .send(r.archivo.contenido);
    });

    app.post("/cotizacion/enviar", async (req, reply) => {
      const f = filtroCotizacion(req);
      if (!f.ok) return reply.status(422).send({ error: { codigo: "DATOS_INVALIDOS", mensaje: "Filtro inválido" } });
      return enviarArchivo(req, reply, "correo_cotizacion", (db, ctx, aud) => pdfDeCotizacion(db, ctx, f.f, aud), (a, r, mensaje) =>
        correoCotizacion({ empresa: r.empresa, cliente: a.folio || null, quien: r.quien, ...(mensaje ? { mensaje } : {}) }),
      );
    });

    app.post("/informe/enviar", async (req, reply) => {
      const filtro = filtroInforme(req);
      if (!filtro.ok) return reply.status(filtro.r.status).send(filtro.r.cuerpo);
      const q = sinIndefinidos(filtro.q);
      const formato = (req.body as { formato?: unknown } | undefined)?.formato === "pdf" ? "pdf" : "csv";
      return enviarArchivo(
        req,
        reply,
        formato === "pdf" ? "correo_pdf_informe" : "correo_informe",
        (db, ctx, aud) => (formato === "pdf" ? pdfDeInforme(db, ctx, q, aud) : csvDeInforme(db, ctx, q, aud)),
        (a, r, mensaje) =>
          correoInforme({ empresa: r.empresa, formato, ordenes: a.ordenes, sinCerrar: a.sinCerrar, quien: r.quien, ...(mensaje ? { mensaje } : {}) }),
      );
    });

    // ── Carga masiva desde Excel (R12) ──
    // En línea y en UNA transacción: con un error no se carga nada (la
    // respuesta 422 deshace todo). La lista de errores va fila por fila.

    app.post("/carga/:tipo", administracion(async (s, ctx, req) => {
      const tipo = String(params(req).tipo);
      if (!(TIPOS_CARGA as readonly string[]).includes(tipo)) {
        return { status: 404, cuerpo: { error: { codigo: "NO_EXISTE", mensaje: "No existe" } } };
      }
      const csv = (req.body as { csv?: unknown } | undefined)?.csv;
      if (typeof csv !== "string" || csv.trim() === "") {
        return { status: 422, cuerpo: { error: { codigo: "DATOS_INVALIDOS", mensaje: "Falta el contenido del archivo" } } };
      }
      const r = await new ServicioCarga(s.consulta, s.flota, s.catalogo, s.llantas).cargar(ctx, tipo as TipoCarga, csv);
      if (r.errores.length > 0) {
        return {
          status: 422,
          cuerpo: { error: { codigo: "CARGA_CON_ERRORES", mensaje: `${r.errores.length} problema(s): no se cargó nada` }, errores: r.errores },
        };
      }
      await s.informe.registrarAuditoria(ctx, "crear", { entidad: "carga_masiva", tipo, filas: r.filas, creados: r.creados, existentes: r.existentes });
      return { status: 200, cuerpo: r };
    }));

    // ── Tablero de la flota (R11) ──
    app.get("/tablero", consulta(async (s, ctx, req) => {
      const p = zFiltroCausas.safeParse(req.query ?? {});
      if (!p.success) return datosInvalidos(p.error.issues);
      return { status: 200, cuerpo: await tableroDeFlota(s.informe, ctx, p.data, reloj(), s.consulta) };
    }));

    app.get("/informe/causas-retiro", consulta(async (s, ctx, req) => {
      const p = zFiltroCausas.safeParse(req.query ?? {});
      if (!p.success) return datosInvalidos(p.error.issues);
      return { status: 200, cuerpo: await s.reclamos.causas(ctx, p.data) };
    }));

    app.get("/reclamos", consulta(async (s, _ctx, req) => {
      const estado = (req.query as Record<string, string> | undefined)?.["estado"];
      return { status: 200, cuerpo: await s.reclamos.listar(estado) };
    }));

    app.post("/reclamos", administracion(async (s, ctx, req) => {
      const p = zCrearReclamo.safeParse(req.body ?? {});
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.reclamos.crear(ctx, p.data);
      if (!r.ok) return rechazo(r.veredicto);
      await s.informe.registrarAuditoria(ctx, "crear", { entidad: "reclamo", id: p.data.id, llantaId: p.data.llantaId });
      return { status: 201, cuerpo: r.valor };
    }));

    app.post("/reclamos/:id/estado", administracion(async (s, ctx, req) => {
      const id = zId.safeParse(params(req).id);
      if (!id.success) return { status: 404, cuerpo: { error: { codigo: "NO_EXISTE", mensaje: "No existe" } } };
      const p = zCambioReclamo.safeParse(req.body ?? {});
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.reclamos.cambiarEstado(ctx, id.data, p.data);
      if (!r.ok) return rechazo(r.veredicto);
      await s.informe.registrarAuditoria(ctx, "actualizar", { entidad: "reclamo", id: id.data, estado: p.data.estado });
      return { status: 200, cuerpo: r.valor };
    }));

    // ── Límites de cambio de la empresa (R2) ──

    app.get("/empresa/limites", consulta(async (s, ctx) => ({ status: 200, cuerpo: await s.empresa.limites(ctx.empresaId) })));

    app.post("/empresa/limites", administracion(async (s, ctx, req) => {
      const p = zLimitesEmpresa.safeParse(req.body ?? {});
      if (!p.success) return datosInvalidos(p.error.issues);
      const antes = await s.empresa.limites(ctx.empresaId);
      const r = await s.empresa.guardarLimites(ctx, p.data);
      if (!r.ok) return rechazo(r.veredicto);
      // Mueve las alertas de toda la flota: queda quién y desde qué valores.
      await s.informe.registrarAuditoria(ctx, "actualizar", { entidad: "limites_empresa", antes, despues: r.valor });
      return { status: 200, cuerpo: r.valor };
    }));

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

    // ── Revisión de lo creado en campo (la hace el administrador) ──
    // En línea: la persona compara y decide en pantalla.

    app.get("/catalogo/revision", consulta(async (s, ctx) => {
      const r = await s.catalogo.revision(ctx);
      return r.ok ? { status: 200, cuerpo: r.valor } : rechazo(r.veredicto);
    }));

    // Una medida se aprueba pero no se unifica: no tiene variantes mal
    // escritas (se normaliza y no se repite en el diseño).
    app.post("/catalogo/medidas/:id/aprobar", administracion(async (s, ctx, req) => {
      const id = zId.safeParse(params(req).id);
      if (!id.success) return { status: 404, cuerpo: { error: { codigo: "NO_EXISTE", mensaje: "No existe" } } };
      const r = await s.catalogo.marcarRevisada(ctx, "medida", id.data);
      if (!r.ok) return rechazo(r.veredicto);
      await s.informe.registrarAuditoria(ctx, "actualizar", { entidad: "medida", id: id.data, revision: "aprobada" });
      return { status: 200, cuerpo: {} };
    }));

    for (const [ruta, tipo] of [["marcas", "marca"], ["disenos", "diseno"]] as const) {
      app.post(`/catalogo/${ruta}/:id/aprobar`, administracion(async (s, ctx, req) => {
        const id = zId.safeParse(params(req).id);
        if (!id.success) return { status: 404, cuerpo: { error: { codigo: "NO_EXISTE", mensaje: "No existe" } } };
        const r = await s.catalogo.marcarRevisada(ctx, tipo, id.data);
        if (!r.ok) return rechazo(r.veredicto);
        await s.informe.registrarAuditoria(ctx, "actualizar", { entidad: tipo, id: id.data, revision: "aprobada" });
        return { status: 200, cuerpo: {} };
      }));

      app.post(`/catalogo/${ruta}/:id/unificar`, administracion(async (s, ctx, req) => {
        const id = zId.safeParse(params(req).id);
        if (!id.success) return { status: 404, cuerpo: { error: { codigo: "NO_EXISTE", mensaje: "No existe" } } };
        const p = zUnificarCatalogo.safeParse(req.body ?? {});
        if (!p.success) return datosInvalidos(p.error.issues);
        const r = await s.catalogo.unificar(ctx, tipo, id.data, p.data.destinoId);
        if (!r.ok) return rechazo(r.veredicto);
        await s.informe.registrarAuditoria(ctx, "actualizar", {
          entidad: tipo, id: id.data, revision: "unificada", destinoId: p.data.destinoId,
          disenosUnificados: r.valor.disenosUnificados,
        });
        return { status: 200, cuerpo: r.valor };
      }));
    }

    // ── Deshabilitar (nada se borra) ──
    // En línea: es gestión, la persona espera saber si se pudo y por qué no.

    for (const [ruta, metodo] of [
      ["/flota/clientes/:id/desactivar", "desactivarCliente"],
      ["/flota/sedes/:id/desactivar", "desactivarSedeCliente"],
      ["/flota/vehiculos/:id/desactivar", "desactivarVehiculo"],
    ] as const) {
      app.post(ruta, administracion(async (s, ctx, req) => {
        const id = zId.safeParse(params(req).id);
        if (!id.success) return { status: 404, cuerpo: { error: { codigo: "NO_EXISTE", mensaje: "No existe" } } };
        const r = await s.flota[metodo](ctx, id.data);
        return r.ok ? { status: 200, cuerpo: {} } : rechazo(r.veredicto);
      }));
    }

    app.post("/usuarios/:id/desactivar", async (req, reply) => {
      const id = zId.safeParse(params(req).id);
      if (!id.success) return reply.status(404).send({ error: { codigo: "NO_EXISTE", mensaje: "El usuario no existe" } });
      const r = await comoAdministracion(req, async (s, ctx) => {
        const x = await s.usuarios.desactivar(ctx, id.data);
        return x.ok ? { status: 200, cuerpo: {} } : rechazo(x.veredicto);
      });
      // Ya confirmado: sus sesiones dejan de renovarse en el acto.
      if (r.status === 200) await op.auth.revocarSesionesDe(id.data);
      return reply.status(r.status).send(r.cuerpo);
    });

    app.post("/usuarios/:id/reactivar", administracion(async (s, ctx, req) => {
      const id = zId.safeParse(params(req).id);
      if (!id.success) return { status: 404, cuerpo: { error: { codigo: "NO_EXISTE", mensaje: "El usuario no existe" } } };
      const r = await s.usuarios.reactivar(ctx, id.data);
      return r.ok ? { status: 200, cuerpo: {} } : rechazo(r.veredicto);
    }));

    // ── Informe ──

    /**
     * Exportación del informe en el formato del taller.
     *
     * Devuelve el archivo, no JSON: lo que el coordinador hace con esto es
     * abrirlo en una hoja de cálculo.
     */
    /**
     * Las órdenes del informe en un solo PDF (decisión del usuario): cada una
     * completa, como su PDF individual, con sus avisos. Mismo filtro que el
     * CSV; si se eligieron órdenes, solo esas. Queda en la auditoría.
     */
    app.get("/informe/pdf", async (req, reply) => {
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
      const q = sinIndefinidos(filtro.q);
      const r = await enTransaccion(op.pool, ctx, async (db) => {
        const x = await pdfDeInforme(db, ctx, q, { origen: "pdf_informe" });
        return { confirmar: x.ok, valor: x };
      });
      if (!r.ok) return reply.status(r.status).send(r.cuerpo);
      return reply
        .status(200)
        .header("content-type", "application/pdf")
        .header("content-disposition", `attachment; filename="${r.archivo.nombre}"`)
        .send(r.archivo.contenido);
    });

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

    /**
     * Auditoría (5.4): solo el administrador. De a una página, lo más
     * reciente primero; `siguiente` es el cursor para ver más.
     */
    app.get("/auditoria", consulta(async (s, ctx, req) => {
      if (!puedeVerAuditoria(ctx.rol)) {
        return { status: 403, cuerpo: { error: { codigo: "SIN_PERMISO", mensaje: "La auditoría la consulta el administrador" } } };
      }
      const p = zConsultaAuditoria.safeParse(req.query ?? {});
      if (!p.success) return datosInvalidos(p.error.issues);
      const filas = await s.informe.listarAuditoria(ctx, sinIndefinidos(p.data));
      const hayMas = filas.length > POR_PAGINA_AUDITORIA;
      const pagina = filas.slice(0, POR_PAGINA_AUDITORIA);
      const ultimo = pagina[pagina.length - 1] as { creadoEn: Date } | undefined;
      return {
        status: 200,
        cuerpo: { registros: pagina, siguiente: hayMas && ultimo ? new Date(ultimo.creadoEn).toISOString() : null },
      };
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

    /**
     * Medida nueva (R1). Llega por la cola, como marca y diseño: el técnico la
     * crea frente a la llanta, a veces sin señal. Sin profundidad de fábrica
     * conocida se guarda igual; el desgaste espera a que alguien la complete.
     */
    app.post("/catalogo/medidas", operacion(async (s, ctx, req) => {
      const p = zCrearMedida.safeParse(req.body);
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.catalogo.agregarMedida(ctx, p.data);
      if (!r.ok) return rechazo(r.veredicto);
      return { status: 201, cuerpo: { id: r.valor.id, medida: r.valor.medida } };
    }));

    /** Completar o corregir la profundidad de fábrica (oficina, en línea). */
    app.post("/catalogo/medidas/:id/profundidad", administracion(async (s, ctx, req) => {
      const id = zId.safeParse(params(req).id);
      if (!id.success) return { status: 404, cuerpo: { error: { codigo: "NO_EXISTE", mensaje: "No existe" } } };
      const p = zProfundidadOriginal.safeParse(req.body ?? {});
      if (!p.success) return datosInvalidos(p.error.issues);
      const r = await s.catalogo.fijarProfundidadOriginal(ctx, id.data, p.data.profundidadOriginal);
      if (!r.ok) return rechazo(r.veredicto);
      await s.informe.registrarAuditoria(ctx, "actualizar", {
        entidad: "medida", id: id.data, profundidadOriginal: p.data.profundidadOriginal,
      });
      return { status: 200, cuerpo: {} };
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
    /**
     * Códigos de activación en lote (lineamiento 3: sin la herramienta de
     * línea de comandos). Los usuarios activos que se pidan, de la empresa, y
     * nunca uno mismo. Uno por persona: cada código va en su propio mensaje
     * (la app los comparte de a uno; un mensaje con todos se los entregaría a
     * quien lo reciba). Hasta 50 por vez.
     */
    app.post("/usuarios/codigos", async (req, reply) => {
      const b = (req.body ?? {}) as { usuarioIds?: unknown };
      const ids = Array.isArray(b.usuarioIds) ? [...new Set(b.usuarioIds.filter((x): x is string => typeof x === "string"))] : [];
      if (ids.length === 0 || ids.length > 50 || ids.some((x) => !zId.safeParse(x).success)) {
        return reply.status(422).send({ error: { codigo: "DATOS_INVALIDOS", mensaje: "Elige entre 1 y 50 usuarios" } });
      }
      let elegidos: { id: string; nombre: string; email: string }[] = [];
      const visto = await comoAdministracion(req, async (s, ctx) => {
        const r = await s.usuarios.listar(ctx);
        if (!r.ok) return rechazo(r.veredicto);
        elegidos = r.valor.filter((u) => ids.includes(u.id) && u.activo && u.id !== ctx.usuarioId);
        return { status: 200, cuerpo: {} };
      });
      if (visto.status >= 300) return reply.status(visto.status).send(visto.cuerpo);
      const codigos = [];
      // De a uno: el servicio de acceso anula los códigos anteriores de cada usuario.
      for (const u of elegidos) {
        const c = await op.auth.crearCodigoActivacion(u.id, req.ip);
        if (c) codigos.push({ usuarioId: u.id, nombre: u.nombre, email: u.email, codigo: c.codigo, expiraEn: c.expiraEn });
      }
      return reply.status(200).send({ codigos });
    });

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
