import { describe, it, expect } from "vitest";
import { textoVencimientoDOT } from "./dot";


describe("texto de vencimiento (R5)", () => {
  const hoy = new Date("2026-10-14T12:00:00Z");
  it("dice cuándo vence, en mes y año", () => {
    expect(textoVencimientoDOT("3624", hoy)).toBe("Vence 09/2030");
  });
  it("con menos de un año, lo marca por vencer", () => {
    expect(textoVencimientoDOT("0121", hoy)).toBe("Por vencer: 01/2027");
  });
  it("vencida lo dice con todas las letras", () => {
    expect(textoVencimientoDOT("0819", hoy)).toBe("VENCIDA desde 02/2025");
  });
  it("sin DOT legible no inventa fecha", () => {
    expect(textoVencimientoDOT("ABC", hoy)).toBeNull();
    expect(textoVencimientoDOT(null, hoy)).toBeNull();
  });
});
