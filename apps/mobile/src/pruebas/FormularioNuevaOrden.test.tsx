import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FormularioNuevaOrden, type FuentesNuevaOrden } from "../ordenes/FormularioNuevaOrden";
import type { QuienCrea } from "../ordenes/nuevaOrden";

const fuentes = (extra: Partial<FuentesNuevaOrden> = {}): FuentesNuevaOrden => ({
  sedes: async () => [
    { id: "s-fun", nombre: "Sede Fundación", codigo: "FUN" },
    { id: "s-ct", nombre: "Carro Taller 01", codigo: "CT01" },
  ],
  clientes: async () => [{ id: "c-1", nombre: "Transportes Reyna" }],
  sedesDeCliente: async () => [{ id: "sc-1", nombre: "Planta Fundación" }],
  vehiculos: async () => [
    { id: "v-1", codigo: "CA-12", placa: "SXK482", nombre: "Tractocamión #12", configuracionEjeId: "cfg-1", kmActual: 78_900 },
  ],
  tecnicos: async () => [{ id: "t-1", nombre: "Carlos Méndez" }],
  ordenesAbiertas: async () => [],
  ...extra,
});

const coord: QuienCrea = { usuarioId: "u-coord", rol: "coordinador", sedes: ["s-fun", "s-ct"] };
const tecnico: QuienCrea = { usuarioId: "t-1", rol: "tecnico", sedes: ["s-fun"] };

function montar(quien: QuienCrea, f = fuentes()) {
  const onCrear = vi.fn();
  render(<FormularioNuevaOrden quien={quien} hoy="2026-10-05" fuentes={f} onCrear={onCrear} />);
  return onCrear;
}
const elegir = async (texto: string | RegExp) => fireEvent.click(await screen.findByText(texto));

describe("orden nueva en cascada", () => {
  it("el coordinador elige sede, cliente, sede del cliente, vehículo y técnico", async () => {
    const onCrear = montar(coord);
    await elegir("Sede Fundación");
    await elegir("Transportes Reyna");
    await elegir("Planta Fundación");
    await elegir(/CA-12/);
    await elegir("Carlos Méndez");
    fireEvent.change(screen.getByLabelText("Quién entrega el vehículo"), { target: { value: "Pedro Gómez" } });
    fireEvent.click(screen.getByTestId("crear-orden"));
    await waitFor(() => expect(onCrear).toHaveBeenCalled());
    const [f, vehiculo, codigo] = onCrear.mock.calls[0] as [Record<string, unknown>, { id: string }, string];
    expect(f).toMatchObject({ sedeId: "s-fun", clienteId: "c-1", sedeClienteId: "sc-1", vehiculoId: "v-1", tecnicoId: "t-1" });
    expect(vehiculo.id).toBe("v-1");
    expect(codigo).toBe("FUN");
  });

  it("cada nivel aparece cuando el anterior está elegido", async () => {
    montar(coord);
    await screen.findByText("Transportes Reyna");
    expect(screen.queryByText("Planta Fundación")).toBeNull();
    await elegir("Transportes Reyna");
    expect(await screen.findByText("Planta Fundación")).toBeTruthy();
  });

  it("el técnico no elige técnico ni sede (tiene una): se asigna a sí mismo", async () => {
    const onCrear = montar(tecnico);
    await elegir("Transportes Reyna");
    await elegir("Planta Fundación");
    await elegir(/CA-12/);
    expect(screen.queryByText("Carlos Méndez")).toBeNull();
    expect(screen.queryByText("Sede Fundación")).toBeNull();
    fireEvent.click(screen.getByLabelText("Llegó sin conductor"));
    fireEvent.click(screen.getByTestId("crear-orden"));
    await waitFor(() => expect(onCrear).toHaveBeenCalled());
    expect((onCrear.mock.calls[0]?.[0] as { tecnicoId: string }).tecnicoId).toBe("t-1");
  });

  it("no crea con datos faltantes y dice qué falta", async () => {
    const onCrear = montar(coord);
    await screen.findByText("Transportes Reyna");
    fireEvent.click(screen.getByTestId("crear-orden"));
    expect(onCrear).not.toHaveBeenCalled();
    expect(screen.getByText("Falta para crear la orden")).toBeTruthy();
  });

  it("avisa si el vehículo ya tiene una orden abierta, sin bloquear", async () => {
    montar(tecnico, fuentes({ ordenesAbiertas: async () => ["OS-FUN-000004"] }));
    await elegir("Transportes Reyna");
    await elegir("Planta Fundación");
    await elegir(/CA-12/);
    expect(await screen.findByText("Este vehículo ya tiene una orden abierta")).toBeTruthy();
    expect(screen.getByTestId("crear-orden")).toBeTruthy();
  });

  it("solo ofrece las sedes de quien crea", async () => {
    montar({ ...coord, sedes: ["s-fun"] });
    await screen.findByText("Transportes Reyna");
    // Con una sola sede propia no hay nada que elegir.
    expect(screen.queryByText("Carro Taller 01")).toBeNull();
  });

  it("sin sedes lo explica en vez de dejar un formulario inútil", async () => {
    montar({ ...coord, sedes: [] });
    expect(await screen.findByText("No hay sedes disponibles")).toBeTruthy();
  });
});
