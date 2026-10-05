import { z } from "zod";
import {
  zClientRequestId,
  zDestinoLlanta,
  zDot,
  zEstadoLlanta,
  zEstadoOrden,
  zFechaISO,
  zFolio,
  zId,
  zKilometraje,
  zMotivo,
  zPosicion,
  zPresion,
  zPrioridad,
  zProfundidad,
  zServicioLlanta,
  zServicioVehiculo,
  zTextoCorto,
  zTextoLargo,
  zTipoServicio,
} from "./comunes";

/**
 * Órdenes de servicio y mediciones por posición.
 *
 * La medición de cada posición es su propio recurso, no un campo dentro de
 * la orden: el técnico sincroniza posición por posición, y si se cae la
 * señal a mitad de captura no puede perder todo lo anterior.
 */

/** Motivos por los que una llanta no se puede identificar en campo. */
export const MOTIVOS_NO_IDENTIFICADA = [
  "flanco_borrado",
  "interna",
  "sucia",
  "danada",
  "reencauche_sin_marcacion",
  "otro",
] as const;
export const zMotivoNoIdentificada = z.enum(MOTIVOS_NO_IDENTIFICADA);

/** Datos de la llanta que SALE de la posición. */
export const zLlantaDesmontada = z.object({
  posicionOrigen: zPosicion.optional(),
  marcaId: zId.optional(),
  disenoId: zId.optional(),
  medida: zTextoCorto.optional(),
  numCalor: zTextoCorto.optional(),
  serial: zTextoCorto.optional(),
  dot: zDot.optional(),
  profundidad: zProfundidad.optional(),
  destino: zDestinoLlanta.optional(),
  detalle: zTextoLargo.optional(),
});
export type LlantaDesmontada = z.infer<typeof zLlantaDesmontada>;

const camposMedicion = {
  id: zId,
  posicion: zPosicion,

  marcaId: zId.optional(),
  disenoId: zId.optional(),
  medida: zTextoCorto.optional(),
  numCalor: zTextoCorto.optional(),
  serial: zTextoCorto.optional(),
  dot: zDot.optional(),
  estadoLlanta: zEstadoLlanta.optional(),

  numParche: zTextoCorto.optional(),
  tipoParcheId: zId.optional(),

  psiEncontrada: zPresion.optional(),
  psiCalibrado: zPresion.optional(),
  profundidad: zProfundidad.optional(),

  servicios: z.array(zServicioLlanta).default([]),
  observaciones: zTextoLargo.optional(),

  /**
   * Cuando el flanco está borrado o la llanta es interna, el técnico no puede
   * identificarla. Sin esta salida explícita inventaría un dato, y un dato
   * inventado es peor que uno faltante.
   */
  noIdentificada: z.boolean().default(false),
  motivoNoIdentificada: zMotivoNoIdentificada.optional(),
  notaNoIdentificada: zTextoCorto.optional(),

  desmontada: zLlantaDesmontada.optional(),
};

export const zMedicionLlanta = z
  .object(camposMedicion)
  .refine((d) => !d.noIdentificada || !!d.motivoNoIdentificada, {
    message: "Si no se pudo identificar la llanta, hay que indicar el motivo",
    path: ["motivoNoIdentificada"],
  })
  .refine((d) => !d.noIdentificada || (!d.marcaId && !d.disenoId), {
    message: "Una llanta marcada como no identificada no puede traer marca ni diseño",
    path: ["marcaId"],
  })
  .refine((d) => !d.disenoId || !!d.marcaId, {
    message: "El diseño depende de la marca",
    path: ["disenoId"],
  })
  .refine((d) => !d.medida || !!d.disenoId, {
    message: "La medida depende del diseño",
    path: ["medida"],
  });
export type MedicionLlanta = z.infer<typeof zMedicionLlanta>;

/** Alta de una orden. El folio lo asigna el servidor, nunca el cliente. */
export const zCrearOrden = z
  .object({
    /** UUID generado en el dispositivo. */
    id: zId,
    clientRequestId: zClientRequestId,

    sedeId: zId,
    clienteId: zId,
    sedeClienteId: zId,
    vehiculoId: zId,
    tecnicoId: zId,
    /** Versión de la plantilla de ejes que se congela en la orden. */
    configuracionEjeId: zId,

    tipo: zTipoServicio,
    prioridad: zPrioridad.default("normal"),
    fecha: zFechaISO,

    /** Referencia temporal de las órdenes creadas sin conexión. */
    codigoReferencia: z.string().trim().max(20).optional(),

    kilometraje: zKilometraje.optional(),
    notaCoordinador: zTextoLargo.optional(),

    sinConductor: z.boolean().default(false),
    conductorNombre: zTextoCorto.optional(),
    conductorCedula: zTextoCorto.optional(),
  })
  .refine((d) => d.sinConductor || !!d.conductorNombre, {
    message: "Indica quién entrega el vehículo, o marca que está sin conductor",
    path: ["conductorNombre"],
  });
export type CrearOrden = z.infer<typeof zCrearOrden>;

