/**
 * Sistema visual.
 *
 * Las decisiones de aquí no son estéticas: la app se usa **con guantes, bajo
 * el sol y con las manos sucias**. Eso condiciona el tamaño de los objetivos
 * táctiles, el contraste y el peso tipográfico más que cualquier preferencia
 * de diseño.
 */

export const colores = {
  fondo: "#1A1D23",
  superficie: "#242830",
  tarjeta: "#2E3340",
  borde: "#3A4050",

  primario: "#F57C00",
  primarioClaro: "#FF9800",
  secundario: "#4A90D9",

  exito: "#2ECC71",
  advertencia: "#F1C40F",
  peligro: "#E74C3C",
  morado: "#9B59B6",

  texto: "#E8EAF0",
  textoTenue: "#8B93A7",
  blanco: "#FFFFFF",
} as const;

/**
 * Tamaños táctiles.
 *
 * El mínimo que recomiendan las guías de accesibilidad son 44 puntos. Aquí el
 * mínimo es 48 y los controles principales llegan a 56: un dedo con guante
 * de trabajo es más ancho y menos preciso que uno desnudo.
 */
export const tactil = {
  minimo: 48,
  comodo: 56,
  /** Casillas del diagrama de llantas: se tocan de a una, con precisión. */
  posicionLlanta: 52,
  /** Separación mínima entre objetivos, para no tocar el de al lado. */
  separacion: 8,
} as const;

export const espacio = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radio = {
  sm: 6,
  md: 10,
  lg: 14,
  completo: 999,
} as const;

/**
 * Tipografía.
 *
 * Los tamaños son mayores que en una app de escritorio: el técnico mira la
 * pantalla a distancia de brazo, con reflejo del sol y a veces sin gafas.
 * Nada baja de 13.
 */
export const texto = {
  titulo: { fontSize: 24, fontWeight: "700" },
  subtitulo: { fontSize: 18, fontWeight: "600" },
  cuerpo: { fontSize: 16, fontWeight: "400" },
  cuerpoFuerte: { fontSize: 16, fontWeight: "600" },
  etiqueta: { fontSize: 14, fontWeight: "600" },
  ayuda: { fontSize: 13, fontWeight: "400" },
  /** Folios y seriales: monoespaciada para leerlos y dictarlos sin error. */
  codigo: { fontSize: 15, fontWeight: "700", fontFamily: "monospace" },
} as const;

/** Estados de la orden, con su color y etiqueta legible. */
export const estadosOrden = {
  borrador: { etiqueta: "Borrador", color: colores.textoTenue },
  programada: { etiqueta: "Programada", color: colores.secundario },
  en_proceso: { etiqueta: "En proceso", color: colores.advertencia },
  en_revision: { etiqueta: "En revisión", color: colores.morado },
  pendiente_cliente: { etiqueta: "Espera al cliente", color: colores.secundario },
  cerrada: { etiqueta: "Cerrada", color: colores.exito },
  anulada: { etiqueta: "Anulada", color: colores.textoTenue },
} as const;

export const prioridades = {
  alta: { etiqueta: "Alta", color: colores.peligro },
  normal: { etiqueta: "Normal", color: colores.secundario },
  baja: { etiqueta: "Baja", color: colores.textoTenue },
} as const;

/** Tipos de eje: el color ayuda a ubicarse en el diagrama de un vistazo. */
export const tiposEje = {
  direccional: { etiqueta: "Direccional", color: colores.secundario },
  traccion: { etiqueta: "Tracción", color: colores.exito },
  arrastre: { etiqueta: "Arrastre", color: colores.advertencia },
  multiuso: { etiqueta: "Multiuso", color: colores.textoTenue },
} as const;

/** Opacidad de un color hexadecimal, para fondos tenues. */
export function conOpacidad(hex: string, alfa: number): string {
  const valor = Math.round(Math.min(1, Math.max(0, alfa)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${valor}`;
}
