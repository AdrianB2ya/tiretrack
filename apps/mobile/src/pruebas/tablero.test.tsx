import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PantallaTablero, type Tablero } from "../informe/PantallaTablero";
import { PortalCliente } from "../cliente/PortalCliente";

/** Tablero de la flota (R11). */

const tablero: Tablero = {
  llantas: 3,
  porMarca: [
    { grupo: "Firestone", llantas: 1, kmPorMm: 9000, proyeccionKm: 117000, cpk: 11 },
    { grupo: "Michelin", llantas: 2, kmPorMm: 10000, proyeccionKm: 130000, cpk: 15 },
  ],
  porDiseno: [{ grupo: "Michelin XZE", llantas: 2, kmPorMm: 10000, proyeccionKm: 130000, cpk: 15 }],
  porPosicion: [{ grupo: "1", llantas: 3, kmPorMm: 9500, proyeccionKm: 120000, cpk: 13 }],
  compras: {
    yaPedidas: [{ medida: "295/80R22.5", cantidad: 1 }],
    en30: [{ medida: "11R22.5", cantidad: 2 }],
    en60: [],
    en90: [],
    sinEstimar: 1,
  },
};

describe("tablero de la flota", () => {
  it("primero lo que hay que comprar, con cantidades y medidas en texto", async () => {
    render(<PantallaTablero fuentes={{ cargar: vi.fn().mockResolvedValue({ ok: true, datos: tablero }) }} />);
    const compras = await screen.findByTestId("compras");
    expect(compras.textContent).toContain("Ya en su límite: 1 de 295/80R22.5");
    expect(compras.textContent).toContain("En 30 días: 2 de 11R22.5");
    expect(compras.textContent).toContain("En 60 días: ninguna");
    expect(compras.textContent).toContain("1 sin estimar");
  });

  it("el rendimiento por marca, diseño o posición", async () => {
    render(<PantallaTablero fuentes={{ cargar: vi.fn().mockResolvedValue({ ok: true, datos: tablero }) }} />);
    expect((await screen.findByTestId("rendimiento-Firestone")).textContent).toContain("Costo por km $11");
    await act(async () => { fireEvent.click(screen.getByTestId("vista-posicion")); });
    expect(screen.getByText("Posición 1")).toBeTruthy();
  });

  it("sin señal lo dice", async () => {
    render(<PantallaTablero fuentes={{ cargar: vi.fn().mockResolvedValue({ ok: false, status: 0, mensaje: "x" }) }} />);
    expect(await screen.findByText(/Sin señal/)).toBeTruthy();
  });

  it("el portal del cliente lleva a sus indicadores y sus llantas", async () => {
    const onIndicadores = vi.fn();
    render(<PortalCliente ordenes={[]} hoy="2026-10-14" onAbrir={vi.fn()} onIndicadores={onIndicadores} onLlantas={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByTestId("portal-indicadores")); });
    expect(onIndicadores).toHaveBeenCalled();
  });
});
