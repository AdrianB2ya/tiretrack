import { CATALOGO_SERVICIOS } from "../tipos";
import { ETIQUETA_PRIORIDAD_RECOMENDACION, type PrioridadRecomendacion } from "../orden/recomendaciones";

/**
 * El documento de la orden (PDF): qué dice, separado de cómo se dibuja.
 *
 * Es lo que el cliente guarda como constancia del servicio, así que importa
 * más lo que NO puede decir que lo que dice:
 *
 *  - Una orden sin aprobar **no aparenta ser definitiva**: lleva "PRELIMINAR".
 *  - Un cierre por vencimiento **nunca aparenta aprobación expresa** (regla
 *    del negocio): lo dice con todas las letras.
 *  - Una firma que ya no ampara el contenido actual **lo advierte**: una firma
 *    debe amparar exactamente lo que quedó.
 *  - Los datos de una orden aprobada son los **congelados**, no los vivos: un
 *    documento cerrado no cambia porque cambien los datos maestros.
 */

export interface PosicionDocumento {
  readonly posicion: number;
  readonly marca: string | null;
  readonly diseno: string | null;
  readonly medida: string | null;
  readonly serial: string | null;
  readonly dot: string | null;
  readonly profundidad: number | null;
  readonly psiEncontrada: number | null;
  readonly psiCalibrado: number | null;
  readonly noIdentificada: boolean;
  /** Códigos del catálogo fijo (`CALI`). */
  readonly servicios: readonly string[];
  readonly desmontada: { serial: string | null; profundidad: number | null; destino: string | null } | null;
}

export interface DatosDocumentoOrden {
  readonly empresa: { nombre: string; nit: string | null };
  readonly orden: {
    folio: string | null;
    codigoReferencia: string | null;
    fecha: string;
    estado: string;
    tipo: string;
    kilometraje: number | null;
    hallazgos: string | null;
    accion: string | null;
    cierreTacito: boolean;
    versionContenido: number;
  };
  readonly cliente: { nombre: string; nit: string | null; sede: string | null };
  readonly vehiculo: { codigo: string; placa: string | null };
  readonly tecnico: { nombre: string; cedula: string | null };
  readonly posiciones: readonly PosicionDocumento[];
  readonly recomendaciones: readonly { texto: string; prioridad: string; posicion: number | null }[];
  readonly firma: {
    nombre: string;
    cedula: string;
    cargo: string | null;
    fechaHora: string | null;
    version: number | null;
    trazo: string | null;
  } | null;
}

export interface Documento {
  readonly titulo: string;
  readonly identificador: string;
  /** Lo que se lee antes que nada: preliminar, cierre por vencimiento, firma no vigente. */
  readonly avisos: readonly string[];
  readonly cabecera: readonly [string, string][];
  readonly columnas: readonly string[];
  readonly filas: readonly string[][];
  readonly hallazgos: string | null;
  readonly accion: string | null;
  readonly recomendaciones: readonly string[];
  readonly firma: { lineas: readonly string[]; trazo: string | null } | null;
}

const ESTADOS: Record<string, string> = {
  borrador: "Borrador",
  programada: "Programada",
  en_proceso: "En proceso",
  en_revision: "En revisión",
  pendiente_cliente: "Esperando aprobación del cliente",
  cerrada: "Cerrada",
  anulada: "Anulada",
};

const NOMBRE_SERVICIO = new Map<string, string>(CATALOGO_SERVICIOS.map((s) => [s.codigo, s.nombre]));
const num = (n: number | null, sufijo = "") => (n === null ? "" : `${String(n).replace(".", ",")}${sufijo}`);

