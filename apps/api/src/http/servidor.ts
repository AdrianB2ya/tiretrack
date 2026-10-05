import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import {
  zAdjuntarFoto,
  zCambiarEstado,
  zComandoActualizarOrden,
  zCrearCliente,
  zCrearDiseno,
  zCrearMarca,
  zCrearOrden,
  zCrearSedeCliente,
  zCrearVehiculo,
  zFiltroInforme,
  zFirma,
  zInstante,
  zReasignar,
} from "@tiretrack/contracts";

/**
 * Quita las claves con valor undefined. Zod marca lo opcional como
 * `T | undefined`; los servicios declaran sus entradas sin esa posibilidad.
 */
function sinIndefinidos<T extends Record<string, unknown>>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;
}

/** Consulta de la descarga: `desde` es la marca `hasta` que entregó el servidor. */
const zConsultaDescarga = z.object({ desde: zInstante.optional() });
import { ROLES, type Rol, type Veredicto } from "@tiretrack/domain";
import type { Claims, ResultadoLogin } from "../acceso/servicio";
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
  login(entrada: { email: string; password: string; empresaId?: string; ip?: string }): Promise<ResultadoLogin>;
  refrescar(refreshToken: string, ctx?: { ip?: string }): Promise<ResultadoLogin>;
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

export function construirServidor(op: OpcionesServidor): FastifyInstance {
  const app = Fastify({ logger: op.registro ?? false, bodyLimit: 512 * 1024 });
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

  // ── Acceso ──
  //
  // No llevan clave de idempotencia: ingresar no es una operación de la cola,
  // y repetir un login simplemente devuelve una sesión nueva.

  /** Traduce el resultado del servicio a la respuesta HTTP. */
  function respuestaDeAcceso(r: ResultadoLogin, reply: FastifyReply) {
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
    const r = await s.ordenes.crear(ctx, p.data);
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
    // Fechas imposibles o parámetros repetidos respondían 500.
    const filtro = zFiltroInforme.safeParse(req.query ?? {});
    if (!filtro.success) {
      const r = datosInvalidos(filtro.error.issues);
      return reply.status(r.status).send(r.cuerpo);
    }
    const q = filtro.data;

    const r = await enTransaccion(op.pool, ctx, async (db) => ({
      confirmar: false,
      valor: await new ServicioInforme(db, reloj).exportar(ctx, {
        ...(q["clienteId"] ? { clienteId: q["clienteId"] } : {}),
        ...(q["vehiculoId"] ? { vehiculoId: q["vehiculoId"] } : {}),
        ...(q["serial"] ? { serial: q["serial"] } : {}),
        ...(q["servicio"] ? { servicio: q["servicio"] } : {}),
        ...(q["desde"] ? { desde: q["desde"] } : {}),
        ...(q["hasta"] ? { hasta: q["hasta"] } : {}),
      }),
    }));

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

  // Cualquier error no previsto: 500 sin detalles internos. La transacción
  // ya se deshizo, así que la clave no quedó consumida y el reintento del
  // celular puede aplicarse.
  app.setErrorHandler((error, _req, reply) => {
    if ((error as { statusCode?: number }).statusCode === 400) {
      return reply.status(422).send({ error: { codigo: "DATOS_INVALIDOS", mensaje: "El cuerpo no es JSON válido" } });
    }
    app.log.error(error);
    return reply.status(500).send({ error: { codigo: "ERROR_INTERNO", mensaje: "Error del servidor. Se reintentará" } });
  });

  return app;
}
