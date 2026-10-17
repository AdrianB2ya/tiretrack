import { describe, it, expect } from "vitest";
import { matrizQR, rutaQR } from "../diseno/CodigoQR";

/** El QR se arma en el teléfono: si la matriz sale mal, ninguna cámara lo lee. */
describe("código QR", () => {
  const m = matrizQR("otpauth://totp/Asistectire:m@x.co?secret=JBSWY3DPEHPK3PXP&issuer=Asistectire");

  it("es cuadrado y de un tamaño válido (21 + 4 por versión)", () => {
    expect(m.every((f) => f.length === m.length)).toBe(true);
    expect((m.length - 21) % 4).toBe(0);
  });

  it("tiene los tres cuadros de posición en las esquinas", () => {
    const n = m.length;
    // Borde exterior de 7×7 oscuro, anillo claro, centro de 3×3 oscuro.
    for (const [f0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
      for (let i = 0; i < 7; i++) {
        expect(m[f0]![c0 + i]).toBe(true);
        expect(m[f0 + 6]![c0 + i]).toBe(true);
        expect(m[f0 + i]![c0]).toBe(true);
        expect(m[f0 + i]![c0 + 6]).toBe(true);
      }
      expect(m[f0 + 1]![c0 + 1]).toBe(false);
      expect(m[f0 + 3]![c0 + 3]).toBe(true);
    }
  });

  it("la ruta tiene un cuadro por módulo oscuro", () => {
    const oscuros = m.flat().filter(Boolean).length;
    expect(rutaQR(m).split("M").length - 1).toBe(oscuros);
  });

  it("el mismo texto da el mismo código", () => {
    expect(matrizQR("abc")).toEqual(matrizQR("abc"));
  });
});
