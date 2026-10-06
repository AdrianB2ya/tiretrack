import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Evidencia, agruparEvidencia, type FotoServidor } from "../fotos/Evidencia";

/** La evidencia del servidor, vista desde cualquier teléfono. */

const foto = (id: string, posicion: number | null): FotoServidor => ({ id, nombre: `${id}.jpg`, posicion, url: `https://x/${id}` });

describe("evidencia", () => {
  it("agrupa por posición, con las de la orden primero", () => {
    const g = agruparEvidencia([foto("p3", 3), foto("g", null), foto("p1", 1), foto("p3b", 3)]);
    expect(g.map((x) => [x.titulo, x.fotos.length])).toEqual([["De la orden", 1], ["Posición 1", 1], ["Posición 3", 2]]);
  });

  it("muestra las fotos y abre una en grande", async () => {
    render(<Evidencia cargar={vi.fn().mockResolvedValue({ ok: true, datos: [foto("g", null), foto("p1", 1)] })} />);
    expect(await screen.findByText("2 fotos en el servidor")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByLabelText("Ver p1.jpg")); });
    expect(screen.getByText("p1.jpg")).toBeTruthy();
  });

  it("sin señal lo dice y deja reintentar", async () => {
    const cargar = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 0, mensaje: "x" })
      .mockResolvedValueOnce({ ok: true, datos: [] });
    render(<Evidencia cargar={cargar} />);
    expect(await screen.findByText(/Sin señal/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("reintentar-evidencia")); });
    expect(await screen.findByText(/Todavía no hay fotos en el servidor/)).toBeTruthy();
  });
});
