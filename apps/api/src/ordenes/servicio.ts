import {
  codigoReferencia,
  congelar,
  esAutoaprobacion,
  evaluarTransicion,
  firmaVigente,
  nuevoId,
  plazoAprobacion,
  puedeAprobar,
  puedeEditarMediciones,
  puedeCerrarse,
  type EstadoOrden,
  type Rol,
  type Veredicto,
  fechaEnColombia,
} from "@tiretrack/domain";
import type { Orden, RepositorioOrdenes } from "./repositorio";

/**
 * Órdenes de servicio.
 *
 * La máquina de estados y las reglas de firma viven en @tiretrack/domain y
 * ya están probadas sin base de datos. Aquí se encadenan con la persistencia:
 * folio, versión, congelado e historial.
 */

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
  readonly clienteId?: string | null;
  readonly vistaCliente?: boolean;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; veredicto: Veredicto };

/**
 * Cómo se protege una escritura contra cambios concurrentes.
 *
 * - `comando`: viene del dispositivo, que trabaja sin señal y encola
 *   operaciones. Se valida con las reglas del negocio AL APLICARLA. No lleva
 *   versión general: las operaciones previas del mismo dispositivo la suben
 *   al aplicarse, y la siguiente chocaría consigo misma.
 * - `en_linea`: viene de una pantalla que mostró la orden y la persona decide
 *   sobre lo que vio. Exige la versión que vio; si cambió, se rechaza.
 *
 * No hay valor por defecto a propósito: quien llama DECIDE el modo. Una
 * versión "opcional" es una protección que se puede olvidar sin que nadie lo
 * note.
 */
export type Precondicion =
  | { readonly modo: "comando" }
  | { readonly modo: "en_linea"; readonly version: number };

export const COMANDO: Precondicion = { modo: "comando" };
export const enLinea = (version: number): Precondicion => ({ modo: "en_linea", version });

/** Reintentos ante una carrera entre leer y escribir, solo en modo comando. */
const REINTENTOS_COMANDO = 3;

/** Datos de la firma, en la forma del contrato `zFirma`. */
export interface DatosFirma {
  readonly nombre: string;
  readonly cedula: string;
  readonly cargo?: string | null;
  readonly trazo: string;
  readonly consentimiento: string;
  /** Versión del CONTENIDO que la persona vio al firmar. */
  readonly versionContenido: number;
}

const fallo = (codigo: string, mensaje: string): Resultado<never> => ({
  ok: false,
  veredicto: { permitido: false, codigo, mensaje },
});

/** Estados cuya transición el cliente sí debe ver en su historial. */
const VISIBLES_CLIENTE: EstadoOrden[] = ["programada", "pendiente_cliente", "cerrada"];

