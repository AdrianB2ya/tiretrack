/**
 * Sistema visual.
 *
 * Las decisiones de aquí no son estéticas: la app se usa **con guantes, bajo
 * el sol y con las manos sucias**. Eso condiciona el tamaño de los objetivos
 * táctiles, el contraste y el peso tipográfico más que cualquier preferencia
 * de diseño.
 */

/**
 * Paleta de Asistectire (decisión del usuario, 2026-10-09): negro, blanco y
 * el rojo de la marca **como acento** (logo, barra superior, pestaña activa).
 * Lo interactivo va en blanco sobre negro, como el logo: si los botones
 * fueran rojos, el rojo dejaría de significar "peligro" (llanta gastada,
 * firma inválida) y bajo el sol esa señal no puede perderse.
 *
 * El fondo es el negro del logo: el logo se ve sin recuadro sobre la app.
 */
export const colores = {
  /*
   * Grafito neutro en escalones (revisión de diseño 2026-10-16). Antes el
   * fondo era casi negro puro (3 % de luminosidad), las capas no se
   * distinguían (contraste 1,08 y 1,17 contra el fondo) y los grises tiraban
   * a café junto al rojo. Cada capa sube un escalón parejo: fondo → barras →
   * tarjetas → campos → paneles abiertos.
   */
  fondo: "#15181C",
  superficie: "#1C2026",
  tarjeta: "#242930",
  /** Campos de texto y listas cerradas: un escalón sobre la tarjeta. */
  campo: "#2C323A",
  /** Lo que flota encima (una lista desplegada). */
  elevado: "#353C46",
  borde: "#3B424C",
  /** Borde de lo que se puede tocar (contornos, brillo de las tarjetas). */
  bordeFuerte: "#4F5865",

  /**
   * Blanco = lo elegido y la acción principal (lleno), o lo que está en foco
   * o abierto (borde). Es la única luz fuerte de la pantalla.
   */
  primario: "#F2F4F7",
  primarioClaro: "#FFFFFF",
  /** El rojo de la marca. Solo identidad (pestaña, logo), nunca estados ni botones. */
  marca: "#ED1C24",
  secundario: "#5EA8F2",

  /* Estados, calibrados para fondo oscuro: todos pasan 4,5 sobre las tarjetas. */
  exito: "#3DD68C",
  advertencia: "#F5C84C",
  /** Rojo coral: distinto del rojo de marca, para no confundir adorno con alarma. */
  peligro: "#FF6B5E",
  morado: "#B78CF2",

  texto: "#F2F4F7",
  textoTenue: "#A9B1BC",
  blanco: "#FFFFFF",
  /** Texto sobre lo blanco y sobre los colores de estado llenos. */
  sobrePrimario: "#15181C",
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

/**
 * Caja de texto: la misma para un campo, una búsqueda o un destinatario
 * (revisión de diseño: había cuatro versiones, de 48 y 56 de alto y con dos
 * fondos distintos).
 */
export const entrada = {
  minHeight: tactil.comodo,
  backgroundColor: colores.campo,
  borderWidth: 1,
  borderColor: colores.borde,
  borderRadius: radio.md,
  paddingHorizontal: espacio.lg,
  fontSize: texto.cuerpo.fontSize,
  color: colores.texto,
} as const;
