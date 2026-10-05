import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
// otplib 13 expone funciones sueltas, no el objeto `authenticator` de v12
import { generateSecret, generateURI, verifySync } from "otplib";

/**
 * ¿El código TOTP es válido para este secreto?
 *
 * otplib LANZA si el código no son 6 dígitos. Sin esta guarda, un código mal
 * escrito —o texto pegado por error— hacía responder 500 al login: el
 * celular lo entendía como falla del servidor y el intento no contaba para
 * el bloqueo. Todo lo que no sea un código bien formado es un código
 * incorrecto, nada más.
 */
export function codigoTotpValido(codigo: string, secreto: string): boolean {
  if (!/^[0-9]{6}$/.test(codigo)) return false;
  try {
    return verifySync({ token: codigo, secret: secreto }).valid;
  } catch {
    return false;
  }
}
import { createHash, randomBytes } from "node:crypto";
import {
  evaluarAcceso,
  expiracionAcceso,
  expiracionRecuperacion,
  expiracionRefresh,
  nuevoId,
  registrarIntentoExitoso,
  registrarIntentoFallido,
  requiereDobleFactor,
  tokenRecuperacionUtilizable,
  validarPassword,
  type Veredicto,
} from "@tiretrack/domain";
import type { RepositorioAcceso, UsuarioAcceso } from "./repositorio";

/**
 * Servicio de autenticación.
 *
 * Las reglas —cuántos intentos, cuánto dura un token, quién necesita doble
 * factor— viven en @tiretrack/domain. Aquí solo está lo que necesita
 * infraestructura: cifrar, firmar y persistir.
 */

export const COSTO_BCRYPT = 12;

export interface ConfigAuth {
  readonly jwtSecret: string;
  readonly emisor?: string;
}

export interface Claims {
  readonly sub: string;
  readonly empresaId: string | null;
  readonly rol: string;
  readonly clienteId: string | null;
}

export type ResultadoLogin =
  | { tipo: "ok"; token: string; refreshToken: string; expiraEn: number; usuario: UsuarioAcceso }
  | { tipo: "elegir_empresa"; empresas: { id: string; nombre: string }[] }
  | { tipo: "error"; veredicto: Veredicto };

