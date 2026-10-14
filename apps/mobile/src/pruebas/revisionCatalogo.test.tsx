import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PantallaRevisionCatalogo, type FuentesRevision, type Revision } from "../admin/PantallaRevisionCatalogo";

/** Lo creado en campo: el administrador lo aprueba o lo unifica con la correcta. */

const REVISION: Revision = {
  marcas: [{
    id: "m-typo", nombre: "Michelim", esGlobal: false,
    candidatas: [{ id: "m-ok", nombre: "Michelin", esGlobal: true }, { id: "m-otra", nombre: "Goodyear", esGlobal: false }],
  }],
  disenos: [{ id: "d-1", nombre: "Ruta 77", esGlobal: false, marcaNombre: "Continental", candidatas: [] }],
  medidas: [{ id: "me-1", medida: "12R22.5", marcaNombre: "Michelin", disenoNombre: "XZE", profundidadOriginal: null }],
};

function fuentes(extra: Partial<FuentesRevision> = {}) {
  return {
    cargar: vi.fn().mockResolvedValueOnce({ ok: true, datos: REVISION }).mockResolvedValue({ ok: true, datos: { marcas: [], disenos: [] } }),
    aprobar: vi.fn().mockResolvedValue({ ok: true, datos: {} }),
    fijarProfundidad: vi.fn().mockResolvedValue({ ok: true, datos: {} }),
    unificar: vi.fn().mockResolvedValue({ ok: true, datos: { disenosUnificados: 1 } }),
    ...extra,
  };
}

describe("revisión de lo creado en campo", () => {
  it("unificar pide elegir la correcta y dice qué va a pasar antes de hacerlo", async () => {
    const f = fuentes();
    render(<PantallaRevisionCatalogo fuentes={f} />);
    expect(await screen.findByText("Michelim")).toBeTruthy();
    expect(screen.queryByTestId("unificar-m-typo")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId("destino-m-typo-m-ok")); });
    expect(screen.getByText(/Las órdenes ya registradas no cambian/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("unificar-m-typo")); });
    expect(f.unificar).toHaveBeenCalledWith("marca", "m-typo", "m-ok");
    expect(await screen.findByText('"Michelim" se unificó con "Michelin"')).toBeTruthy();
    expect(screen.getByText(/Nada pendiente/)).toBeTruthy();
  });

  it("'Es correcta' la aprueba; un diseño dice de qué marca es", async () => {
    const f = fuentes();
    render(<PantallaRevisionCatalogo fuentes={f} />);
    expect(await screen.findByText("Marca: Continental")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("aprobar-d-1")); });
    expect(f.aprobar).toHaveBeenCalledWith("diseno", "d-1");
  });

  it("una medida creada en campo se aprueba completando su profundidad de fábrica", async () => {
    const f = fuentes();
    render(<PantallaRevisionCatalogo fuentes={f} />);
    expect(await screen.findByText("Michelin · XZE")).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByTestId("prof-me-1"), { target: { value: "15,5" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("aprobar-me-1")); });
    expect(f.fijarProfundidad).toHaveBeenCalledWith("me-1", 15.5);
    expect(f.aprobar).toHaveBeenCalledWith("medida", "me-1");
  });

  it("aprobar una medida sin tocar la profundidad no la reescribe", async () => {
    const f = fuentes();
    render(<PantallaRevisionCatalogo fuentes={f} />);
    { const el = await screen.findByTestId("aprobar-me-1"); await act(async () => { fireEvent.click(el); }); }
    expect(f.fijarProfundidad).not.toHaveBeenCalled();
    expect(f.aprobar).toHaveBeenCalledWith("medida", "me-1");
  });

  it("si el servidor no deja, dice por qué", async () => {
    const f = fuentes({ unificar: vi.fn().mockResolvedValue({ ok: false, status: 409, mensaje: "Esta entrada ya se unificó con otra" }) });
    render(<PantallaRevisionCatalogo fuentes={f} />);
    const destino = await screen.findByTestId("destino-m-typo-m-ok");
    await act(async () => { fireEvent.click(destino); });
    await act(async () => { fireEvent.click(screen.getByTestId("unificar-m-typo")); });
    expect(await screen.findByText("Esta entrada ya se unificó con otra")).toBeTruthy();
  });
});
