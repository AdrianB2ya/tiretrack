import { zCrearConfiguracionEje } from "@tiretrack/contracts";
import { validarConfiguracion, type DefinicionEje } from "@tiretrack/domain";
import type { PosicionEjeLocal } from "../datos/repositorio";

/**
 * Editor de plantillas de ejes: lo que el administrador entiende ("eje de
 * tracción, dual, 105 PSI") convertido a lo que el sistema usa (posiciones
 * numeradas).
 *
 * La numeración corresponde con lo que el técnico ve de pie frente al camión:
 * eje por eje de adelante hacia atrás, y en cada eje de izquierda a derecha.
 * En una dual, la interna es la segunda de la izquierda y la primera de la
 * derecha (la que mira al centro), igual que en la semilla.
 */

export type TipoEje = "direccional" | "traccion" | "arrastre" | "multiuso";

export interface EjeEditable {
  readonly tipoEje: TipoEje;
  readonly dual: boolean;
  /** Texto del campo: se valida al convertir. */
  readonly psi: string;
  readonly profMin: string;
}

export const EJE_NUEVO: EjeEditable = { tipoEje: "traccion", dual: true, psi: "105", profMin: "2,5" };

const numero = (s: string): number | undefined => {
  const t = s.trim().replace(",", ".");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
};

export function aDefiniciones(ejes: readonly EjeEditable[]): DefinicionEje[] {
  let siguiente = 1;
  return ejes.map((e, i) => {
    const izquierda = e.dual ? [siguiente, siguiente + 1] : [siguiente];
    siguiente += izquierda.length;
    const derecha = e.dual ? [siguiente, siguiente + 1] : [siguiente];
    siguiente += derecha.length;
    const psi = numero(e.psi);
    const prof = numero(e.profMin);
    return {
      numero: i + 1,
      tipoEje: e.tipoEje,
      posicionesIzquierda: izquierda,
      posicionesDerecha: derecha,
      ...(psi !== undefined ? { psiObjetivo: psi } : {}),
      ...(prof !== undefined ? { profundidadMinima: prof } : {}),
    };
  });
}

/** Para dibujar la vista previa con el mismo diagrama de las órdenes. */
export function aPosicionesLocales(defs: readonly DefinicionEje[]): PosicionEjeLocal[] {
  return defs.flatMap((d) => {
    const fila = (n: number, lado: "izquierdo" | "derecho", interna: boolean): PosicionEjeLocal => ({
      configuracionEjeId: "vista-previa",
      numero: n,
      eje: d.numero,
      lado,
      esInterna: interna,
      tipoEje: d.tipoEje,
      psiObjetivo: d.psiObjetivo ?? null,
      profundidadMinima: d.profundidadMinima ?? null,
    });
    const dual = d.posicionesIzquierda.length > 1;
    return [
      ...d.posicionesIzquierda.map((n, i) => fila(n, "izquierdo", dual && i === 1)),
      ...d.posicionesDerecha.map((n, i) => fila(n, "derecho", dual && i === 0)),
    ];
  });
}

/** Para crear la versión nueva de una plantilla existente a partir de lo que hay. */
export function desdePosiciones(posiciones: readonly PosicionEjeLocal[]): EjeEditable[] {
  const porEje = new Map<number, PosicionEjeLocal[]>();
  for (const p of posiciones) porEje.set(p.eje, [...(porEje.get(p.eje) ?? []), p]);
  return [...porEje.keys()].sort((a, b) => a - b).map((eje) => {
    const ps = porEje.get(eje) ?? [];
    const primera = ps[0];
    const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
    return {
      tipoEje: (primera?.tipoEje ?? "multiuso") as TipoEje,
      dual: ps.filter((p) => p.lado === "izquierdo").length > 1,
      psi: fmt(primera?.psiObjetivo),
      profMin: fmt(primera?.profundidadMinima),
    };
  });
}

/** Lo mismo que validarán el dominio y el contrato del servidor. */
export function revisarPlantilla(nombre: string, ejes: readonly EjeEditable[]): string[] {
  const p: string[] = [];
  if (nombre.trim().length < 2) p.push("Ponle un nombre a la plantilla");
  if (ejes.length === 0) p.push("Agrega al menos un eje");
  ejes.forEach((e, i) => {
    if (Number.isNaN(numero(e.psi))) p.push(`Eje ${i + 1}: el PSI debe ser un número`);
    if (Number.isNaN(numero(e.profMin))) p.push(`Eje ${i + 1}: la profundidad mínima debe ser un número`);
  });
  if (p.length > 0) return p;
  const defs = aDefiniciones(ejes);
  const v = validarConfiguracion(defs);
  if (!v.permitido) p.push(v.mensaje ?? "La plantilla no es válida");
  const c = zCrearConfiguracionEje.safeParse({ id: "00000000-0000-4000-8000-000000000000", nombre, ejes: defs });
  if (!c.success && p.length === 0) p.push(c.error.issues[0]?.message ?? "La plantilla no es válida");
  return p;
}
