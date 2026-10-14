import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { accionesCatalogoGeneral } from "../plataforma/catalogoGeneral";
import { PantallaCatalogo } from "../catalogo/PantallaCatalogo";

/** Catálogo general de la plataforma desde la app. */

describe("catálogo general", () => {
  it("habla con las rutas de la plataforma y todo lo que trae es del catálogo general", async () => {
    const enLinea = vi.fn(async (metodo: string, ruta: string) => {
      if (metodo === "GET" && ruta === "/plataforma/catalogo/marcas") return { ok: true, datos: [{ id: "m1", nombre: "Continental" }] };
      return { ok: true, datos: { id: "m2", nombre: "Bridgestone" } };
    });
    const c = accionesCatalogoGeneral(enLinea as never);
    expect(await c.marcas()).toEqual([{ id: "m1", nombre: "Continental", esGlobal: true, creadaLocal: false }]);
    await c.crearMarca("Bridgestone");
    expect(enLinea).toHaveBeenLastCalledWith("POST", "/plataforma/catalogo/marcas", { id: expect.any(String), nombre: "Bridgestone" });
  });

  it("sin profundidad de fábrica no manda un null", async () => {
    const enLinea = vi.fn().mockResolvedValue({ ok: true, datos: { id: "x", disenoId: "d1", medida: "11R22.5", profundidadOriginal: null } });
    await accionesCatalogoGeneral(enLinea).crearMedida("d1", "11R22.5", null);
    expect(enLinea.mock.calls[0]?.[2]).not.toHaveProperty("profundidadOriginal");
  });

  it("si el servidor rechaza el alta, la pantalla muestra el motivo en vez de fallar en silencio", async () => {
    const enLinea = vi.fn(async (metodo: string) =>
      metodo === "GET" ? { ok: true, datos: [] } : { ok: false, status: 409, mensaje: 'Ya existe "Michelin". Selecciónala en vez de crearla' },
    );
    render(<PantallaCatalogo fuentes={{ catalogo: accionesCatalogoGeneral(enLinea as never), descripcion: "Catálogo general" }} />);
    expect(await screen.findByText("Catálogo general")).toBeTruthy();
    const campo = screen.getByTestId("cat-marca-buscar");
    await act(async () => { fireEvent.change(campo, { target: { value: "Michelin" } }); });
    const crear = screen.getByText(/Agregar marca/);
    await act(async () => { fireEvent.click(crear); });
    expect(await screen.findByText(/Ya existe "Michelin"/)).toBeTruthy();
  });
});
