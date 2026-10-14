import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { coincide, POR_PAGINA } from "../diseno/BusquedaLista";
import { PantallaFlota, type FuentesFlota } from "../flota/PantallaFlota";
import { ElegirUno } from "../diseno/ListaBuscable";

/**
 * Listas con datos reales (pedido del usuario: "si tengo 1000 clientes ya te
 * imaginas la pantalla"). Ninguna pinta todo: se busca y se ve de a 20.
 */

const MIL = Array.from({ length: 1000 }, (_, i) => ({
  id: `c-${i}`,
  nombre: `Cliente ${String(i).padStart(4, "0")}`,
  nit: `900${String(i).padStart(6, "0")}`,
}));

function fuentesFlota(): FuentesFlota {
  return {
    clientes: vi.fn().mockResolvedValue(MIL),
    sedesDeCliente: vi.fn().mockResolvedValue([]),
    vehiculos: vi.fn().mockResolvedValue([]),
    plantillas: vi.fn().mockResolvedValue([]),
  };
}

describe("búsqueda en listas", () => {
  it("palabra por palabra, en cualquier orden y sin tildes", () => {
    expect(coincide("Transportes Reyna · SXK482", "reyna 482")).toBe(true);
    expect(coincide("Logística Andina", "logistica")).toBe(true);
    expect(coincide("Transportes Reyna", "reyna bogota")).toBe(false);
  });

  it("mil clientes: se ven 20, se pide más y se busca por nombre o NIT", async () => {
    render(<PantallaFlota rol="coordinador" fuentes={fuentesFlota()} acciones={{ crearCliente: vi.fn(), crearSede: vi.fn(), crearVehiculo: vi.fn() }} />);
    const primero = await screen.findByTestId("cliente-c-0");
    expect(primero).toBeTruthy();
    expect(screen.queryByTestId(`cliente-c-${POR_PAGINA}`)).toBeNull();
    expect(screen.getByTestId("mas-clientes").textContent).toContain("quedan 980");
    await act(async () => { fireEvent.click(screen.getByTestId("mas-clientes")); });
    expect(screen.getByTestId(`cliente-c-${POR_PAGINA}`)).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByTestId("buscar-cliente"), { target: { value: "900000777" } }); });
    expect(screen.getByTestId("cliente-c-777")).toBeTruthy();
    expect(screen.queryByTestId("cliente-c-0")).toBeNull();
  });

  it("elegir entre mil: con algo elegido, una sola línea; sin elegir, pocas opciones a la vista", async () => {
    const opciones = MIL.map((c) => ({ id: c.id, texto: c.nombre }));
    const { container, unmount } = render(<ElegirUno opciones={[{ id: "todos", texto: "Todos" }, ...opciones]} seleccionado="todos" onElegir={vi.fn()} />);
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(0);
    expect(screen.getByText("Todos")).toBeTruthy();
    unmount();
    const { container: c2 } = render(<ElegirUno opciones={opciones} seleccionado={null} onElegir={vi.fn()} />);
    expect(c2.querySelectorAll('[role="radio"]').length).toBeLessThanOrEqual(10);
  });
});
