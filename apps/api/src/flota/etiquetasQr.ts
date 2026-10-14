import QRCode from "qrcode";
import { contenidoQRVehiculo } from "@tiretrack/domain";
import { generar, ROJO_MARCA } from "../informe/documento";

/**
 * Etiquetas con el QR de cada vehículo (R15), listas para imprimir y pegar:
 * dos columnas por cuatro filas en una hoja A4. Debajo del QR, el código y la
 * placa en grande —se leen a distancia y se dictan por teléfono— y el cliente.
 *
 * El QR lleva solo el enlace con el id (`asistectire://vehiculo/<uuid>`):
 * sin sesión no abre nada.
 */

interface Consulta {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface FiltroEtiquetas {
  readonly clienteId?: string;
  readonly sedeClienteId?: string;
  readonly vehiculoId?: string;
}

/** Más etiquetas en un archivo: varias impresiones (y el PDF no se eterniza). */
export const MAX_ETIQUETAS = 200;

export interface VehiculoEtiqueta {
  readonly id: string;
  readonly codigo: string;
  readonly placa: string | null;
  readonly cliente: string;
}

export async function vehiculosParaEtiquetas(db: Consulta, f: FiltroEtiquetas): Promise<VehiculoEtiqueta[]> {
  const r = await db.query<VehiculoEtiqueta>(
    `SELECT v.id, v.codigo, v.placa, c.nombre AS cliente
       FROM "Vehiculo" v
       JOIN "SedeCliente" sc ON sc.id = v."sedeClienteId"
       JOIN "Cliente" c ON c.id = sc."clienteId"
      WHERE v.activo
        AND ($1::text IS NULL OR c.id = $1)
        AND ($2::text IS NULL OR sc.id = $2)
        AND ($3::text IS NULL OR v.id = $3)
      ORDER BY c.nombre, v.codigo
      LIMIT ${MAX_ETIQUETAS + 1}`,
    [f.clienteId ?? null, f.sedeClienteId ?? null, f.vehiculoId ?? null],
  );
  return r.rows;
}

export async function pdfEtiquetas(vehiculos: readonly VehiculoEtiqueta[]): Promise<Buffer> {
  // Las imágenes primero: el dibujo de pdfkit es síncrono.
  const qrs = await Promise.all(
    vehiculos.map((v) => QRCode.toBuffer(contenidoQRVehiculo(v.id), { type: "png", errorCorrectionLevel: "M", margin: 1, width: 360 })),
  );
  return generar("Códigos QR de vehículos", (pdf) => {
    const margen = 30;
    const cols = 2;
    const filas = 4;
    const ancho = (pdf.page.width - margen * 2) / cols;
    const alto = (pdf.page.height - margen * 2) / filas;
    vehiculos.forEach((v, i) => {
      const enPagina = i % (cols * filas);
      if (i > 0 && enPagina === 0) pdf.addPage();
      const x = margen + (enPagina % cols) * ancho;
      const y = margen + Math.floor(enPagina / cols) * alto;
      // Línea de corte punteada.
      pdf.save().dash(3, { space: 3 }).strokeColor("#999999").rect(x, y, ancho, alto).stroke().restore();
      const lado = Math.min(alto - 70, ancho - 20);
      pdf.image(qrs[i] as Buffer, x + (ancho - lado) / 2, y + 8, { width: lado, height: lado });
      const ty = y + 10 + lado;
      pdf.fillColor("#000").font("Helvetica-Bold").fontSize(18).text(v.codigo, x, ty, { width: ancho, align: "center" });
      pdf.font("Helvetica").fontSize(11).text(v.placa ? `Placa ${v.placa}` : "Sin placa", x, pdf.y, { width: ancho, align: "center" });
      pdf.fillColor(ROJO_MARCA).fontSize(8).text(v.cliente, x, pdf.y + 1, { width: ancho, align: "center" });
    });
  });
}
