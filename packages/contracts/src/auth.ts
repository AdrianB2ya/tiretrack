import { z } from "zod";
import { zId, zRol, zTextoCorto } from "./comunes";

/**
 * Autenticación.
 *
 * El correo es único POR EMPRESA, no globalmente: la misma persona puede
 * trabajar para dos empresas suscritas. Por eso el login puede requerir
 * indicar la empresa cuando el correo aparece en más de una.
 */

export const zLogin = z.object({
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  password: z.string().min(1, "La contraseña es obligatoria"),
  /** Necesario solo si el correo existe en más de una empresa. */
  empresaId: zId.optional(),
  /** Código TOTP cuando el usuario tiene doble factor activo. */
  codigo2fa: z.string().regex(/^\d{6}$/).optional(),
});
export type Login = z.infer<typeof zLogin>;

export const zUsuarioSesion = z.object({
  id: zId,
  nombre: zTextoCorto,
  email: z.string().email(),
  rol: zRol,
  empresaId: zId.nullable(),
  /** Solo cuando rol = cliente: limita lo que puede ver. */
  clienteId: zId.nullable(),
  sedes: z.array(zId),
  sedePrincipal: zId.nullable(),
});
export type UsuarioSesion = z.infer<typeof zUsuarioSesion>;

export const zRespuestaLogin = z.object({
  token: z.string(),
  refreshToken: z.string(),
  expiraEn: z.number().int(),
  usuario: zUsuarioSesion,
});
export type RespuestaLogin = z.infer<typeof zRespuestaLogin>;

/**
 * Cuando el correo existe en varias empresas, el servidor no elige por el
 * usuario: devuelve las opciones para que él indique cuál.
 */
export const zRespuestaEligeEmpresa = z.object({
  requiereEmpresa: z.literal(true),
  empresas: z.array(z.object({ id: zId, nombre: zTextoCorto })),
});
export type RespuestaEligeEmpresa = z.infer<typeof zRespuestaEligeEmpresa>;

export const zRespuestaRequiere2fa = z.object({
  requiere2fa: z.literal(true),
});

export const zRefresh = z.object({ refreshToken: z.string().min(1) });

export const zSolicitarRecuperacion = z.object({
  email: z.string().trim().toLowerCase().email(),
});

/**
 * La respuesta es la misma exista o no el correo: revelar cuáles están
 * registrados permite enumerar usuarios.
 */
export const zRespuestaRecuperacion = z.object({
  mensaje: z.literal("Si el correo existe, enviamos instrucciones"),
});

export const zRestablecerPassword = z
  .object({
    token: z.string().min(20),
    password: z
      .string()
      .min(10, "Mínimo 10 caracteres")
      .max(128)
      .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v),
        "Debe combinar mayúsculas, minúsculas y números"),
    confirmacion: z.string(),
  })
  .refine((d) => d.password === d.confirmacion, {
    message: "Las contraseñas no coinciden",
    path: ["confirmacion"],
  });
export type RestablecerPassword = z.infer<typeof zRestablecerPassword>;
