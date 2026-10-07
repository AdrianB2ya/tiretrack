import { describe, it, expect } from "vitest";
import { puedeVerAuditoria, rangoDeDiasColombia, resumirDetalleAuditoria } from "./vista";

describe("consulta de la auditoría", () => {
  it("solo el administrador la ve", () => {
    expect(puedeVerAuditoria("administrador")).toBe(true);
    expect(puedeVerAuditoria("coordinador")).toBe(false);
    expect(puedeVerAuditoria("tecnico")).toBe(false);
  });

  it("el día es el de Colombia: empieza a las 5 a. m. UTC y el hasta incluye el día entero", () => {
    expect(rangoDeDiasColombia("2026-10-06", "2026-10-06")).toEqual({
      desde: "2026-10-06T05:00:00.000Z",
      hasta: "2026-10-07T05:00:00.000Z",
    });
    // Fin de mes: el día siguiente cambia de mes.
    expect(rangoDeDiasColombia(undefined, "2026-10-31")).toEqual({ hasta: "2026-11-01T05:00:00.000Z" });
    expect(rangoDeDiasColombia()).toEqual({});
  });

  it("resume lo esencial de una exportación, un PDF y un cambio", () => {
    expect(resumirDetalleAuditoria("exportar_informe", { registros: 44, sinCerrar: 2 })).toBe("44 registros · 2 sin cerrar");
    expect(resumirDetalleAuditoria("exportar_informe", { origen: "pdf_orden", folio: "OS-FUN-000004" })).toBe("PDF de OS-FUN-000004");
    expect(resumirDetalleAuditoria("deshabilitar", { entidad: "usuario" })).toBe("usuario");
    expect(resumirDetalleAuditoria("crear", null)).toBe("");
  });
});
