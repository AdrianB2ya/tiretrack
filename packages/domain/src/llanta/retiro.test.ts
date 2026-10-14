import { describe, it, expect } from "vitest";
import { esFalla, evaluarCambioReclamo, retirosSinFoto, siguientesReclamo } from "./retiro";

describe("retiro y fallas (R10)", () => {
  it("el desgaste normal no es una falla; el corte sí", () => {
    expect(esFalla("desgaste_normal")).toBe(false);
    expect(esFalla("corte")).toBe(true);
    expect(esFalla(null)).toBe(false);
  });

  it("una falla sin foto impide enviar; con foto o por desgaste, no", () => {
    const fotos = new Map([[2, 1]]);
    expect(
      retirosSinFoto(
        [
          { posicion: 3, motivoRetiro: "corte" },
          { posicion: 2, motivoRetiro: "impacto" },
          { posicion: 1, motivoRetiro: "desgaste_normal" },
        ],
        fotos,
      ),
    ).toEqual([3]);
  });
});

describe("reclamos de garantía (R10)", () => {
  it("abierto → enviado → aprobado o rechazado → cerrado", () => {
    expect(siguientesReclamo("abierto")).toEqual(["enviado", "cerrado"]);
    expect(evaluarCambioReclamo("enviado", "rechazado").permitido).toBe(true);
    expect(evaluarCambioReclamo("abierto", "aprobado").codigo).toBe("TRANSICION_INVALIDA");
  });

  it("aprobar exige decir cuánto se reconoció", () => {
    expect(evaluarCambioReclamo("enviado", "aprobado").codigo).toBe("VALOR_REQUERIDO");
    expect(evaluarCambioReclamo("enviado", "aprobado", 450000).permitido).toBe(true);
  });
});
