import { describe, it, expect } from "vitest";
import { LIMITES_POR_DEFECTO, nivelDeCambio, umbralesDeCambio, validarLimites } from "./limites";

describe("límites de cambio por empresa (R2)", () => {
  it("por defecto, los del ejemplo del usuario: 3 mm inmediato, 5 mm programar", () => {
    expect(LIMITES_POR_DEFECTO).toEqual({ cambioInmediato: 3, programarCambio: 5 });
  });

  it("el límite se incluye: 3 mm es cambio inmediato", () => {
    const u = umbralesDeCambio(null, LIMITES_POR_DEFECTO);
    expect(nivelDeCambio(3, u)).toBe("cambio_inmediato");
    expect(nivelDeCambio(3.1, u)).toBe("programar_cambio");
    expect(nivelDeCambio(5, u)).toBe("programar_cambio");
    expect(nivelDeCambio(5.1, u)).toBeNull();
  });

  it("sin medida no hay nivel: un dato faltante no es un dato malo", () => {
    expect(nivelDeCambio(null, umbralesDeCambio(null, LIMITES_POR_DEFECTO))).toBeNull();
  });

  it("el mínimo del eje manda y corre la banda preventiva con él", () => {
    // Direccional que exige 4: inmediato a 4, programar desde 6 (banda de 2).
    expect(umbralesDeCambio(4, LIMITES_POR_DEFECTO)).toEqual({ inmediato: 4, programar: 6 });
    // Un eje más permisivo no baja el preventivo de la empresa.
    expect(umbralesDeCambio(2.5, LIMITES_POR_DEFECTO)).toEqual({ inmediato: 2.5, programar: 5 });
  });

  it("cada empresa con sus límites", () => {
    const u = umbralesDeCambio(null, { cambioInmediato: 4, programarCambio: 7 });
    expect(nivelDeCambio(3.5, u)).toBe("cambio_inmediato");
    expect(nivelDeCambio(6, u)).toBe("programar_cambio");
  });

  it("rechaza límites incoherentes", () => {
    expect(validarLimites({ cambioInmediato: 0, programarCambio: 5 }).permitido).toBe(false);
    expect(validarLimites({ cambioInmediato: 5, programarCambio: 5 }).permitido).toBe(false);
    expect(validarLimites({ cambioInmediato: 3, programarCambio: 40 }).permitido).toBe(false);
    expect(validarLimites({ cambioInmediato: 3, programarCambio: 5 }).permitido).toBe(true);
  });
});
