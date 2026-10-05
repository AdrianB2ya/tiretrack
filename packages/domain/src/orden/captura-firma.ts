import { type Veredicto, PERMITIDO, negar } from "../tipos";

/**
 * Captura de la firma de quien recibe.
 *
 * La firma cierra el trabajo en campo: sin ella no hay soporte si el cliente
 * después objeta lo que se hizo. Pero el trazo es un **dato biométrico**, y
 * en Colombia la Ley 1581 de 2012 exige consentimiento informado antes de
 * recolectarlo, más constancia de que se dio.
 *
 * Por eso el consentimiento no es una casilla decorativa: sin él no se puede
 * capturar, y se guarda **qué versión del texto** aceptó la persona. Si la
 * política cambia, hay que poder saber cuál aceptó cada quien.
 */

/** Versión del texto de consentimiento vigente. Subir al cambiar el texto. */
export const VERSION_CONSENTIMIENTO = "2026-09-v1";

export const TEXTO_CONSENTIMIENTO =
  "Autorizo a que se registre mi firma y mis datos de identificación para " +
  "dejar constancia del servicio recibido. Estos datos se usan solo para " +
  "respaldar esta orden y se conservan mientras dure la relación comercial. " +
  "Puedo consultarlos, corregirlos o solicitar su eliminación.";

export interface DatosFirma {
  readonly nombre: string;
  readonly cedula: string;
  readonly cargo?: string | null;
  /** Trazo capturado, como lista de segmentos. */
  readonly trazo: readonly (readonly { x: number; y: number }[])[];
  readonly consentimientoAceptado: boolean;
}

/** Trazos con muy pocos puntos suelen ser un toque accidental. */
export const PUNTOS_MINIMOS_TRAZO = 8;

export function validarFirma(f: DatosFirma): Veredicto {
  if (!f.consentimientoAceptado) {
    // Primero el consentimiento: capturar el trazo y después preguntar sería
    // recolectar el dato antes de tener permiso.
    return negar(
      "SIN_CONSENTIMIENTO",
      "Quien recibe debe autorizar el registro de su firma y sus datos",
    );
  }
  if (f.nombre.trim().length < 3) {
    return negar("NOMBRE_INVALIDO", "Escribe el nombre de quien recibe");
  }
  if (!cedulaValida(f.cedula)) {
    return negar("CEDULA_INVALIDA", "La cédula debe tener entre 6 y 12 dígitos");
  }

  const puntos = f.trazo.reduce((n, segmento) => n + segmento.length, 0);
  if (puntos === 0) {
    return negar("SIN_TRAZO", "Falta la firma");
  }
  if (puntos < PUNTOS_MINIMOS_TRAZO) {
    // Un punto suelto no es una firma: probablemente rozó la pantalla.
    return negar("TRAZO_INSUFICIENTE", "La firma quedó incompleta. Inténtalo de nuevo");
  }

  return PERMITIDO;
}

/** Solo dígitos, sin puntos ni espacios; longitud plausible en Colombia. */
export function cedulaValida(cedula: string): boolean {
  const limpia = cedula.replace(/[.\s-]/g, "");
  return /^\d{6,12}$/.test(limpia);
}

export function normalizarCedula(cedula: string): string {
  return cedula.replace(/[.\s-]/g, "");
}

/**
 * Serializa el trazo para guardarlo.
 *
 * Se guardan los puntos, no una imagen: ocupan mucho menos, se sincronizan
 * por conexiones malas sin problema y se pueden volver a dibujar a cualquier
 * tamaño, incluido el PDF de la orden.
 */
export function serializarTrazo(
  trazo: readonly (readonly { x: number; y: number }[])[],
): string {
  // Se redondea a un decimal: la precisión de un dedo no da para más y el
  // tamaño baja a la mitad.
  return JSON.stringify(
    trazo.map((segmento) => segmento.map((p) => [redondear(p.x), redondear(p.y)])),
  );
}

export function deserializarTrazo(crudo: string | null): { x: number; y: number }[][] {
  if (!crudo) return [];
  try {
    const datos = JSON.parse(crudo) as number[][][];
    return datos.map((segmento) => segmento.map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 })));
  } catch {
    // Un trazo corrupto no debe impedir abrir la orden: se muestra sin firma.
    return [];
  }
}

const redondear = (n: number): number => Math.round(n * 10) / 10;

/** Ruta SVG del trazo, para dibujarlo. */
export function trazoASvg(
  trazo: readonly (readonly { x: number; y: number }[])[],
): string {
  return trazo
    .filter((segmento) => segmento.length > 0)
    .map((segmento) => {
      const [primero, ...resto] = segmento;
      if (!primero) return "";
      const inicio = `M ${primero.x} ${primero.y}`;
      // Un solo punto se dibuja como una línea mínima, o no se vería nada.
      if (resto.length === 0) return `${inicio} L ${primero.x + 0.5} ${primero.y}`;
      return `${inicio} ${resto.map((p) => `L ${p.x} ${p.y}`).join(" ")}`;
    })
    .filter(Boolean)
    .join(" ");
}

export interface RegistroConsentimiento {
  readonly version: string;
  readonly aceptadoEn: string;
}

/** Constancia de lo aceptado, para guardar junto a la firma. */
export function registrarConsentimiento(ahora: Date): RegistroConsentimiento {
  return { version: VERSION_CONSENTIMIENTO, aceptadoEn: ahora.toISOString() };
}
