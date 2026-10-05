import { z } from "zod";
import {
  zFechaISO,
  zId,
  zPosicion,
  zPresion,
  zProfundidad,
  zTextoCorto,
  zTextoLargo,
  zTipoEje,
  zUnidadPresion,
  zUnidadProfundidad,
} from "./comunes";

/**
 * Catálogo, clientes y sincronización.
 */

// ── Catálogo de llantas: marca → diseño → medida ───────────────────────────

export const zCrearMarca = z.object({
  id: zId,
  nombre: z.string().trim().min(2).max(60),
  /** true si la crea el técnico en campo: queda para revisión del admin. */
  creadaEnCampo: z.boolean().default(false),
});

export const zCrearDiseno = z.object({
  id: zId,
  marcaId: zId,
  nombre: z.string().trim().min(2).max(60),
  tipoEje: zTipoEje.default("multiuso"),
  creadaEnCampo: z.boolean().default(false),
});

/**
 * La profundidad de fábrica vive en la MEDIDA, no en el diseño: un XZY-3 en
 * 295/80R22.5 trae 16 mm y en 11R22.5 trae 14.5. Si se guarda un solo valor
 * por diseño, el porcentaje de desgaste sale mal en flotas con dos medidas.
 */
export const zCrearMedida = z.object({
  disenoId: zId,
  medida: z
    .string()
    .trim()
    .min(4)
    .max(30)
    .regex(/^[\d/.\-RXx ]+$/, "Formato esperado: 295/80R22.5"),
  profundidadOriginal: zProfundidad.nullable().optional(),
});

export const zPromoverMarca = z.object({ marcaId: zId });

// ── Empresa, sedes y usuarios ──────────────────────────────────────────────

export const zCrearEmpresa = z.object({
  id: zId,
  nombre: zTextoCorto,
  nit: z.string().trim().min(5).max(20),
  nitSecundario: z.string().trim().max(20).optional(),
  unidadPresion: zUnidadPresion.default("psi"),
  unidadProfundidad: zUnidadProfundidad.default("mm"),
});

export const zCrearSede = z.object({
  id: zId,
  nombre: zTextoCorto,
  /** Entra en el folio: OS-FUN-000123. */
  codigo: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(6)
    .regex(/^[A-Z0-9]+$/, "Solo letras y números, sin espacios"),
  direccion: zTextoCorto.optional(),
  ciudad: zTextoCorto.optional(),
  departamento: zTextoCorto.optional(),
});

export const zCrearUsuario = z.object({
  id: zId,
  nombre: zTextoCorto,
  cedula: z.string().trim().min(5).max(20),
  email: z.string().trim().toLowerCase().email(),
  telefono: z.string().trim().max(20).optional(),
  rol: z.enum(["administrador", "coordinador", "tecnico", "cliente"]),
  /** Un usuario rota entre sedes: la relación es de muchos a muchos. */
  sedes: z.array(zId).min(1, "Asigna al menos una sede"),
  sedePrincipal: zId.optional(),
  /** Obligatorio cuando el rol es cliente. */
  clienteId: zId.optional(),
})
  .refine((d) => d.rol !== "cliente" || !!d.clienteId, {
    message: "Un usuario cliente debe estar vinculado a su cliente",
    path: ["clienteId"],
  })
  .refine((d) => !d.sedePrincipal || d.sedes.includes(d.sedePrincipal), {
    message: "La sede principal debe estar entre las asignadas",
    path: ["sedePrincipal"],
  });

// ── Clientes, sedes de cliente y vehículos ─────────────────────────────────

export const zCrearCliente = z.object({
  id: zId,
  nombre: zTextoCorto,
  /** Único POR EMPRESA. El mismo NIT puede existir en otra empresa. */
  nit: z.string().trim().min(5).max(20),
  nitSecundario: z.string().trim().max(20).optional(),
  contacto: zTextoCorto.optional(),
  telefono: z.string().trim().max(20).optional(),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
});

export const zCrearSedeCliente = z.object({
  id: zId,
  clienteId: zId,
  nombre: zTextoCorto,
  direccion: zTextoCorto.optional(),
  ciudad: zTextoCorto.optional(),
  departamento: zTextoCorto.optional(),
});

/** El vehículo pertenece a la SEDE del cliente, no al cliente. */
export const zCrearVehiculo = z.object({
  id: zId,
  sedeClienteId: zId,
  configuracionEjeId: zId,
  codigo: zTextoCorto,
  placa: z.string().trim().max(10).optional(),
  nombre: zTextoCorto,
  tipo: zTextoCorto,
  marca: zTextoCorto.optional(),
  modelo: zTextoCorto.optional(),
  anio: z.number().int().min(1950).max(2100).optional(),
  kmActual: z.number().int().min(0).default(0),
});

// ── Configuración de ejes ──────────────────────────────────────────────────

export const zEjeDefinicion = z.object({
  numero: z.number().int().min(1).max(20),
  tipoEje: zTipoEje,
  psiObjetivo: zPresion.optional(),
  profundidadMinima: zProfundidad.optional(),
  posicionesIzquierda: z.array(zPosicion).min(1),
  posicionesDerecha: z.array(zPosicion).min(1),
});

