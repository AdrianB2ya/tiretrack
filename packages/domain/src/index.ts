/**
 * @tiretrack/domain
 *
 * Reglas de negocio puras: sin React, sin Node, sin base de datos.
 * Las usan por igual el backend (para validar) y la app (para responder
 * sin esperar al servidor). Una sola definición de cada regla.
 */

export const DOMAIN_VERSION = "0.2.0";

export * from "./identidad";
export * from "./tipos";

export * from "./orden/estados";
export * from "./orden/firma";
export * from "./orden/recomendaciones";
export * from "./orden/captura-firma";
export * from "./orden/congelado";

export * from "./llanta/dot";
export * from "./llanta/medicion";

export * from "./catalogo/normalizacion";
export * from "./catalogo/ambito";
export * from "./catalogo/revision";
export * from "./folio/folio";
export * from "./tiempo/habiles";
export * from "./tiempo/zona";
export * from "./acceso/politica";
export * from "./acceso/usuarios";
export * from "./flota/reglas";
export * from "./fotos/reglas";
export * from "./informe/formato";
export * from "./informe/documentoOrden";
export * from "./trabajos/reglas";
export * from "./trabajos/programacion";
export * from "./auditoria/vista";