/** Datos que el técnico corrige mientras la orden está abierta. */
export const zActualizarOrden = z.object({
  version: z.number().int().min(0),
  kilometraje: zKilometraje.nullable().optional(),
  hallazgos: zTextoLargo.optional(),
  accion: zTextoLargo.optional(),
  horasTrabajo: z.number().min(0).max(99).optional(),
  serviciosVehiculo: z.array(zServicioVehiculo).optional(),
  notaCoordinador: zTextoLargo.nullable().optional(),
});
export type ActualizarOrden = z.infer<typeof zActualizarOrden>;

/**
 * Firma de quien recibe.
 *
 * `versionContenido` es la versión del CONTENIDO que la persona vio al
 * firmar, no la versión general de la orden. La general sube también al
 * cambiar de estado o asignar el folio, cosas que no alteran lo firmado; con
 * ella, una jornada sin señal chocaría consigo misma. El servidor verifica que
 * su contenido coincida con lo firmado: si no, la persona firmó algo que el
 * servidor no tiene, y la firma se rechaza.
 *
 * `trazo` y `consentimiento` son obligatorios. Antes el contrato no los
 * conocía y el validador los descartaba en silencio: el servidor habría
 * perdido la constancia del consentimiento que exige la Ley 1581.
 */
export const zFirma = z.object({
  nombre: zTextoCorto,
  cedula: zTextoCorto,
  cargo: zTextoCorto.optional(),
  /** Segmentos del trazo, serializados. Se guardan puntos, no una imagen. */
  trazo: z.string().min(2).max(200_000),
  /** Versión del texto de consentimiento que aceptó quien firma. */
  consentimiento: z.string().min(1).max(40),
  versionContenido: z.number().int().min(0),
});
export type Firma = z.infer<typeof zFirma>;

/**
 * Cambio de estado. El motivo es obligatorio en devolución, objeción,
 * anulación y cierre forzado; el servidor lo exige con las reglas del dominio.
 */
/**
 * Cambio de estado como COMANDO.
 *
 * No lleva versión: lo valida el servidor con las reglas del negocio al
 * aplicarlo —¿la transición existe?, ¿quien la pide puede?, ¿la firma sigue
 * vigente?—. Las pantallas que editan EN LÍNEA mandan además la versión que
 * vieron en el encabezado `If-Match`, que el servidor exige en esas rutas.
 */
export const zCambiarEstado = z.object({
  estado: zEstadoOrden,
  motivo: zMotivo.optional(),
});
export type CambiarEstado = z.infer<typeof zCambiarEstado>;
export type Reasignar = z.infer<typeof zReasignar>;
export type AdjuntarFoto = z.infer<typeof zAdjuntarFoto>;

/** Reasignación como comando; ver `zCambiarEstado` sobre la versión. */
export const zReasignar = z.object({
  tecnicoId: zId,
  motivo: zMotivo,
});

/**
 * Adjuntar una foto a la orden, como operación ORDENADA.
 *
 * Viaja en la misma cola que las mediciones y la firma, para respetar el
 * orden en que el técnico trabajó. El archivo sube aparte por lo pesado, pero
 * lo que cambia el contenido de la orden es esta operación, no la llegada de
 * los bytes. Antes lo hacía la confirmación del archivo, que podía llegar
 * DESPUÉS de la firma e invalidarla aunque la foto se tomó antes de firmar.
 */
export const zAdjuntarFoto = z.object({
  id: zId,
  medicionId: zId.optional(),
  nombre: zTextoCorto,
  tipoMime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  tamanoBytes: z.number().int().positive(),
});

/** Filtros del listado de órdenes. */
export const zFiltroOrdenes = z.object({
  estado: zEstadoOrden.optional(),
  clienteId: zId.optional(),
  vehiculoId: zId.optional(),
  tecnicoId: zId.optional(),
  sedeId: zId.optional(),
  desde: zFechaISO.optional(),
  hasta: zFechaISO.optional(),
});
export type FiltroOrdenes = z.infer<typeof zFiltroOrdenes>;

/** Recomendaciones: lo que se encontró y no se ejecutó en la visita. */
export const PRIORIDADES_RECOMENDACION = ["urgente", "proxima", "seguimiento"] as const;
export const ESTADOS_RECOMENDACION = ["abierta", "ejecutada", "descartada"] as const;

export const zCrearRecomendacion = z.object({
  id: zId,
  vehiculoId: zId,
  posicion: zPosicion.optional(),
  texto: z.string().trim().min(5).max(1000),
  prioridad: z.enum(PRIORIDADES_RECOMENDACION).default("proxima"),
});
export type CrearRecomendacion = z.infer<typeof zCrearRecomendacion>;

export const zResolverRecomendacion = z.object({
  estado: z.enum(["ejecutada", "descartada"]),
  ordenId: zId,
});

/** Respuesta con el folio ya asignado por el servidor. */
export const zOrdenCreada = z.object({
  id: zId,
  folio: zFolio,
  estado: zEstadoOrden,
  version: z.number().int(),
});
export type OrdenCreada = z.infer<typeof zOrdenCreada>;
