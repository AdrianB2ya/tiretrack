import {
  puedeAprobar,
  puedeGestionarConfiguraciones,
  puedeGestionarProgramaciones,
  puedeGestionarUsuarios,
  puedeVerAuditoria,
  puedeRevisarCreadasEnCampo,
  type Rol,
} from "@tiretrack/domain";

/**
 * Navegación de abajo, para cada rol según lo que puede hacer.
 *
 * En la primera prueba en el teléfono el usuario lo dijo claro: tocaba una
 * tarjeta del panel, llegaba a una lista y no tenía cómo moverse. La barra de
 * abajo deja siempre a un toque lo que se usa a diario; lo de vez en cuando
 * va en "Más", para que el panel muestre decisiones y no botones.
 *
 * Todos los roles tienen barra, con lo que pueden hacer (pedido del usuario
 * tras la primera prueba). Al principio el técnico no la tenía, para no
 * sumarle un toque con guantes; pero sin ella no encontraba su cuenta ni el
 * registro de clientes. Sigue entrando directo a sus órdenes.
 */

export type Pestana = "panel" | "ordenes" | "revision" | "cliente" | "plataforma" | "mas";

export interface DestinoPestana {
  readonly clave: Pestana;
  readonly etiqueta: string;
  readonly ruta: string;
}

const MAS: DestinoPestana = { clave: "mas", etiqueta: "Más", ruta: "/mas" };

export function pestanasPara(rol: Rol | string): DestinoPestana[] {
  if (rol === "tecnico") return [{ clave: "ordenes", etiqueta: "Mis órdenes", ruta: "/ordenes" }, MAS];
  if (rol === "cliente") return [{ clave: "cliente", etiqueta: "Mis servicios", ruta: "/cliente" }, MAS];
  if (rol === "superadmin") return [{ clave: "plataforma", etiqueta: "Plataforma", ruta: "/plataforma" }, MAS];
  if (!puedeAprobar(rol as Rol)) return [];
  return [
    { clave: "panel", etiqueta: "Panel", ruta: "/panel" },
    { clave: "ordenes", etiqueta: "Órdenes", ruta: "/ordenes" },
    { clave: "revision", etiqueta: "Revisar", ruta: "/revision" },
    MAS,
  ];
}

export interface OpcionMas {
  readonly clave: string;
  readonly etiqueta: string;
  readonly detalle: string;
  readonly ruta: string;
}

/**
 * Secciones de "Más" (R17). Con veinte entradas en una sola lista, lo que se
 * busca queda abajo y se pasa de largo con el pulgar. Agrupadas por para qué
 * sirven, en el orden en que se usan: lo diario primero, la cuenta al final.
 */
export const GRUPOS_MAS = ["Trabajo diario", "Llantas", "Informes", "Administración", "Cuenta"] as const;
export type GrupoMas = (typeof GRUPOS_MAS)[number];

/** Toda opción tiene su sección: una prueba falla si se agrega una sin ella. */
export const GRUPO_DE_OPCION: Record<string, GrupoMas> = {
  escanear: "Trabajo diario",
  "nueva-orden": "Trabajo diario",
  programaciones: "Trabajo diario",
  flota: "Trabajo diario",
  alertas: "Llantas",
  llantas: "Llantas",
  stock: "Llantas",
  "codigos-qr": "Llantas",
  reclamos: "Llantas",
  catalogo: "Llantas",
  informe: "Informes",
  tablero: "Informes",
  "causas-retiro": "Informes",
  cotizacion: "Informes",
  usuarios: "Administración",
  sedes: "Administración",
  plantillas: "Administración",
  limites: "Administración",
  "revision-catalogo": "Administración",
  carga: "Administración",
  auditoria: "Administración",
  cuenta: "Cuenta",
};

export function agruparOpciones(opciones: readonly OpcionMas[]): { grupo: GrupoMas; opciones: OpcionMas[] }[] {
  return GRUPOS_MAS.map((grupo) => ({ grupo, opciones: opciones.filter((o) => (GRUPO_DE_OPCION[o.clave] ?? "Cuenta") === grupo) })).filter(
    (g) => g.opciones.length > 0,
  );
}

const sinTildes = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

/** Busca en el nombre y en para qué sirve: "excel" encuentra "Cargar desde Excel". */
export function buscarOpciones(opciones: readonly OpcionMas[], texto: string): OpcionMas[] {
  const q = sinTildes(texto);
  if (!q) return [...opciones];
  // Palabra por palabra y en cualquier orden: "codigo qr" encuentra "Códigos QR".
  const palabras = q.split(/\s+/);
  return opciones.filter((o) => {
    const t = sinTildes(`${o.etiqueta} ${o.detalle}`);
    return palabras.every((p) => t.includes(p));
  });
}

/** Con más de estas opciones, "Más" ofrece búsqueda. */
export const MAX_MAS_SIN_BUSQUEDA = 8;

