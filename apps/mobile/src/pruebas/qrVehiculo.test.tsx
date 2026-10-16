import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { EscanerQR } from "../flota/EscanerQR";
import { FichaVehiculo } from "../flota/FichaVehiculo";
import { PantallaEtiquetasQR } from "../flota/PantallaEtiquetasQR";
import { fijarPermiso, mostrarCodigo } from "./dobles/expo-camera";
import { unaOrden } from "./fabrica";
import type { FichaVehiculoLocal } from "../datos/repositorio";
import type { OrdenParaLista } from "../ordenes/lista";
import { elegirOpcion } from "./listas";

/** Código QR del vehículo (R15) en el teléfono. */

const ID = "3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b";

const FICHA: FichaVehiculoLocal = {
  id: ID, sedeClienteId: "sc", configuracionEjeId: "cfg", codigo: "CA-12", placa: "SXK482", nombre: "Tractocamión",
  kmActual: 78900, activo: true, cliente: "Transportes Reyna", sede: "Planta", plantilla: "Tractocamión 6x4",
};

const orden = (id: string, estado: string, fecha: string): OrdenParaLista => ({
  orden: unaOrden({ id, estado: estado as never, fecha, folio: `OS-FUN-${id}`, vehiculoId: ID }),
  vehiculoCodigo: "CA-12", clienteNombre: "Reyna", posicionesCapturadas: 3, posicionesTotales: 10, tieneCambiosSinEnviar: false,
});

describe("escanear el QR del vehículo", () => {
  afterEach(() => fijarPermiso({ granted: true, canAskAgain: true, status: "granted" }));

  it("abre la ficha con el id leído, una sola vez aunque la cámara lo repita", async () => {
    const onVehiculo = vi.fn();
    render(<EscanerQR onVehiculo={onVehiculo} />);
    act(() => {
      mostrarCodigo(`asistectire://vehiculo/${ID}`);
      mostrarCodigo(`asistectire://vehiculo/${ID}`);
    });
    expect(onVehiculo).toHaveBeenCalledTimes(1);
    expect(onVehiculo).toHaveBeenCalledWith(ID);
  });

  it("otro QR cualquiera se dice y no abre nada", () => {
    const onVehiculo = vi.fn();
    render(<EscanerQR onVehiculo={onVehiculo} />);
    act(() => mostrarCodigo("https://factura.example/123"));
    expect(onVehiculo).not.toHaveBeenCalled();
    expect(screen.getByText("Código no reconocido")).toBeTruthy();
  });

  it("sin permiso de cámara explica dónde activarlo", () => {
    fijarPermiso({ granted: false, canAskAgain: false, status: "denied" });
    render(<EscanerQR onVehiculo={vi.fn()} />);
    expect(screen.getByText(/Ajustes del teléfono/)).toBeTruthy();
    expect(screen.queryByTestId("camara")).toBeNull();
  });
});

describe("ficha del vehículo", () => {
  it("muestra qué vehículo es y su orden en curso primero", async () => {
    const onAbrirOrden = vi.fn();
    render(
      <FichaVehiculo
        ficha={FICHA}
        ordenes={[orden("1", "cerrada", "2026-09-01"), orden("2", "en_proceso", "2026-10-10")]}
        onAbrirOrden={onAbrirOrden}
        onNuevaOrden={vi.fn()}
      />,
    );
    expect(screen.getByTestId("codigo-vehiculo").textContent).toBe("CA-12");
    expect(screen.getByText("Transportes Reyna · Planta")).toBeTruthy();
    expect(screen.getByText("En curso (1)")).toBeTruthy();
    expect(screen.getByText("En proceso")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("orden-2")); });
    expect(onAbrirOrden).toHaveBeenCalledWith("2");
  });

  it("un vehículo deshabilitado lo dice y no ofrece orden nueva", () => {
    render(<FichaVehiculo ficha={{ ...FICHA, activo: false }} ordenes={[]} onAbrirOrden={vi.fn()} onNuevaOrden={vi.fn()} />);
    expect(screen.getByText("Vehículo deshabilitado")).toBeTruthy();
    expect(screen.queryByTestId("nueva-orden-vehiculo")).toBeNull();
  });

  it("si no está en el teléfono lo explica", () => {
    render(<FichaVehiculo ficha={null} ordenes={[]} onAbrirOrden={vi.fn()} />);
    expect(screen.getByText("Este vehículo no está en el teléfono")).toBeTruthy();
  });
});

describe("etiquetas QR", () => {
  it("baja el PDF del cliente elegido", async () => {
    const descargar = vi.fn().mockResolvedValue({ ok: true });
    render(<PantallaEtiquetasQR fuentes={{ clientes: vi.fn().mockResolvedValue([{ id: "c1", nombre: "Reyna" }]), descargar }} />);
    await elegirOpcion({ testID: "cliente-c1" });
    await act(async () => { fireEvent.click(screen.getByTestId("bajar-etiquetas")); });
    expect(descargar).toHaveBeenCalledWith("c1");
    expect(screen.getByText("Etiquetas listas")).toBeTruthy();
  });
});
