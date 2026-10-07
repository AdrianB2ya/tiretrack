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

/** Lo que va en "Más", según lo que el rol puede hacer. */
export function opcionesMas(rol: Rol | string): OpcionMas[] {
  const r = rol as Rol;
  const o: OpcionMas[] = [];
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
  if (puedeRevisarCreadasEnCampo(r) && r !== "superadmin") {
    o.push({ clave: "revision-catalogo", etiqueta: "Marcas creadas en campo", detalle: "Aprobar o unificar lo que escribieron los técnicos", ruta: "/revision-catalogo" });
  }
  if (puedeVerAuditoria(r)) {
    o.push({ clave: "auditoria", etiqueta: "Auditoría", detalle: "Quién sacó datos y quién cambió qué", ruta: "/auditoria" });
  }
  if (puedeGestionarConfiguraciones(r)) {
    o.push({ clave: "plantillas", etiqueta: "Plantillas de ejes", detalle: "Cómo se dibuja cada tipo de vehículo", ruta: "/plantillas" });
  }
  o.push({ clave: "cuenta", etiqueta: "Mi cuenta", detalle: "Sesión y cambios sin enviar", ruta: "/cuenta" });
  return o;
}
