import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AnularOrden } from "../coordinador/AnularOrden";

/** Anular una orden desde la app (respuesta 7 del usuario). */

describe("anular la orden", () => {
  it("exige un motivo con sustancia y un segundo toque", async () => {
    const onAnular = vi.fn().mockResolvedValue(undefined);
    render(<AnularOrden estado="en_proceso" rol="coordinador" bloqueadaPorOtro={false} onAnular={onAnular} />);
    await act(async () => { fireEvent.click(screen.getByTestId("anular")); });
    await act(async () => { fireEvent.change(screen.getByTestId("anular-motivo"), { target: { value: "vendido" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("anular-confirmar")); });
    expect(onAnular).not.toHaveBeenCalled();
    await act(async () => { fireEvent.change(screen.getByTestId("anular-motivo"), { target: { value: "El vehículo se vendió y ya no es del cliente" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("anular-confirmar")); });
    expect(onAnular).not.toHaveBeenCalled();
    expect(screen.getByText("Tocar otra vez para anular")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("anular-confirmar")); });
    expect(onAnular).toHaveBeenCalledWith("El vehículo se vendió y ya no es del cliente");
  });

  it("con la orden en manos de un técnico se puede anular, y dice qué pasa con lo que traiga", async () => {
    render(<AnularOrden estado="programada" rol="administrador" bloqueadaPorOtro onAnular={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByTestId("anular")); });
    expect(screen.getByText(/se rechazará y le quedará apartado en su teléfono/)).toBeTruthy();
  });

  it("no aparece para el técnico ni en una orden ya cerrada", () => {
    const { container: a } = render(<AnularOrden estado="en_proceso" rol="tecnico" bloqueadaPorOtro={false} onAnular={vi.fn()} />);
    expect(a.textContent).toBe("");
    const { container: b } = render(<AnularOrden estado="cerrada" rol="coordinador" bloqueadaPorOtro={false} onAnular={vi.fn()} />);
    expect(b.textContent).toBe("");
  });
});
