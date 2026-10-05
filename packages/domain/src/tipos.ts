/**
 * Tipos compartidos del dominio.
 *
 * Son los mismos que usan la base de datos, la API y la app. Si un valor
 * aparece aquí, aparece igual en los tres lados.
 */

export const ROLES = ["superadmin", "administrador", "coordinador", "tecnico", "cliente"] as const;
export type Rol = (typeof ROLES)[number];

export const ESTADOS_ORDEN = [
  "borrador",
  "programada",
  "en_proceso",
  "en_revision",
  "pendiente_cliente",
  "cerrada",
  "anulada",
] as const;
export type EstadoOrden = (typeof ESTADOS_ORDEN)[number];

/** Estados en los que la orden todavía admite cambios. */
export const ESTADOS_ABIERTOS: readonly EstadoOrden[] = [
  "borrador",
  "programada",
  "en_proceso",
  "en_revision",
  "pendiente_cliente",
];

export const TIPOS_SERVICIO = ["preventivo", "correctivo"] as const;
export type TipoServicio = (typeof TIPOS_SERVICIO)[number];

export const PRIORIDADES = ["baja", "normal", "alta"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];

export const TIPOS_EJE = ["direccional", "traccion", "arrastre", "multiuso"] as const;
export type TipoEje = (typeof TIPOS_EJE)[number];

export const ESTADOS_LLANTA = [
  "Nueva",
  "Reencauche 1",
  "Reencauche 2",
  "Reencauche 3",
  "Usada",
] as const;
export type EstadoLlanta = (typeof ESTADOS_LLANTA)[number];

export const DESTINOS_LLANTA = [
  "Desecho",
  "Repuesto",
  "Reencauche",
  "Reparación",
  "Inventario",
] as const;
export type DestinoLlanta = (typeof DESTINOS_LLANTA)[number];

export const UNIDADES_PRESION = ["psi", "bar", "kpa"] as const;
export type UnidadPresion = (typeof UNIDADES_PRESION)[number];

export const UNIDADES_PROFUNDIDAD = ["mm", "in32"] as const;
export type UnidadProfundidad = (typeof UNIDADES_PROFUNDIDAD)[number];

/**
 * Servicios del catálogo. `porLlanta` distingue los que se marcan en cada
 * posición de los que aplican al vehículo completo.
 *
 * En el informe operativo la alineación aparece marcada por posición, así
 * que va como servicio de llanta aunque físicamente se haga sobre el eje.
 */
/**
 * Catálogo de servicios: FIJO y único.
 *
 * Es la única fuente. La semilla del servidor, el contrato y la app derivan
 * de aquí; ninguno declara su propia lista. Antes había tres copias —aquí sin
 * código, en la semilla con código copiado a mano, y en la tabla que el
 * celular descargaba— que coincidían por cuidado, no por diseño.
 *
 * Lo que identifica a un servicio es su CÓDIGO, no su nombre. El nombre es
 * para mostrar y puede cambiar ("Retorqueo" → "Reapriete") sin romper el
 * histórico ni la sincronización; el código no cambia nunca. Además es ASCII:
 * sin tildes que comparar.
 */
export const CATALOGO_SERVICIOS = [
  { codigo: "MONT", nombre: "Montaje", porLlanta: true, columna: "MONTAJE" },
  { codigo: "REPA", nombre: "Reparación", porLlanta: true, columna: "REPARACION" },
  { codigo: "ROTA", nombre: "Rotación", porLlanta: true, columna: "ROTACION" },
  { codigo: "CALI", nombre: "Calibración", porLlanta: true, columna: "CALIBRACION" },
  { codigo: "RETO", nombre: "Retorqueo", porLlanta: true, columna: "RETORQUE" },
  { codigo: "MARC", nombre: "Marcación", porLlanta: true, columna: "MARCACION" },
  { codigo: "BALA", nombre: "Balanceo", porLlanta: true, columna: "BALANCEO" },
  { codigo: "ALIN", nombre: "Alineación", porLlanta: true, columna: "ALINEACION" },
  { codigo: "ENGR", nombre: "Engrase", porLlanta: false, columna: "ENGRASE" },
] as const;

export type DefinicionServicio = (typeof CATALOGO_SERVICIOS)[number];
export type CodigoServicio = DefinicionServicio["codigo"];

/**
 * Códigos por ámbito. Se eliminaron `SERVICIOS_LLANTA` y `SERVICIOS_VEHICULO`
 * —que eran NOMBRES— en vez de redefinirlos: nombre y código son ambos
 * `string`, y cambiar el significado de una constante existente habría
 * compilado sin avisar en cada sitio que la usaba.
 */
export const CODIGOS_SERVICIO_LLANTA = CATALOGO_SERVICIOS.filter((s) => s.porLlanta).map(
  (s) => s.codigo,
);
export const CODIGOS_SERVICIO_VEHICULO = CATALOGO_SERVICIOS.filter((s) => !s.porLlanta).map(
  (s) => s.codigo,
);

export function definicionDeServicio(codigo: string): DefinicionServicio | undefined {
  return CATALOGO_SERVICIOS.find((s) => s.codigo === codigo);
}

export function esCodigoServicio(valor: string): valor is CodigoServicio {
  return CATALOGO_SERVICIOS.some((s) => s.codigo === valor);
}

/** Resultado de evaluar una regla: permite o explica por qué no. */
export interface Veredicto {
  readonly permitido: boolean;
  readonly codigo?: string;
  readonly mensaje?: string;
  /** Campo que causó el rechazo, para señalarlo en pantalla. */
  readonly campo?: string;
}

export const PERMITIDO: Veredicto = { permitido: true };

export function negar(codigo: string, mensaje: string): Veredicto {
  return { permitido: false, codigo, mensaje };
}
