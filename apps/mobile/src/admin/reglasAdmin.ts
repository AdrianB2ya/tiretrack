import { zCrearSede, zCrearUsuario } from "@tiretrack/contracts";
import type { Rol } from "@tiretrack/domain";

/**
 * Administración de usuarios y sedes: validación y mensajes.
 *
 * Con los mismos contratos que el servidor: lo que pasa aquí, pasa allá.
 */

export const ETIQUETA_ROL_ASIGNABLE: Record<"administrador" | "coordinador" | "tecnico" | "cliente", string> = {
  tecnico: "Técnico",
  coordinador: "Coordinador",
  administrador: "Administrador",
  cliente: "Cliente (portal)",
};

export interface FormUsuario {
  readonly nombre: string;
  readonly cedula: string;
  readonly email: string;
  readonly telefono: string;
  readonly rol: Rol;
  readonly sedes: readonly string[];
  readonly clienteId: string | null;
}

type Issues = { issues: { path: (string | number)[]; message: string }[] };
const problemas = (r: { success: boolean; error?: Issues }) =>
  r.success ? [] : (r.error?.issues ?? []).map((i) => ({ campo: String(i.path[0] ?? ""), mensaje: i.message }));

const ID = "00000000-0000-4000-8000-000000000000";

export function revisarUsuario(f: FormUsuario) {
  return problemas(
    zCrearUsuario.safeParse({
      id: ID,
      nombre: f.nombre,
      cedula: f.cedula,
      email: f.email,
      ...(f.telefono.trim() ? { telefono: f.telefono } : {}),
      rol: f.rol,
      sedes: f.sedes,
      ...(f.rol === "cliente" && f.clienteId ? { clienteId: f.clienteId } : {}),
    }),
  );
}

export function revisarSedeEmpresa(f: { nombre: string; codigo: string; ciudad: string }) {
  return problemas(zCrearSede.safeParse({ id: ID, nombre: f.nombre, codigo: f.codigo, ...(f.ciudad.trim() ? { ciudad: f.ciudad } : {}) }));
}

/**
 * El mensaje para WhatsApp: qué hacer, en orden, sin depender de que la
 * persona sepa qué es Asistectire.
 */
export function mensajeActivacion(nombre: string, codigo: string, expiraEn: string): string {
  const fecha = new Date(expiraEn);
  const vence = Number.isNaN(fecha.getTime())
    ? ""
    : ` Vence el ${fecha.toLocaleDateString("es-CO", { day: "numeric", month: "long" })}.`;
  return (
    `Hola ${nombre.split(" ")[0]}. Tu código para activar Asistectire es ${codigo}. ` +
    `Abre la app, toca «Tengo un código de activación», escribe tu correo y este código, ` +
    `y elige tu contraseña.${vence}`
  );
}
