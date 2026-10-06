import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DecisionCliente, diasHasta, textoPlazo, MOTIVO_MINIMO } from "../cliente/DecisionCliente";
import { PortalCliente, seccionesCliente } from "../cliente/PortalCliente";
import { unaOrden } from "./fabrica";
import type { OrdenParaLista } from "../ordenes/lista";

/**
 * Portal del cliente.
 *
 * Si no responde, la orden se cierra sola como cierre tácito: el plazo tiene
 * que estar a la vista, y lo más urgente arriba.
 */

const item = (o: Parameters<typeof unaOrden>[0]): OrdenParaLista => ({
  orden: unaOrden(o), vehiculoCodigo: "CA-12", clienteNombre: "Reyna",
  posicionesCapturadas: 4, posicionesTotales: 4, tieneCambiosSinEnviar: false,
});

describe("plazo del cliente", () => {
  it("cuenta los días que quedan", () => {
    expect(diasHasta("2026-10-08", "2026-10-05")).toBe(3);
    expect(textoPlazo("2026-10-08", "2026-10-05")).toMatch(/3 días.*se aprueba sola/);
    expect(textoPlazo("2026-10-05", "2026-10-05")).toMatch(/Hoy vence/);
    expect(textoPlazo("2026-10-01", "2026-10-05")).toMatch(/venció/);
    expect(textoPlazo(null, "2026-10-05")).toBeNull();
  });
});

describe("decisión", () => {
  function montar() {
    const onAprobar = vi.fn();
    const onObjetar = vi.fn();
    render(<DecisionCliente limiteCliente="2026-10-08" hoy="2026-10-05" onAprobar={onAprobar} onObjetar={onObjetar} />);
    return { onAprobar, onObjetar };
  }

  it("muestra el plazo y aprueba", () => {
    const { onAprobar } = montar();
    expect(screen.getByText(/3 días/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("aprobar"));
    expect(onAprobar).toHaveBeenCalled();
  });

  it("objetar exige explicar qué no corresponde", () => {
    const { onObjetar } = montar();
    fireEvent.click(screen.getByTestId("objetar"));
    fireEvent.change(screen.getByLabelText("¿Qué no corresponde?"), { target: { value: "no" } });
    fireEvent.click(screen.getByTestId("confirmar-objecion"));
    expect(onObjetar).not.toHaveBeenCalled();
    const motivo = "La posición 3 no se cambió";
    expect(motivo.length).toBeGreaterThanOrEqual(MOTIVO_MINIMO);
    fireEvent.change(screen.getByLabelText("¿Qué no corresponde?"), { target: { value: motivo } });
    fireEvent.click(screen.getByTestId("confirmar-objecion"));
    expect(onObjetar).toHaveBeenCalledWith(motivo);
  });
});

describe("portal", () => {
  const ordenes = [
    item({ id: "a", estado: "pendiente_cliente", limiteCliente: "2026-10-09", folio: "OS-FUN-000003" }),
    item({ id: "b", estado: "pendiente_cliente", limiteCliente: "2026-10-06", folio: "OS-FUN-000004" }),
    item({ id: "c", estado: "cerrada", folio: "OS-FUN-000001" }),
  ];

  it("lo que vence antes va primero", () => {
    expect(seccionesCliente(ordenes).porAprobar.map((o) => o.orden.id)).toEqual(["b", "a"]);
    expect(seccionesCliente(ordenes).cerradas.map((o) => o.orden.id)).toEqual(["c"]);
  });

  it("muestra cuánto le queda a cada una y abre la orden", () => {
    const onAbrir = vi.fn();
    render(<PortalCliente ordenes={ordenes} hoy="2026-10-05" onAbrir={onAbrir} />);
    expect(screen.getByText("1 día")).toBeTruthy();
    fireEvent.click(screen.getByText("OS-FUN-000004"));
    expect(onAbrir).toHaveBeenCalledWith("b");
  });
});
