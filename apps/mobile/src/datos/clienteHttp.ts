import type { OperacionPendiente, TipoOperacion } from "./repositorio";
import type { ClienteSincronizacion, ResultadoEnvio } from "./sincronizacion";
import type { ClienteDescarga, PaqueteDescargado } from "./descarga";

/**
 * Cliente HTTP del motor de sincronización.
 *
 * Traduce la respuesta del servidor a un resultado que el motor entiende. La
 * traducción importa tanto como el envío: confundir un conflicto con una
 * falta de conexión haría reintentar algo que nunca va a funcionar.
 */

export interface ConfigCliente {
  readonly baseUrl: string;
  readonly obtenerToken: () => Promise<string | null>;
  /**
   * Renueva la sesión con el token de renovación. Devuelve true si lo logró.
   * Se llama una sola vez ante un 401, y luego se reintenta la operación.
   */
  readonly renovarSesion?: () => Promise<boolean>;
  /** Corta la espera: en 4G rural una petición colgada bloquea la cola. */
  readonly tiempoLimiteMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Ruta de cada tipo de operación.
 *
 * El tipo es `Record<TipoOperacion, ...>`, no `Record<string, ...>`, y eso es
 * deliberado: con `string`, agregar un tipo nuevo al repositorio sin agregarlo
 * aquí compilaba, el cliente lo trataba como desconocido, lo rechazaba, y el
 * motor lo sacaba de la cola. Así se perdieron en silencio las marcas creadas
 * en campo y las reasignaciones. Con el tipo exacto, el compilador lo impide.
 */
const RUTAS: Record<TipoOperacion, (op: OperacionPendiente) => { metodo: string; ruta: string }> = {
  crear_orden: () => ({ metodo: "POST", ruta: "/ordenes" }),
  actualizar_orden: (op) => ({ metodo: "PATCH", ruta: `/ordenes/${op.ordenId}` }),
  guardar_medicion: (op) => ({ metodo: "PUT", ruta: `/ordenes/${op.ordenId}/mediciones/${op.recursoId}` }),
  cambiar_estado: (op) => ({ metodo: "POST", ruta: `/ordenes/${op.ordenId}/estado` }),
  firmar: (op) => ({ metodo: "POST", ruta: `/ordenes/${op.ordenId}/firma` }),
  subir_foto: (op) => ({ metodo: "POST", ruta: `/fotos/${op.recursoId}/confirmar` }),
  reasignar: (op) => ({ metodo: "POST", ruta: `/ordenes/${op.ordenId}/reasignar` }),
  crear_marca: () => ({ metodo: "POST", ruta: "/catalogo/marcas" }),
  crear_diseno: () => ({ metodo: "POST", ruta: "/catalogo/disenos" }),
  adjuntar_foto: (op) => ({ metodo: "POST", ruta: `/ordenes/${op.ordenId}/fotos` }),
  crear_cliente: () => ({ metodo: "POST", ruta: "/flota/clientes" }),
  crear_sede_cliente: () => ({ metodo: "POST", ruta: "/flota/sedes" }),
  crear_vehiculo: () => ({ metodo: "POST", ruta: "/flota/vehiculos" }),
};

/** Marca interna: la respuesta fue 401, hay que intentar renovar. */
const NO_AUTENTICADO = Symbol("no_autenticado");

export class ClienteHttp implements ClienteSincronizacion, ClienteDescarga {
  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly config: ConfigCliente) {
    this.fetch = config.fetch ?? globalThis.fetch;
  }

  async enviar(op: OperacionPendiente): Promise<ResultadoEnvio> {
    const destino = RUTAS[op.tipo];
    if (!destino) {
      return { tipo: "rechazada", mensaje: `Operación desconocida: ${op.tipo}` };
    }
    const { metodo, ruta } = destino(op);

    let token = await this.config.obtenerToken();
    if (!token && this.config.renovarSesion && (await this.config.renovarSesion())) {
      token = await this.config.obtenerToken();
    }
    if (!token) {
      // Antes esto era un RECHAZO: cerrar sesión apartaba todo el trabajo
      // pendiente. Sin sesión, la operación se queda esperando que alguien
      // vuelva a ingresar.
      return { tipo: "sin_sesion", mensaje: "La sesión expiró. Vuelve a ingresar" };
    }

    let resultado = await this.enviarCon(metodo, ruta, op, token);

    // Un 401 casi siempre es un token de acceso vencido (duran 15 minutos).
    // Se renueva UNA vez y se reintenta. Antes se trataba como rechazo: un
    // técnico que volvía de una jornada sin señal veía todo su trabajo
    // apartado.
    if (resultado === NO_AUTENTICADO && this.config.renovarSesion) {
      if (await this.config.renovarSesion()) {
        const nuevo = await this.config.obtenerToken();
        if (nuevo) resultado = await this.enviarCon(metodo, ruta, op, nuevo);
      }
    }

    if (resultado === NO_AUTENTICADO) {
      return { tipo: "sin_sesion", mensaje: "La sesión expiró. Vuelve a ingresar" };
    }
    return resultado;
  }

