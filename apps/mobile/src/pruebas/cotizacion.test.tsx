import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PantallaCotizacion, type FuentesCotizacion, type VistaCotizacion } from "../informe/PantallaCotizacion";
import { elegirOpcion } from "./listas";

/** Cotización (R14) en el teléfono. */

const VISTA: VistaCotizacion = {
  llantas: [{ concepto: "Llanta 295/80R22.5", detalle: "CA-12 (pos. 1, 2)", cantidad: 2, urgencia: "inmediato" }],
  servicios: [{ concepto: "Montaje", detalle: "Una por llanta a cambiar", cantidad: 2, urgencia: null }],
  totalLlantas: 2,
  nota: "Valores por definir: los precios se acuerdan aparte.",
  fecha: "2026-10-14",
};

function fuentes(extra: Partial<FuentesCotizacion> = {}): FuentesCotizacion {
  return {
    clientes: vi.fn().mockResolvedValue([{ id: "c1", nombre: "Transportes Reyna" }]),
    ver: vi.fn().mockResolvedValue({ ok: true, datos: VISTA }),
    descargarPdf: vi.fn().mockResolvedValue({ ok: true }),
    enviar: vi.fn().mockResolvedValue({ ok: true, datos: { enviadoA: ["a@b.co"] } }),
    ...extra,
  };
}

describe("cotización", () => {
  it("se elige el cliente, se ve con la urgencia en texto y se avisa que no lleva precios", async () => {
    const f = fuentes();
    render(<PantallaCotizacion fuentes={f} />);
    await elegirOpcion({ testID: "cliente-c1" });
    await act(async () => { fireEvent.click(screen.getByTestId("ver-cotizacion")); });
    expect(f.ver).toHaveBeenCalledWith("?clienteId=c1");
    expect(screen.getByText("2 × Llanta 295/80R22.5")).toBeTruthy();
    expect(screen.getByText("INMEDIATO")).toBeTruthy();
    expect(screen.getByText("Sin precios")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("descargar-cotizacion")); });
    expect(f.descargarPdf).toHaveBeenCalledWith("?clienteId=c1");
  });

  it("sin cliente elegido no se pide nada", async () => {
    const f = fuentes();
    render(<PantallaCotizacion fuentes={f} />);
    await act(async () => { fireEvent.click(screen.getByTestId("ver-cotizacion")); });
    expect(f.ver).not.toHaveBeenCalled();
  });

  it("sin nada que cotizar lo dice", async () => {
    const f = fuentes({ ver: vi.fn().mockResolvedValue({ ok: true, datos: { ...VISTA, llantas: [], servicios: [], totalLlantas: 0 } }) });
    render(<PantallaCotizacion fuentes={f} />);
    await elegirOpcion({ testID: "cliente-c1" });
    await act(async () => { fireEvent.click(screen.getByTestId("ver-cotizacion")); });
    expect(screen.getByText(/Nada que cotizar/)).toBeTruthy();
  });
});
