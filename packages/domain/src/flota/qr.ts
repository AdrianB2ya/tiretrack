/**
 * Código QR del vehículo (R15, brecha E).
 *
 * El QR pegado en el camión lleva SOLO el identificador del vehículo, como
 * enlace de la app: `asistectire://vehiculo/<uuid>`. Sin sesión no abre nada
 * —el UUID no dice de quién es ni qué placa tiene—, así que un QR fotografiado
 * por un tercero no filtra datos del cliente.
 *
 * Al escanearlo, la app abre la ficha del vehículo y su orden en curso: el
 * técnico deja de buscar por placa entre veinte camiones parecidos.
 */

export const PREFIJO_QR_VEHICULO = "asistectire://vehiculo/";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function contenidoQRVehiculo(vehiculoId: string): string {
  return `${PREFIJO_QR_VEHICULO}${vehiculoId}`;
}

/**
 * El id del vehículo a partir de lo que leyó la cámara. Acepta el enlace de
 * la app y el UUID solo (una etiqueta impresa a mano). Cualquier otro QR —el
 * de una factura, el de un repuesto— devuelve null en vez de abrir algo raro.
 */
export function leerQRVehiculo(texto: string): string | null {
  const t = texto.trim();
  const id = t.toLowerCase().startsWith(PREFIJO_QR_VEHICULO) ? t.slice(PREFIJO_QR_VEHICULO.length).split(/[/?#]/)[0] ?? "" : t;
  return UUID.test(id) ? id.toLowerCase() : null;
}
