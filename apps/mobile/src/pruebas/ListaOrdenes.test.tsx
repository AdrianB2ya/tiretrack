import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ListaOrdenes, TarjetaOrden } from "../ordenes/ListaOrdenes";
import type { OrdenParaLista } from "../ordenes/lista";
import type { OrdenLocal } from "../datos/repositorio";

/**
 * Pantalla de órdenes.
 *
 * Se prueba lo que el técnico tiene que poder ver sin leer con atención: la
 * sección urgente arriba, cuánto le falta a cada orden y qué tiene sin
 * enviar.
 */

const ordenBase: OrdenLocal = {
  id: "ord-1",
  folio: "OS-FUN-000001",
  codigoReferencia: null,
  sedeId: "sede-fun",
  vehiculoId: "veh-1",
  clienteId: "cli-1",
  tecnicoId: "u-tec1",
  tecnicoNombre: "Carlos Méndez",
  enviadaRevisionEn: null,
  limiteCliente: null,
  estado: "programada",
  motivoDevolucion: null,
  notaCoordinador: null,
  fecha: "2026-09-17",
  configuracionEjeId: "cfg-1",
  kilometraje: null,
  hallazgos: null,
  accion: null,
  firmaNombre: null,
  firmaCedula: null,
  firmaVersion: null,
  firmaTrazo: null,
  firmaCargo: null,
  firmaFechaHora: null,
  version: 0,
  versionContenido: 0,
  sincronizada: true,
};

function item(orden: Partial<OrdenLocal>, extra: Partial<OrdenParaLista> = {}): OrdenParaLista {
  return {
    orden: { ...ordenBase, ...orden },
    vehiculoCodigo: "CA-12",
    clienteNombre: "Transportes Reyna",
    posicionesCapturadas: 0,
    posicionesTotales: 22,
    tieneCambiosSinEnviar: false,
    ...extra,
  };
}

describe("listado", () => {
  it("muestra las órdenes agrupadas", () => {
    render(
      <ListaOrdenes
        ordenes={[item({ id: "a", estado: "programada" }), item({ id: "b", estado: "en_proceso" })]}
        onAbrir={vi.fn()}
      />,
    );
    expect(screen.getByText("Por hacer")).toBeTruthy();
    expect(screen.getByText("En curso")).toBeTruthy();
  });

  it("explica por qué no hay nada en vez de dejar la pantalla vacía", () => {
    render(<ListaOrdenes ordenes={[]} onAbrir={vi.fn()} />);
    expect(screen.getByText("No tienes órdenes asignadas")).toBeTruthy();
  });

  it("admite un mensaje propio cuando el vacío es por un filtro", () => {
    render(
      <ListaOrdenes ordenes={[]} onAbrir={vi.fn()} mensajeVacio="Ninguna coincide con la búsqueda" />,
    );
    expect(screen.getByText("Ninguna coincide con la búsqueda")).toBeTruthy();
  });

  it("abre la orden al tocarla", () => {
    const abrir = vi.fn();
    render(<ListaOrdenes ordenes={[item({ id: "ord-9" })]} onAbrir={abrir} />);
    fireEvent.click(screen.getByTestId("orden-ord-9"));
    expect(abrir).toHaveBeenCalledWith("ord-9");
  });

  it("muestra cuántas hay en cada sección", () => {
    render(
      <ListaOrdenes
        ordenes={[item({ id: "a" }), item({ id: "b" }), item({ id: "c" })]}
        onAbrir={vi.fn()}
      />,
    );
    expect(screen.getByText("3")).toBeTruthy();
  });
});

describe("tarjeta de orden", () => {
  it("muestra folio, vehículo y cliente", () => {
    render(<TarjetaOrden item={item({})} onPress={vi.fn()} />);
    expect(screen.getByText("OS-FUN-000001")).toBeTruthy();
    expect(screen.getByText("CA-12")).toBeTruthy();
    expect(screen.getByText("Transportes Reyna")).toBeTruthy();
  });

  it("muestra el estado en texto, no solo por color", () => {
    render(<TarjetaOrden item={item({ estado: "en_proceso" })} onPress={vi.fn()} />);
    expect(screen.getByText("En proceso")).toBeTruthy();
  });

  it("muestra el código de referencia cuando aún no hay folio", () => {
    render(
      <TarjetaOrden
        item={item({ folio: null, codigoReferencia: "FUN-K7M2" })}
        onPress={vi.fn()}
      />,
    );
    expect(screen.getByText("FUN-K7M2")).toBeTruthy();
  });

  it("marca lo que tiene cambios sin enviar", () => {
    // Un punto basta: el técnico lo reconoce de reojo sin leer.
    render(<TarjetaOrden item={item({}, { tieneCambiosSinEnviar: true })} onPress={vi.fn()} />);
    expect(screen.getByLabelText("Con cambios sin enviar")).toBeTruthy();
  });

  it("no marca las que están al día", () => {
    render(<TarjetaOrden item={item({})} onPress={vi.fn()} />);
    expect(screen.queryByLabelText("Con cambios sin enviar")).toBeNull();
  });

  it("muestra el motivo de devolución completo", () => {
    // El técnico tiene que saber qué corregir sin abrir la orden.
    render(
      <TarjetaOrden
        item={item({ estado: "en_proceso", motivoDevolucion: "Falta el número de parche en la 6" })}
        onPress={vi.fn()}
      />,
    );
    expect(screen.getByText("Falta el número de parche en la 6")).toBeTruthy();
  });

  it("el progreso se lee como cuentas, no como porcentaje", () => {
    // "17 de 22" se entiende mejor que "77%" cuando lo que falta es tocar
    // cinco casillas más.
    render(<TarjetaOrden item={item({}, { posicionesCapturadas: 17 })} onPress={vi.fn()} />);
    expect(screen.getByText("17 de 22")).toBeTruthy();
  });

  it("no muestra progreso si no se sabe cuántas posiciones tiene", () => {
    render(
      <TarjetaOrden item={item({}, { posicionesTotales: 0 })} onPress={vi.fn()} />,
    );
    expect(screen.queryByText(/de 0/)).toBeNull();
  });

  it("responde al toque", () => {
    const tocar = vi.fn();
    render(<TarjetaOrden item={item({ id: "x" })} onPress={tocar} />);
    fireEvent.click(screen.getByTestId("orden-x"));
    expect(tocar).toHaveBeenCalledOnce();
  });
});
