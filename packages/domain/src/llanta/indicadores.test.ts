import { describe, it, expect } from "vitest";
import { indicadoresLlanta, kmRecorridos, referenciaDesgaste } from "./indicadores";

describe("referencia de desgaste (R9)", () => {
  it("sigue la fórmula del Excel, con el 0–50 % como inicio de ciclo", () => {
    expect(referenciaDesgaste(100)).toBe("FINAL 100%");
    expect(referenciaDesgaste(80)).toBe("TENDENCIA DE RENDIMIENTO 71% - 98%");
    expect(referenciaDesgaste(60)).toBe("PROYECCIÓN 50% - 70%");
    expect(referenciaDesgaste(0.5)).toBe("INICIO DE CICLO 0% - 50%");
    expect(referenciaDesgaste(null)).toBeNull();
  });
});

describe("kilómetros recorridos (R9)", () => {
  it("suma por tramos aunque la llanta cambie de vehículo", () => {
    const r = kmRecorridos(
      [
        { tipo: "montaje", kilometraje: 100_000, fecha: "2026-01-01" },
        { tipo: "desmontaje", kilometraje: 130_000, fecha: "2026-04-01" },
        // Otro camión, otro odómetro.
        { tipo: "montaje", kilometraje: 20_000, fecha: "2026-05-01" },
      ],
      35_000,
    );
    expect(r).toEqual({ kmMontaje: 20_000, kmRecorrido: 45_000 });
  });

  it("un tramo sin km o con el odómetro hacia atrás no se inventa", () => {
    expect(kmRecorridos([{ tipo: "montaje", kilometraje: null, fecha: "2026-01-01" }], 50_000).kmRecorrido).toBeNull();
    expect(kmRecorridos([{ tipo: "montaje", kilometraje: 90_000, fecha: "2026-01-01" }], 10_000).kmRecorrido).toBeNull();
  });

  it("solo cuenta hasta la fecha de la medición", () => {
    const movs = [
      { tipo: "montaje", kilometraje: 100_000, fecha: "2026-01-01" },
      { tipo: "desmontaje", kilometraje: 130_000, fecha: "2026-04-01" },
    ];
    expect(kmRecorridos(movs, 110_000, "2026-02-01")).toEqual({ kmMontaje: 100_000, kmRecorrido: 10_000 });
  });
});

describe("indicadores de una llanta (R9)", () => {
  it("calcula las columnas del Excel de levantamiento", () => {
    const i = indicadoresLlanta({
      exterior: 9, centro: 10, interior: 11, remanente: 9,
      inicial: 16, baja: 3, kmRecorrido: 70_000, costo: 1_820_000,
    });
    expect(i.profMedia).toBe(10);
    expect(i.difLados).toBe(2);
    expect(i.mmDesgaste).toBe(7);
    expect(i.pctRodado).toBe(53.8); // 7 / (16 − 3)
    expect(i.referencia).toBe("PROYECCIÓN 50% - 70%");
    expect(i.kmPorMm).toBe(10_000);
    expect(i.proyeccionKm).toBe(130_000); // 10.000 × 13
    expect(i.cpk).toBe(14); // 1.820.000 / 130.000
  });

  it("sin profundidad inicial, ni desgaste ni % rodado: no se inventa", () => {
    const i = indicadoresLlanta({ exterior: 9, centro: null, interior: null, remanente: 9, inicial: null, baja: 3, kmRecorrido: 1000, costo: 1 });
    expect(i).toMatchObject({ profMedia: 9, mmDesgaste: null, pctRodado: null, referencia: null, cpk: null });
  });
});
