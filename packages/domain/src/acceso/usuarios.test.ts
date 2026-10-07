import { describe, it, expect } from "vitest";
import {
  expiracionActivacion,
  generarCodigoActivacion,
  normalizarCodigoActivacion,
  puedeDesactivarUsuario,
  puedeAsignarRol,
  puedeGestionarUsuarios,
  rolesAsignables,
} from "./usuarios";

describe("alta de usuarios", () => {
  it("solo el administrador", () => {
    expect(puedeGestionarUsuarios("administrador")).toBe(true);
    expect(puedeGestionarUsuarios("coordinador")).toBe(false);
    expect(puedeAsignarRol("coordinador", "tecnico").codigo).toBe("SIN_PERMISO");
  });

  it("nunca crea superadmin: es de la plataforma", () => {
    expect(rolesAsignables("administrador")).not.toContain("superadmin");
    expect(puedeAsignarRol("administrador", "superadmin").permitido).toBe(false);
    expect(puedeAsignarRol("administrador", "tecnico").permitido).toBe(true);
  });
});

describe("código de activación", () => {
  it("tiene la forma XXXX-XXXX y sin letras confundibles", () => {
    for (let i = 0; i < 200; i++) {
      const c = generarCodigoActivacion();
      expect(c).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(c).not.toMatch(/[O0I1LS5B8Z2]/);
    }
  });

  it("se reconoce como sea que se escriba", () => {
    expect(normalizarCodigoActivacion(" k7m2-x9qp ")).toBe("K7M2X9QP");
    expect(normalizarCodigoActivacion("K7M2 X9QP")).toBe("K7M2X9QP");
  });

  it("vence a las 72 horas", () => {
    const ahora = new Date("2026-10-05T12:00:00Z");
    expect(expiracionActivacion(ahora).toISOString()).toBe("2026-10-08T12:00:00.000Z");
  });
});

describe("desactivar usuarios", () => {
  const libre = { ordenesAbiertas: 0, programacionesActivas: 0 };
  it("solo el administrador, y nunca a sí mismo", () => {
    expect(puedeDesactivarUsuario("administrador", false, libre).permitido).toBe(true);
    expect(puedeDesactivarUsuario("coordinador", false, libre).codigo).toBe("SIN_PERMISO");
    expect(puedeDesactivarUsuario("administrador", true, libre).codigo).toBe("UNO_MISMO");
  });

  it("con trabajo abierto no: primero se reasigna", () => {
    expect(puedeDesactivarUsuario("administrador", false, { ordenesAbiertas: 2, programacionesActivas: 0 }).mensaje).toBe("Tiene 2 órdenes abiertas: reasígnalas primero");
    expect(puedeDesactivarUsuario("administrador", false, { ordenesAbiertas: 0, programacionesActivas: 1 }).codigo).toBe("TIENE_PROGRAMACIONES");
  });
});
