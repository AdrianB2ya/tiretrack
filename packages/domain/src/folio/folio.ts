/**
 * Folio de la orden.
 *
 * Formato: OS-{sede}-{consecutivo de 6 dígitos} → OS-FUN-000123
 *
 * El folio es una ETIQUETA LEGIBLE, no la identidad del registro: eso es el
 * UUID generado en el cliente. Por eso la firma se ata al UUID y no al folio.
 *
 * El consecutivo es por sede y se incrementa de forma atómica en el servidor
 * (UPDATE ... RETURNING). Nunca con count()+1: dos técnicos creando una orden
 * al mismo tiempo obtendrían el mismo número.
 *
 * Órdenes programadas: se crean con conexión, folio real desde el inicio.
 * Órdenes imprevistas sin señal: nacen con código de referencia y reciben su
 * folio al sincronizar.
 */

export const PREFIJO_ORDEN = "OS";
export const DIGITOS_CONSECUTIVO = 6;

export interface FolioPartes {
  readonly prefijo: string;
  readonly codigoSede: string;
  readonly consecutivo: number;
}

export function formatearFolio(codigoSede: string, consecutivo: number): string {
  if (!codigoSede.trim()) throw new Error("El folio necesita el código de la sede");
  if (!Number.isInteger(consecutivo) || consecutivo < 1) {
    throw new Error("El consecutivo debe ser un entero positivo");
  }
  const numero = String(consecutivo).padStart(DIGITOS_CONSECUTIVO, "0");
  return `${PREFIJO_ORDEN}-${codigoSede.toUpperCase()}-${numero}`;
}

export function parsearFolio(folio: string): FolioPartes | null {
  const m = /^([A-Z]{2})-([A-Z0-9]{2,6})-(\d{4,})$/.exec(folio.trim().toUpperCase());
  if (!m) return null;
  const [, prefijo, codigoSede, numero] = m;
  return {
    prefijo: prefijo ?? "",
    codigoSede: codigoSede ?? "",
    consecutivo: Number.parseInt(numero ?? "0", 10),
  };
}

export function esFolioValido(folio: string): boolean {
  return parsearFolio(folio) !== null;
}

/**
 * Una orden sincronizada tiene folio; una creada sin señal todavía no.
 * Distinguirlas evita mostrar un número que después va a cambiar.
 */
export function tieneFolioDefinitivo(folio: string | null | undefined): boolean {
  return !!folio && esFolioValido(folio);
}
