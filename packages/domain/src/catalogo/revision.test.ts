import { describe, it, expect } from "vitest";
import { candidatasParaUnificar, disenosEquivalentes, evaluarUnificacion, type EntradaRevisable } from "./revision";

const E = "emp-1";
const marca = (id: string, nombre: string, extra: Partial<EntradaRevisable> = {}): EntradaRevisable => ({
  id, nombre, empresaId: E, esGlobal: false, activa: true, ...extra,
});

describe("unificar lo creado en campo", () => {
  const michelim = marca("m-campo", "Michelim");
  const michelin = marca("m-global", "Michelin", { empresaId: null, esGlobal: true });

  it("una propia se unifica con una vigente, propia o global", () => {
    expect(evaluarUnificacion(michelim, michelin, E).permitido).toBe(true);
  });

  it("no consigo misma, ni una global, ni hacia una deshabilitada o ya unificada, ni de otra empresa", () => {
    expect(evaluarUnificacion(michelim, michelim, E).codigo).toBe("MISMA_ENTRADA");
    expect(evaluarUnificacion(michelin, michelim, E).codigo).toBe("NO_PROPIA");
    expect(evaluarUnificacion(michelim, { ...michelin, activa: false }, E).codigo).toBe("DESTINO_INACTIVO");
    expect(evaluarUnificacion(michelim, { ...michelin, reemplazadaPorId: "x" }, E).codigo).toBe("DESTINO_INACTIVO");
    expect(evaluarUnificacion({ ...michelim, reemplazadaPorId: "x" }, michelin, E).codigo).toBe("YA_UNIFICADA");
    expect(evaluarUnificacion(michelim, marca("ajena", "Michelin", { empresaId: "otra" }), E).codigo).toBe("NO_EXISTE");
  });

  it("un diseño solo con otro de la misma marca", () => {
    const d = marca("d1", "XZE2", { marcaId: "m-global" });
    expect(evaluarUnificacion(d, marca("d2", "XZE-2", { marcaId: "m-global" }), E).permitido).toBe(true);
    expect(evaluarUnificacion(d, marca("d3", "XZE-2", { marcaId: "otra" }), E).codigo).toBe("OTRA_MARCA");
  });

  it("las candidatas más parecidas van primero, sin ella misma", () => {
    const todas = [marca("b", "Bridgestone"), michelin, michelim, marca("g", "Goodyear")];
    expect(candidatasParaUnificar(michelim, todas, E).map((m) => m.nombre)).toEqual(["Michelin", "Goodyear", "Bridgestone"]);
  });

  it("los diseños con el mismo nombre normalizado se unifican con la marca", () => {
    expect(disenosEquivalentes([{ id: "o1", nombre: "XZE" }, { id: "o2", nombre: "Raro" }], [{ id: "d1", nombre: "xze" }]))
      .toEqual([{ origenId: "o1", destinoId: "d1" }]);
  });
});
