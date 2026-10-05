import {
  esAutoaprobacion,
  evaluarTransicion,
  firmaVigente,
  puedeAprobar,
  type EstadoOrden,
  type Rol,
  type Veredicto,
} from "@tiretrack/domain";
import type { OrdenLocal } from "../datos/repositorio";
import type { Diagrama } from "../ordenes/diagrama";

/**
 * Bandeja de revisión del coordinador.
 *
 * Su trabajo es decidir rápido sobre órdenes que **otro** ejecutó. Dos cosas
 * lo gobiernan:
 *
 * 1. **El coordinador devuelve, no corrige.** Si editara las mediciones, la
 *    orden dejaría de ser el registro de lo que el técnico vio, y la firma
 *    del cliente dejaría de amparar lo que dice el documento.
 * 2. **Lo dudoso se ve antes de abrir.** Con veinte órdenes en la bandeja,
 *    lo que no se ve en la tarjeta no se revisa.
 */

export interface OrdenEnBandeja {
  readonly orden: OrdenLocal;
  readonly vehiculoCodigo: string;
  readonly clienteNombre: string;
  readonly tecnicoNombre: string;
  readonly diagrama: Diagrama;
  /** Días hábiles que lleva esperando revisión. */
  readonly diasEsperando: number;
}

export interface ContextoCoordinador {
  readonly usuarioId: string;
  readonly rol: Rol;
  readonly vistaCliente?: boolean;
}

// ── Señales de la tarjeta ───────────────────────────────────────────────────

export type ClaseSenal = "critica" | "atencion" | "informativa";

export interface Senal {
  readonly clave: string;
  readonly clase: ClaseSenal;
  readonly texto: string;
}

/**
 * Señales que el coordinador debe ver **sin abrir** la orden.
 *
 * Son las que cambian su decisión: una orden incompleta, una firma que no
 * ampara el contenido, o que quien la ejecutó sea él mismo.
 */
export function senalesDe(item: OrdenEnBandeja, ctx: ContextoCoordinador): Senal[] {
  const senales: Senal[] = [];
  const { orden, diagrama } = item;

  // Una firma invalidada significa que el contenido cambió después de
  // firmarse: el cliente firmó otra cosa.
  if (orden.firmaNombre && !tieneFirmaVigente(orden)) {
    senales.push({
      clave: "firma_invalidada",
      clase: "critica",
      texto: "La firma no ampara el contenido actual",
    });
  }

  if (!orden.firmaNombre) {
    senales.push({ clave: "sin_firma", clase: "critica", texto: "Sin firma del cliente" });
  }

  // Autoaprobación: que el mismo que ejecutó apruebe anula el control. No se
  // bloquea —en una sede de dos personas puede ser inevitable— pero queda a
  // la vista y en la auditoría.
  if (esAutoaprobacion(orden.tecnicoId, ctx.usuarioId)) {
    senales.push({
      clave: "autoaprobacion",
      clase: "atencion",
      texto: "Tú ejecutaste esta orden",
    });
  }

  if (diagrama.faltantes.length > 0) {
    senales.push({
      clave: "incompleta",
      clase: "atencion",
      texto: `Faltan ${diagrama.faltantes.length} de ${diagrama.totalPosiciones} posiciones`,
    });
  }

  if (diagrama.conAlerta.length > 0) {
    senales.push({
      clave: "alertas",
      clase: "atencion",
      texto: `${diagrama.conAlerta.length} llanta(s) bajo el mínimo`,
    });
  }

  if (!orden.hallazgos?.trim()) {
    senales.push({ clave: "sin_hallazgos", clase: "informativa", texto: "Sin hallazgos escritos" });
  }

  if (item.diasEsperando >= 2) {
    senales.push({
      clave: "demorada",
      clase: "atencion",
      texto: `Esperando ${item.diasEsperando} días`,
    });
  }

  return senales;
}

function tieneFirmaVigente(orden: OrdenLocal): boolean {
  if (!orden.firmaNombre) return false;
  return firmaVigente({
    versionContenido: orden.versionContenido,
    firma: {
      nombre: orden.firmaNombre,
      cedula: orden.firmaCedula ?? "",
      fecha: orden.firmaFechaHora ?? "",
      version: orden.firmaVersion ?? -1,
    },
  });
}

// ── Orden de la bandeja ─────────────────────────────────────────────────────

/**
 * Ordena la bandeja.
 *
 * Primero lo que lleva más tiempo esperando: el técnico ya hizo su parte y
 * cada día que pasa es un día que el cliente no recibe su documento. Las
 * críticas suben, porque devolverlas tarde obliga al técnico a volver al
 * vehículo cuando ya se fue.
 */
