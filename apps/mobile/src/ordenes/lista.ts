import type { EstadoOrden } from "@tiretrack/domain";
import type { OrdenLocal } from "../datos/repositorio";

/**
 * Lógica del listado de órdenes del técnico.
 *
 * Se separa de la pantalla porque el orden en que aparecen las órdenes no es
 * un detalle visual: es lo que decide qué camión atiende primero alguien que
 * abre la app con veinte pendientes y el sol encima. Aquí se puede probar.
 */

export interface OrdenParaLista {
  readonly orden: OrdenLocal;
  readonly vehiculoCodigo: string;
  readonly clienteNombre: string;
  readonly posicionesCapturadas: number;
  readonly posicionesTotales: number;
  readonly tieneCambiosSinEnviar: boolean;
}

export type Grupo = "devueltas" | "en_curso" | "por_hacer" | "esperando" | "terminadas";

export interface SeccionLista {
  readonly grupo: Grupo;
  readonly titulo: string;
  readonly ordenes: readonly OrdenParaLista[];
}

/**
 * Orden de los grupos: lo que exige acción del técnico primero.
 *
 * Las devueltas van arriba de todo aunque haya órdenes en curso: alguien está
 * esperando esa corrección y el técnico ya dio el trabajo por terminado, así
 * que si no la ve arriba no la ve.
 */
const ORDEN_GRUPOS: readonly Grupo[] = [
  "devueltas",
  "en_curso",
  "por_hacer",
  "esperando",
  "terminadas",
];

const TITULOS: Record<Grupo, string> = {
  devueltas: "Devueltas para corregir",
  en_curso: "En curso",
  por_hacer: "Por hacer",
  esperando: "Esperando aprobación",
  terminadas: "Terminadas",
};

export function grupoDe(orden: OrdenLocal): Grupo {
  // Una orden en proceso con motivo de devolución no es lo mismo que una que
  // el técnico dejó a medias: la primera tiene a alguien esperando.
  if (orden.estado === "en_proceso" && orden.motivoDevolucion) return "devueltas";
  if (orden.estado === "en_proceso" || orden.estado === "borrador") return "en_curso";
  if (orden.estado === "programada") return "por_hacer";
  if (orden.estado === "en_revision" || orden.estado === "pendiente_cliente") return "esperando";
  return "terminadas";
}

/**
 * Agrupa y ordena.
 *
 * Dentro de cada grupo, lo más antiguo primero: una orden programada hace una
 * semana lleva más tiempo esperando que la de hoy. Es lo contrario a lo
 * habitual en una bandeja, y es deliberado.
 */
export function construirSecciones(ordenes: readonly OrdenParaLista[]): SeccionLista[] {
  const porGrupo = new Map<Grupo, OrdenParaLista[]>();

  for (const item of ordenes) {
    const grupo = grupoDe(item.orden);
    const lista = porGrupo.get(grupo) ?? [];
    lista.push(item);
    porGrupo.set(grupo, lista);
  }

  return ORDEN_GRUPOS.filter((g) => (porGrupo.get(g)?.length ?? 0) > 0).map((grupo) => ({
    grupo,
    titulo: TITULOS[grupo],
    ordenes: (porGrupo.get(grupo) ?? []).sort((a, b) =>
      // Terminadas al revés: ahí interesa lo reciente, no lo viejo.
      grupo === "terminadas"
        ? b.orden.fecha.localeCompare(a.orden.fecha)
        : a.orden.fecha.localeCompare(b.orden.fecha),
    ),
  }));
}

/** Órdenes que el técnico todavía tiene que tocar. */
export function contarPendientes(ordenes: readonly OrdenParaLista[]): number {
  return ordenes.filter((o) => {
    const g = grupoDe(o.orden);
    return g === "devueltas" || g === "en_curso" || g === "por_hacer";
  }).length;
}

export interface ProgresoCaptura {
  readonly capturadas: number;
  readonly totales: number;
  readonly porcentaje: number;
  readonly completa: boolean;
}

export function progresoDe(item: OrdenParaLista): ProgresoCaptura {
  const totales = item.posicionesTotales;
  const capturadas = item.posicionesCapturadas;
  return {
    capturadas,
    totales,
    porcentaje: totales === 0 ? 0 : Math.round((capturadas / totales) * 100),
    completa: totales > 0 && capturadas >= totales,
  };
}

/**
 * Identificador visible de la orden.
 *
 * Las creadas sin señal no tienen folio todavía: se muestra su código de
 * referencia, que **no se parece a un folio** a propósito. Nadie debe
 * confundirlo con el consecutivo definitivo.
 */
export function identificadorVisible(orden: OrdenLocal): {
  texto: string;
  esProvisional: boolean;
} {
  if (orden.folio) return { texto: orden.folio, esProvisional: false };
  if (orden.codigoReferencia) return { texto: orden.codigoReferencia, esProvisional: true };
  return { texto: "Sin sincronizar", esProvisional: true };
}

/** Estados en los que el técnico todavía puede capturar. */
const ESTADOS_EDITABLES: readonly EstadoOrden[] = ["borrador", "programada", "en_proceso"];

export function puedeCapturar(orden: OrdenLocal): boolean {
  return ESTADOS_EDITABLES.includes(orden.estado as EstadoOrden);
}

export interface FiltroLista {
  readonly texto?: string;
  readonly soloPendientes?: boolean;
}

/**
 * Busca por folio, vehículo o cliente: son las tres formas en que el técnico
 * identifica una orden cuando le preguntan por teléfono.
 */
export function filtrar(
  ordenes: readonly OrdenParaLista[],
  filtro: FiltroLista,
): OrdenParaLista[] {
  let resultado = [...ordenes];

  if (filtro.soloPendientes) {
    resultado = resultado.filter((o) => {
      const g = grupoDe(o.orden);
      return g === "devueltas" || g === "en_curso" || g === "por_hacer";
    });
  }

  const texto = filtro.texto?.trim().toLowerCase();
  if (texto) {
    resultado = resultado.filter((o) => {
      const id = identificadorVisible(o.orden).texto.toLowerCase();
      return (
        id.includes(texto) ||
        o.vehiculoCodigo.toLowerCase().includes(texto) ||
        o.clienteNombre.toLowerCase().includes(texto)
      );
    });
  }

  return resultado;
}
