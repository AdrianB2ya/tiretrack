import { type Veredicto, PERMITIDO, negar } from "../tipos";

/**
 * Reglas de acceso.
 *
 * Van en el dominio porque el bloqueo por intentos, la caducidad de los
 * tokens y la exigencia de doble factor son decisiones de negocio, no
 * detalles de infraestructura. Aquí se prueban sin base de datos ni red.
 */

// ── Política de contraseñas ─────────────────────────────────────────────────

export const LARGO_MINIMO_PASSWORD = 10;
export const LARGO_MAXIMO_PASSWORD = 128;

/**
 * Se exige longitud y variedad, no una lista de reglas arbitrarias. Las
 * políticas muy rebuscadas empujan a la gente a escribir la contraseña en un
 * papel pegado al monitor, que es peor.
 */
export function validarPassword(password: string): Veredicto {
  if (password.length < LARGO_MINIMO_PASSWORD) {
    return negar("PASSWORD_CORTA", `Mínimo ${LARGO_MINIMO_PASSWORD} caracteres`);
  }
  if (password.length > LARGO_MAXIMO_PASSWORD) {
    return negar("PASSWORD_LARGA", `Máximo ${LARGO_MAXIMO_PASSWORD} caracteres`);
  }
  const tieneMinuscula = /[a-z]/.test(password);
  const tieneMayuscula = /[A-Z]/.test(password);
  const tieneNumero = /\d/.test(password);
  if (!tieneMinuscula || !tieneMayuscula || !tieneNumero) {
    return negar("PASSWORD_DEBIL", "Debe combinar mayúsculas, minúsculas y números");
  }
  return PERMITIDO;
}

// ── Bloqueo por intentos fallidos ───────────────────────────────────────────

export const INTENTOS_ANTES_DE_BLOQUEAR = 5;
export const MINUTOS_BLOQUEO = 15;

export interface EstadoAcceso {
  readonly intentosFallidos: number;
  readonly bloqueadoHasta?: Date | null;
  readonly activo: boolean;
}

/** Bloqueo temporal, no permanente: un bloqueo eterno es una negación de
 * servicio contra el propio usuario si alguien conoce su correo. */
export function estaBloqueado(estado: EstadoAcceso, ahora: Date): boolean {
  if (!estado.bloqueadoHasta) return false;
  return estado.bloqueadoHasta.getTime() > ahora.getTime();
}

export function minutosRestantesDeBloqueo(estado: EstadoAcceso, ahora: Date): number {
  if (!estaBloqueado(estado, ahora)) return 0;
  const ms = (estado.bloqueadoHasta as Date).getTime() - ahora.getTime();
  return Math.ceil(ms / 60_000);
}

export interface ResultadoIntento {
  readonly intentosFallidos: number;
  readonly bloqueadoHasta: Date | null;
}

/** Suma un intento fallido y bloquea al llegar al tope. */
export function registrarIntentoFallido(estado: EstadoAcceso, ahora: Date): ResultadoIntento {
  const intentos = estado.intentosFallidos + 1;
  if (intentos >= INTENTOS_ANTES_DE_BLOQUEAR) {
    return {
      intentosFallidos: intentos,
      bloqueadoHasta: new Date(ahora.getTime() + MINUTOS_BLOQUEO * 60_000),
    };
  }
  return { intentosFallidos: intentos, bloqueadoHasta: null };
}

/** El acceso correcto limpia el contador. */
export function registrarIntentoExitoso(): ResultadoIntento {
  return { intentosFallidos: 0, bloqueadoHasta: null };
}

// ── Evaluación del intento de acceso ────────────────────────────────────────

export interface ContextoAcceso {
  readonly estado: EstadoAcceso;
  readonly passwordCorrecta: boolean;
  readonly rol: string;
  readonly dobleFactorActivo: boolean;
  readonly codigo2faPresente: boolean;
  readonly codigo2faValido: boolean;
  readonly ahora: Date;
}

