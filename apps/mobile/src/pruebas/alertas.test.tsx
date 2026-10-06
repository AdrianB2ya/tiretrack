import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AlertasLlantas, agruparAlertas, type AlertaLlanta } from "../coordinador/AlertasLlantas";

/** Llantas para cambiar: se calculaban y no se le mostraban a nadie. */

const alerta = (vehiculo: string, posicion: number, severidad: string, tipo = "profundidad_baja"): AlertaLlanta => ({
  vehiculoId: `v-${vehiculo}`, vehiculoCodigo: vehiculo, vehiculoPlaca: null, clienteNombre: "Transportes Reyna",
  posicion, serial: `S${posicion}`, tipo, severidad, mensaje: `${vehiculo} posición ${posicion}: ${tipo}`,
});

describe("alertas de llantas", () => {
  it("agrupa por vehículo; el que tiene algo crítico, primero", () => {
    const g = agruparAlertas([alerta("CA-01", 2, "media"), alerta("CA-02", 5, "critica"), alerta("CA-01", 1, "critica"), alerta("CA-03", 1, "media")]);
    expect(g.map((x) => x[0]?.vehiculoCodigo)).toEqual(["CA-01", "CA-02", "CA-03"]);
    expect(g[0]?.map((a) => a.posicion)).toEqual([1, 2]);
  });

  it("dice la severidad en texto y deja programar el cambio", async () => {
    const onProgramar = vi.fn();
    render(<AlertasLlantas cargar={async () => ({ ok: true, datos: [alerta("CA-12", 3, "critica", "dot_vencido")] })} onProgramar={onProgramar} />);
    expect(await screen.findByText("1 alerta en 1 vehículo")).toBeTruthy();
    expect(screen.getByText("Crítica")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText("Programar el cambio")); });
    expect(onProgramar).toHaveBeenCalled();
  });

  it("sin alertas lo dice; sin señal también, y deja reintentar", async () => {
    const cargar = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 0, mensaje: "x" })
      .mockResolvedValueOnce({ ok: true, datos: [] });
    render(<AlertasLlantas cargar={cargar} onProgramar={vi.fn()} />);
    expect(await screen.findByText(/Sin señal/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("reintentar-alertas")); });
    expect(await screen.findByText(/Ninguna llanta para cambiar/)).toBeTruthy();
  });
});