export function armarDocumentoOrden(d: DatosDocumentoOrden): Documento {
  const o = d.orden;
  const avisos: string[] = [];
  if (o.estado === "anulada") avisos.push("ANULADA: esta orden no tiene validez.");
  else if (o.estado !== "pendiente_cliente" && o.estado !== "cerrada") {
    avisos.push("PRELIMINAR: la orden no ha sido aprobada; las mediciones pueden cambiar.");
  }
  if (o.estado === "cerrada" && o.cierreTacito) {
    // Nunca disfrazar el vencimiento de aprobación expresa.
    avisos.push("Cerrada por vencimiento del plazo de aprobación: el cliente no la aprobó expresamente.");
  }
  if (d.firma && d.firma.version !== null && d.firma.version !== o.versionContenido) {
    avisos.push("La firma no ampara el contenido actual: la orden cambió después de firmarse.");
  }
  if (!d.firma && o.estado !== "anulada") avisos.push("Sin firma de quien recibió el servicio.");

  const identificador = o.folio ?? (o.codigoReferencia ? `Referencia ${o.codigoReferencia}` : "Sin folio");

  return {
    titulo: "Orden de servicio",
    identificador,
    avisos,
    cabecera: [
      ["Empresa", d.empresa.nit ? `${d.empresa.nombre} · NIT ${d.empresa.nit}` : d.empresa.nombre],
      ["Cliente", d.cliente.nit ? `${d.cliente.nombre} · NIT ${d.cliente.nit}` : d.cliente.nombre],
      ...(d.cliente.sede ? ([["Sede del cliente", d.cliente.sede]] as [string, string][]) : []),
      ["Vehículo", d.vehiculo.placa ? `${d.vehiculo.codigo} · ${d.vehiculo.placa}` : d.vehiculo.codigo],
      ["Fecha", o.fecha],
      ["Tipo", o.tipo === "correctivo" ? "Correctivo" : "Preventivo"],
      ["Estado", ESTADOS[o.estado] ?? o.estado],
      ["Kilometraje", o.kilometraje === null ? "Sin registrar" : o.kilometraje.toLocaleString("es-CO")],
      ["Técnico", d.tecnico.cedula ? `${d.tecnico.nombre} · CC ${d.tecnico.cedula}` : d.tecnico.nombre],
    ],
    columnas: ["Pos.", "Llanta", "Serial", "DOT", "Prof.", "PSI enc./cal.", "Servicios", "Llanta que salió"],
    filas: [...d.posiciones].sort((a, b) => a.posicion - b.posicion).map((p) => [
      String(p.posicion),
      // El blanco parece un olvido; esto fue una decisión del técnico (1.8).
      p.noIdentificada ? "SIN IDENTIFICAR" : [p.marca, p.diseno, p.medida].filter(Boolean).join(" ") || "—",
      p.serial ?? "",
      p.dot ?? "",
      num(p.profundidad, " mm"),
      p.psiEncontrada === null && p.psiCalibrado === null ? "" : `${num(p.psiEncontrada) || "—"} / ${num(p.psiCalibrado) || "—"}`,
      p.servicios.map((c) => NOMBRE_SERVICIO.get(c) ?? c).join(", "),
      p.desmontada
        ? [p.desmontada.serial, num(p.desmontada.profundidad, " mm"), p.desmontada.destino].filter(Boolean).join(" · ")
        : "",
    ]),
    hallazgos: o.hallazgos,
    accion: o.accion,
    recomendaciones: d.recomendaciones.map((r) => {
      const prioridad = ETIQUETA_PRIORIDAD_RECOMENDACION[r.prioridad as PrioridadRecomendacion] ?? r.prioridad;
      return `${prioridad}${r.posicion !== null ? ` · posición ${r.posicion}` : ""}: ${r.texto}`;
    }),
    firma: d.firma
      ? {
          lineas: [
            `Recibió: ${d.firma.nombre} · CC ${d.firma.cedula}${d.firma.cargo ? ` · ${d.firma.cargo}` : ""}`,
            ...(d.firma.fechaHora ? [`Firmado: ${d.firma.fechaHora}`] : []),
          ],
          trazo: d.firma.trazo,
        }
      : null,
  };
}

/** Nombre del archivo: el folio, que es como se busca después. */
export function nombreArchivoOrden(d: DatosDocumentoOrden): string {
  const base = d.orden.folio ?? d.orden.codigoReferencia ?? "orden";
  return `${base.replace(/[^\w-]/g, "_")}.pdf`;
}

/**
 * Órdenes por PDF del informe. Más que esto no se le entrega a nadie: para
 * eso está el CSV. Lo usan el servidor (rechaza) y la app (avisa antes).
 */
export const MAX_ORDENES_PDF = 30;
