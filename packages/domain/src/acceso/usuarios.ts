import { type Rol, type Veredicto, PERMITIDO, negar } from "../tipos";

/**
 * Alta de usuarios con código de activación.
 *
 * Decisión del usuario: no hay servicio de correo. El administrador crea el
 * usuario, la app le muestra un código de un solo uso para enviarlo por
 * WhatsApp, y la persona elige su propia contraseña. Nadie más la conoce.
 *
 * El mismo mecanismo sirve para que el administrador ayude a recuperar una
 * cuenta: emite un código nuevo.
 */

/** Solo el administrador da de alta usuarios: deciden quién entra a la empresa. */
export function puedeGestionarUsuarios(rol: Rol): boolean {
  return rol === "administrador";
}

/** El superadmin es de la plataforma: ninguna empresa lo crea. */
export function rolesAsignables(rol: Rol): Rol[] {
  return puedeGestionarUsuarios(rol) ? ["administrador", "coordinador", "tecnico", "cliente"] : [];
}

export function puedeAsignarRol(quien: Rol, nuevo: Rol): Veredicto {
  if (!puedeGestionarUsuarios(quien)) return negar("SIN_PERMISO", "Solo el administrador da de alta usuarios");
  if (!rolesAsignables(quien).includes(nuevo)) return negar("ROL_NO_ASIGNABLE", "Ese rol no se puede asignar");
  return PERMITIDO;
}

/** Tres días: alcanza para que llegue por WhatsApp y la persona lo use. */
export const HORAS_CODIGO_ACTIVACION = 72;

export function expiracionActivacion(ahora: Date): Date {
  return new Date(ahora.getTime() + HORAS_CODIGO_ACTIVACION * 3_600_000);
}

/**
 * Sin letras que se confunden al dictarlas o leerlas en una pantalla con sol:
 * no hay O/0, I/1/L, S/5, B/8, Z/2.
 */
const ALFABETO_CODIGO = "ACDEFGHJKMNPQRTUVWXY34679";
export const LARGO_CODIGO_ACTIVACION = 8;

/**
 * Código de activación, como "K7M2-X9QP". 25^8 ≈ 1,5·10^11 combinaciones; con
 * el bloqueo por intentos de la cuenta, adivinarlo no es práctico.
 */
export function generarCodigoActivacion(azar: (n: number) => number = (n) => Math.floor(Math.random() * n)): string {
  let c = "";
  for (let i = 0; i < LARGO_CODIGO_ACTIVACION; i++) c += ALFABETO_CODIGO[azar(ALFABETO_CODIGO.length)];
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** Como se escriba —minúsculas, con o sin guion, con espacios—, el mismo código. */
export function normalizarCodigoActivacion(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Lo que se necesita saber para decidir si alguien se puede desactivar. */
export interface UsoDeUsuario {
  /** Órdenes sin cerrar asignadas a esa persona. */
  readonly ordenesAbiertas: number;
  /** Visitas recurrentes activas con esa persona como técnico fijo. */
  readonly programacionesActivas: number;
}

/**
 * Desactivar a alguien (deja de trabajar en la empresa). Nada se borra.
 *
 * Como el resto del sistema, no se deshabilita algo con trabajo abierto: sus
 * órdenes quedarían en la lista de nadie, y sus visitas recurrentes dejarían
 * de generarse. Primero se reasignan.
 */
export function puedeDesactivarUsuario(quien: Rol, esUnoMismo: boolean, uso: UsoDeUsuario): Veredicto {
  if (!puedeGestionarUsuarios(quien)) return negar("SIN_PERMISO", "Solo el administrador desactiva usuarios");
  // Quedaría fuera sin nadie que lo pueda volver a activar.
  if (esUnoMismo) return negar("UNO_MISMO", "No puedes desactivar tu propia cuenta");
  if (uso.ordenesAbiertas > 0) {
    return negar(
      "TIENE_ORDENES_ABIERTAS",
      `Tiene ${uso.ordenesAbiertas} ${uso.ordenesAbiertas === 1 ? "orden abierta" : "órdenes abiertas"}: reasígnalas primero`,
    );
  }
  if (uso.programacionesActivas > 0) {
    return negar(
      "TIENE_PROGRAMACIONES",
      `Es el técnico de ${uso.programacionesActivas} ${uso.programacionesActivas === 1 ? "visita recurrente" : "visitas recurrentes"}: cambia el técnico primero`,
    );
  }
  return PERMITIDO;
}
