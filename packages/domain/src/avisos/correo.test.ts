import { describe, it, expect } from "vitest";
import { avisoCambios, avisoPorAprobar, correoInforme, revisarDestinatarios } from "./correo";

describe("correos (R13)", () => {
  it("entiende varios destinatarios separados como sea, sin repetir", () => {
    expect(revisarDestinatarios("Ana@Flota.co; jefe@flota.co,ana@flota.co\nmal@ x@y")).toEqual({
      validos: ["ana@flota.co", "jefe@flota.co"],
      invalidos: ["mal@", "x@y"],
    });
  });

  it("el aviso al cliente dice el plazo y que vencerlo NO es aprobar", () => {
    const c = avisoPorAprobar({ empresa: "Asistectire", folio: "OS-FUN-000004", vehiculo: "CA-12", limite: "2026-10-21" });
    expect(c.asunto).toBe("Orden OS-FUN-000004 espera su aprobación");
    expect(c.texto).toContain("hasta el 2026-10-21");
    expect(c.texto).toContain("cierre tácito");
    expect(c.texto).toContain("no como aprobada por usted");
  });

  it("el informe con órdenes sin cerrar lo advierte en el correo", () => {
    const c = correoInforme({ empresa: "Asistectire", formato: "pdf", ordenes: 3, sinCerrar: 1, quien: "Laura" });
    expect(c.texto).toContain("las 3 órdenes en PDF");
    expect(c.texto).toContain("1 de las órdenes no están cerradas");
  });

  it("el resumen diario agrupa por vehículo y ordena por posición", () => {
    const c = avisoCambios({
      empresa: "Asistectire",
      fecha: "2026-10-14",
      llantas: [
        { vehiculo: "CA-12", cliente: "Reyna", posicion: 4, motivo: "CAMBIO INMEDIATO (2,5 mm)" },
        { vehiculo: "CA-12", cliente: "Reyna", posicion: 1, motivo: "DOT VENCIDO" },
      ],
    });
    expect(c.asunto).toBe("2 llantas para cambio inmediato · 2026-10-14");
    expect(c.texto.indexOf("Posición 1")).toBeLessThan(c.texto.indexOf("Posición 4"));
    expect(c.texto).toContain("en 1 vehículo de sus sedes");
  });
});
