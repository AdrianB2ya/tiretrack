import {
  armarCotizacion,
  fechaEnColombia,
  LIMITES_POR_DEFECTO,
  NOTA_SIN_PRECIOS,
  type Cotizacion,
  type LineaCotizacion,
  type MedicionParaCotizar,
} from "@tiretrack/domain";
import { generar, LOGO, ROJO_MARCA } from "./documento";
import type { Contexto, ServicioInforme } from "./servicio";

/**
 * Cotización de los cambios recomendados (R14). Sale de las filas del
 * informe —mismo alcance, mismas reglas de nivel de cambio— y de las
 * recomendaciones abiertas. Sin precios hasta la parte D.
 */

interface Consulta {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface DatosCotizacion extends Cotizacion {
  readonly empresa: string;
  readonly cliente: { nombre: string; nit: string } | null;
  readonly fecha: string;
  readonly nota: string;
}

export async function cotizacionDe(
  db: Consulta,
  informe: ServicioInforme,
  ctx: Contexto,
  filtro: { clienteId?: string; vehiculoId?: string },
  hoy: Date,
): Promise<DatosCotizacion> {
  const filas = await informe.consultar(ctx, filtro);
  const mediciones: MedicionParaCotizar[] = filas
    .filter((f) => f.vehiculoCodigo !== null)
    .map((f) => ({
      vehiculo: f.vehiculoCodigo as string,
      posicion: f.posicion,
      fecha: f.fecha,
      marca: f.marca,
      diseno: f.diseno,
      medida: f.medida,
      profundidad: f.profundidad,
      // El servidor la trae ya convertida a número junto con cada fila.
      minimoEje: (f as { minimoEje?: number | null }).minimoEje ?? null,
      dot: f.dot,
    }));

  const empresa = await db.query<{ nombre: string; i: string; p: string }>(
    `SELECT nombre, "limiteCambioInmediato" AS i, "limiteProgramarCambio" AS p FROM "Empresa" WHERE id = $1`,
    [ctx.empresaId],
  );
  const e = empresa.rows[0];
  const limites = e ? { cambioInmediato: Number(e.i), programarCambio: Number(e.p) } : LIMITES_POR_DEFECTO;

  const recomendaciones = await db.query<{ vehiculo: string; descripcion: string; prioridad: string }>(
    `SELECT v.codigo AS vehiculo, r.texto AS descripcion, r.prioridad::text AS prioridad
       FROM "Recomendacion" r JOIN "Vehiculo" v ON v.id = r."vehiculoId"
      WHERE r.estado = 'abierta'
        AND ($1::text IS NULL OR r."clienteId" = $1)
        AND ($2::text IS NULL OR r."vehiculoId" = $2)`,
    [filtro.clienteId ?? null, filtro.vehiculoId ?? null],
  );

  const cliente = filtro.clienteId
    ? (await db.query<{ nombre: string; nit: string }>(`SELECT nombre, nit FROM "Cliente" WHERE id = $1`, [filtro.clienteId])).rows[0] ?? null
    : null;

  return {
    ...armarCotizacion(mediciones, recomendaciones.rows, limites, hoy),
    empresa: e?.nombre ?? "",
    cliente,
    fecha: fechaEnColombia(hoy),
    nota: NOTA_SIN_PRECIOS,
  };
}

const URGENCIA = { inmediato: "Inmediato", programar: "Programar" } as const;

/** El PDF: conceptos y cantidades, con las columnas de valor en blanco para llenar. */
export function pdfCotizacion(d: DatosCotizacion): Promise<Buffer> {
  return generar(`Cotización ${d.fecha}`, (pdf) => {
    const ancho = pdf.page.width - 80;
    const arriba = 40;
    if (LOGO) pdf.image(LOGO, 40 + ancho - 110, arriba - 6, { fit: [110, 44] });
    pdf.fillColor("#000").font("Helvetica-Bold").fontSize(16).text("Cotización", 40, arriba + 8);
    const linea = arriba + 46;
    pdf.moveTo(40, linea).lineTo(40 + ancho, linea).lineWidth(2).strokeColor(ROJO_MARCA).stroke();
    pdf.lineWidth(1).strokeColor("#000");
    pdf.y = linea + 10;

    pdf.fontSize(10);
    const cabecera: [string, string][] = [
      ["Empresa", d.empresa],
      ["Cliente", d.cliente ? `${d.cliente.nombre} · NIT ${d.cliente.nit}` : "Todos los clientes"],
      ["Fecha", d.fecha],
    ];
    for (const [k, v] of cabecera) pdf.font("Helvetica-Bold").text(`${k}: `, 40, pdf.y, { continued: true }).font("Helvetica").text(v);
    pdf.moveDown(0.5);
    {
      // Que no parezca un valor en cero: es un valor que falta.
      const y = pdf.y;
      pdf.font("Helvetica-Bold").fontSize(9);
      const alto = pdf.heightOfString(d.nota, { width: ancho - 16 }) + 10;
      pdf.rect(40, y, ancho, alto).fillAndStroke("#FFF3CD", "#B8860B");
      pdf.fillColor("#000").text(d.nota, 48, y + 5, { width: ancho - 16 });
      pdf.y = y + alto + 8;
    }

    // Concepto | Detalle | Cant. | Valor unitario | Total
    const cols = [130, ancho - 130 - 40 - 75 - 75, 40, 75, 75];
    const fila = (celdas: string[], negrita = false) => {
      pdf.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      const alto = Math.max(...celdas.map((c, i) => pdf.heightOfString(c, { width: (cols[i] ?? 40) - 6 }))) + 6;
      if (pdf.y + alto > pdf.page.height - 50) pdf.addPage();
      const y = pdf.y;
      let x = 40;
      celdas.forEach((c, i) => {
        const w = cols[i] ?? 40;
        pdf.rect(x, y, w, alto).stroke();
        pdf.text(c, x + 3, y + 3, { width: w - 6, align: i === 2 ? "right" : "left" });
        x += w;
      });
      pdf.y = y + alto;
    };
    const seccion = (titulo: string, lineas: readonly LineaCotizacion[]) => {
      pdf.moveDown(0.5);
      pdf.font("Helvetica-Bold").fontSize(11).text(titulo, 40, pdf.y);
      pdf.moveDown(0.2);
      if (lineas.length === 0) {
        pdf.font("Helvetica").fontSize(9).text("Nada que cotizar.", 40, pdf.y);
        return;
      }
      fila(["Concepto", "Detalle", "Cant.", "Valor unitario", "Total"], true);
      for (const l of lineas) {
        const concepto = l.urgencia ? `${l.concepto}\n${URGENCIA[l.urgencia]}` : l.concepto;
        fila([concepto, l.detalle, String(l.cantidad), "", ""]);
      }
    };
    seccion("Llantas", d.llantas);
    seccion("Servicios", d.servicios);
    pdf.moveDown(1);
    pdf.font("Helvetica").fontSize(7).fillColor("#666666").text(
      "Según la última medición de cada posición y los límites de cambio de la empresa. Generado por Asistectire.",
      40,
      pdf.y,
      { width: ancho },
    );
  });
}
