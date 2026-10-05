import { describe, it, expect } from "vitest";
import {
  validarPassword,
  estaBloqueado,
  minutosRestantesDeBloqueo,
  registrarIntentoFallido,
  registrarIntentoExitoso,
  evaluarAcceso,
  requiereDobleFactor,
  tokenRecuperacionUtilizable,
  sesionVigente,
  expiracionAcceso,
  expiracionRefresh,
  expiracionRecuperacion,
  INTENTOS_ANTES_DE_BLOQUEAR,
  MINUTOS_BLOQUEO,
  type ContextoAcceso,
  type EstadoAcceso,
} from "./politica";

const AHORA = new Date("2026-09-14T10:00:00.000Z");
const sano: EstadoAcceso = { intentosFallidos: 0, bloqueadoHasta: null, activo: true };

const acceso = (extra: Partial<ContextoAcceso> = {}): ContextoAcceso => ({
  estado: sano,
  passwordCorrecta: true,
  rol: "tecnico",
  dobleFactorActivo: false,
  codigo2faPresente: false,
  codigo2faValido: false,
  ahora: AHORA,
  ...extra,
});

describe("política de contraseñas", () => {
  it("acepta una contraseña con longitud y variedad", () => {
    expect(validarPassword("Llantas2026").permitido).toBe(true);
  });

  it("rechaza las cortas", () => {
    expect(validarPassword("Corta1").codigo).toBe("PASSWORD_CORTA");
  });

  it("rechaza las absurdamente largas", () => {
    expect(validarPassword("A1" + "x".repeat(200)).codigo).toBe("PASSWORD_LARGA");
  });

  it("exige mezclar mayúsculas, minúsculas y números", () => {
    expect(validarPassword("solominusculas").codigo).toBe("PASSWORD_DEBIL");
    expect(validarPassword("SOLOMAYUSCULAS1").codigo).toBe("PASSWORD_DEBIL");
    expect(validarPassword("SinNumerosAqui").codigo).toBe("PASSWORD_DEBIL");
  });
});

describe("bloqueo por intentos fallidos", () => {
  it("cuenta los intentos sin bloquear antes del tope", () => {
    const r = registrarIntentoFallido({ ...sano, intentosFallidos: 2 }, AHORA);
    expect(r.intentosFallidos).toBe(3);
    expect(r.bloqueadoHasta).toBeNull();
  });

  it("bloquea al llegar al tope", () => {
    const r = registrarIntentoFallido(
      { ...sano, intentosFallidos: INTENTOS_ANTES_DE_BLOQUEAR - 1 },
      AHORA,
    );
    expect(r.bloqueadoHasta).not.toBeNull();
    const minutos = ((r.bloqueadoHasta as Date).getTime() - AHORA.getTime()) / 60_000;
    expect(minutos).toBe(MINUTOS_BLOQUEO);
  });

  it("el bloqueo es temporal, no permanente", () => {
    // Un bloqueo eterno sería una negación de servicio contra el propio
    // usuario a quien le conozcan el correo.
    const estado = { ...sano, bloqueadoHasta: new Date(AHORA.getTime() + 5 * 60_000) };
    expect(estaBloqueado(estado, AHORA)).toBe(true);
    const despues = new Date(AHORA.getTime() + 20 * 60_000);
    expect(estaBloqueado(estado, despues)).toBe(false);
  });

  it("informa cuántos minutos faltan", () => {
    const estado = { ...sano, bloqueadoHasta: new Date(AHORA.getTime() + 7 * 60_000) };
    expect(minutosRestantesDeBloqueo(estado, AHORA)).toBe(7);
    expect(minutosRestantesDeBloqueo(sano, AHORA)).toBe(0);
  });

  it("un acceso correcto limpia el contador", () => {
    const r = registrarIntentoExitoso();
    expect(r.intentosFallidos).toBe(0);
    expect(r.bloqueadoHasta).toBeNull();
  });
});

describe("evaluación del acceso", () => {
  it("permite entrar con credenciales correctas", () => {
    expect(evaluarAcceso(acceso()).permitido).toBe(true);
  });

  it("rechaza una contraseña incorrecta", () => {
    expect(evaluarAcceso(acceso({ passwordCorrecta: false })).codigo).toBe(
      "CREDENCIALES_INVALIDAS",
    );
  });

  it("no distingue cuenta inexistente de contraseña incorrecta", () => {
    // Distinguirlas permite averiguar qué cuentas existen.
    const desactivada = evaluarAcceso(acceso({ estado: { ...sano, activo: false } }));
    const malaPassword = evaluarAcceso(acceso({ passwordCorrecta: false }));
    expect(desactivada.codigo).toBe(malaPassword.codigo);
    expect(desactivada.mensaje).toBe(malaPassword.mensaje);
  });

  it("una cuenta bloqueada no entra ni con la contraseña correcta", () => {
    const estado = { ...sano, bloqueadoHasta: new Date(AHORA.getTime() + 10 * 60_000) };
    const r = evaluarAcceso(acceso({ estado }));
    expect(r.codigo).toBe("CUENTA_BLOQUEADA");
    expect(r.mensaje).toContain("10 minutos");
  });

  it("comprueba el bloqueo antes que la contraseña", () => {
    // Si se comprobara después, se podría usar el tiempo de respuesta para
    // saber si la contraseña era correcta.
    const estado = { ...sano, bloqueadoHasta: new Date(AHORA.getTime() + 5 * 60_000) };
    expect(evaluarAcceso(acceso({ estado, passwordCorrecta: false })).codigo).toBe(
      "CUENTA_BLOQUEADA",
    );
  });
});