export class ServicioOrdenes {
  constructor(
    private readonly repo: RepositorioOrdenes,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  private hoy(): string {
    // El día en Colombia: en UTC, después de las 7 p. m. ya es mañana.
    return fechaEnColombia(this.reloj());
  }

  // ── Creación ──────────────────────────────────────────────────────────────

  /**
   * Las órdenes programadas se crean con conexión y reciben folio real de
   * inmediato. Las imprevistas que nacen sin señal llevan solo un código de
   * referencia y reciben el folio al sincronizar.
   */
  async crear(
    ctx: Contexto,
    entrada: {
      id?: string;
      clientRequestId: string;
      sedeId: string;
      clienteId: string;
      sedeClienteId: string;
      vehiculoId: string;
      tecnicoId: string;
      configuracionEjeId: string;
      tipo: string;
      prioridad?: string;
      fecha: string;
      kilometraje?: number;
      notaCoordinador?: string;
      sinConductor?: boolean;
      conductorNombre?: string;
      /** true cuando el dispositivo la creó sin señal. */
      sinConexion?: boolean;
      confirmarDuplicada?: boolean;
    },
  ): Promise<Resultado<{ orden: Orden; avisoVehiculoOcupado?: string }>> {
    if (ctx.rol === "cliente") return fallo("SIN_PERMISO", "No puedes crear órdenes");

    // Idempotencia: si el envío se reintentó, se devuelve la que ya existe en
    // vez de crear una segunda.
    const yaCreada = await this.repo.buscarPorClientRequestId(entrada.clientRequestId);
    if (yaCreada) return { ok: true, valor: { orden: yaCreada } };

    // El técnico solo se asigna órdenes a sí mismo
    const tecnicoId = ctx.rol === "tecnico" ? ctx.usuarioId : entrada.tecnicoId;

    const perteneceASede = await this.repo.tecnicoPerteneceASede(tecnicoId, entrada.sedeId);
    if (!perteneceASede) {
      return fallo("TECNICO_AJENO_A_SEDE", "El técnico no está asignado a esa sede");
    }

    // El vehículo con otra orden abierta se avisa, no se bloquea: puede ser
    // un correctivo urgente sobre un vehículo con preventivo en curso.
    const abiertas = await this.repo.ordenesAbiertasDeVehiculo(entrada.vehiculoId);
    let aviso: string | undefined;
    if (abiertas.length > 0 && !entrada.confirmarDuplicada) {
      const otra = abiertas[0] as Orden;
      return fallo(
        "VEHICULO_CON_ORDEN_ABIERTA",
        `El vehículo ya tiene la orden ${otra.folio ?? otra.codigoReferencia} sin cerrar`,
      );
    }
    if (abiertas.length > 0) {
      aviso = `Se creó con ${abiertas.length} orden(es) abiertas del mismo vehículo`;
    }

    const codigoSede = await this.repo.codigoDeSede(entrada.sedeId);
    if (!codigoSede) return fallo("SEDE_NO_EXISTE", "La sede no existe");

    const folio = entrada.sinConexion
      ? null
      : await this.repo.siguienteFolio(ctx.empresaId, entrada.sedeId, codigoSede);

    const orden = await this.repo.crear({
      id: entrada.id ?? nuevoId(),
      empresaId: ctx.empresaId,
      sedeId: entrada.sedeId,
      clienteId: entrada.clienteId,
      sedeClienteId: entrada.sedeClienteId,
      vehiculoId: entrada.vehiculoId,
      tecnicoId,
      configuracionEjeId: entrada.configuracionEjeId,
      folio,
      // No se parece a un folio a propósito: nadie debe confundirlo con el
      // consecutivo definitivo.
      codigoReferencia: entrada.sinConexion ? codigoReferencia(codigoSede) : null,
      tipo: entrada.tipo,
      prioridad: entrada.prioridad ?? "normal",
      estado: ctx.rol === "tecnico" ? "en_proceso" : "programada",
      fecha: entrada.fecha,
      kilometraje: entrada.kilometraje ?? null,
      hallazgos: null,
      accion: null,
      notaCoordinador: entrada.notaCoordinador ?? null,
      motivoDevolucion: null,
      sinConductor: entrada.sinConductor ?? false,
      conductorNombre: entrada.conductorNombre ?? null,
      firmaNombre: null,
      firmaCedula: null,
      firmaVersion: null,
      clienteNombre: null,
      vehiculoCodigo: null,
      tecnicoNombre: null,
      congeladoEn: null,
      aprobadoPorId: null,
      autoAprobada: false,
      enviadoClienteEn: null,
      limiteCliente: null,
      cierreTacito: false,
      clientRequestId: entrada.clientRequestId,
      creadoPorId: ctx.usuarioId,
    });

    await this.repo.registrarHistorial({
      id: nuevoId(),
      ordenId: orden.id,
      estadoAnterior: null,
      estadoNuevo: orden.estado,
      usuarioId: ctx.usuarioId,
      motivo: null,
      visibleCliente: VISIBLES_CLIENTE.includes(orden.estado),
    });

    return { ok: true, valor: aviso ? { orden, avisoVehiculoOcupado: aviso } : { orden } };
  }

  /** Asigna folio a una orden que nació sin señal. */
  async asignarFolio(ctx: Contexto, ordenId: string): Promise<Resultado<Orden>> {
    const orden = await this.repo.buscarPorId(ordenId);
    if (!orden) return fallo("NO_EXISTE", "La orden no existe");
    if (orden.folio) return { ok: true, valor: orden };

    const codigoSede = await this.repo.codigoDeSede(orden.sedeId);
    if (!codigoSede) return fallo("SEDE_NO_EXISTE", "La sede no existe");

    const folio = await this.repo.siguienteFolio(ctx.empresaId, orden.sedeId, codigoSede);
    const actualizada = await this.repo.actualizar(ordenId, orden.version, {
      folio,
      sincronizadoEn: this.reloj(),
    });
    if (!actualizada) return fallo("CONFLICTO_VERSION", "La orden cambió mientras se procesaba");
    return { ok: true, valor: actualizada };
  }

  // ── Consulta ──────────────────────────────────────────────────────────────

  async listar(ctx: Contexto, filtro: Parameters<RepositorioOrdenes["listar"]>[0] = {}) {
    // RLS ya filtra por rol, pero acotar en la consulta evita traer filas que
    // el motor va a descartar.
    if (ctx.rol === "tecnico") return this.repo.listar({ ...filtro, tecnicoId: ctx.usuarioId });
    if (ctx.rol === "cliente" && ctx.clienteId) {
      return this.repo.listar({ ...filtro, clienteId: ctx.clienteId });
    }
    return this.repo.listar(filtro);
  }

  /**
   * El cliente no ve el ida y vuelta entre coordinador y técnico: es control
   * de calidad interno, expone al técnico y no le aporta nada.
   */
  async historial(ctx: Contexto, ordenId: string) {
    return this.repo.historialDe(ordenId, ctx.rol === "cliente");
  }

  // ── Edición de la cabecera ────────────────────────────────────────────────

  async actualizarDatos(
    ctx: Contexto,
    ordenId: string,
    pre: Precondicion,
    datos: { kilometraje?: number; hallazgos?: string; accion?: string; horasTrabajo?: number },
  ): Promise<Resultado<Orden>> {
    return this.escribir(ordenId, pre, (orden) => {
      const permiso = puedeEditarMediciones({
        estado: orden.estado,
        rol: ctx.rol,
        esTecnicoAsignado: orden.tecnicoId === ctx.usuarioId,
        vistaCliente: ctx.vistaCliente ?? false,
      });
      if (!permiso.permitido) return { ok: false, veredicto: permiso };
      // true: esto SÍ es contenido del servicio, invalida la firma
      return { datos: limpiar(datos), tocaContenido: true };
    });
  }

  /** El coordinador puede dejar instrucciones mientras la orden esté abierta. */
  async actualizarNota(
    ctx: Contexto,
    ordenId: string,
    pre: Precondicion,
    nota: string | null,
  ): Promise<Resultado<Orden>> {
    if (!puedeAprobar(ctx.rol, ctx.vistaCliente ?? false)) {
      return fallo("SIN_PERMISO", "Solo el coordinador deja instrucciones");
    }
    return this.escribir(ordenId, pre, () => ({ datos: { notaCoordinador: nota } }));
  }

  // ── Firma ─────────────────────────────────────────────────────────────────

  /**
   * Firma de quien recibe.
   *
   * Se ancla a la versión del CONTENIDO, y el servidor exige que coincida con
   * la que la persona firmó. Si no coincide, firmó algo distinto de lo que el
   * servidor tiene —por ejemplo, una medición quedó apartada— y la firma se
   * rechaza: aceptarla sería afirmar que el cliente aprobó un documento que
   * nunca vio.
   */
  async firmar(
    ctx: Contexto,
    ordenId: string,
    pre: Precondicion,
    firma: DatosFirma,
  ): Promise<Resultado<Orden>> {
    for (let intento = 0; intento < REINTENTOS_COMANDO; intento++) {
      const orden = await this.repo.buscarPorId(ordenId);
      if (!orden) return fallo("NO_EXISTE", "La orden no existe");
      if (orden.tecnicoId !== ctx.usuarioId) {
        return fallo("SOLO_ASIGNADO", "Solo el técnico asignado captura la firma");
      }
      if (!firma.nombre.trim() || !firma.cedula.trim()) {
        return fallo("FIRMA_INCOMPLETA", "Se necesita nombre y cédula de quien recibe");
      }
      if (!firma.consentimiento.trim()) {
        return fallo("SIN_CONSENTIMIENTO", "Falta la constancia del consentimiento de datos");
      }
      if (firma.versionContenido !== orden.versionContenido) {
        return fallo(
          "FIRMA_DESACTUALIZADA",
          "Quien firmó vio un contenido distinto del que tiene el servidor. Hay que volver a firmar",
        );
      }

      const version = this.versionParaEscribir(orden, pre);
      if (typeof version !== "number") return version;

      const actualizada = await this.repo.actualizar(ordenId, version, {
        firmaNombre: firma.nombre.trim(),
        firmaCedula: firma.cedula.trim(),
        firmaCargo: firma.cargo?.trim() || null,
        firmaTrazo: firma.trazo,
        firmaConsentimiento: firma.consentimiento,
        firmaFechaHora: this.reloj(),
        firmaVersion: orden.versionContenido,
      });
      if (actualizada) return { ok: true, valor: actualizada };
      if (pre.modo === "en_linea") break;
      // Comando: alguien escribió entre leer y escribir. Se vuelve a validar
      // contra el estado nuevo en vez de rechazar el trabajo del técnico.
    }
    return fallo("CONFLICTO_VERSION", "La orden cambió. Recárgala");
  }

  /**
   * Versión con la que se escribirá.
   *
   * En línea: la que vio la persona; si ya no es la actual, conflicto.
   * Comando: la que se acaba de leer; si cambia antes de escribir, el
   * llamador reintenta validando de nuevo.
   */
  private versionParaEscribir(
    orden: Orden,
    pre: Precondicion,
  ): number | Resultado<never> {
    if (pre.modo === "en_linea" && orden.version !== pre.version) {
      return fallo("CONFLICTO_VERSION", "Otra persona modificó la orden. Recárgala");
    }
    return orden.version;
  }

  // ── Máquina de estados ────────────────────────────────────────────────────

  async cambiarEstado(
    ctx: Contexto,
    ordenId: string,
    pre: Precondicion,
    destino: EstadoOrden,
    opciones: { motivo?: string; porVencimiento?: boolean } = {},
  ): Promise<Resultado<Orden>> {
    for (let intento = 0; intento < REINTENTOS_COMANDO; intento++) {
      const r = await this.intentarCambioDeEstado(ctx, ordenId, pre, destino, opciones);
      if (r !== "carrera") return r;
      if (pre.modo === "en_linea") break;
    }
    return fallo("CONFLICTO_VERSION", "La orden cambió. Recárgala");
  }

  /** Un intento de transición. Devuelve "carrera" si otro escribió en medio. */
  private async intentarCambioDeEstado(
    ctx: Contexto,
    ordenId: string,
    pre: Precondicion,
    destino: EstadoOrden,
    opciones: { motivo?: string; porVencimiento?: boolean },
  ): Promise<Resultado<Orden> | "carrera"> {
    const orden = await this.repo.buscarPorId(ordenId);
    if (!orden) return fallo("NO_EXISTE", "La orden no existe");
    const version = this.versionParaEscribir(orden, pre);
    if (typeof version !== "number") return version;

    const vigente = firmaVigente({
      versionContenido: orden.versionContenido,
      firma: orden.firmaNombre
        ? {
            nombre: orden.firmaNombre,
            cedula: orden.firmaCedula ?? "",
            fecha: "",
            version: orden.firmaVersion ?? -1,
          }
        : null,
    });

    const veredicto = evaluarTransicion(orden.estado, destino, {
      rol: ctx.rol,
      esTecnicoAsignado: orden.tecnicoId === ctx.usuarioId,
      firmaVigente: vigente,
      motivo: opciones.motivo,
      porVencimiento: opciones.porVencimiento ?? false,
    });
    if (!veredicto.permitido) return { ok: false, veredicto };

    const extra = await this.datosDeTransicion(orden, destino, ctx, opciones);
    if ("veredicto" in extra) return { ok: false, veredicto: extra.veredicto };

    const actualizada = await this.repo.cambiarEstado(ordenId, version, destino, extra.campos);
    if (!actualizada) return "carrera";

    await this.repo.registrarHistorial({
      id: nuevoId(),
      ordenId,
      estadoAnterior: orden.estado,
      estadoNuevo: destino,
      usuarioId: ctx.usuarioId,
      motivo: opciones.motivo ?? null,
      // La objeción del cliente sí la ve él; la devolución interna no.
      visibleCliente: VISIBLES_CLIENTE.includes(destino) || ctx.rol === "cliente",
    });

    return { ok: true, valor: actualizada };
  }

  /** Campos extra que acompañan cada transición. */
  private async datosDeTransicion(
    orden: Orden,
    destino: EstadoOrden,
    ctx: Contexto,
    opciones: { motivo?: string; porVencimiento?: boolean },
  ): Promise<{ campos: Record<string, unknown> } | { veredicto: Veredicto }> {
    if (destino === "pendiente_cliente") {
      // El congelado ocurre AQUÍ, no al cerrar: este es el contenido que el
      // cliente va a aprobar y ya no debe cambiar.
      const datos = await this.repo.datosParaCongelar(orden.id);
      if (!datos) return { veredicto: { permitido: false, codigo: "SIN_DATOS", mensaje: "Faltan datos maestros" } };

      const posiciones = await this.repo.contarPosiciones(orden.id);
      const listo = puedeCerrarse({
        tieneFirmaVigente: true,
        tieneCongelado: true,
        posicionesCapturadas: posiciones,
      });
      if (!listo.permitido) return { veredicto: listo };

      const congelado = congelar(datos, this.hoy());
      const plazo = plazoAprobacion(this.hoy(), this.hoy());

      return {
        campos: {
          ...congelado,
          congeladoEn: this.reloj(),
          aprobadoPorId: ctx.usuarioId,
          aprobadoEn: this.reloj(),
          autoAprobada: esAutoaprobacion(orden.tecnicoId, ctx.usuarioId),
          enviadoClienteEn: plazo.enviadoEn,
          limiteCliente: plazo.limite,
        },
      };
    }

    if (destino === "cerrada") {
      return {
        campos: {
          cierreTacito: opciones.porVencimiento ?? false,
          motivoCierre: opciones.motivo ?? null,
        },
      };
    }

    if (destino === "en_proceso" && orden.estado !== "programada") {
      // Devolución u objeción: el motivo queda visible para el técnico.
      return {
        campos: {
          motivoDevolucion: opciones.motivo ?? null,
          enviadoClienteEn: null,
          limiteCliente: null,
        },
      };
    }

    if (destino === "anulada") {
      return { campos: { anuladaEn: this.reloj(), motivoCierre: opciones.motivo ?? null } };
    }

    return { campos: {} };
  }

  /**
   * Cierre por vencimiento del plazo. Lo ejecuta un trabajo programado, no
   * una persona: queda marcado como tácito y nunca disfrazado de aprobación.
   */
  async cerrarPorVencimiento(ordenId: string, sistemaUsuarioId: string): Promise<Resultado<Orden>> {
    const orden = await this.repo.buscarPorId(ordenId);
    if (!orden) return fallo("NO_EXISTE", "La orden no existe");
    if (orden.estado !== "pendiente_cliente") {
      return fallo("ESTADO_INVALIDO", "La orden no está esperando al cliente");
    }
    if (!orden.limiteCliente || this.hoy() < orden.limiteCliente) {
      return fallo("PLAZO_VIGENTE", "El plazo del cliente todavía no vence");
    }

    return this.cambiarEstado(
      { empresaId: orden.empresaId, rol: "administrador", usuarioId: sistemaUsuarioId },
      ordenId,
      // Comando: lo decide una regla (plazo vencido), no una persona que
      // haya visto una versión. Si el cliente aprueba en el mismo instante,
      // la máquina de estados rechaza el cierre al revalidar.
      COMANDO,
      "cerrada",
      { porVencimiento: true, motivo: "Cerrada por vencimiento del plazo de aprobación" },
    );
  }

  /** Reasignar no toca la autoría de las mediciones ya capturadas. */
  async reasignar(
    ctx: Contexto,
    ordenId: string,
    pre: Precondicion,
    nuevoTecnicoId: string,
    motivo: string,
  ): Promise<Resultado<Orden>> {
    if (!puedeAprobar(ctx.rol, ctx.vistaCliente ?? false)) {
      return fallo("SIN_PERMISO", "Solo el coordinador reasigna");
    }
    const pertenece = async (sedeId: string) =>
      this.repo.tecnicoPerteneceASede(nuevoTecnicoId, sedeId);

    let estadoAntes: EstadoOrden | null = null;
    const r = await this.escribirAsync(ordenId, pre, async (orden) => {
      if (!(await pertenece(orden.sedeId))) {
        return fallo("TECNICO_AJENO_A_SEDE", "El técnico no está asignado a esa sede");
      }
      estadoAntes = orden.estado;
      // El motivo NO va en motivoDevolucion. Antes iba ahí, y el celular
      // clasifica una orden en proceso con ese campo como "Devuelta para
      // corregir": el técnico nuevo recibía la orden marcada como devuelta,
      // con "Cambio de turno" como si fuera lo que tenía que corregir.
      return { datos: { tecnico_id: nuevoTecnicoId } };
    });
    if (!r.ok || estadoAntes === null) return r;

    // Queda en el historial, sin cambio de estado y sin mostrarse al cliente.
    await this.repo.registrarHistorial({
      id: nuevoId(),
      ordenId,
      estadoAnterior: estadoAntes,
      estadoNuevo: estadoAntes,
      usuarioId: ctx.usuarioId,
      motivo: `Reasignada: ${motivo}`,
      visibleCliente: false,
    });
    return r;
  }

  /**
   * Escritura protegida según la precondición.
   *
   * `validar` recibe la orden recién leída y devuelve los campos a escribir o
   * un rechazo. En modo comando, si otro escribió entre leer y escribir, se
   * vuelve a leer y validar: el comando se juzga contra el estado ACTUAL, en
   * vez de rechazar el trabajo del técnico por una carrera que no causó.
   */
  private async escribir(
    ordenId: string,
    pre: Precondicion,
    validar: (orden: Orden) => Resultado<never> | { datos: Record<string, unknown>; tocaContenido?: boolean },
  ): Promise<Resultado<Orden>> {
    return this.escribirAsync(ordenId, pre, async (o) => validar(o));
  }

  private async escribirAsync(
    ordenId: string,
    pre: Precondicion,
    validar: (
      orden: Orden,
    ) => Promise<Resultado<never> | { datos: Record<string, unknown>; tocaContenido?: boolean }>,
  ): Promise<Resultado<Orden>> {
    for (let intento = 0; intento < REINTENTOS_COMANDO; intento++) {
      const orden = await this.repo.buscarPorId(ordenId);
      if (!orden) return fallo("NO_EXISTE", "La orden no existe");

      const version = this.versionParaEscribir(orden, pre);
      if (typeof version !== "number") return version;

      const decision = await validar(orden);
      if ("ok" in decision) return decision;

      const actualizada = await this.repo.actualizar(
        ordenId,
        version,
        decision.datos,
        decision.tocaContenido ?? false,
      );
      if (actualizada) return { ok: true, valor: actualizada };
      if (pre.modo === "en_linea") break;
    }
    return fallo("CONFLICTO_VERSION", "La orden cambió. Recárgala");
  }
}

/** Quita las claves sin valor para no sobrescribir con undefined. */
function limpiar(datos: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined));
}
