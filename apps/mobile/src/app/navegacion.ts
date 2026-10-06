import {
  puedeAprobar,
  puedeGestionarConfiguraciones,
  puedeGestionarProgramaciones,
  puedeGestionarUsuarios,
  type Rol,
} from "@tiretrack/domain";

/**
 * Navegación de la oficina (coordinador y administrador).
 *
 * En la primera prueba en el teléfono el usuario lo dijo claro: tocaba una
 * tarjeta del panel, llegaba a una lista y no tenía cómo moverse. La barra de
 * abajo deja siempre a un toque lo que se usa a diario; lo de vez en cuando
 * va en "Más", para que el panel muestre decisiones y no botones.
 *
 * El técnico no tiene barra: entra directo a sus órdenes y cada pantalla
 * intermedia es un toque más con guantes.
 */

export type Pestana = "panel" | "ordenes" | "revision" | "mas";

export interface DestinoPestana {
  readonly clave: Pestana;
  readonly etiqueta: string;
  readonly ruta: string;
}

export function pestanasPara(rol: Rol | string): DestinoPestana[] {
  if (!puedeAprobar(rol as Rol)) return [];
  return [
    { clave: "panel", etiqueta: "Panel", ruta: "/panel" },
    { clave: "ordenes", etiqueta: "Órdenes", ruta: "/ordenes" },
    { clave: "revision", etiqueta: "Revisar", ruta: "/revision" },
    { clave: "mas", etiqueta: "Más", ruta: "/mas" },
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
  if (puedeAprobar(r)) {
    o.push({ clave: "nueva-orden", etiqueta: "Programar una orden", detalle: "Para un técnico de tu sede", ruta: "/nueva-orden" });
  }
  if (puedeGestionarProgramaciones(r)) {
    o.push({ clave: "programaciones", etiqueta: "Visitas recurrentes", detalle: "Órdenes que se generan solas cada cierto tiempo", ruta: "/programaciones" });
  }
  if (puedeAprobar(r)) {
    o.push({ clave: "flota", etiqueta: "Clientes y vehículos", detalle: "Registrar clientes, sedes y vehículos", ruta: "/flota" });
    o.push({ clave: "informe", etiqueta: "Informe", detalle: "Consultar y exportar mediciones", ruta: "/informe" });
  }
  if (puedeGestionarUsuarios(r)) {
    o.push({ clave: "usuarios", etiqueta: "Usuarios", detalle: "Altas y códigos de activación", ruta: "/usuarios" });
    o.push({ clave: "sedes", etiqueta: "Sedes", detalle: "Sedes de la empresa", ruta: "/sedes" });
  }
  if (puedeGestionarConfiguraciones(r)) {
    o.push({ clave: "plantillas", etiqueta: "Plantillas de ejes", detalle: "Cómo se dibuja cada tipo de vehículo", ruta: "/plantillas" });
  }
  o.push({ clave: "cuenta", etiqueta: "Mi cuenta", detalle: "Sesión y cambios sin enviar", ruta: "/cuenta" });
  return o;
}