/**
 * Roles que exigen doble factor por su nivel de acceso. El administrador
 * gestiona usuarios y clientes; el superadmin cruza empresas.
 */
export const ROLES_CON_2FA_OBLIGATORIO = ["superadmin", "administrador"];

export function requiereDobleFactor(rol: string, dobleFactorActivo: boolean): boolean {
  return dobleFactorActivo || ROLES_CON_2FA_OBLIGATORIO.includes(rol);
}

export function evaluarAcceso(c: ContextoAcceso): Veredicto {
  if (!c.estado.activo) {
    // Mismo mensaje que credenciales inválidas: distinguirlos permite
    // averiguar qué cuentas existen.
    return negar("CREDENCIALES_INVALIDAS", "Correo o contraseña incorrectos");
  }
  if (estaBloqueado(c.estado, c.ahora)) {
    const min = minutosRestantesDeBloqueo(c.estado, c.ahora);
    return negar("CUENTA_BLOQUEADA", `Demasiados intentos. Reintenta en ${min} minutos`);
  }
  if (!c.passwordCorrecta) {
    return negar("CREDENCIALES_INVALIDAS", "Correo o contraseña incorrectos");
  }
  if (requiereDobleFactor(c.rol, c.dobleFactorActivo)) {
    if (!c.codigo2faPresente) {
      return negar("REQUIERE_2FA", "Ingresa el código de verificación");
    }
    if (!c.codigo2faValido) {
      return negar("CODIGO_2FA_INVALIDO", "Código de verificación incorrecto");
    }
  }
  return PERMITIDO;
}

// ── Tokens ──────────────────────────────────────────────────────────────────

export const MINUTOS_TOKEN_ACCESO = 15;
export const DIAS_TOKEN_REFRESH = 7;
export const MINUTOS_TOKEN_RECUPERACION = 30;

export function expiracionAcceso(ahora: Date): Date {
  return new Date(ahora.getTime() + MINUTOS_TOKEN_ACCESO * 60_000);
}

export function expiracionRefresh(ahora: Date): Date {
  return new Date(ahora.getTime() + DIAS_TOKEN_REFRESH * 24 * 60 * 60_000);
}

export function expiracionRecuperacion(ahora: Date): Date {
  return new Date(ahora.getTime() + MINUTOS_TOKEN_RECUPERACION * 60_000);
}

export interface TokenRecuperacion {
  readonly expiraEn: Date;
  readonly usadoEn?: Date | null;
}

/**
 * Un token de recuperación sirve UNA vez y caduca. Si no se invalidara al
 * usarlo, quien tuviera acceso al correo podría volver a entrar días después.
 */
export function tokenRecuperacionUtilizable(token: TokenRecuperacion, ahora: Date): Veredicto {
  if (token.usadoEn) {
    return negar("TOKEN_USADO", "Este enlace ya se utilizó. Solicita uno nuevo");
  }
  if (token.expiraEn.getTime() <= ahora.getTime()) {
    return negar("TOKEN_EXPIRADO", "El enlace caducó. Solicita uno nuevo");
  }
  return PERMITIDO;
}

export interface Sesion {
  readonly expiraEn: Date;
  readonly revocadaEn?: Date | null;
}

export function sesionVigente(sesion: Sesion, ahora: Date): boolean {
  if (sesion.revocadaEn) return false;
  return sesion.expiraEn.getTime() > ahora.getTime();
}

/**
 * Acciones que obligan a cerrar todas las sesiones abiertas: si alguien tomó
 * la cuenta, cambiar la contraseña debe expulsarlo de inmediato.
 */
export const MOTIVOS_REVOCACION = [
  "cambio_password",
  "usuario_desactivado",
  "cierre_manual",
  "sospecha_compromiso",
] as const;
export type MotivoRevocacion = (typeof MOTIVOS_REVOCACION)[number];

export function debeRevocarSesiones(motivo: MotivoRevocacion): boolean {
  return MOTIVOS_REVOCACION.includes(motivo);
}
