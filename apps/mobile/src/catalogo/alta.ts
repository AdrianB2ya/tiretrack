import { clave, evaluarNombreNuevo, medidaValida, normalizarMedida } from "@tiretrack/domain";

/**
 * Alta de marca, diseño o medida desde el celular (R1).
 *
 * Lo que el técnico escribe frente a la llanta se compara con lo que ya hay
 * antes de crear nada: el duplicado exacto se bloquea ("Michelín" es
 * "Michelin") y lo parecido se muestra para que lo elija si era eso. Sin esto,
 * en tres meses hay cuatro variantes de "Michelin" y el análisis por marca
 * deja de existir.
 */

export interface Existente {
  readonly id: string;
  readonly nombre: string;
}

export type EvaluacionAlta =
  | { readonly estado: "vacia" }
  | { readonly estado: "invalida"; readonly mensaje: string }
  | { readonly estado: "existe"; readonly existente: Existente }
  | { readonly estado: "nueva"; readonly valor: string; readonly parecidas: readonly Existente[] };

/** Marca o diseño: un nombre. */
export function evaluarAltaNombre(texto: string, existentes: readonly Existente[]): EvaluacionAlta {
  const limpio = texto.trim().replace(/\s+/g, " ");
  if (limpio === "") return { estado: "vacia" };
  const r = evaluarNombreNuevo(limpio, existentes);
  if (r.duplicado) return { estado: "existe", existente: r.duplicado };
  if (!r.puedeCrear) return { estado: "invalida", mensaje: "Escribe al menos 2 letras" };
  return { estado: "nueva", valor: limpio, parecidas: r.parecidas };
}

/**
 * Medida: se normaliza ("295/80r22,5" → "295/80R22.5") antes de comparar,
 * para que no queden dos escrituras de la misma medida.
 */
export function evaluarAltaMedida(texto: string, existentes: readonly Existente[]): EvaluacionAlta {
  if (texto.trim() === "") return { estado: "vacia" };
  const valor = normalizarMedida(texto.replace(",", "."));
  if (!medidaValida(valor)) {
    return { estado: "invalida", mensaje: "Escríbela como en el flanco, por ejemplo 295/80R22.5" };
  }
  const existe = existentes.find((e) => clave(e.nombre) === clave(valor));
  if (existe) return { estado: "existe", existente: existe };
  return { estado: "nueva", valor, parecidas: [] };
}

/** Coincidencia parcial sin tildes, mayúsculas, espacios ni guiones. */
export function filtrarPorTexto<T extends { texto: string }>(opciones: readonly T[], termino: string): T[] {
  const k = clave(termino);
  if (k === "") return [...opciones];
  return opciones.filter((o) => clave(o.texto).includes(k));
}
