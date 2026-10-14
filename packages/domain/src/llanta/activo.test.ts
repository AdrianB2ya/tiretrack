import { describe, it, expect } from "vitest";
import { claveIdentificador, estadoTrasDesmontaje, evaluarMovimiento, identificable } from "./activo";

describe("la llanta como activo (R8)", () => {
  it("de bodega se monta, se envía a reencauche o se desecha", () => {
    expect(evaluarMovimiento("bodega", "montaje")).toMatchObject({ permitido: true, hacia: "montada" });
    expect(evaluarMovimiento("bodega", "envio_reencauche")).toMatchObject({ permitido: true, hacia: "reencauche" });
    expect(evaluarMovimiento("bodega", "desecho")).toMatchObject({ permitido: true, hacia: "desecho" });
  });

  it("una montada no se envía a reencauche sin desmontarla", () => {
    const v = evaluarMovimiento("montada", "envio_reencauche");
    expect(v.permitido).toBe(false);
    expect(v.mensaje).toContain("montada");
  });

  it("del reencauche vuelve a bodega; desechada no vuelve", () => {
    expect(evaluarMovimiento("reencauche", "retorno_reencauche")).toMatchObject({ permitido: true, hacia: "bodega" });
    expect(evaluarMovimiento("desecho", "retorno_reencauche").permitido).toBe(false);
    expect(evaluarMovimiento("desecho", "montaje").permitido).toBe(false);
  });

  it("al desmontarla va a donde dijo el técnico; sin destino, a bodega", () => {
    expect(estadoTrasDesmontaje("Desecho")).toBe("desecho");
    expect(estadoTrasDesmontaje("Reencauche")).toBe("reencauche");
    expect(estadoTrasDesmontaje("Reparación")).toBe("reparacion");
    expect(estadoTrasDesmontaje("Inventario")).toBe("bodega");
    expect(estadoTrasDesmontaje(null)).toBe("bodega");
  });

  it("el serial se compara sin espacios, guiones ni mayúsculas", () => {
    expect(claveIdentificador(" mx 1002-3 ")).toBe("MX10023");
    expect(claveIdentificador("")).toBeNull();
  });

  it("sin serial ni número interno no es un activo que se pueda seguir", () => {
    expect(identificable({ serial: null, numeroInterno: null })).toBe(false);
    expect(identificable({ numeroInterno: "A-17" })).toBe(true);
  });
});
