import type { UsuarioSesion } from "./servicio";

/**
 * Ingreso: validación del formulario y llamada al servidor.
 *
 * Separado de la pantalla para poder probar las reglas sin montar nada, y
 * porque el ingreso es lo único que el celular NO puede hacer sin señal: la
 * primera vez hay que llegar al servidor sí o sí.
 */

export interface Credenciales {
  readonly email: string;
  readonly password: string;
  /** Solo cuando el correo existe en varias empresas y ya se eligió una. */
  readonly empresaId?: string;
  /** Código de la app autenticadora, cuando el rol exige doble factor. */
  readonly codigo2fa?: string;
}

export type ResultadoIngreso =
  | { tipo: "ok"; token: string; refreshToken: string; usuario: UsuarioSesion }
  /** El mismo correo existe en varias empresas: hay que elegir. */
  | { tipo: "elegir_empresa"; empresas: { id: string; nombre: string }[] }
  /** Credenciales, cuenta bloqueada o inactiva. El servidor no distingue. */
  | { tipo: "credenciales"; mensaje: string }
  /** No se llegó al servidor. Reintentar sirve; cambiar la clave no. */
  | { tipo: "sin_conexion"; mensaje: string }
  /** Contraseña correcta; falta el código de la app autenticadora. */
  | { tipo: "requiere_codigo" }
  /** El código no sirvió: mal escrito o ya vencido (dura 30 segundos). */
  | { tipo: "codigo_invalido"; mensaje: string };

/** El código va sin espacios: las apps autenticadoras lo muestran "123 456". */
export function limpiarCodigo(codigo: string): string {
  return codigo.replace(/[ \t\n\r]+/g, "");
}

/**
 * El código se revisa antes de enviarlo: cada intento fallido cuenta para el
 * bloqueo de la cuenta, y gastar uno en un código de cinco dígitos es tirarlo.
 */
export function revisarCodigo(codigo: string): string | null {
  const limpio = limpiarCodigo(codigo);
  if (!limpio) return "Escribe el código de tu app autenticadora";
  if (!/^[0-9]{6}$/.test(limpio)) return "El código tiene 6 números";
  return null;
}

export function validarCorreo(email: string): boolean {
  const limpio = email.trim();
  // Comprobación deliberadamente laxa: el servidor decide. Una validación
  // estricta aquí rechazaría correos válidos raros y dejaría a alguien
  // fuera sin razón.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio);
}

export interface ProblemaFormulario {
  readonly campo: "email" | "password";
  readonly mensaje: string;
}

export function revisarFormulario(c: Credenciales): ProblemaFormulario[] {
  const problemas: ProblemaFormulario[] = [];
  if (!c.email.trim()) problemas.push({ campo: "email", mensaje: "Escribe tu correo" });
  else if (!validarCorreo(c.email)) problemas.push({ campo: "email", mensaje: "Ese correo no parece válido" });
  if (!c.password) problemas.push({ campo: "password", mensaje: "Escribe tu contraseña" });
  return problemas;
}

export interface ConfigAcceso {
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly tiempoLimiteMs?: number;
}

/**
 * Pide una sesión al servidor.
 *
 * Distingue "no se pudo llegar" de "credenciales incorrectas": son dos
 * problemas distintos con dos soluciones distintas, y confundirlos hace que
 * un técnico sin señal cambie su contraseña creyendo que la olvidó.
 */
export async function ingresar(
  config: ConfigAcceso,
  credenciales: Credenciales,
): Promise<ResultadoIngreso> {
  const hacerPeticion = config.fetch ?? globalThis.fetch;
  const control = new AbortController();
  const limite = setTimeout(() => control.abort(), config.tiempoLimiteMs ?? 20_000);

  try {
    const r = await hacerPeticion(`${config.baseUrl}/auth/ingresar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: credenciales.email.trim().toLowerCase(),
        password: credenciales.password,
        ...(credenciales.empresaId ? { empresaId: credenciales.empresaId } : {}),
        ...(credenciales.codigo2fa ? { codigo2fa: limpiarCodigo(credenciales.codigo2fa) } : {}),
      }),
      signal: control.signal,
    });

    if (r.status === 409) {
      const cuerpo = (await r.json()) as { empresas?: { id: string; nombre: string }[] };
      return { tipo: "elegir_empresa", empresas: cuerpo.empresas ?? [] };
    }
    if (r.status === 401 || r.status === 422) {
      const cuerpo = (await r.json().catch(() => ({}))) as { error?: { codigo?: string; mensaje?: string } };
      // El doble factor no es un error de credenciales: la contraseña era
      // correcta. Mezclarlos haría que alguien con la clave bien la cambie.
      if (cuerpo.error?.codigo === "REQUIERE_2FA") return { tipo: "requiere_codigo" };
      if (cuerpo.error?.codigo === "CODIGO_2FA_INVALIDO") {
        return {
          tipo: "codigo_invalido",
          mensaje: "Código incorrecto o vencido. Espera a que tu app muestre uno nuevo y escríbelo",
        };
      }
      return { tipo: "credenciales", mensaje: cuerpo.error?.mensaje ?? "Correo o contraseña incorrectos" };
    }
    if (!r.ok) {
      // 5xx: el servidor está mal, no las credenciales. Reintentar sirve.
      return { tipo: "sin_conexion", mensaje: "El servidor no está respondiendo. Inténtalo en un momento" };
    }

    const cuerpo = (await r.json()) as {
      token: string;
      refreshToken: string;
      usuario: UsuarioSesion;
    };
    return { tipo: "ok", token: cuerpo.token, refreshToken: cuerpo.refreshToken, usuario: cuerpo.usuario };
  } catch {
    return {
      tipo: "sin_conexion",
      mensaje: "No hay señal. Busca cobertura para entrar la primera vez",
    };
  } finally {
    clearTimeout(limite);
  }
}