describe("doble factor", () => {
  it("es obligatorio para administrador y superadmin", () => {
    expect(requiereDobleFactor("administrador", false)).toBe(true);
    expect(requiereDobleFactor("superadmin", false)).toBe(true);
  });

  it("es opcional para los demás roles", () => {
    expect(requiereDobleFactor("tecnico", false)).toBe(false);
    expect(requiereDobleFactor("coordinador", false)).toBe(false);
    expect(requiereDobleFactor("cliente", false)).toBe(false);
  });

  it("si el usuario lo activó, aplica aunque su rol no lo exija", () => {
    expect(requiereDobleFactor("tecnico", true)).toBe(true);
  });

  it("pide el código cuando falta", () => {
    const r = evaluarAcceso(acceso({ rol: "administrador" }));
    expect(r.codigo).toBe("REQUIERE_2FA");
  });

  it("rechaza un código incorrecto", () => {
    const r = evaluarAcceso(
      acceso({ rol: "administrador", codigo2faPresente: true, codigo2faValido: false }),
    );
    expect(r.codigo).toBe("CODIGO_2FA_INVALIDO");
  });

  it("deja entrar con el código correcto", () => {
    const r = evaluarAcceso(
      acceso({ rol: "administrador", codigo2faPresente: true, codigo2faValido: true }),
    );
    expect(r.permitido).toBe(true);
  });

  it("el técnico entra sin código si no lo tiene activo", () => {
    expect(evaluarAcceso(acceso({ rol: "tecnico" })).permitido).toBe(true);
  });
});

describe("caducidad de tokens", () => {
  it("el token de acceso dura minutos, no días", () => {
    const min = (expiracionAcceso(AHORA).getTime() - AHORA.getTime()) / 60_000;
    expect(min).toBe(15);
  });

  it("el de refresco dura días", () => {
    const dias = (expiracionRefresh(AHORA).getTime() - AHORA.getTime()) / (24 * 3600_000);
    expect(dias).toBe(7);
  });

  it("el de recuperación caduca pronto", () => {
    const min = (expiracionRecuperacion(AHORA).getTime() - AHORA.getTime()) / 60_000;
    expect(min).toBe(30);
  });
});

describe("token de recuperación", () => {
  const vigente = { expiraEn: new Date(AHORA.getTime() + 10 * 60_000), usadoEn: null };

  it("sirve si está vigente y sin usar", () => {
    expect(tokenRecuperacionUtilizable(vigente, AHORA).permitido).toBe(true);
  });

  it("no sirve dos veces", () => {
    // Si no se invalidara al usarlo, quien tuviera acceso al correo podría
    // volver a entrar días después.
    const usado = { ...vigente, usadoEn: AHORA };
    expect(tokenRecuperacionUtilizable(usado, AHORA).codigo).toBe("TOKEN_USADO");
  });

  it("no sirve después de caducar", () => {
    const viejo = { expiraEn: new Date(AHORA.getTime() - 60_000), usadoEn: null };
    expect(tokenRecuperacionUtilizable(viejo, AHORA).codigo).toBe("TOKEN_EXPIRADO");
  });

  it("estar usado pesa más que estar vigente", () => {
    const usadoYVigente = { expiraEn: new Date(AHORA.getTime() + 60_000), usadoEn: AHORA };
    expect(tokenRecuperacionUtilizable(usadoYVigente, AHORA).codigo).toBe("TOKEN_USADO");
  });
});

describe("sesiones", () => {
  it("una sesión vigente sirve", () => {
    expect(sesionVigente({ expiraEn: new Date(AHORA.getTime() + 60_000) }, AHORA)).toBe(true);
  });

  it("una sesión revocada no sirve aunque no haya caducado", () => {
    // Cambiar la contraseña debe expulsar de inmediato a quien haya tomado
    // la cuenta.
    const revocada = { expiraEn: new Date(AHORA.getTime() + 3600_000), revocadaEn: AHORA };
    expect(sesionVigente(revocada, AHORA)).toBe(false);
  });

  it("una sesión caducada no sirve", () => {
    expect(sesionVigente({ expiraEn: new Date(AHORA.getTime() - 1000) }, AHORA)).toBe(false);
  });
});
