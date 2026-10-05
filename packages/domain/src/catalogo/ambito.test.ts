import { describe, it, expect } from "vitest";
import {
  visiblePara,
  filtrarVisibles,
  puedeCrearEntrada,
  puedePromoverAGlobal,
  puedeRevisarCreadasEnCampo,
  puedeModificar,
  evaluarPromocion,
  jerarquiaCoherente,
  medidaValida,
  normalizarMedida,
  type EntradaConAmbito,
} from "./ambito";

const EMP_A = "emp-a";
const EMP_B = "emp-b";

const global = (nombre: string): EntradaConAmbito => ({
  id: `g-${nombre}`,
  nombre,
  esGlobal: true,
  empresaId: null,
});

const propia = (nombre: string, empresaId: string): EntradaConAmbito => ({
  id: `p-${nombre}`,
  nombre,
  esGlobal: false,
  empresaId,
  creadaEnCampo: true,
});

describe("ámbito del catálogo", () => {
  it("una empresa ve lo global", () => {
    expect(visiblePara(global("Michelin"), EMP_A)).toBe(true);
  });

  it("una empresa ve lo suyo", () => {
    expect(visiblePara(propia("Reencauchadora del Caribe", EMP_A), EMP_A)).toBe(true);
  });

  it("no ve lo propio de otra empresa", () => {
    expect(visiblePara(propia("Reencauchadora del Caribe", EMP_B), EMP_A)).toBe(false);
  });

  it("filtra una lista mezclada", () => {
    const todas = [global("Michelin"), propia("Taller A", EMP_A), propia("Taller B", EMP_B)];
    const visibles = filtrarVisibles(todas, EMP_A).map((e) => e.nombre);
    expect(visibles).toEqual(["Michelin", "Taller A"]);
  });
});

describe("quién crea entradas", () => {
  it("el técnico puede crear en campo", () => {
    // Bloquearlo haría que escriba la marca en observaciones o elija una
    // cualquiera con tal de guardar.
    expect(puedeCrearEntrada("tecnico").permitido).toBe(true);
  });

  it("coordinador y administrador también", () => {
    expect(puedeCrearEntrada("coordinador").permitido).toBe(true);
    expect(puedeCrearEntrada("administrador").permitido).toBe(true);
  });

  it("el cliente no: su portal es de solo lectura", () => {
    expect(puedeCrearEntrada("cliente").codigo).toBe("SIN_PERMISO");
  });
});

describe("promoción a global", () => {
  it("solo la plataforma promueve", () => {
    expect(puedePromoverAGlobal("superadmin").permitido).toBe(true);
    expect(puedePromoverAGlobal("administrador").codigo).toBe("SOLO_SUPERADMIN");
    expect(puedePromoverAGlobal("coordinador").codigo).toBe("SOLO_SUPERADMIN");
  });

  it("promueve una entrada que no choca con nada global", () => {
    const globales = [global("Michelin"), global("Bridgestone")];
    expect(evaluarPromocion(propia("Kumho", EMP_A), globales).permitido).toBe(true);
  });

  it("no promueve si ya existe idéntica ignorando tildes y guiones", () => {
    // Promover un duplicado partiría el análisis en dos marcas globales.
    const globales = [global("Michelin")];
    expect(evaluarPromocion(propia("michelín", EMP_A), globales).codigo).toBe("YA_EXISTE_GLOBAL");
  });

  it("advierte si se parece mucho a una global", () => {
    const globales = [global("Michelin")];
    expect(evaluarPromocion(propia("Michelim", EMP_A), globales).codigo).toBe("PARECIDA_A_GLOBAL");
  });

  it("no promueve lo que ya es global", () => {
    expect(evaluarPromocion(global("Michelin"), []).codigo).toBe("YA_ES_GLOBAL");
  });

  it("el mensaje dice con cuál choca, para poder fusionar", () => {
    const r = evaluarPromocion(propia("michelin", EMP_A), [global("Michelin")]);
    expect(r.mensaje).toContain("Michelin");
  });
});

describe("revisión de lo creado en campo", () => {
  it("lo revisan administrador y superadmin", () => {
    expect(puedeRevisarCreadasEnCampo("administrador")).toBe(true);
    expect(puedeRevisarCreadasEnCampo("superadmin")).toBe(true);
  });

  it("no el técnico ni el coordinador", () => {
    expect(puedeRevisarCreadasEnCampo("tecnico")).toBe(false);
    expect(puedeRevisarCreadasEnCampo("coordinador")).toBe(false);
  });
});

describe("modificación", () => {
  it("una entrada global no la toca una empresa", () => {
    // La comparten todas: cambiarla afectaría a los demás suscriptores.
    const r = puedeModificar(global("Michelin"), "administrador", EMP_A);
    expect(r.codigo).toBe("ENTRADA_GLOBAL");
  });

  it("la plataforma sí modifica lo global", () => {
    expect(puedeModificar(global("Michelin"), "superadmin", EMP_A).permitido).toBe(true);
  });

  it("no se modifica lo propio de otra empresa", () => {
    const r = puedeModificar(propia("Taller B", EMP_B), "administrador", EMP_A);
    expect(r.codigo).toBe("OTRA_EMPRESA");
  });

  it("el administrador modifica lo propio de su empresa", () => {
    expect(puedeModificar(propia("Taller A", EMP_A), "administrador", EMP_A).permitido).toBe(true);
  });

  it("el técnico crea pero no modifica lo ya existente", () => {
    const r = puedeModificar(propia("Taller A", EMP_A), "tecnico", EMP_A);
    expect(r.codigo).toBe("SIN_PERMISO");
  });
});

describe("jerarquía marca → diseño → medida", () => {
  it("acepta la selección completa", () => {
    expect(jerarquiaCoherente({ marcaId: "m", disenoId: "d", medida: "295/80R22.5" }).permitido).toBe(
      true,
    );
  });

  it("acepta quedarse solo en la marca", () => {
    expect(jerarquiaCoherente({ marcaId: "m" }).permitido).toBe(true);
  });

  it("rechaza un diseño sin marca", () => {
    expect(jerarquiaCoherente({ disenoId: "d" }).codigo).toBe("FALTA_MARCA");
  });

  it("rechaza una medida sin diseño", () => {
    expect(jerarquiaCoherente({ marcaId: "m", medida: "11R22.5" }).codigo).toBe("FALTA_DISENO");
  });

  it("no exige nada si no se seleccionó nada", () => {
    // La llanta puede quedar sin identificar, con su motivo.
    expect(jerarquiaCoherente({}).permitido).toBe(true);
  });
});

describe("medidas", () => {
  it("acepta los formatos usados en la flota", () => {
    for (const m of ["295/80R22.5", "11R22.5", "385/65R22.5", "275/80R22.5", "12R22.5"]) {
      expect(medidaValida(m), `debería aceptar ${m}`).toBe(true);
    }
  });

  it("rechaza texto libre", () => {
    for (const m of ["grande", "295-80-22", "R22.5", ""]) {
      expect(medidaValida(m), `no debería aceptar ${m}`).toBe(false);
    }
  });

  it("normaliza para que no queden dos medidas iguales escritas distinto", () => {
    expect(normalizarMedida(" 295/80r22.5 ")).toBe("295/80R22.5");
    expect(normalizarMedida("11 R 22.5")).toBe("11R22.5");
  });

  it("la normalización deja la medida en formato válido", () => {
    expect(medidaValida(normalizarMedida("295/80r22.5"))).toBe(true);
  });
});
