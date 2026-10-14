import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PantallaCarga, type FuentesCarga } from "../carga/PantallaCarga";

/** Carga masiva desde Excel (R12) en el teléfono. */

const BUENO = "CLIENTE;NIT;SEDE;CODIGO;DESCRIPCION;PLANTILLA\nTransportes Reyna;800;Planta;CA-12;Tracto;6x4\n";
const MALO = "CLIENTE;NIT;SEDE;CODIGO;DESCRIPCION;PLANTILLA\nTransportes Reyna;800;Planta;;Tracto;6x4\n";

function fuentes(extra: Partial<FuentesCarga> = {}): FuentesCarga {
  return {
    elegir: vi.fn().mockResolvedValue({ ok: true, nombre: "flota.csv", texto: BUENO }),
    compartirPlantilla: vi.fn().mockResolvedValue({ ok: true }),
    cargar: vi.fn().mockResolvedValue({ ok: true, datos: { filas: 1, creados: { clientes: 1, sedes: 1, vehiculos: 1 }, existentes: 0 } }),
    ...extra,
  };
}

describe("carga masiva", () => {
  it("revisa el archivo antes de enviar y carga cuando todo está bien", async () => {
    const f = fuentes();
    render(<PantallaCarga fuentes={f} />);
    await act(async () => { fireEvent.click(screen.getByTestId("elegir-archivo")); });
    expect(screen.getByText("Todas las filas están bien.")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("cargar")); });
    expect(f.cargar).toHaveBeenCalledWith("flota", BUENO);
    expect(screen.getByText(/1 clientes, 1 sedes, 1 vehículos/)).toBeTruthy();
  });

  it("con filas malas dice cuáles y no deja cargar", async () => {
    const f = fuentes({ elegir: vi.fn().mockResolvedValue({ ok: true, nombre: "flota.csv", texto: MALO }) });
    render(<PantallaCarga fuentes={f} />);
    await act(async () => { fireEvent.click(screen.getByTestId("elegir-archivo")); });
    expect(screen.getByText("Fila 2: Falta CODIGO")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("cargar")); });
    expect(f.cargar).not.toHaveBeenCalled();
  });

  it("si el servidor encuentra problemas, los muestra fila por fila", async () => {
    const f = fuentes({
      cargar: vi.fn().mockResolvedValue({
        ok: false, status: 422, mensaje: "1 problema(s): no se cargó nada",
        cuerpo: { errores: [{ fila: 2, mensaje: 'No hay una plantilla de ejes vigente llamada "6x4"' }] },
      }),
    });
    render(<PantallaCarga fuentes={f} />);
    await act(async () => { fireEvent.click(screen.getByTestId("elegir-archivo")); });
    await act(async () => { fireEvent.click(screen.getByTestId("cargar")); });
    expect(screen.getByText("No se cargó nada")).toBeTruthy();
    expect(screen.getByText(/Fila 2: No hay una plantilla/)).toBeTruthy();
  });

  it("baja la plantilla del tipo elegido", async () => {
    const f = fuentes();
    render(<PantallaCarga fuentes={f} />);
    await act(async () => { fireEvent.click(screen.getByTestId("carga-catalogo")); });
    await act(async () => { fireEvent.click(screen.getByTestId("bajar-plantilla")); });
    expect(f.compartirPlantilla).toHaveBeenCalledWith("plantilla-catalogo.csv", expect.stringContaining("MARCA;DISEÑO;TIPO EJE"));
  });

  it("cancelar la elección no es un error", async () => {
    render(<PantallaCarga fuentes={fuentes({ elegir: vi.fn().mockResolvedValue({ ok: false, cancelado: true }) })} />);
    await act(async () => { fireEvent.click(screen.getByTestId("elegir-archivo")); });
    expect(screen.queryByText(/No se pudo/)).toBeNull();
  });
});
