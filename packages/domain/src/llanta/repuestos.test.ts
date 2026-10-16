import { describe, it, expect } from "vitest";
import {
  esRepuesto, etiquetaPosicion, nombrePosicion, posicionRepuesto, repuestosDeLaOrden, repuestosTrasInspeccion,
} from "./repuestos";

describe("llantas de repuesto", () => {
  it("se numeran aparte de las posiciones de eje", () => {
    expect(posicionRepuesto(1)).toBe(101);
    expect(esRepuesto(101)).toBe(true);
    expect(esRepuesto(60)).toBe(false);
    expect(esRepuesto(100)).toBe(false);
    expect(esRepuesto(111)).toBe(false);
    expect(nombrePosicion(102)).toBe("Repuesto 2");
    expect(nombrePosicion(3)).toBe("Posición 3");
    expect(etiquetaPosicion(101)).toBe("R1");
    expect(etiquetaPosicion(7)).toBe("7");
  });

  it("la orden muestra los que el vehículo recuerda, o más si se agregó uno", () => {
    expect(repuestosDeLaOrden(2, [1, 2, 3])).toBe(2);
    expect(repuestosDeLaOrden(1, [101, 103])).toBe(3);
    expect(repuestosDeLaOrden(0, [])).toBe(0);
  });

  it("tras una inspección completa recuerda hasta el último que se midió", () => {
    expect(repuestosTrasInspeccion("preventivo", 2, [1, 101])).toBe(1);
    expect(repuestosTrasInspeccion("levantamiento", 0, [101, 102])).toBe(2);
    expect(repuestosTrasInspeccion("preventivo", 2, [1, 2])).toBe(0);
  });

  it("un correctivo no olvida los repuestos que no revisó", () => {
    expect(repuestosTrasInspeccion("correctivo", 2, [3])).toBe(2);
    expect(repuestosTrasInspeccion("correctivo", 1, [102])).toBe(2);
  });
});
