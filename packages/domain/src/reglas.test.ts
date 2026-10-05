import { describe, it, expect } from "vitest";
import {
  normalizar,
  clave,
  distancia,
  evaluarNombreNuevo,
  buscar,
} from "./catalogo/normalizacion";
import { formatearFolio, parsearFolio, esFolioValido, tieneFolioDefinitivo } from "./folio/folio";
import {
  sumarDias,
  sumarDiasHabiles,
  siguienteHabil,
  esFinDeSemana,
  diasHabilesEntre,
  plazoAprobacion,
  proximaEjecucion,
  DIAS_APROBACION_CLIENTE,
} from "./tiempo/habiles";

// ── Catálogo ────────────────────────────────────────────────────────────────

const marcas = [
  { id: "m1", nombre: "Michelin" },
  { id: "m2", nombre: "Bridgestone" },
  { id: "m3", nombre: "Goodyear" },
];

describe("normalización de nombres", () => {
  it("quita tildes y mayúsculas", () => {
    expect(normalizar("Michelín")).toBe("michelin");
    expect(normalizar("  ALINEACIÓN  ")).toBe("alineacion");
  });

  it("la clave además ignora espacios y guiones", () => {
    expect(clave("XZY-3")).toBe("xzy3");
    expect(clave("XZY 3")).toBe("xzy3");
    expect(clave("X Multi Z")).toBe("xmultiz");
  });
});

describe("distancia de edición", () => {
  it("mide diferencias pequeñas", () => {
    expect(distancia("michelin", "michelim")).toBe(1);
    expect(distancia("michelin", "michelin")).toBe(0);
  });

  it("corta pronto cuando las longitudes son muy distintas", () => {
    expect(distancia("a", "abcdefghij")).toBeGreaterThan(3);
  });

  it("maneja cadenas vacías", () => {
    expect(distancia("", "abc")).toBe(3);
    expect(distancia("abc", "")).toBe(3);
  });
});

describe("crear entradas de catálogo", () => {
  it("bloquea el duplicado exacto ignorando tildes", () => {
    // Sin esto, en tres meses hay cuatro variantes de Michelin y el
    // análisis por marca deja de existir.
    const r = evaluarNombreNuevo("michelín", marcas);
    expect(r.puedeCrear).toBe(false);
    expect(r.duplicado?.id).toBe("m1");
  });

  it("bloquea aunque cambien espacios y guiones", () => {
    const disenos = [{ id: "d1", nombre: "XZY-3" }];
    expect(evaluarNombreNuevo("XZY 3", disenos).puedeCrear).toBe(false);
    expect(evaluarNombreNuevo("xzy3", disenos).puedeCrear).toBe(false);
  });

  it("advierte de parecidas pero deja crear", () => {
    // Michelin y Michelim podrían ser marcas distintas de verdad.
    const r = evaluarNombreNuevo("Michelim", marcas);
    expect(r.puedeCrear).toBe(true);
    expect(r.parecidas.map((p) => p.id)).toContain("m1");
  });

  it("no advierte cuando el nombre es claramente distinto", () => {
    const r = evaluarNombreNuevo("Continental", marcas);
    expect(r.puedeCrear).toBe(true);
    expect(r.parecidas).toHaveLength(0);
  });

  it("exige un largo mínimo", () => {
    expect(evaluarNombreNuevo("M", marcas).puedeCrear).toBe(false);
    expect(evaluarNombreNuevo("  ", marcas).puedeCrear).toBe(false);
  });

  it("limita cuántas parecidas muestra", () => {
    const muchas = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, nombre: `Michelin${i}` }));
    expect(evaluarNombreNuevo("Michelin", muchas).parecidas.length).toBeLessThanOrEqual(3);
  });
});

describe("búsqueda en catálogo", () => {
  it("encuentra por coincidencia parcial sin tildes", () => {
    expect(buscar("miche", marcas).map((m) => m.id)).toEqual(["m1"]);
    expect(buscar("STONE", marcas).map((m) => m.id)).toEqual(["m2"]);
  });

  it("sin término devuelve todo", () => {
    expect(buscar("", marcas)).toHaveLength(3);
  });
});

// ── Folio ───────────────────────────────────────────────────────────────────

