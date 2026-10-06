import { describe, it, expect } from "vitest";
import { ordenarRecomendaciones, puedeGestionarRecomendaciones } from "./recomendaciones";

describe("recomendaciones", () => {
  it("las registra el técnico asignado o la oficina, en una orden abierta", () => {
    expect(puedeGestionarRecomendaciones({ rol: "tecnico", esTecnicoAsignado: true, estadoOrden: "en_proceso" }).permitido).toBe(true);
    expect(puedeGestionarRecomendaciones({ rol: "coordinador", esTecnicoAsignado: false, estadoOrden: "en_revision" }).permitido).toBe(true);
    expect(puedeGestionarRecomendaciones({ rol: "tecnico", esTecnicoAsignado: false, estadoOrden: "en_proceso" }).codigo).toBe("SOLO_ASIGNADO");
    expect(puedeGestionarRecomendaciones({ rol: "cliente", esTecnicoAsignado: false, estadoOrden: "pendiente_cliente" }).codigo).toBe("SIN_PERMISO");
    // Una orden cerrada es un documento: no cambia.
    expect(puedeGestionarRecomendaciones({ rol: "coordinador", esTecnicoAsignado: false, estadoOrden: "cerrada" }).codigo).toBe("ORDEN_CERRADA");
  });

  it("urgentes primero; entre iguales, la más vieja", () => {
    const r = ordenarRecomendaciones([
      { id: "a", prioridad: "seguimiento", creadaEn: "2026-01-01" },
      { id: "b", prioridad: "urgente", creadaEn: "2026-03-01" },
      { id: "c", prioridad: "urgente", creadaEn: "2026-02-01" },
      { id: "d", prioridad: "proxima", creadaEn: "2026-01-01" },
    ]);
    expect(r.map((x) => x.id)).toEqual(["c", "b", "d", "a"]);
  });
});