/**
 * Las plantillas son INMUTABLES: editar crea una versión nueva. Las órdenes
 * ya creadas conservan la versión con la que se dibujaron, para que una orden
 * de hace seis meses siga mostrando su diagrama de entonces.
 */
export const zCrearConfiguracionEje = z.object({
  id: zId,
  nombre: zTextoCorto,
  ejes: z.array(zEjeDefinicion).min(1),
  /** Presente cuando esta versión reemplaza a otra. */
  reemplazaA: zId.optional(),
});
export type CrearConfiguracionEje = z.infer<typeof zCrearConfiguracionEje>;

// ── Programación recurrente ────────────────────────────────────────────────

export const zCrearProgramacion = z.object({
  id: zId,
  clienteId: zId,
  sedeClienteId: zId,
  vehiculoId: zId,
  tipo: z.enum(["preventivo", "correctivo"]),
  frecuencia: z.enum(["dias_habiles", "dias_calendario", "semanal", "quincenal", "mensual"]),
  cada: z.number().int().min(1).max(365).default(1),
  inicio: zFechaISO,
});

// ── Sincronización ─────────────────────────────────────────────────────────

export const TIPOS_OPERACION = [
  "crear_orden",
  "actualizar_orden",
  "guardar_medicion",
  "cambiar_estado",
  "crear_recomendacion",
  "resolver_recomendacion",
  "subir_foto",
] as const;

/**
 * Se sincronizan OPERACIONES, no registros.
 *
 * Cada acción del técnico es un evento con identificador propio. Reintentar
 * el envío no duplica nada, y el servidor puede aplicarlas en orden aunque
 * lleguen todas juntas después de horas sin señal.
 */
export const zOperacion = z.object({
  id: zId,
  tipo: z.enum(TIPOS_OPERACION),
  /** Marca del dispositivo, para ordenar y para depurar. */
  creadaEn: z.string().datetime(),
  /** Identificador del recurso afectado. */
  recursoId: zId,
  ordenId: zId.optional(),
  datos: z.unknown(),
  /** Intentos previos: sirve para el descarte tras demasiados fallos. */
  intentos: z.number().int().min(0).default(0),
});
export type Operacion = z.infer<typeof zOperacion>;

export const zLoteSincronizacion = z.object({
  dispositivoId: zId,
  operaciones: z.array(zOperacion).min(1).max(200),
});
export type LoteSincronizacion = z.infer<typeof zLoteSincronizacion>;

export const RESULTADOS_OPERACION = ["aplicada", "duplicada", "conflicto", "rechazada"] as const;

export const zResultadoOperacion = z.object({
  operacionId: zId,
  resultado: z.enum(RESULTADOS_OPERACION),
  /** Presente cuando el servidor asignó un folio a una orden imprevista. */
  folioAsignado: z.string().optional(),
  /** Versión que quedó en el servidor, para reconciliar el estado local. */
  version: z.number().int().optional(),
  codigo: z.string().optional(),
  mensaje: z.string().optional(),
});
export type ResultadoOperacion = z.infer<typeof zResultadoOperacion>;

export const zRespuestaSincronizacion = z.object({
  resultados: z.array(zResultadoOperacion),
  /** Marca para pedir solo lo que cambió desde la última vez. */
  servidorEn: z.string().datetime(),
});
export type RespuestaSincronizacion = z.infer<typeof zRespuestaSincronizacion>;

// ── Fotos ──────────────────────────────────────────────────────────────────

export const zSolicitarSubida = z.object({
  id: zId,
  ordenId: zId,
  posicion: zPosicion.optional(),
  nombreArchivo: zTextoCorto,
  tipoMime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  /** Se comprime en el dispositivo antes de subir: tope de 2 MB. */
  tamanoBytes: z.number().int().min(1).max(2 * 1024 * 1024, "Comprime la foto antes de subirla"),
});
export type SolicitarSubida = z.infer<typeof zSolicitarSubida>;

export const zUrlPrefirmada = z.object({
  url: z.string().url(),
  campos: z.record(z.string()).optional(),
  urlPublica: z.string().url(),
  expiraEn: z.number().int(),
});

// ── Informe ────────────────────────────────────────────────────────────────

export const zFiltroInforme = z.object({
  clienteId: zId.optional(),
  vehiculoId: zId.optional(),
  serial: zTextoCorto.optional(),
  servicio: zTextoCorto.optional(),
  estadoLlanta: zTextoCorto.optional(),
  desde: zFechaISO.optional(),
  hasta: zFechaISO.optional(),
  /** Órdenes concretas cuando el usuario las eligió a mano. */
  ordenIds: z.array(zId).optional(),
});
export type FiltroInforme = z.infer<typeof zFiltroInforme>;

export const zRegistroAuditoria = z.object({
  accion: z.string(),
  detalle: z.record(z.unknown()).optional(),
  ip: z.string().optional(),
});

export const zObservacion = zTextoLargo;
