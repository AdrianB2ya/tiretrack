import { type Veredicto, PERMITIDO, negar } from "../tipos";

/**
 * La llanta como activo (R8, brecha A).
 *
 * Hasta aquí el sistema medía POSICIONES: "la posición 3 del CA-12 tenía 8
 * mm". La llanta misma no existía, y sin ella no hay historia, ni vidas, ni
 * inventario, ni kilómetros recorridos, ni costo por kilómetro.
 *
 * Una llanta es del CLIENTE (la flota es suya); la empresa prestadora la
 * administra. Se identifica por su **serial** o por un **número interno**
 * (marcado a fuego o etiqueta), únicos dentro del cliente.
 *
 * Estados:
 *
 * - `bodega`: en inventario de una sede, nueva o usada, lista para montar.
 * - `montada`: en un vehículo y una posición.
 * - `reencauche`: enviada a reencauchar; vuelve con una vida más.
 * - `reparacion`: enviada a reparar; vuelve igual.
 * - `desecho`: fuera de servicio. No vuelve (nada se borra).
 */

export const ESTADOS_ACTIVO = ["bodega", "montada", "reencauche", "reparacion", "desecho"] as const;
export type EstadoActivo = (typeof ESTADOS_ACTIVO)[number];

export const ETIQUETA_ESTADO_ACTIVO: Record<EstadoActivo, string> = {
  bodega: "En bodega",
  montada: "Montada",
  reencauche: "En reencauche",
  reparacion: "En reparación",
  desecho: "Desechada",
};

export const TIPOS_MOVIMIENTO = [
  "ingreso", "montaje", "desmontaje",
  "envio_reencauche", "retorno_reencauche",
  "envio_reparacion", "retorno_reparacion",
  "desecho", "traslado",
] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

export const ETIQUETA_MOVIMIENTO: Record<TipoMovimiento, string> = {
  ingreso: "Ingreso a bodega",
  montaje: "Montaje",
  desmontaje: "Desmontaje",
  envio_reencauche: "Enviada a reencauche",
  retorno_reencauche: "Volvió del reencauche",
  envio_reparacion: "Enviada a reparación",
  retorno_reparacion: "Volvió de reparación",
  desecho: "Desechada",
  traslado: "Traslado de sede",
};

/** Movimientos que la oficina registra a mano (montaje y desmontaje salen de las órdenes). */
export const MOVIMIENTOS_MANUALES: readonly TipoMovimiento[] = [
  "envio_reencauche", "retorno_reencauche", "envio_reparacion", "retorno_reparacion", "desecho", "traslado",
];

/** Desde qué estados vale cada movimiento, y a qué estado lleva. */
const TRANSICIONES: Record<TipoMovimiento, { desde: readonly EstadoActivo[]; hacia: EstadoActivo }> = {
  ingreso: { desde: [], hacia: "bodega" },
  montaje: { desde: ["bodega"], hacia: "montada" },
  desmontaje: { desde: ["montada"], hacia: "bodega" },
  envio_reencauche: { desde: ["bodega"], hacia: "reencauche" },
  retorno_reencauche: { desde: ["reencauche"], hacia: "bodega" },
  envio_reparacion: { desde: ["bodega"], hacia: "reparacion" },
  retorno_reparacion: { desde: ["reparacion"], hacia: "bodega" },
  desecho: { desde: ["bodega", "reencauche", "reparacion"], hacia: "desecho" },
  traslado: { desde: ["bodega"], hacia: "bodega" },
};

export function evaluarMovimiento(estado: EstadoActivo, tipo: TipoMovimiento): Veredicto & { hacia?: EstadoActivo } {
  const t = TRANSICIONES[tipo];
  if (!t) return negar("MOVIMIENTO_DESCONOCIDO", "Movimiento desconocido");
  if (!t.desde.includes(estado)) {
    return negar(
      "MOVIMIENTO_INVALIDO",
      `Una llanta ${ETIQUETA_ESTADO_ACTIVO[estado].toLowerCase()} no puede pasar a "${ETIQUETA_MOVIMIENTO[tipo].toLowerCase()}"`,
    );
  }
  return { ...PERMITIDO, hacia: t.hacia };
}

/**
 * A dónde va la llanta que sale de un vehículo, según el destino que anotó
 * el técnico en la orden ("Desecho", "Reencauche"…). Sin destino, a bodega:
 * se decide después, y una llanta sin lugar no se puede encontrar.
 */
export function estadoTrasDesmontaje(destino: string | null | undefined): EstadoActivo {
  switch ((destino ?? "").trim().toLowerCase()) {
    case "desecho":
      return "desecho";
    case "reencauche":
      return "reencauche";
    case "reparación":
    case "reparacion":
      return "reparacion";
    default:
      return "bodega";
  }
}

/** El serial o el número interno, sin espacios ni guiones y en mayúsculas: "mx 1002-3" es MX10023. */
export function claveIdentificador(v: string | null | undefined): string | null {
  const k = (v ?? "").toUpperCase().replace(/[\s-]/g, "");
  return k === "" ? null : k;
}

/** Una llanta sin serial ni número interno no se puede seguir: no es activo. */
export function identificable(l: { serial?: string | null; numeroInterno?: string | null }): boolean {
  return claveIdentificador(l.serial) !== null || claveIdentificador(l.numeroInterno) !== null;
}
