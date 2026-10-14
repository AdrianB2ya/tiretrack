import { describe, it, expect } from "vitest";
import { exigeLiberar, puedeLiberarBloqueo, puedeTomarBloqueo } from "./bloqueo";

const base = { rol: "tecnico" as const, usuarioId: "tec-1", tecnicoId: "tec-1", estado: "programada" as const, bloqueadaPorId: null };

describe("bloqueo de la orden (R7)", () => {
  it("el técnico asignado se la lleva, por hacer o en curso", () => {
    expect(puedeTomarBloqueo(base).permitido).toBe(true);
    expect(puedeTomarBloqueo({ ...base, estado: "en_proceso" }).permitido).toBe(true);
  });

  it("nadie más se la lleva: ni otro técnico ni la oficina", () => {
    expect(puedeTomarBloqueo({ ...base, usuarioId: "tec-2" }).codigo).toBe("SOLO_ASIGNADO");
    expect(puedeTomarBloqueo({ ...base, rol: "coordinador", usuarioId: "coo-1" }).codigo).toBe("SOLO_ASIGNADO");
  });

  it("una orden en revisión o cerrada no se lleva", () => {
    expect(puedeTomarBloqueo({ ...base, estado: "en_revision" }).codigo).toBe("ESTADO_INVALIDO");
  });

  it("volver a tomarla quien ya la tiene no es error (reintento con mala señal)", () => {
    expect(puedeTomarBloqueo({ ...base, bloqueadaPorId: "tec-1" }).permitido).toBe(true);
  });

  it("la libera quien la tiene, sin motivo", () => {
    expect(puedeLiberarBloqueo({ ...base, bloqueadaPorId: "tec-1" }).permitido).toBe(true);
  });

  it("la oficina la libera con un motivo con sustancia; el técnico de al lado no", () => {
    const of = { ...base, rol: "coordinador" as const, usuarioId: "coo-1", bloqueadaPorId: "tec-1" };
    expect(puedeLiberarBloqueo({ ...of, motivo: "ok" }).codigo).toBe("MOTIVO_REQUERIDO");
    expect(puedeLiberarBloqueo({ ...of, motivo: "Carlos perdió el teléfono" }).permitido).toBe(true);
    expect(puedeLiberarBloqueo({ ...base, usuarioId: "tec-2", bloqueadaPorId: "tec-1", motivo: "x".repeat(20) }).codigo).toBe("SIN_PERMISO");
  });

  it("reasignar o anular una orden bloqueada exige liberarla primero", () => {
    expect(exigeLiberar("tec-1", "coo-1").codigo).toBe("ORDEN_BLOQUEADA");
    expect(exigeLiberar(null, "coo-1").permitido).toBe(true);
  });
});
