import type { Rol } from "../tipos";
import { DESFASE_COLOMBIA_HORAS } from "../tiempo/zona";

/**
 * Consulta de la auditoría (5.4).
 *
 * La auditoría es la evidencia de quién sacó datos, quién cambió qué y qué
 * hizo el sistema solo. Se consulta, nunca se edita (la base revoca UPDATE y
 * DELETE al rol de aplicación).
 */

/** Acciones registrables: las mismas del enum de la base. */
export const ACCIONES_AUDITORIA = [
  "crear",
  "actualizar",
  "deshabilitar",
  "cambiar_estado",
  "reasignar",
  "aprobar",
  "anular",
  "login_exitoso",
  "login_fallido",
  "recuperar_password",
  "suplantar_empresa",
  "exportar_informe",
  "exportar_listado",
] as const;
export type AccionAuditoria = (typeof ACCIONES_AUDITORIA)[number];

export const ETIQUETA_ACCION_AUDITORIA: Record<AccionAuditoria, string> = {
  crear: "Creó",
  actualizar: "Modificó",
  deshabilitar: "Deshabilitó",
  cambiar_estado: "Cambió el estado",
  reasignar: "Reasignó",
  aprobar: "Aprobó",
  anular: "Anuló",
  login_exitoso: "Ingresó",
  login_fallido: "Ingreso fallido",
  recuperar_password: "Recuperó la contraseña",
  suplantar_empresa: "Sesión de soporte",
  exportar_informe: "Exportó datos",
  exportar_listado: "Exportó un listado",
};

/**
 * Solo el administrador: la auditoría muestra a quién se vigila, incluido el
 * coordinador. Que quien exporta pueda leer cómo quedó registrado le
 * permitiría ajustar su conducta al rastro.
 */
export function puedeVerAuditoria(rol: Rol): boolean {
  return rol === "administrador";
}

/**
 * Un rango de días de Colombia como instantes UTC [desde, hasta).
 *
 * `creadoEn` se guarda en UTC. Comparado contra el día pelado, lo hecho
 * después de las 7 p. m. caía en el día siguiente y "hoy" incluía la noche
 * de ayer. El `hasta` es el día entero: se convierte en el comienzo del día
 * siguiente, exclusivo.
 */
export function rangoDeDiasColombia(desde?: string, hasta?: string): { desde?: string; hasta?: string } {
  const inicio = (dia: string, sumarDias = 0) => {
    const [a, m, d] = dia.split("-").map(Number) as [number, number, number];
    return new Date(Date.UTC(a, m - 1, d + sumarDias, -DESFASE_COLOMBIA_HORAS)).toISOString();
  };
  return {
    ...(desde ? { desde: inicio(desde) } : {}),
    ...(hasta ? { hasta: inicio(hasta, 1) } : {}),
  };
}

/** Lo esencial del detalle, en una línea. El detalle completo queda a la vista aparte. */
export function resumirDetalleAuditoria(accion: string, detalle: Record<string, unknown> | null): string {
  if (!detalle) return "";
  const partes: string[] = [];
  const texto = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : null);
  if (accion === "exportar_informe" || accion === "exportar_listado") {
    if (detalle["origen"] === "pdf_orden") partes.push(`PDF de ${texto(detalle["folio"]) ?? "una orden"}`);
    const n = texto(detalle["registros"]);
    if (n) partes.push(`${n} registros`);
    const sinCerrar = Number(detalle["sinCerrar"] ?? 0);
    if (sinCerrar > 0) partes.push(`${sinCerrar} sin cerrar`);
  }
  const entidad = texto(detalle["entidad"]);
  if (entidad && partes.length === 0) partes.push(entidad);
  for (const clave of ["folio", "motivo", "estado"]) {
    const v = texto(detalle[clave]);
    if (v && !partes.some((p) => p.includes(v))) partes.push(clave === "motivo" ? `motivo: ${v}` : v);
  }
  return partes.join(" · ");
}