/** Lo que va en "Más", según lo que el rol puede hacer. */
export function opcionesMas(rol: Rol | string): OpcionMas[] {
  const r = rol as Rol;
  const o: OpcionMas[] = [];
  // R15: el QR pegado en el vehículo abre su ficha y su orden en curso.
  if (r === "tecnico" || puedeAprobar(r)) {
    o.push({ clave: "escanear", etiqueta: "Escanear vehículo", detalle: "Leer el código QR pegado en el vehículo", ruta: "/escanear" });
  }
  if (r === "tecnico") {
    // El técnico crea clientes y sedes porque es operativo: llega a una sede
    // que no estaba registrada y necesita trabajar (1.5). Vehículos no.
    o.push({ clave: "nueva-orden", etiqueta: "Nueva orden", detalle: "Un vehículo que llegó sin estar programado", ruta: "/nueva-orden" });
    o.push({ clave: "flota", etiqueta: "Clientes y sedes", detalle: "Registrar un cliente o una sede que no está", ruta: "/flota" });
    // Decisión del usuario: técnico y cliente ven el informe. El servidor lo
    // limita: el técnico a sus órdenes; el cliente a las suyas que esperan su
    // aprobación o están cerradas.
    o.push({ clave: "informe", etiqueta: "Informe", detalle: "Mediciones de tus órdenes: consultar y exportar", ruta: "/informe" });
  }
  if (r === "cliente") {
    o.push({ clave: "informe", etiqueta: "Informe", detalle: "Mediciones de tu flota: consultar y exportar", ruta: "/informe" });
  }
  if (puedeAprobar(r)) {
    o.push({ clave: "nueva-orden", etiqueta: "Programar una orden", detalle: "Para un técnico de tu sede", ruta: "/nueva-orden" });
  }
  if (puedeGestionarProgramaciones(r)) {
    o.push({ clave: "programaciones", etiqueta: "Visitas recurrentes", detalle: "Órdenes que se generan solas cada cierto tiempo", ruta: "/programaciones" });
  }
  if (puedeAprobar(r)) {
    o.push({ clave: "flota", etiqueta: "Clientes y vehículos", detalle: "Registrar clientes, sedes y vehículos", ruta: "/flota" });
    o.push({ clave: "alertas", etiqueta: "Llantas para cambiar", detalle: "DOT vencido o bajo el mínimo, según la última medición", ruta: "/alertas" });
    o.push({ clave: "informe", etiqueta: "Informe", detalle: "Consultar y exportar mediciones", ruta: "/informe" });
  }
  if (puedeGestionarUsuarios(r)) {
    o.push({ clave: "usuarios", etiqueta: "Usuarios", detalle: "Altas y códigos de activación", ruta: "/usuarios" });
    o.push({ clave: "sedes", etiqueta: "Sedes", detalle: "Sedes de la empresa", ruta: "/sedes" });
  }
  // R8: el inventario lo consulta cualquiera de la empresa y el cliente (el suyo).
  if (r !== "superadmin") {
    o.push({ clave: "llantas", etiqueta: "Llantas", detalle: "Cada llanta: dónde está, sus vidas y su historia", ruta: "/llantas" });
  }
  if (r !== "superadmin" && r !== "tecnico") {
    o.push({ clave: "tablero", etiqueta: "Indicadores de la flota", detalle: "Qué comprar y cuándo, y qué marca rinde", ruta: "/tablero" });
    o.push({ clave: "causas-retiro", etiqueta: "Causas de retiro", detalle: "Por qué salen las llantas: por motivo, marca, posición y vehículo", ruta: "/causas-retiro" });
  }
  if (puedeGestionarCatalogo(r)) {
    o.push({ clave: "cotizacion", etiqueta: "Cotización", detalle: "Lo que hay que cambiar en la flota de un cliente, para cotizar", ruta: "/cotizacion" });
    o.push({ clave: "codigos-qr", etiqueta: "Códigos QR de vehículos", detalle: "Etiquetas para imprimir y pegar en cada vehículo", ruta: "/codigos-qr" });
    o.push({ clave: "carga", etiqueta: "Cargar desde Excel", detalle: "Clientes, vehículos, llantas o catálogo, de un archivo", ruta: "/carga" });
  }
  if (puedeGestionarCatalogo(r)) {
    o.push({ clave: "reclamos", etiqueta: "Garantías y reclamos", detalle: "Reclamos al proveedor por llantas que fallaron", ruta: "/reclamos" });
  }
  if (puedeGestionarCatalogo(r)) {
    o.push({ clave: "stock", etiqueta: "Stock de bodega", detalle: "Llantas en bodega por sede y medida, contra el mínimo", ruta: "/stock" });
  }
  if (puedeGestionarCatalogo(r)) {
    o.push({ clave: "catalogo", etiqueta: "Catálogo de llantas", detalle: "Marcas, diseños y medidas con su profundidad de fábrica", ruta: "/catalogo" });
  }
  if (puedeRevisarCreadasEnCampo(r) && r !== "superadmin") {
    o.push({ clave: "revision-catalogo", etiqueta: "Creado en campo", detalle: "Aprobar o unificar marcas, diseños y medidas que agregaron los técnicos", ruta: "/revision-catalogo" });
  }
  if (puedeVerAuditoria(r)) {
    o.push({ clave: "auditoria", etiqueta: "Auditoría", detalle: "Quién sacó datos y quién cambió qué", ruta: "/auditoria" });
  }
  if (r === "administrador") {
    o.push({ clave: "limites", etiqueta: "Límites de cambio", detalle: "Desde qué profundidad una llanta pide cambio en tu empresa", ruta: "/limites" });
  }
  if (puedeGestionarConfiguraciones(r)) {
    o.push({ clave: "plantillas", etiqueta: "Plantillas de ejes", detalle: "Cómo se dibuja cada tipo de vehículo", ruta: "/plantillas" });
  }
  o.push({ clave: "cuenta", etiqueta: "Mi cuenta", detalle: "Sesión y cambios sin enviar", ruta: "/cuenta" });
  return o;
}

/** Catálogo de llantas completo: la oficina (el técnico agrega desde la posición). */
export function puedeGestionarCatalogo(r: Rol): boolean {
  return r === "administrador" || r === "coordinador";
}
