import { normalizarCodigoActivacion, validarPassword } from "@tiretrack/domain";
import type { ConfigAcceso } from "./ingreso";

/**
 * Activación de la cuenta con el código que entregó el administrador.
 *
 * No hay correo (decisión del usuario): el código llega por WhatsApp. La
 * persona elige su contraseña aquí; nadie más la conoce.
 */

export interface DatosActivacion {
  readonly email: string;
  readonly codigo: string;
  readonly password: string;
  readonly confirmacion: string;
  readonly empresaId?: string;
  readonly codigo2fa?: string;
}

export type ResultadoActivacion =
  | { tipo: "ok" }
  /** Su rol exige doble factor: registrar la app autenticadora antes de terminar. */
  | { tipo: "configurar_2fa"; secreto: string; uri: string }
  | { tipo: "elegir_empresa"; empresas: { id: string; nombre: string }[] }
  | { tipo: "rechazada"; mensaje: string }
  | { tipo: "sin_conexion"; mensaje: string };

export type ProblemaActivacion = { campo: "email" | "codigo" | "password" | "confirmacion"; mensaje: string };

/**
 * Se revisa antes de enviar: un código equivocado cuenta como intento
 * fallido de la cuenta, y gastar uno por un error de tipeo es tirarlo.
 */
export function revisarActivacion(d: DatosActivacion): ProblemaActivacion[] {
  const p: ProblemaActivacion[] = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) p.push({ campo: "email", mensaje: "Escribe tu correo" });
  if (normalizarCodigoActivacion(d.codigo).length !== 8) {
    p.push({ campo: "codigo", mensaje: "El código tiene 8 letras y números, como K7M2-X9QP" });
  }
  // La misma política que el servidor.
  const fuerza = validarPassword(d.password);
  if (!fuerza.permitido) p.push({ campo: "password", mensaje: fuerza.mensaje ?? "Contraseña muy débil" });
  if (d.password !== d.confirmacion) p.push({ campo: "confirmacion", mensaje: "Las contraseñas no coinciden" });
  return p;
}

/** Agrupado de a cuatro, para copiarlo a mano en la app autenticadora sin perderse. */
export function secretoLegible(secreto: string): string {
  return secreto.replace(/(.{4})/g, "$1 ").trim();
}

export async function activar(config: ConfigAcceso, d: DatosActivacion): Promise<ResultadoActivacion> {
  const hacer = config.fetch ?? globalThis.fetch;
  const control = new AbortController();
  const limite = setTimeout(() => control.abort(), config.tiempoLimiteMs ?? 20_000);
  try {
    const r = await hacer(`${config.baseUrl}/auth/activar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: d.email.trim().toLowerCase(),
        codigo: d.codigo.trim(),
        password: d.password,
        ...(d.empresaId ? { empresaId: d.empresaId } : {}),
        ...(d.codigo2fa ? { codigo2fa: d.codigo2fa.replace(/[ \t]/g, "") } : {}),
      }),
      signal: control.signal,
    });
    const cuerpo = (await r.json().catch(() => ({}))) as {
      activada?: boolean;
      configurar2fa?: { secreto: string; uri: string };
      empresas?: { id: string; nombre: string }[];
      error?: { codigo?: string; mensaje?: string };
    };
    if (r.ok && cuerpo.activada) return { tipo: "ok" };
    if (r.ok && cuerpo.configurar2fa) return { tipo: "configurar_2fa", ...cuerpo.configurar2fa };
    if (r.status === 409) return { tipo: "elegir_empresa", empresas: cuerpo.empresas ?? [] };
    if (r.status >= 500) return { tipo: "sin_conexion", mensaje: "El servidor no está respondiendo. Inténtalo en un momento" };
    return { tipo: "rechazada", mensaje: cuerpo.error?.mensaje ?? "No se pudo activar la cuenta" };
  } catch {
    return { tipo: "sin_conexion", mensaje: "No hay señal. Activar la cuenta necesita conexión" };
  } finally {
    clearTimeout(limite);
  }
}
