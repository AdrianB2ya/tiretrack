import { type Veredicto, PERMITIDO, negar } from "../tipos";
import { clave, distancia } from "./normalizacion";

/**
 * Revisión de lo creado en campo (decisión del usuario, 2026-10-06: la hace
 * el administrador de la empresa).
 *
 * Dos salidas:
 *
 * - **Aprobar**: la entrada es real y queda como propia de la empresa.
 * - **Unificar con otra**: era la misma ("Michelim" → "Michelin"). La
 *   duplicada **no se borra ni se reescribe**: queda como alias de la
 *   correcta y deja de ofrecerse. Los informes y el análisis agrupan por la
 *   correcta; cada orden ya registrada sigue mostrando lo que se escribió.
 *   Reescribir las mediciones cambiaría documentos cerrados y firmados, y
 *   un documento cerrado no cambia porque alguien limpie el catálogo.
 *
 * Volver global (compartida con todas las empresas) es otra cosa: decide la
 * plataforma, no una empresa (`puedePromoverAGlobal`).
 */

export interface EntradaRevisable {
  readonly id: string;
  readonly nombre: string;
  readonly empresaId: string | null;
  readonly esGlobal: boolean;
  readonly activa: boolean;
  /** Si ya es alias de otra: no se puede unificar hacia ella. */
  readonly reemplazadaPorId?: string | null;
  /** En diseños: la marca a la que pertenece (ya resuelta a la correcta). */
  readonly marcaId?: string;
}

export function evaluarUnificacion(
  origen: EntradaRevisable,
  destino: EntradaRevisable,
  empresaId: string,
): Veredicto {
  if (origen.id === destino.id) return negar("MISMA_ENTRADA", "No se puede unificar consigo misma");
  if (origen.esGlobal || origen.empresaId !== empresaId) {
    return negar("NO_PROPIA", "Solo se unifican entradas de tu empresa; las globales las administra la plataforma");
  }
  if (origen.reemplazadaPorId) return negar("YA_UNIFICADA", "Esta entrada ya se unificó con otra");
  if (!destino.activa || destino.reemplazadaPorId) {
    return negar("DESTINO_INACTIVO", "Elige una entrada vigente: esa está deshabilitada o ya unificada");
  }
  if (!destino.esGlobal && destino.empresaId !== empresaId) return negar("NO_EXISTE", "No existe");
  if (origen.marcaId !== undefined && origen.marcaId !== destino.marcaId) {
    return negar("OTRA_MARCA", "Un diseño se unifica con otro de la misma marca");
  }
  return PERMITIDO;
}

/**
 * Candidatas para unificar, las más parecidas primero: es lo que el
 * administrador tiene que ver para reconocer el duplicado.
 */
export function candidatasParaUnificar<T extends EntradaRevisable>(origen: EntradaRevisable, todas: readonly T[], empresaId: string): T[] {
  const k = clave(origen.nombre);
  return todas
    .filter((t) => evaluarUnificacion(origen, t, empresaId).permitido)
    .map((t) => ({ t, d: distancia(k, clave(t.nombre), 99) }))
    .sort((a, b) => a.d - b.d || a.t.nombre.localeCompare(b.t.nombre))
    .map((x) => x.t);
}

/**
 * Al unificar una marca, sus diseños con el mismo nombre (normalizado) que
 * uno de la marca correcta se unifican también: "XZE" de "Michelim" es el
 * "XZE" de "Michelin". Los demás quedan para revisarlos uno por uno.
 */
export function disenosEquivalentes<T extends { id: string; nombre: string }>(
  delOrigen: readonly T[],
  delDestino: readonly T[],
): { origenId: string; destinoId: string }[] {
  const porClave = new Map(delDestino.map((d) => [clave(d.nombre), d.id]));
  return delOrigen.flatMap((d) => {
    const destinoId = porClave.get(clave(d.nombre));
    return destinoId ? [{ origenId: d.id, destinoId }] : [];
  });
}