export function ordenarBandeja(
  items: readonly OrdenEnBandeja[],
  ctx: ContextoCoordinador,
): OrdenEnBandeja[] {
  return [...items].sort((a, b) => {
    const criticaA = senalesDe(a, ctx).some((s) => s.clase === "critica");
    const criticaB = senalesDe(b, ctx).some((s) => s.clase === "critica");
    if (criticaA !== criticaB) return criticaA ? -1 : 1;
    return b.diasEsperando - a.diasEsperando;
  });
}

export function contarPorRevisar(items: readonly OrdenEnBandeja[]): number {
  return items.filter((i) => i.orden.estado === "en_revision").length;
}

// ── Decisiones ──────────────────────────────────────────────────────────────

export type Decision = "aprobar" | "devolver" | "reasignar";

export interface AccionCoordinador {
  readonly decision: Decision;
  readonly habilitada: boolean;
  readonly motivo?: string;
  /** Si exige escribir una razón antes de confirmar. */
  readonly exigeMotivo: boolean;
}

export function accionesDe(
  item: OrdenEnBandeja,
  ctx: ContextoCoordinador,
): AccionCoordinador[] {
  const gestor = puedeAprobar(ctx.rol, ctx.vistaCliente ?? false);

  if (!gestor) {
    return (["aprobar", "devolver", "reasignar"] as const).map((decision) => ({
      decision,
      habilitada: false,
      motivo: "Solo el coordinador puede revisar órdenes",
      exigeMotivo: decision !== "aprobar",
    }));
  }

  const aprobar = evaluarTransicion(item.orden.estado as EstadoOrden, "pendiente_cliente", {
    rol: ctx.rol,
    esTecnicoAsignado: false,
    firmaVigente: tieneFirmaVigente(item.orden),
  });

  const devolver = evaluarTransicion(item.orden.estado as EstadoOrden, "en_proceso", {
    rol: ctx.rol,
    esTecnicoAsignado: false,
    firmaVigente: tieneFirmaVigente(item.orden),
    // La máquina exige motivo; aquí solo se comprueba que la transición
    // exista, el motivo lo valida `validarDevolucion`.
    motivo: "(pendiente)",
  });

  return [
    {
      decision: "aprobar",
      habilitada: aprobar.permitido,
      ...(aprobar.permitido ? {} : { motivo: aprobar.mensaje ?? "" }),
      exigeMotivo: false,
    },
    {
      decision: "devolver",
      habilitada: devolver.permitido,
      ...(devolver.permitido ? {} : { motivo: devolver.mensaje ?? "" }),
      // Devolver sin decir qué corregir hace que el técnico adivine, y
      // normalmente vuelva con el mismo problema.
      exigeMotivo: true,
    },
    {
      decision: "reasignar",
      habilitada: item.orden.estado !== "cerrada" && item.orden.estado !== "anulada",
      exigeMotivo: true,
    },
  ];
}

export const LARGO_MINIMO_MOTIVO = 10;

/**
 * Valida el motivo de devolución.
 *
 * Se exige algo con sustancia: un "corregir" suelto obliga al técnico a
 * volver al vehículo sin saber qué revisar.
 */
export function validarDevolucion(motivo: string): Veredicto {
  const limpio = motivo.trim();
  if (limpio.length === 0) {
    return { permitido: false, codigo: "SIN_MOTIVO", mensaje: "Explica qué hay que corregir" };
  }
  if (limpio.length < LARGO_MINIMO_MOTIVO) {
    return {
      permitido: false,
      codigo: "MOTIVO_CORTO",
      mensaje: "Sé específico: el técnico tiene que saber qué revisar sin preguntar",
    };
  }
  return { permitido: true };
}

/**
 * Sugerencias de motivo, a partir de las señales detectadas.
 *
 * Escribir el motivo a mano en el celular es lento, y lo lento se omite: sin
 * sugerencias el coordinador termina escribiendo "revisar" y devolviendo el
 * problema sin resolverlo.
 */
export function motivosSugeridos(item: OrdenEnBandeja, ctx: ContextoCoordinador): string[] {
  const sugerencias: string[] = [];
  const senales = senalesDe(item, ctx);

  if (senales.some((s) => s.clave === "incompleta")) {
    sugerencias.push(
      `Faltan las posiciones ${item.diagrama.faltantes.join(", ")}. Captúralas o anota por qué no se pudieron revisar`,
    );
  }
  if (senales.some((s) => s.clave === "firma_invalidada")) {
    sugerencias.push("La orden cambió después de firmarse: hay que volver a capturar la firma");
  }
  if (senales.some((s) => s.clave === "sin_hallazgos")) {
    sugerencias.push("Escribe los hallazgos: es lo primero que lee el cliente");
  }
  if (senales.some((s) => s.clave === "alertas")) {
    sugerencias.push(
      `Confirma el estado de las llantas ${item.diagrama.conAlerta.join(", ")}, que están bajo el mínimo`,
    );
  }

  return sugerencias;
}