describe("folio", () => {
  it("arma el formato con sede y consecutivo", () => {
    expect(formatearFolio("FUN", 123)).toBe("OS-FUN-000123");
    expect(formatearFolio("ct01", 45)).toBe("OS-CT01-000045");
  });

  it("rechaza datos inválidos en vez de generar basura", () => {
    expect(() => formatearFolio("", 1)).toThrow();
    expect(() => formatearFolio("FUN", 0)).toThrow();
    expect(() => formatearFolio("FUN", -5)).toThrow();
    expect(() => formatearFolio("FUN", 1.5)).toThrow();
  });

  it("descompone un folio en sus partes", () => {
    const p = parsearFolio("OS-FUN-000123");
    expect(p?.prefijo).toBe("OS");
    expect(p?.codigoSede).toBe("FUN");
    expect(p?.consecutivo).toBe(123);
  });

  it("reconoce folios válidos e inválidos", () => {
    expect(esFolioValido("OS-FUN-000123")).toBe(true);
    expect(esFolioValido("FUN-K7M2")).toBe(false); // código de referencia, no folio
    expect(esFolioValido("cualquier cosa")).toBe(false);
  });

  it("distingue una orden sincronizada de una que aún no tiene folio", () => {
    expect(tieneFolioDefinitivo("OS-FUN-000123")).toBe(true);
    expect(tieneFolioDefinitivo("FUN-K7M2")).toBe(false);
    expect(tieneFolioDefinitivo(null)).toBe(false);
  });
});

// ── Fechas hábiles ──────────────────────────────────────────────────────────

describe("días hábiles", () => {
  it("reconoce sábados y domingos", () => {
    expect(esFinDeSemana("2026-09-05")).toBe(true); // sábado
    expect(esFinDeSemana("2026-09-06")).toBe(true); // domingo
    expect(esFinDeSemana("2026-09-04")).toBe(false); // viernes
  });

  it("suma días calendario sin saltar nada", () => {
    expect(sumarDias("2026-09-04", 3)).toBe("2026-09-07");
  });

  it("suma días hábiles saltando el fin de semana", () => {
    // Viernes 4 + 1 hábil = lunes 7
    expect(sumarDiasHabiles("2026-09-04", 1)).toBe("2026-09-07");
    // Viernes 4 + 5 hábiles = viernes 11
    expect(sumarDiasHabiles("2026-09-04", 5)).toBe("2026-09-11");
  });

  it("puede restar días hábiles", () => {
    expect(sumarDiasHabiles("2026-09-07", -1)).toBe("2026-09-04");
  });

  it("sumar cero no mueve la fecha", () => {
    expect(sumarDiasHabiles("2026-09-05", 0)).toBe("2026-09-05");
  });

  it("corre al siguiente hábil cuando cae en fin de semana", () => {
    expect(siguienteHabil("2026-09-05")).toBe("2026-09-07");
    expect(siguienteHabil("2026-09-04")).toBe("2026-09-04");
  });

  it("cuenta días hábiles entre dos fechas", () => {
    expect(diasHabilesEntre("2026-09-04", "2026-09-11")).toBe(5);
    expect(diasHabilesEntre("2026-09-11", "2026-09-04")).toBe(0);
  });
});

describe("plazo de aprobación del cliente", () => {
  it("da cinco días hábiles por defecto", () => {
    expect(DIAS_APROBACION_CLIENTE).toBe(5);
    const p = plazoAprobacion("2026-09-04", "2026-09-04");
    expect(p.limite).toBe("2026-09-11");
    expect(p.vencido).toBe(false);
  });

  it("cuenta los días que quedan", () => {
    const p = plazoAprobacion("2026-09-04", "2026-09-08");
    expect(p.diasRestantes).toBe(3);
  });

  it("marca vencido al llegar el límite", () => {
    // Vencido no es lo mismo que aprobado: la orden cierra sola, pero el
    // documento debe decir que fue por vencimiento del plazo.
    const p = plazoAprobacion("2026-09-04", "2026-09-11");
    expect(p.vencido).toBe(true);
    expect(p.diasRestantes).toBe(0);
  });
});

describe("recurrencias", () => {
  it("calcula la próxima por días hábiles", () => {
    expect(proximaEjecucion("2026-09-04", "dias_habiles", 5)).toBe("2026-09-11");
  });

  it("nunca programa en fin de semana", () => {
    // Nadie atiende el sábado.
    for (const f of ["dias_calendario", "semanal", "quincenal", "mensual"] as const) {
      const r = proximaEjecucion("2026-09-04", f, 1);
      expect(esFinDeSemana(r)).toBe(false);
    }
  });

  it("mensual avanza un mes", () => {
    expect(proximaEjecucion("2026-08-03", "mensual").startsWith("2026-09")).toBe(true);
  });

  it("semanal avanza siete días", () => {
    expect(proximaEjecucion("2026-09-07", "semanal")).toBe("2026-09-14");
  });
});
