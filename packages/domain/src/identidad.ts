/**
 * Identidad de los registros.
 *
 * Decisión de arquitectura (aprobada): todo registro nace con un UUID
 * generado en el CLIENTE, no en el servidor. Es lo que permite capturar sin
 * conexión y sincronizar después sin duplicar.
 *
 * El folio (OS-FUN-000123) es una ETIQUETA LEGIBLE, no la identidad. Se
 * asigna en el servidor. Por eso la firma del cliente se ata al UUID: ese
 * dato existe desde el primer momento y nunca cambia.
 */

/**
 * Respaldo para entornos sin crypto.randomUUID. Pasa en WebView de Android
 * antiguos: sin esto la app no podría generar identificadores sin conexión.
 */
export function uuidRespaldo(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Genera un UUID v4. Usa crypto nativo cuando está disponible. */
export function nuevoId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") {
    return g.crypto.randomUUID();
  }
  return uuidRespaldo();
}

/**
 * Código de referencia para órdenes creadas SIN conexión.
 *
 * Las órdenes programadas reciben su folio real en la oficina. Solo las
 * imprevistas nacen en campo sin número, y necesitan algo con qué buscarlas
 * mientras sincronizan. No se parece a un folio a propósito: nadie debe
 * confundirlo con el consecutivo definitivo.
 *
 * Formato: FUN-K7M2
 */
const ALFABETO_REFERENCIA = "ACDEFGHJKLMNPQRTUVWXY34679";

export function codigoReferencia(codigoSede: string, largo = 4): string {
  let cuerpo = "";
  for (let i = 0; i < largo; i++) {
    const idx = Math.floor(Math.random() * ALFABETO_REFERENCIA.length);
    cuerpo += ALFABETO_REFERENCIA[idx];
  }
  return `${codigoSede.toUpperCase()}-${cuerpo}`;
}

/** Comprueba que una cadena tenga forma de UUID. */
export function esUuid(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);
}

/** Comprueba que una cadena tenga forma de código de referencia. */
export function esCodigoReferencia(valor: string): boolean {
  return new RegExp(`^[A-Z0-9]{2,6}-[${ALFABETO_REFERENCIA}]{4,}$`).test(valor);
}
