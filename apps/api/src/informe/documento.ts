import PDFDocument from "pdfkit";
import {
  armarDocumentoOrden,
  deserializarTrazo,
  nombreArchivoOrden,
  type DatosDocumentoOrden,
  type Documento,
  type Rol,
} from "@tiretrack/domain";

/**
 * PDF de la orden (6.3): la constancia que guarda el cliente.
 *
 * Qué dice lo decide el dominio (`armarDocumentoOrden`, con sus avisos de
 * preliminar, cierre por vencimiento y firma no vigente); aquí solo se reúnen
 * los datos y se dibuja. Corre bajo RLS: una orden que quien pregunta no ve,
 * no existe.
 */

export interface Consulta {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Contexto {
  readonly rol: Rol;
}

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const t = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export class ServicioDocumento {
  constructor(private readonly db: Consulta) {}

  /** null si la orden no existe para quien pregunta. */
  async datos(ctx: Contexto, ordenId: string): Promise<DatosDocumentoOrden | null> {
    const r = await this.db.query<Record<string, unknown>>(
      `SELECT o.folio, o."codigoReferencia", to_char(o.fecha,'YYYY-MM-DD') AS fecha, o.estado::text AS estado,
              o.tipo::text AS tipo, o.kilometraje, o.hallazgos, o.accion, o."cierreTacito", o."versionContenido",
              o."firmaNombre", o."firmaCedula", o."firmaCargo", o."firmaVersion", o."firmaTrazo",
              to_char(o."firmaFechaHora" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS "firmaFechaHora",
              -- Los datos congelados al aprobar mandan sobre los vivos: un
              -- documento cerrado no cambia porque cambien los maestros.
              coalesce(o."clienteNombre", c.nombre) AS "clienteNombre", coalesce(o."clienteNit", c.nit) AS "clienteNit",
              coalesce(o."sedeClienteNombre", sc.nombre) AS "sedeClienteNombre",
              coalesce(o."vehiculoCodigo", v.codigo) AS "vehiculoCodigo", coalesce(o."vehiculoPlaca", v.placa) AS "vehiculoPlaca",
              coalesce(o."tecnicoNombre", u.nombre) AS "tecnicoNombre", coalesce(o."tecnicoCedula", u.cedula) AS "tecnicoCedula",
              e.nombre AS "empresaNombre", e.nit AS "empresaNit"
         FROM "OrdenServicio" o
         JOIN "Empresa" e ON e.id = o."empresaId"
         LEFT JOIN "Cliente" c ON c.id = o."clienteId"
         LEFT JOIN "SedeCliente" sc ON sc.id = o."sedeClienteId"
         LEFT JOIN "Vehiculo" v ON v.id = o."vehiculoId"
         LEFT JOIN "Usuario" u ON u.id = o.tecnico_id
        WHERE o.id = $1`,
      [ordenId],
    );
    const o = r.rows[0];
    if (!o) return null;
    // El cliente, como en su portal: lo que espera su aprobación y lo cerrado.
    if (ctx.rol === "cliente" && o["estado"] !== "pendiente_cliente" && o["estado"] !== "cerrada") return null;

    const pos = await this.db.query<Record<string, unknown>>(
      `SELECT lr.posicion, m.nombre AS marca, d.nombre AS diseno, lr.medida, lr.serial, lr.dot, lr.profundidad,
              lr."psiEncontrada", lr."psiCalibrado", lr."noIdentificada",
              lr."desSerial", lr."desProfundidad", lr."desDestino",
              lr."profExterior", lr."profCentro", lr."profInterior",
              lr."desProfExterior", lr."desProfCentro", lr."desProfInterior",
              coalesce((SELECT array_agg(s.codigo ORDER BY s.codigo) FROM "LlantaServicio" ls
                         JOIN "Servicio" s ON s.id = ls."servicioId" WHERE ls."llantaRegistroId" = lr.id), ARRAY[]::text[]) AS servicios
         FROM "LlantaRegistro" lr
         LEFT JOIN "Marca" m ON m.id = lr."marcaId"
         LEFT JOIN "Diseno" d ON d.id = lr."disenoId"
        WHERE lr."ordenId" = $1 ORDER BY lr.posicion`,
      [ordenId],
    );
    const recs = await this.db.query<Record<string, unknown>>(
      `SELECT texto, prioridad::text AS prioridad, posicion FROM "Recomendacion"
        WHERE "origenOrdenId" = $1 ORDER BY "creadaEn"`,
      [ordenId],
    );

    return {
      empresa: { nombre: String(o["empresaNombre"]), nit: t(o["empresaNit"]) },
      orden: {
        folio: t(o["folio"]), codigoReferencia: t(o["codigoReferencia"]), fecha: String(o["fecha"]),
        estado: String(o["estado"]), tipo: String(o["tipo"]), kilometraje: n(o["kilometraje"]),
        hallazgos: t(o["hallazgos"]), accion: t(o["accion"]), cierreTacito: Boolean(o["cierreTacito"]),
        versionContenido: Number(o["versionContenido"] ?? 0),
      },
      cliente: { nombre: String(o["clienteNombre"] ?? ""), nit: t(o["clienteNit"]), sede: t(o["sedeClienteNombre"]) },
      vehiculo: { codigo: String(o["vehiculoCodigo"] ?? ""), placa: t(o["vehiculoPlaca"]) },
      tecnico: { nombre: String(o["tecnicoNombre"] ?? ""), cedula: t(o["tecnicoCedula"]) },
      posiciones: pos.rows.map((p) => ({
        posicion: Number(p["posicion"]), marca: t(p["marca"]), diseno: t(p["diseno"]), medida: t(p["medida"]),
        serial: t(p["serial"]), dot: t(p["dot"]), profundidad: n(p["profundidad"]),
        profundidades: { exterior: n(p["profExterior"]), centro: n(p["profCentro"]), interior: n(p["profInterior"]) },
        psiEncontrada: n(p["psiEncontrada"]), psiCalibrado: n(p["psiCalibrado"]),
        noIdentificada: Boolean(p["noIdentificada"]), servicios: (p["servicios"] as string[]) ?? [],
        desmontada: p["desSerial"] || p["desProfundidad"] !== null || p["desDestino"]
          ? {
              serial: t(p["desSerial"]), profundidad: n(p["desProfundidad"]), destino: t(p["desDestino"]),
              profundidades: { exterior: n(p["desProfExterior"]), centro: n(p["desProfCentro"]), interior: n(p["desProfInterior"]) },
            }
          : null,
      })),
      recomendaciones: recs.rows.map((x) => ({ texto: String(x["texto"]), prioridad: String(x["prioridad"]), posicion: n(x["posicion"]) })),
      firma: o["firmaNombre"]
        ? {
            nombre: String(o["firmaNombre"]), cedula: String(o["firmaCedula"] ?? ""), cargo: t(o["firmaCargo"]),
            fechaHora: t(o["firmaFechaHora"]), version: n(o["firmaVersion"]), trazo: t(o["firmaTrazo"]),
          }
        : null,
    };
  }

  nombreArchivo(d: DatosDocumentoOrden): string {
    return nombreArchivoOrden(d);
  }

  /** Dibuja el documento. A4, letras estándar (cubren las tildes del español). */
  async pdf(d: DatosDocumentoOrden, generadoEn: string): Promise<Buffer> {
    const doc = armarDocumentoOrden(d);
    return generar(`${doc.titulo} ${doc.identificador}`, (pdf) => dibujarOrden(pdf, doc, generadoEn));
  }

  /**
   * Varias órdenes en un solo PDF (el informe), cada una desde una página
   * nueva y con sus propios avisos: una preliminar entre aprobadas sigue
   * diciendo PRELIMINAR.
   */
  async pdfVarias(lista: readonly DatosDocumentoOrden[], titulo: string, generadoEn: string): Promise<Buffer> {
    return generar(titulo, (pdf) => {
      lista.forEach((d, i) => {
        if (i > 0) pdf.addPage();
        dibujarOrden(pdf, armarDocumentoOrden(d), generadoEn);
      });
    });
  }
}

function generar(titulo: string, dibujar: (pdf: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 40, info: { Title: titulo, Creator: "TireTrack" } });
    const partes: Buffer[] = [];
    pdf.on("data", (b: Buffer) => partes.push(b));
    pdf.on("end", () => resolve(Buffer.concat(partes)));
    pdf.on("error", reject);
    dibujar(pdf);
    pdf.end();
  });
}

