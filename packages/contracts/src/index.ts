/**
 * @tiretrack/contracts
 *
 * Esquemas Zod compartidos entre la API y la app. Un solo lugar donde vive
 * la forma de los datos que cruzan la red.
 *
 * Los enums salen de @tiretrack/domain: aquí no se redefine ninguna lista,
 * porque duplicarla es garantizar que en algún momento se desincronicen.
 */

export const CONTRACTS_VERSION = "0.1.0";

export * from "./comunes";
export * from "./auth";
export * from "./orden";
export * from "./catalogo";
