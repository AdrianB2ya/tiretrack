import { type EstadoOrden, type Rol, type Veredicto, PERMITIDO, negar } from "../tipos";

/**
 * Firma del cliente y permisos de edición.
 *
 * La firma se ata a la VERSIÓN de la orden. Si el contenido cambia después
 * de firmar, la firma deja de amparar lo que quedó registrado y hay que
 * recapturarla. Esto surgió de un caso real: el coordinador devolvía una
 * orden ya firmada, el técnico corregía una medición, y el documento que el
 * cliente había firmado ya no era el mismo.
 */

export interface Firma {
  readonly nombre: string;
  readonly cedula: string;
  readonly fecha: string;
  /**
   * Versión del CONTENIDO en el momento de firmar.
   *
   * No es la versión general de la orden: esa sube también al mover la orden
   * de estado, y avanzar en el flujo no debe invalidar una firma. El
   * documento que el cliente firmó no cambia porque el coordinador lo
   * apruebe.
   */
  readonly version: number;
}

export interface OrdenFirmable {
  /** Contador que sube solo cuando cambian mediciones o datos del servicio. */
  readonly versionContenido: number;
  readonly firma?: Firma | null;
}

/** Hay firma y corresponde a la versión actual. */
export function firmaVigente(orden: OrdenFirmable): boolean {
  return !!orden.firma && orden.firma.version === orden.versionContenido;
}

/** Hay firma, pero la orden cambió después: no ampara el contenido actual. */
export function firmaInvalidada(orden: OrdenFirmable): boolean {
  return !!orden.firma && orden.firma.version !== orden.versionContenido;
}

export interface ContextoEdicion {
  readonly estado: EstadoOrden;
  readonly rol: Rol;
  readonly esTecnicoAsignado: boolean;
  /** true en el portal del cliente. */
  readonly vistaCliente?: boolean;
}

/**
 * Quién puede capturar o modificar mediciones.
 *
 * Solo el técnico asignado, y solo mientras la orden está en captura. El
 * coordinador NO edita: devuelve la orden con motivo. Si pudiera corregir lo
 * que midió el técnico, la autoría y la firma perderían sentido.
 */
export function puedeEditarMediciones(c: ContextoEdicion): Veredicto {
  if (c.vistaCliente) return negar("VISTA_CLIENTE", "El portal del cliente es de solo lectura");

  if (c.estado === "cerrada" || c.estado === "anulada") {
    return negar("ORDEN_CERRADA", "La orden ya está cerrada");
  }
  if (c.estado === "en_revision") {
    return negar("EN_REVISION", "La orden está en revisión del coordinador");
  }
  if (c.estado === "pendiente_cliente") {
    return negar("ESPERA_CLIENTE", "La orden está esperando la aprobación del cliente");
  }
  if (!c.esTecnicoAsignado) {
    return negar(
      "SOLO_ASIGNADO",
      "Solo el técnico asignado captura. Si algo está mal, devuelve la orden",
    );
  }
  return PERMITIDO;
}

/** El gestor puede aprobar o devolver, pero no editar. */
export function puedeAprobar(rol: Rol, vistaCliente = false): boolean {
  if (vistaCliente) return false;
  return rol === "coordinador" || rol === "administrador";
}

/**
 * Aprobación del propio ejecutor. Está permitida —es su nivel de autoridad—
 * pero debe quedar marcada en el registro.
 */
export function esAutoaprobacion(tecnicoId: string, aprobadorId: string): boolean {
  return tecnicoId === aprobadorId;
}