function dibujarOrden(pdf: PDFKit.PDFDocument, doc: Documento, generadoEn: string): void {
  {
    const ancho = pdf.page.width - 80;
    pdf.fillColor("#000");
    pdf.y = Math.max(pdf.y, 40);
    pdf.font("Helvetica-Bold").fontSize(16).text(doc.titulo, { continued: true }).font("Helvetica").text(`  ${doc.identificador}`);
    pdf.moveDown(0.5);

    // Lo que no puede pasarse por alto va primero, en un recuadro.
    for (const aviso of doc.avisos) {
      const y = pdf.y;
      pdf.font("Helvetica-Bold").fontSize(10);
      const alto = pdf.heightOfString(aviso, { width: ancho - 16 }) + 10;
      pdf.rect(40, y, ancho, alto).fillAndStroke("#FFF3CD", "#B8860B");
      pdf.fillColor("#000").text(aviso, 48, y + 5, { width: ancho - 16 });
      pdf.y = y + alto + 4;
    }
    pdf.moveDown(0.5);

    pdf.fontSize(10);
    for (const [etiqueta, valor] of doc.cabecera) {
      pdf.font("Helvetica-Bold").text(`${etiqueta}: `, 40, pdf.y, { continued: true }).font("Helvetica").text(valor);
    }
    pdf.moveDown(0.8);

    // Tabla de posiciones.
    // Suman 515 (A4 menos márgenes). Profundidad más ancha: lleva tres medidas.
    const anchos = [28, 105, 62, 34, 76, 56, 80, 74];
    const fila = (celdas: readonly string[], negrita: boolean) => {
      pdf.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      const alto = Math.max(...celdas.map((c, i) => pdf.heightOfString(c || " ", { width: (anchos[i] ?? 40) - 4 }))) + 4;
      if (pdf.y + alto > pdf.page.height - 60) pdf.addPage();
      const y = pdf.y;
      let x = 40;
      celdas.forEach((c, i) => {
        pdf.text(c, x + 2, y + 2, { width: (anchos[i] ?? 40) - 4 });
        x += anchos[i] ?? 40;
      });
      pdf.moveTo(40, y + alto).lineTo(40 + ancho, y + alto).strokeColor("#CCCCCC").stroke();
      pdf.y = y + alto;
    };
    fila(doc.columnas, true);
    if (doc.filas.length === 0) {
      pdf.font("Helvetica").fontSize(9).text("No se registraron mediciones.", 40, pdf.y + 4);
    }
    for (const f of doc.filas) fila(f, false);
    pdf.moveDown(1);

    const bloque = (titulo: string, cuerpo: string) => {
      if (pdf.y > pdf.page.height - 100) pdf.addPage();
      pdf.font("Helvetica-Bold").fontSize(10).text(titulo, 40, pdf.y).font("Helvetica").fontSize(9).text(cuerpo, { width: ancho });
      pdf.moveDown(0.6);
    };
    if (doc.hallazgos) bloque("Hallazgos", doc.hallazgos);
    if (doc.accion) bloque("Acción", doc.accion);
    if (doc.recomendaciones.length > 0) bloque("Recomendaciones", doc.recomendaciones.map((r) => `• ${r}`).join("\n"));

    if (doc.firma) {
      if (pdf.y > pdf.page.height - 160) pdf.addPage();
      pdf.font("Helvetica-Bold").fontSize(10).text("Firma de quien recibió", 40, pdf.y);
      const caja = { x: 40, y: pdf.y + 4, w: 240, h: 90 };
      pdf.rect(caja.x, caja.y, caja.w, caja.h).strokeColor("#999999").stroke();
      // El trazo se guardó como puntos: se redibuja escalado a la caja.
      const trazo = deserializarTrazo(doc.firma.trazo);
      const puntos = trazo.flat();
      if (puntos.length > 0) {
        const minX = Math.min(...puntos.map((p) => p.x)), maxX = Math.max(...puntos.map((p) => p.x));
        const minY = Math.min(...puntos.map((p) => p.y)), maxY = Math.max(...puntos.map((p) => p.y));
        const escala = Math.min((caja.w - 20) / Math.max(1, maxX - minX), (caja.h - 20) / Math.max(1, maxY - minY));
        pdf.strokeColor("#000").lineWidth(1.2);
        for (const s of trazo) {
          const [p0, ...resto] = s;
          if (!p0) continue;
          pdf.moveTo(caja.x + 10 + (p0.x - minX) * escala, caja.y + 10 + (p0.y - minY) * escala);
          for (const p of resto) pdf.lineTo(caja.x + 10 + (p.x - minX) * escala, caja.y + 10 + (p.y - minY) * escala);
          pdf.stroke();
        }
        pdf.lineWidth(1);
      }
      pdf.y = caja.y + caja.h + 4;
      pdf.font("Helvetica").fontSize(9);
      for (const l of doc.firma.lineas) pdf.text(l, 40, pdf.y);
    }

    pdf.moveDown(1.5);
    pdf.font("Helvetica").fontSize(7).fillColor("#666666").text(`Generado por TireTrack el ${generadoEn}.`, 40, pdf.y, { width: ancho });
    pdf.fillColor("#000");
  }
}
