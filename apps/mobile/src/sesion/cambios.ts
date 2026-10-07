import type { TipoOperacion } from "../datos/repositorio";

/**
 * Cambios sin enviar, contados uno por uno.
 *
 * Al cerrar sesión la app decía "hay 2 cambios sin enviar" y no había dónde
 * ver cuáles ni por qué. Los apartados por el servidor no salen sincronizando:
 * esperan a que una persona decida (CLAUDE.md, motor de sincronización). Sin
 * verlos, esa persona no tenía con qué decidir.
 */

export interface CambioSinEnviar {
  readonly id: string;
  readonly tipo: TipoOperacion;
  readonly datos: unknown;
  /** Folio o código de referencia de la orden, si es de una orden. */
  readonly orden: string | null;
  readonly intentos: number;
  readonly ultimoError: string | null;
  /** Lleno si el servidor lo rechazó: no se reenvía solo. */
  readonly motivoRechazo: string | null;
}

const ESTADO: Record<string, string> = {
  programada: "programada", en_proceso: "en proceso", en_revision: "en revisión",
  pendiente_cliente: "espera al cliente", cerrada: "cerrada", anulada: "anulada",
};

const NOMBRE: Record<TipoOperacion, string> = {
  crear_orden: "Orden nueva",
  actualizar_orden: "Kilometraje y hallazgos",
  guardar_medicion: "Medición",
  cambiar_estado: "Cambio de estado",
  crear_marca: "Marca nueva",
  crear_diseno: "Diseño nuevo",
  reasignar: "Reasignación",
  adjuntar_foto: "Foto",
  firmar: "Firma del cliente",
  subir_foto: "Foto",
  crear_cliente: "Cliente nuevo",
  crear_sede_cliente: "Sede de cliente nueva",
  crear_vehiculo: "Vehículo nuevo",
  crear_recomendacion: "Recomendación",
  resolver_recomendacion: "Recomendación resuelta",
};

/** Qué es, en palabras del técnico: "Medición de la posición 3", "Cambio de estado a en revisión". */
export function describirCambio(c: CambioSinEnviar): string {
  const d = (c.datos ?? {}) as Record<string, unknown>;
  let base = NOMBRE[c.tipo] ?? c.tipo;
  if (c.tipo === "guardar_medicion" && typeof d["posicion"] === "number") base = `Medición de la posición ${d["posicion"]}`;
  if (c.tipo === "cambiar_estado" && typeof d["estado"] === "string") base = `Cambio de estado a ${ESTADO[d["estado"]] ?? d["estado"]}`;
  if (c.tipo === "crear_marca" && typeof d["nombre"] === "string") base = `Marca nueva: ${d["nombre"]}`;
  return c.orden ? `${base} · ${c.orden}` : base;
}

/** En qué está: esperando su turno, o rechazado con el motivo del servidor. */
export function situacionDe(c: CambioSinEnviar): { apartado: boolean; texto: string } {
  if (c.motivoRechazo) return { apartado: true, texto: `El servidor lo rechazó: ${c.motivoRechazo}` };
  if (c.ultimoError) return { apartado: false, texto: `Se reintenta solo (${c.intentos} intento${c.intentos === 1 ? "" : "s"}): ${c.ultimoError}` };
  return { apartado: false, texto: "Esperando para enviarse" };
}
