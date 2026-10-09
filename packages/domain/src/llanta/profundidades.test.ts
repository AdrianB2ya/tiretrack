import { describe, it, expect } from "vitest";
import { describirProfundidades, profundidadDeReferencia, puntosSinMedir } from "./profundidades";

describe("tres profundidades", () => {
  it("la de la llanta es la mínima: se cambia por su punto más gastado", () => {
    expect(profundidadDeReferencia({ exterior: 9.5, centro: 9, interior: 8.5 })).toBe(8.5);
  });

  it("basta una; sin ninguna no hay profundidad", () => {
    expect(profundidadDeReferencia({ centro: 7 })).toBe(7);
    expect(profundidadDeReferencia({})).toBeNull();
    expect(profundidadDeReferencia(null)).toBeNull();
    expect(profundidadDeReferencia({ exterior: null, centro: undefined })).toBeNull();
  });

  it("cero es una medida, no una falta", () => {
    expect(profundidadDeReferencia({ exterior: 0, centro: 3 })).toBe(0);
  });

  it("dice cuáles faltan, para avisar sin bloquear", () => {
    expect(puntosSinMedir({ centro: 7 })).toEqual(["exterior", "interior"]);
    expect(puntosSinMedir({ exterior: 1, centro: 2, interior: 3 })).toEqual([]);
  });

  it("se describen con coma y un guion donde no se midió", () => {
    expect(describirProfundidades({ exterior: 9.5, interior: 8.5 })).toBe("9,5 · – · 8,5");
    expect(describirProfundidades({})).toBe("");
  });
});