export class ServicioAuth {
  constructor(
    private readonly repo: RepositorioAcceso,
    private readonly config: ConfigAuth,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async hashearPassword(password: string): Promise<string> {
    return bcrypt.hash(password, COSTO_BCRYPT);
  }

  /**
   * El correo es único POR EMPRESA: la misma persona puede trabajar para dos
   * empresas suscritas. Si aparece en varias y no se indicó cuál, se
   * devuelven las opciones en vez de elegir por el usuario.
   */
  async login(entrada: {
    email: string;
    password: string;
    empresaId?: string;
    codigo2fa?: string;
    ip?: string;
    dispositivo?: string;
  }): Promise<ResultadoLogin> {
    const ahora = this.reloj();
    const email = entrada.email.trim().toLowerCase();

    const candidatos = await this.repo.buscarPorEmail(email, entrada.empresaId);

    if (candidatos.length === 0) {
      // Se gasta el mismo tiempo que en un login real: si esta rama
      // respondiera de inmediato, medir la demora revelaría qué correos
      // están registrados.
      await bcrypt.compare(entrada.password, "$2a$12$" + "x".repeat(53));
      await this.repo.registrarAuditoria({
        accion: "login_fallido",
        detalle: { email, motivo: "no_existe" },
        ip: entrada.ip,
      });
      return {
        tipo: "error",
        veredicto: {
          permitido: false,
          codigo: "CREDENCIALES_INVALIDAS",
          mensaje: "Correo o contraseña incorrectos",
        },
      };
    }

    if (candidatos.length > 1) {
      return {
        tipo: "elegir_empresa",
        empresas: candidatos.map((u) => ({
          id: u.empresaId ?? "",
          nombre: u.empresaNombre ?? "",
        })),
      };
    }

    const usuario = candidatos[0] as UsuarioAcceso;
    const passwordCorrecta = await bcrypt.compare(entrada.password, usuario.passwordHash);

    const codigoPresente = !!entrada.codigo2fa;
    const codigoValido =
      codigoPresente && usuario.dobleFactorSecreto
        ? codigoTotpValido(entrada.codigo2fa as string, usuario.dobleFactorSecreto)
        : false;

    const veredicto = evaluarAcceso({
      estado: {
        intentosFallidos: usuario.intentosFallidos,
        bloqueadoHasta: usuario.bloqueadoHasta,
        activo: usuario.activo,
      },
      passwordCorrecta,
      rol: usuario.rol,
      dobleFactorActivo: usuario.dobleFactorActivo,
      codigo2faPresente: codigoPresente,
      codigo2faValido: codigoValido,
      ahora,
    });

    if (!veredicto.permitido) {
      // Pedir el segundo factor no es un intento fallido: la contraseña era
      // correcta. Contarlo bloquearía a quien simplemente abre el diálogo.
      if (veredicto.codigo !== "REQUIERE_2FA") {
        const r = registrarIntentoFallido(
          {
            intentosFallidos: usuario.intentosFallidos,
            bloqueadoHasta: usuario.bloqueadoHasta,
            activo: usuario.activo,
          },
          ahora,
        );
        await this.repo.actualizarIntentos(usuario.id, r.intentosFallidos, r.bloqueadoHasta);
        await this.repo.registrarAuditoria({
          empresaId: usuario.empresaId,
          usuarioId: usuario.id,
          accion: "login_fallido",
          detalle: { motivo: veredicto.codigo, intentos: r.intentosFallidos },
          ip: entrada.ip,
        });
      }
      return { tipo: "error", veredicto };
    }

    const limpio = registrarIntentoExitoso();
    await this.repo.actualizarIntentos(usuario.id, limpio.intentosFallidos, limpio.bloqueadoHasta);
    await this.repo.marcarAcceso(usuario.id, ahora);

    const token = this.firmarAcceso(usuario, ahora);
    const refreshToken = await this.crearRefresh(usuario, ahora, entrada);

    await this.repo.registrarAuditoria({
      empresaId: usuario.empresaId,
      usuarioId: usuario.id,
      accion: "login_exitoso",
      ip: entrada.ip,
    });

    return {
      tipo: "ok",
      token,
      refreshToken,
      expiraEn: Math.floor(expiracionAcceso(ahora).getTime() / 1000),
      usuario,
    };
  }

  private firmarAcceso(usuario: UsuarioAcceso, ahora: Date): string {
    const claims: Claims = {
      sub: usuario.id,
      empresaId: usuario.empresaId,
      rol: usuario.rol,
      clienteId: usuario.clienteId,
    };
    const segundos = Math.floor((expiracionAcceso(ahora).getTime() - ahora.getTime()) / 1000);
    return jwt.sign(claims, this.config.jwtSecret, {
      expiresIn: segundos,
      issuer: this.config.emisor ?? "tiretrack",
    });
  }

  /**
   * El refresh se guarda HASHEADO. Si alguien lee la base de datos, no
   * obtiene sesiones utilizables: el token en claro solo lo tiene el cliente.
   */
  private async crearRefresh(
    usuario: UsuarioAcceso,
    ahora: Date,
    ctx: { ip?: string; dispositivo?: string },
  ): Promise<string> {
    const enClaro = randomBytes(48).toString("base64url");
    await this.repo.crearSesion({
      id: nuevoId(),
      usuarioId: usuario.id,
      refreshHash: hashear(enClaro),
      expiraEn: expiracionRefresh(ahora),
      ip: ctx.ip ?? null,
      dispositivo: ctx.dispositivo ?? null,
    });
    return enClaro;
  }

  /** Rotación: cada uso entrega un refresh nuevo y revoca el anterior. */
  async refrescar(
    refreshToken: string,
    ctx: { ip?: string; dispositivo?: string } = {},
  ): Promise<ResultadoLogin> {
    const ahora = this.reloj();
    const sesion = await this.repo.buscarSesionPorHash(hashear(refreshToken));

    if (!sesion || sesion.revocadaEn || sesion.expiraEn.getTime() <= ahora.getTime()) {
      return {
        tipo: "error",
        veredicto: {
          permitido: false,
          codigo: "SESION_INVALIDA",
          mensaje: "La sesión expiró. Vuelve a ingresar",
        },
      };
    }

    const usuario = await this.repo.buscarPorId(sesion.usuarioId);
    if (!usuario || !usuario.activo) {
      await this.repo.revocarSesion(sesion.id, ahora);
      return {
        tipo: "error",
        veredicto: {
          permitido: false,
          codigo: "SESION_INVALIDA",
          mensaje: "La sesión expiró. Vuelve a ingresar",
        },
      };
    }

    await this.repo.revocarSesion(sesion.id, ahora);
    const nuevoRefresh = await this.crearRefresh(usuario, ahora, ctx);

    return {
      tipo: "ok",
      token: this.firmarAcceso(usuario, ahora),
      refreshToken: nuevoRefresh,
      expiraEn: Math.floor(expiracionAcceso(ahora).getTime() / 1000),
      usuario,
    };
  }

  verificarToken(token: string): Claims | null {
    try {
      return jwt.verify(token, this.config.jwtSecret, {
        issuer: this.config.emisor ?? "tiretrack",
      }) as Claims;
    } catch {
      return null;
    }
  }

  /**
   * Devuelve siempre lo mismo, exista o no el correo. Revelar cuáles están
   * registrados permite enumerar usuarios de la plataforma.
   */
  async solicitarRecuperacion(
    email: string,
    ip?: string,
  ): Promise<{ tokenEnClaro: string | null }> {
    const ahora = this.reloj();
    const candidatos = await this.repo.buscarPorEmail(email.trim().toLowerCase());
    if (candidatos.length === 0) return { tokenEnClaro: null };

    const usuario = candidatos[0] as UsuarioAcceso;
    const enClaro = randomBytes(32).toString("base64url");

    await this.repo.crearTokenRecuperacion({
      id: nuevoId(),
      usuarioId: usuario.id,
      tokenHash: hashear(enClaro),
      expiraEn: expiracionRecuperacion(ahora),
      ipSolicitud: ip ?? null,
    });

    await this.repo.registrarAuditoria({
      empresaId: usuario.empresaId,
      usuarioId: usuario.id,
      accion: "recuperar_password",
      ip,
    });

    return { tokenEnClaro: enClaro };
  }

  async restablecerPassword(tokenEnClaro: string, password: string): Promise<Veredicto> {
    const ahora = this.reloj();

    const fuerza = validarPassword(password);
    if (!fuerza.permitido) return fuerza;

    const token = await this.repo.buscarTokenRecuperacion(hashear(tokenEnClaro));
    if (!token) {
      return { permitido: false, codigo: "TOKEN_INVALIDO", mensaje: "Enlace no válido" };
    }

    const utilizable = tokenRecuperacionUtilizable(token, ahora);
    if (!utilizable.permitido) return utilizable;

    await this.repo.cambiarPassword(token.usuarioId, await this.hashearPassword(password), ahora);
    await this.repo.marcarTokenUsado(token.id, ahora);

    // Cambiar la contraseña expulsa a quien haya tomado la cuenta.
    await this.repo.revocarSesionesDeUsuario(token.usuarioId, ahora);

    return { permitido: true };
  }

  /** Alta del doble factor. El secreto solo se muestra al configurarlo. */
  generarSecreto2fa(email: string, empresa: string): { secreto: string; uri: string } {
    const secreto = generateSecret();
    return {
      secreto,
      uri: generateURI({ secret: secreto, label: email, issuer: `TireTrack (${empresa})` }),
    };
  }

  verificarCodigo2fa(codigo: string, secreto: string): boolean {
    return codigoTotpValido(codigo, secreto);
  }

  necesita2fa(rol: string, activo: boolean): boolean {
    return requiereDobleFactor(rol, activo);
  }
}

/** SHA-256: los tokens son aleatorios de 256+ bits, no necesitan bcrypt. */
export function hashear(valor: string): string {
  return createHash("sha256").update(valor).digest("hex");
}
