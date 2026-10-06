import type { AdjuntarFoto, CrearOrden, Firma, MedicionLlanta } from "@tiretrack/contracts";

/**
 * Traducción de lo local al contrato compartido.
 *
 * SQLite y el formulario producen `null` para lo vacío; el contrato espera
 * que lo vacío **no esté**. Esa sola diferencia hacía que el servidor
 * rechazara prácticamente todas las mediciones: casi ninguna llega con todos
 * los campos llenos.
 *
 * Se traduce aquí, en la frontera, y en ningún otro sitio. Si cada pantalla
 * convirtiera por su cuenta, cada una lo haría un poco distinto.
 */

export interface MedicionParaEnviar {
  readonly id: string;
  readonly posicion: number;
  readonly marcaId?: string | null;
  readonly disenoId?: string | null;
  readonly medida?: string | null;
  readonly numCalor?: string | null;
  readonly serial?: string | null;
  readonly dot?: string | null;
  readonly estadoLlanta?: string | null;
  readonly psiEncontrada?: number | null;
  readonly psiCalibrado?: number | null;
  readonly profundidad?: number | null;
  readonly observaciones?: string | null;
  readonly noIdentificada?: boolean;
  readonly motivoNoId?: string | null;
  /** Códigos de servicio del catálogo fijo (`CALI`, `RETO`…). */
  readonly servicios?: readonly string[];
  /** La llanta que salió de la posición, si se cambió. */
  readonly desmontada?: Desmontada | null;
}

/** La llanta que sale de la posición, en el celular. */
export interface Desmontada {
  readonly posicionOrigen: number | null;
  readonly marcaId: string | null;
  readonly disenoId: string | null;
  readonly medida: string | null;
  readonly numCalor: string | null;
  readonly serial: string | null;
  readonly dot: string | null;
  readonly profundidad: number | null;
  readonly destino: string | null;
  readonly detalle: string | null;
}

/**
 * Convierte una medición local a la forma del contrato.
 *
 * Tres cosas quedan **fuera a propósito**:
 * - `ordenId`: viaja en la URL, no en el cuerpo.
 * - `capturadoPorId`: el servidor lo toma de la sesión. Si viajara en el
 *   cuerpo, cualquiera podría firmar mediciones a nombre de otro.
 * - los campos vacíos: el contrato los espera ausentes, no en `null`.
 */
export function medicionAContrato(m: MedicionParaEnviar): MedicionLlanta {
  const salida: Record<string, unknown> = {
    id: m.id,
    posicion: m.posicion,
    noIdentificada: m.noIdentificada ?? false,
    // Los códigos viajan tal cual: son el identificador del contrato. Uno
    // desconocido tampoco se descarta: el servidor lo rechazará y la
    // operación quedará apartada. Descartarlo borraría en silencio un
    // servicio que el técnico sí hizo.
    servicios: [...(m.servicios ?? [])],
  };

  const opcionales: [keyof MedicionLlanta, unknown][] = [
    ["marcaId", m.marcaId],
    ["disenoId", m.disenoId],
    ["medida", m.medida],
    ["numCalor", m.numCalor],
    ["serial", m.serial],
    ["dot", m.dot],
    ["estadoLlanta", m.estadoLlanta],
    ["psiEncontrada", m.psiEncontrada],
    ["psiCalibrado", m.psiCalibrado],
    ["profundidad", m.profundidad],
    ["observaciones", m.observaciones],
    // El nombre local era distinto del contrato: se perdía sin error, porque
    // las claves desconocidas se descartan al validar.
    ["motivoNoIdentificada", m.motivoNoId],
  ];

  for (const [clave, valor] of opcionales) {
    if (valor !== null && valor !== undefined && valor !== "") salida[clave] = valor;
  }

  // La desmontada viaja anidada y, como el resto, sin campos vacíos.
  if (m.desmontada) {
    const d: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(m.desmontada)) {
      if (valor !== null && valor !== undefined && valor !== "") d[clave] = valor;
    }
    salida["desmontada"] = d;
  }

  return salida as MedicionLlanta;
}

export interface OrdenParaEnviar {
  readonly id: string;
  readonly clientRequestId?: string | null;
  readonly sedeId: string;
  readonly clienteId: string;
  readonly sedeClienteId: string;
  readonly vehiculoId: string;
  readonly tecnicoId: string;
  readonly configuracionEjeId: string;
  readonly tipo: string;
  readonly prioridad?: string | null;
  readonly fecha: string;
  readonly codigoReferencia?: string | null;
  readonly kilometraje?: number | null;
  readonly sinConductor?: boolean;
  readonly conductorNombre?: string | null;
  /** Instrucciones del coordinador. No viajaban: el técnico nunca las veía. */
  readonly notaCoordinador?: string | null;
}

/**
 * Convierte una orden local a la forma del contrato de creación.
 *
 * `clientRequestId` es lo que evita crear la orden dos veces si el envío se
 * reintenta. El móvil no lo mandaba, y el contrato lo exige. La clave correcta
 * ya existía: el UUID que el dispositivo genera al crear la orden, estable
 * entre reintentos.
 *
 * `estado` y `folio` quedan fuera: el estado lo decide el servidor según el
 * rol, y el folio lo asigna el servidor con su consecutivo atómico.
 */
export function ordenAContrato(o: OrdenParaEnviar): CrearOrden {
  const salida: Record<string, unknown> = {
    id: o.id,
    clientRequestId: o.clientRequestId ?? o.id,
    sedeId: o.sedeId,
    clienteId: o.clienteId,
    sedeClienteId: o.sedeClienteId,
    vehiculoId: o.vehiculoId,
    tecnicoId: o.tecnicoId,
    configuracionEjeId: o.configuracionEjeId,
    tipo: o.tipo,
    fecha: o.fecha,
    sinConductor: o.sinConductor ?? false,
  };

  const opcionales: [string, unknown][] = [
    ["prioridad", o.prioridad],
    ["codigoReferencia", o.codigoReferencia],
    ["kilometraje", o.kilometraje],
    ["conductorNombre", o.conductorNombre],
    ["notaCoordinador", o.notaCoordinador],
  ];
  for (const [clave, valor] of opcionales) {
    if (valor !== null && valor !== undefined && valor !== "") salida[clave] = valor;
  }
  return salida as CrearOrden;
}

/**
 * Firma en la forma del contrato.
 *
 * `versionContenido` es la del momento de firmar. El servidor la compara con
 * la suya: si no coinciden, la persona firmó algo que el servidor no tiene y
 * la firma se rechaza.
 */
export function firmaAContrato(
  f: { nombre: string; cedula: string; cargo?: string | null; trazo: string; consentimiento: string },
  versionContenido: number,
): Firma {
  const salida: Record<string, unknown> = {
    nombre: f.nombre.trim(),
    cedula: f.cedula.trim(),
    trazo: f.trazo,
    consentimiento: f.consentimiento,
    versionContenido,
  };
  if (f.cargo?.trim()) salida["cargo"] = f.cargo.trim();
  return salida as Firma;
}

/** Foto adjunta en la forma del contrato. La ruta local no viaja. */
export function fotoAContrato(f: {
  id: string;
  medicionId?: string | null;
  nombre: string;
  tipoMime: string;
  tamanoBytes: number;
}): AdjuntarFoto {
  const salida: Record<string, unknown> = {
    id: f.id,
    nombre: f.nombre,
    tipoMime: f.tipoMime,
    tamanoBytes: f.tamanoBytes,
  };
  if (f.medicionId) salida["medicionId"] = f.medicionId;
  return salida as AdjuntarFoto;
}
