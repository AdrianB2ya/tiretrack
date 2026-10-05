import { type Veredicto, PERMITIDO, negar } from "../tipos";

/**
 * Registro fotográfico.
 *
 * La foto es lo que sostiene la orden si el cliente objeta. Sin ella, un
 * hallazgo de corte en el flanco es la palabra del técnico contra la del
 * cliente.
 *
 * El problema operativo: una foto de celular pesa 3 a 5 MB y el técnico toma
 * varias por posición. Veintidós posiciones son más de 60 MB por orden, en
 * 4G rural. Por eso la compresión en el dispositivo no es una optimización,
 * es lo que hace viable el flujo.
 */

export const TAMANO_MAXIMO_BYTES = 2 * 1024 * 1024;
export const TAMANO_OBJETIVO_BYTES = 250 * 1024;
export const LADO_MAXIMO_PX = 1600;

export const TIPOS_PERMITIDOS = ["image/jpeg", "image/png", "image/webp"] as const;
export type TipoImagen = (typeof TIPOS_PERMITIDOS)[number];

/** Tope por posición: más fotos de la misma llanta no agregan evidencia. */
export const MAXIMO_POR_POSICION = 6;
/** Tope por orden, para las fotos generales del vehículo. */
export const MAXIMO_POR_ORDEN = 20;

export interface SolicitudFoto {
  readonly tipoMime: string;
  readonly tamanoBytes: number;
  readonly nombreArchivo: string;
  /** Cuántas hay ya en ese destino. */
  readonly existentes: number;
  /** null cuando la foto es del vehículo y no de una posición. */
  readonly posicion: number | null;
}

export function validarFoto(s: SolicitudFoto): Veredicto {
  if (!(TIPOS_PERMITIDOS as readonly string[]).includes(s.tipoMime)) {
    return negar("TIPO_NO_PERMITIDO", "Solo se aceptan imágenes JPEG, PNG o WebP");
  }
  if (s.tamanoBytes <= 0) {
    return negar("ARCHIVO_VACIO", "El archivo está vacío");
  }
  if (s.tamanoBytes > TAMANO_MAXIMO_BYTES) {
    // El dispositivo debe comprimir antes de pedir la URL: enviar y luego
    // rechazar gastaría los datos móviles del técnico igual.
    return negar(
      "ARCHIVO_MUY_GRANDE",
      `La foto pesa ${Math.round(s.tamanoBytes / 1024)} KB. Comprímela antes de subirla`,
    );
  }

  const tope = s.posicion === null ? MAXIMO_POR_ORDEN : MAXIMO_POR_POSICION;
  if (s.existentes >= tope) {
    const donde = s.posicion === null ? "esta orden" : `la posición ${s.posicion}`;
    return negar("DEMASIADAS_FOTOS", `Ya hay ${tope} fotos en ${donde}`);
  }

  if (!s.nombreArchivo.trim()) {
    return negar("SIN_NOMBRE", "El archivo necesita un nombre");
  }

  return PERMITIDO;
}

/**
 * Ruta del objeto en el almacenamiento.
 *
 * Lleva la empresa por delante para que el prefijo permita separar por tenant
 * al hacer copias o al borrar una empresa completa. El id de la foto va en el
 * nombre para que dos fotos con el mismo nombre de archivo no se pisen.
 */
export function rutaAlmacenamiento(p: {
  empresaId: string;
  ordenId: string;
  fotoId: string;
  posicion: number | null;
  tipoMime: string;
}): string {
  const ext = extensionDe(p.tipoMime);
  const carpeta = p.posicion === null ? "orden" : `posicion-${p.posicion}`;
  return `${p.empresaId}/${p.ordenId}/${carpeta}/${p.fotoId}.${ext}`;
}

export function extensionDe(tipoMime: string): string {
  switch (tipoMime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}

/** Minutos que vive la URL de subida. Corta: se usa de inmediato. */
export const MINUTOS_URL_SUBIDA = 10;
/** Minutos que vive la URL de lectura. Más larga: el cliente mira el informe. */
export const MINUTOS_URL_LECTURA = 60;

export interface ContextoBorrado {
  readonly esAutor: boolean;
  readonly ordenEditable: boolean;
}

/**
 * Una foto se borra solo mientras la orden admite cambios y solo por quien la
 * tomó. Después de que el documento se aprueba, la evidencia es parte del
 * expediente: quitarla sería alterar lo que el cliente firmó.
 */
export function puedeBorrarFoto(c: ContextoBorrado): Veredicto {
  if (!c.ordenEditable) {
    return negar("ORDEN_NO_EDITABLE", "La orden ya no admite cambios");
  }
  if (!c.esAutor) {
    return negar("NO_ES_AUTOR", "Solo quien tomó la foto puede quitarla");
  }
  return PERMITIDO;
}
