import { z } from "zod";
import {
  ESTADOS_ORDEN,
  ESTADOS_LLANTA,
  DESTINOS_LLANTA,
  PRIORIDADES,
  ROLES,
  TIPOS_EJE,
  TIPOS_SERVICIO,
  UNIDADES_PRESION,
  UNIDADES_PROFUNDIDAD,
  CODIGOS_SERVICIO_LLANTA,
  CODIGOS_SERVICIO_VEHICULO,
  dotValido,
  esFolioValido,
} from "@tiretrack/domain";

/**
 * Piezas primitivas de los contratos.
 *
 * Los enums salen del dominio, no se redefinen aquí: si mañana se agrega un
 * estado a la orden, el esquema lo acepta sin tocar este archivo. Duplicar la
 * lista sería garantizar que en algún momento se desincronicen.
 */

export const zUuid = z.string().uuid("Debe ser un UUID");

/**
 * Los identificadores los genera el CLIENTE, no el servidor. Es lo que
 * permite capturar sin conexión y sincronizar después sin duplicar.
 */
export const zId = zUuid;

/**
 * Fecha AAAA-MM-DD.
 *
 * No basta con Date.parse: "2026-02-31" no falla, se convierte en silencio
 * al 3 de marzo. Una orden fechada un día inexistente quedaría guardada con
 * otra fecha sin que nadie lo note. Se verifica que los componentes
 * sobrevivan al viaje de ida y vuelta.
 */
export const zFechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: AAAA-MM-DD")
  .refine((v) => {
    const [a, m, d] = v.split("-").map(Number);
    if (!a || !m || !d) return false;
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const fecha = new Date(Date.UTC(a, m - 1, d));
    return (
      fecha.getUTCFullYear() === a &&
      fecha.getUTCMonth() === m - 1 &&
      fecha.getUTCDate() === d
    );
  }, "Esa fecha no existe");

export const zTextoCorto = z.string().trim().min(1).max(120);
export const zTextoLargo = z.string().trim().max(2000);

/** Motivo obligatorio: en blanco no cuenta como motivo. */
export const zMotivo = z.string().trim().min(3, "El motivo no puede quedar vacío").max(1000);

export const zRol = z.enum(ROLES);
export const zEstadoOrden = z.enum(ESTADOS_ORDEN);
export const zPrioridad = z.enum(PRIORIDADES);
export const zTipoServicio = z.enum(TIPOS_SERVICIO);
export const zTipoEje = z.enum(TIPOS_EJE);
export const zEstadoLlanta = z.enum(ESTADOS_LLANTA);
export const zDestinoLlanta = z.enum(DESTINOS_LLANTA);
export const zUnidadPresion = z.enum(UNIDADES_PRESION);
export const zUnidadProfundidad = z.enum(UNIDADES_PROFUNDIDAD);

/**
 * Por la red viaja el CÓDIGO del servicio, no su nombre. El nombre es para
 * mostrar y puede cambiar; si fuera el identificador, renombrar un servicio en
 * pantalla rompería la sincronización y el histórico.
 */
export const zServicioLlanta = z.enum(CODIGOS_SERVICIO_LLANTA as [string, ...string[]]);
export const zServicioVehiculo = z.enum(CODIGOS_SERVICIO_VEHICULO as [string, ...string[]]);

/** Folio con el formato OS-{sede}-{consecutivo}. */
export const zFolio = z.string().refine(esFolioValido, "Folio con formato inválido");

/**
 * Código DOT: semana y año de fabricación. Se acepta vacío porque el técnico
 * puede no alcanzar a leerlo, pero si viene algo debe ser interpretable.
 */
export const zDot = z
  .string()
  .trim()
  .max(20)
  .refine((v) => v === "" || dotValido(v), "El DOT debe traer semana y año, por ejemplo 3624");

/** Presión y profundidad: no negativas y con techo razonable. */
export const zPresion = z.number().min(0).max(400);
export const zProfundidad = z.number().min(0).max(60);

/** Posición dentro del diagrama. El máximo real lo valida la configuración. */
export const zPosicion = z.number().int().min(1).max(60);

export const zKilometraje = z.number().int().min(0).max(9_999_999);

/**
 * Clave de idempotencia de la sincronización. Reintentar el envío de una
 * operación no debe crear un registro duplicado.
 */
export const zClientRequestId = zUuid;

/** Paginación estándar de los listados. */
export const zPaginacion = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(50),
});

export type Paginacion = z.infer<typeof zPaginacion>;

/** Respuesta de error uniforme de la API. */
export const zError = z.object({
  error: z.object({
    codigo: z.string(),
    mensaje: z.string(),
    campo: z.string().optional(),
    detalles: z.unknown().optional(),
  }),
});

export type RespuestaError = z.infer<typeof zError>;
