import { describe, it, expect } from "vitest";
import {
  CADA_MAXIMO,
  describirFrecuencia,
  primeraVisita,
  proximasVisitas,
  puedeGestionarProgramaciones,
  revisarProgramacion,
} from "./programacion";
import { avanzarProxima } from "./reglas";

describe("programación recurrente", () => {
  it("la programan el administrador y el coordinador", () => {
    expect(puedeGestionarProgramaciones("administrador")).toBe(true);
    expect(puedeGestionarProgramaciones("coordinador")).toBe(true);
    expect(puedeGestionarProgramaciones("tecnico")).toBe(false);
    expect(puedeGestionarProgramaciones("cliente")).toBe(false);
  });

  it("describe la frecuencia en palabras, con plurales bien escritos", () => {
    expect(describirFrecuencia("mensual", 1)).toBe("Cada mes");
    expect(describirFrecuencia("mensual", 3)).toBe("Cada 3 meses");
    expect(describirFrecuencia("dias_habiles", 5)).toBe("Cada 5 días hábiles");
    expect(describirFrecuencia("quincenal", 1)).toBe("Cada quince días");
    expect(describirFrecuencia("semanal", 2)).toBe("Cada 2 semanas");
  });

  it("la primera visita corre al lunes si el inicio cae en fin de semana", () => {
    expect(primeraVisita("2026-10-10")).toBe("2026-10-12"); // sábado
    expect(primeraVisita("2026-10-07")).toBe("2026-10-07");
  });

  it("la vista previa coincide con lo que generará el trabajo", () => {
    // Lo que el coordinador ve antes de guardar es lo que va a pasar.
    const inicio = "2026-10-15";
    const vista = proximasVisitas(inicio, "mensual", 1, 4);
    expect(vista).toEqual(["2026-10-15", "2026-11-16", "2026-12-15", "2027-01-15"]);
    let p = { id: "p", vehiculoId: "v", frecuencia: "mensual" as const, cada: 1, inicio, proxima: vista[0] as string, activa: true };
    for (const esperada of vista.slice(1)) {
      const siguiente = avanzarProxima(p, p.proxima);
      expect(siguiente).toBe(esperada);
      p = { ...p, proxima: siguiente };
    }
  });

  it("no repite el mismo lunes cuando dos fechas se corren juntas", () => {
    // Viernes, sábado y domingo diarios caen todos el lunes.
    const v = proximasVisitas("2026-10-09", "dias_calendario", 1, 3);
    expect(v).toEqual(["2026-10-09", "2026-10-12", "2026-10-13"]);
  });

  it("no se programa hacia atrás ni con un periodo absurdo", () => {
    expect(revisarProgramacion({ inicio: "2026-10-05", cada: 1 }, "2026-10-06").codigo).toBe("INICIO_PASADO");
    expect(revisarProgramacion({ inicio: "2026-10-06", cada: 1 }, "2026-10-06").permitido).toBe(true);
    expect(revisarProgramacion({ inicio: "2026-10-06", cada: 0 }, "2026-10-06").codigo).toBe("CADA_INVALIDO");
    expect(revisarProgramacion({ inicio: "2026-10-06", cada: CADA_MAXIMO + 1 }, "2026-10-06").codigo).toBe("CADA_INVALIDO");
    expect(revisarProgramacion({ inicio: "2026-10-06", cada: 1.5 }, "2026-10-06").codigo).toBe("CADA_INVALIDO");
  });
});