  /**
   * Petición en línea, para la administración (usuarios, sedes): la persona
   * espera la respuesta —el código de activación viene en ella—, así que no
   * pasa por la cola. Con sesión, renovándola UNA vez ante un 401.
   */
  async enLinea<T>(
    metodo: "GET" | "POST",
    ruta: string,
    cuerpo?: unknown,
  ): Promise<{ ok: true; datos: T } | { ok: false; status: number; codigo: string | null; mensaje: string }> {
    const intentar = async (token: string) => {
      const control = new AbortController();
      const limite = setTimeout(() => control.abort(), this.config.tiempoLimiteMs ?? 30_000);
      try {
        return await this.fetch(`${this.config.baseUrl}${ruta}`, {
          method: metodo,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          ...(metodo === "POST" ? { body: JSON.stringify(cuerpo ?? {}) } : {}),
          signal: control.signal,
        });
      } finally {
        clearTimeout(limite);
      }
    };
    try {
      let token = await this.config.obtenerToken();
      if (!token) return { ok: false, status: 401, codigo: "NO_AUTENTICADO", mensaje: "La sesión expiró. Vuelve a ingresar" };
      let r = await intentar(token);
      if (r.status === 401 && this.config.renovarSesion && (await this.config.renovarSesion())) {
        token = await this.config.obtenerToken();
        if (token) r = await intentar(token);
      }
      const j = (await r.json().catch(() => ({}))) as { error?: { codigo?: string; mensaje?: string } };
      if (r.ok) return { ok: true, datos: j as T };
      return { ok: false, status: r.status, codigo: j.error?.codigo ?? null, mensaje: j.error?.mensaje ?? "No se pudo completar" };
    } catch {
      // Sin respuesta: es la señal, no los datos.
      return { ok: false, status: 0, codigo: null, mensaje: "No hay señal. Esta acción necesita conexión" };
    }
  }

  private async enviarCon(
    metodo: string,
    ruta: string,
    op: OperacionPendiente,
    token: string,
  ): Promise<ResultadoEnvio | typeof NO_AUTENTICADO> {
    const control = new AbortController();
    const tiempoLimite = setTimeout(
      () => control.abort(),
      this.config.tiempoLimiteMs ?? 30_000,
    );

    try {
      const respuesta = await this.fetch(`${this.config.baseUrl}${ruta}`, {
        method: metodo,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          // La clave de idempotencia es el id de la OPERACIÓN, no el del
          // recurso: si el técnico guarda la misma posición dos veces, son
          // dos operaciones distintas y ambas deben aplicarse.
          "Idempotency-Key": op.id,
        },
        body: JSON.stringify(op.datos),
        signal: control.signal,
      });

      if (respuesta.status === 401) return NO_AUTENTICADO;
      return await this.interpretar(respuesta);
    } catch (e) {
      // Un fallo de red o un tiempo agotado se reintentan; no son rechazos.
      return { tipo: "sin_conexion", mensaje: (e as Error).message };
    } finally {
      clearTimeout(tiempoLimite);
    }
  }

  /**
   * Trae el paquete de datos del servidor.
   *
   * Devuelve null si no se pudo llegar: el que llama distingue "no hay señal"
   * de "no hay nada nuevo", que son cosas distintas.
   */
  async traer(desde: string | null): Promise<PaqueteDescargado | null> {
    const token = await this.config.obtenerToken();
    if (!token) return null;

    const consulta = desde ? `?desde=${encodeURIComponent(desde)}` : "";
    try {
      const r = await this.fetch(`${this.config.baseUrl}/sincronizacion${consulta}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 401 && this.config.renovarSesion && (await this.config.renovarSesion())) {
        return this.traer(desde);
      }
      if (!r.ok) return null;
      return (await r.json()) as PaqueteDescargado;
    } catch {
      return null;
    }
  }

  private async interpretar(r: Response): Promise<ResultadoEnvio> {
    if (r.ok) {
      const cuerpo = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      // Se conserva el cuerpo entero: al adjuntar una foto trae la URL
      // firmada para subir los bytes, y descartarla obligaría a pedirla
      // otra vez.
      return { tipo: "aplicada", folio: (cuerpo["folio"] as string) ?? null, datos: cuerpo };
    }

    // El servidor ya tenía esta operación: el envío anterior sí llegó y se
    // perdió la respuesta. Es lo que la idempotencia debe lograr.
    if (r.status === 409) {
      const cuerpo = (await r.json().catch(() => ({}))) as {
        error?: { codigo?: string; mensaje?: string };
        folio?: string;
      };
      if (cuerpo.error?.codigo === "YA_APLICADA") {
        return { tipo: "duplicada", folio: cuerpo.folio ?? null };
      }
      return {
        tipo: "conflicto",
        mensaje: cuerpo.error?.mensaje ?? "La orden cambió en el servidor",
      };
    }

    // Solo el 403 es un rechazo de permiso: el usuario está identificado y
    // no puede hacer esto. El 401 se atiende antes, renovando la sesión.
    if (r.status === 403) {
      const cuerpo = (await r.json().catch(() => ({}))) as { error?: { mensaje?: string } };
      return { tipo: "rechazada", mensaje: cuerpo.error?.mensaje ?? "No tienes permiso para esta operación" };
    }

    if (r.status === 400 || r.status === 422) {
      const cuerpo = (await r.json().catch(() => ({}))) as { error?: { mensaje?: string } };
      return { tipo: "rechazada", mensaje: cuerpo.error?.mensaje ?? "El servidor rechazó los datos" };
    }

    if (r.status === 404) {
      return { tipo: "rechazada", mensaje: "El recurso ya no existe en el servidor" };
    }

    // 5xx y todo lo demás: es del servidor, no del dato. Se reintenta.
    return { tipo: "sin_conexion", mensaje: `El servidor respondió ${r.status}` };
  }
}
