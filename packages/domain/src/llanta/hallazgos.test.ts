import { describe, it, expect } from "vitest";
import { diferenciaDeLados, diferenciaPresion, recomendacionPorLados } from "./hallazgos";

describe("diferencia de lados (R6)", () => {
  it("es el valor absoluto entre exterior e interior", () => {
    expect(diferenciaDeLados({ exterior: 8, interior: 9.5 })).toBe(1.5);
    expect(diferenciaDeLados({ exterior: 9.5, interior: 8 })).toBe(1.5);
  });

  it("sin uno de los dos lados no se inventa", () => {
    expect(diferenciaDeLados({ exterior: 8, interior: null })).toBeNull();
  });

  it("desde 1 mm: en el direccional, alinear; en los demás, calibración y rotación", () => {
    expect(recomendacionPorLados(1, "direccional")).toBe("Alinear, revisar calibración y balanceo");
    expect(recomendacionPorLados(1.2, "traccion")).toBe("Revisar calibración, rotación y balanceo");
    expect(recomendacionPorLados(0.9, "direccional")).toBeNull();
    expect(recomendacionPorLados(null, "direccional")).toBeNull();
  });
});

describe("diferencia de presión (R6)", () => {
  it("encontrada menos recomendada, con signo", () => {
    expect(diferenciaPresion(95, 110)).toBe(-15);
    expect(diferenciaPresion(118, 110)).toBe(8);
    expect(diferenciaPresion(null, 110)).toBeNull();
  });
});
