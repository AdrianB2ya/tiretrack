import { leerDOT } from "../llanta/dot";
import { nivelDeCambio, umbralesDeCambio, type LimitesEmpresa, type NivelCambio } from "../llanta/limites";

/**
 * Cotización de los cambios recomendados (R14, brecha E).
 *
 * Sale del levantamiento: lo que hoy está montado en cada posición, con su
 * nivel de cambio según los límites de la empresa y el mínimo del eje (R2),
 * más las recomendaciones abiertas de esos vehículos.
 *
 * **Sin precios**: los servicios con precio son la parte D, que quedó fuera.
 * La cotización lista conceptos y cantidades con los valores en blanco, para
 * llenarlos a mano; cuando entren los precios se calcula sola.
 */

export interface MedicionParaCotizar {
  readonly vehiculo: string;
  readonly posicion: number;
  readonly fecha: string;
  readonly marca: string | null;
  readonly diseno: string | null;
  readonly medida: string | null;
  readonly profundidad: number | null;
  readonly minimoEje: number | null;
  readonly dot: string | null;
}

export interface RecomendacionParaCotizar {
  readonly vehiculo: string;
  readonly descripcion: string;
  readonly prioridad: string;
}

export type Urgencia = "inmediato" | "programar";

export interface LineaCotizacion {
  readonly concepto: string;
  readonly detalle: string;
  readonly cantidad: number;
  readonly urgencia: Urgencia | null;
}

export interface Cotizacion {
  readonly llantas: LineaCotizacion[];
  readonly servicios: LineaCotizacion[];
  readonly totalLlantas: number;
}

export const NOTA_SIN_PRECIOS =
  "Valores por definir: esta cotización lista lo que se recomienda cambiar y las cantidades. Los precios se acuerdan aparte.";

/**
 * Lo montado HOY en cada posición: la última medición de cada vehículo y
 * posición. No por llanta: una llanta gastada que ya se cambió seguiría
 * siendo "la última medición de esa llanta" y se cotizaría de nuevo.
 */
export function montadoPorPosicion<T extends { vehiculo: string; posicion: number; fecha: string }>(filas: readonly T[]): T[] {
  const m = new Map<string, T>();
  for (const f of filas) {
    const k = `${f.vehiculo}#${f.posicion}`;
    const previa = m.get(k);
    if (!previa || f.fecha > previa.fecha) m.set(k, f);
  }
  return [...m.values()];
}

/** Por qué hay que cambiarla, si hay que cambiarla. El DOT vencido es inmediato. */
export function urgenciaDeCambio(m: MedicionParaCotizar, limites: LimitesEmpresa, hoy: Date): Urgencia | null {
  if (leerDOT(m.dot, hoy)?.vencida) return "inmediato";
  const nivel: NivelCambio | null = nivelDeCambio(m.profundidad, umbralesDeCambio(m.minimoEje, limites));
  return nivel === "cambio_inmediato" ? "inmediato" : nivel === "programar_cambio" ? "programar" : null;
}

const posiciones = (xs: readonly { vehiculo: string; posicion: number }[]) => {
  const porVehiculo = new Map<string, number[]>();
  for (const x of xs) porVehiculo.set(x.vehiculo, [...(porVehiculo.get(x.vehiculo) ?? []), x.posicion]);
  return [...porVehiculo.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([v, ps]) => `${v} (pos. ${[...ps].sort((a, b) => a - b).join(", ")})`)
    .join("; ");
};

export function armarCotizacion(
  mediciones: readonly MedicionParaCotizar[],
  recomendaciones: readonly RecomendacionParaCotizar[],
  limites: LimitesEmpresa,
  hoy: Date,
): Cotizacion {
  const aCambiar = montadoPorPosicion(mediciones)
    .map((m) => ({ m, u: urgenciaDeCambio(m, limites, hoy) }))
    .filter((x): x is { m: MedicionParaCotizar; u: Urgencia } => x.u !== null);

  // Una línea por medida y urgencia: es como se compra. La referencia actual
  // va en el detalle, como sugerencia, no como obligación.
  const grupos = new Map<string, { medida: string | null; u: Urgencia; items: MedicionParaCotizar[] }>();
  for (const { m, u } of aCambiar) {
    const k = `${u}|${m.medida ?? ""}`;
    const g = grupos.get(k) ?? { medida: m.medida, u, items: [] };
    g.items.push(m);
    grupos.set(k, g);
  }
  const llantas = [...grupos.values()]
    .sort((a, b) => (a.u === b.u ? (a.medida ?? "~").localeCompare(b.medida ?? "~") : a.u === "inmediato" ? -1 : 1))
    .map((g) => {
      const refs = [...new Set(g.items.map((i) => [i.marca, i.diseno].filter(Boolean).join(" ")).filter(Boolean))];
      return {
        concepto: g.medida ? `Llanta ${g.medida}` : "Llanta (medida por confirmar)",
        detalle: `${refs.length > 0 ? `Referencia actual: ${refs.join(", ")}. ` : ""}${posiciones(g.items)}`,
        cantidad: g.items.length,
        urgencia: g.u,
      };
    });

  const servicios: LineaCotizacion[] = [];
  if (aCambiar.length > 0) {
    // Cada llanta que entra se monta: lo que el taller cobra aunque nadie lo
    // haya escrito como recomendación.
    servicios.push({ concepto: "Montaje", detalle: "Una por llanta a cambiar", cantidad: aCambiar.length, urgencia: null });
  }
  const porTexto = new Map<string, { texto: string; items: RecomendacionParaCotizar[] }>();
  for (const r of recomendaciones) {
    const k = r.descripcion.trim().toLowerCase().replace(/\s+/g, " ");
    if (!k) continue;
    const g = porTexto.get(k) ?? { texto: r.descripcion.trim(), items: [] };
    g.items.push(r);
    porTexto.set(k, g);
  }
  for (const g of [...porTexto.values()].sort((a, b) => a.texto.localeCompare(b.texto))) {
    const vehiculos = [...new Set(g.items.map((i) => i.vehiculo))].sort();
    servicios.push({
      concepto: g.texto,
      detalle: `Recomendación de visitas anteriores: ${vehiculos.join(", ")}`,
      cantidad: g.items.length,
      urgencia: g.items.some((i) => i.prioridad === "urgente") ? "inmediato" : null,
    });
  }

  return { llantas, servicios, totalLlantas: aCambiar.length };
}
