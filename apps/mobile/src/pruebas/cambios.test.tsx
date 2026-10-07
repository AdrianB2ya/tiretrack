import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describirCambio, situacionDe, type CambioSinEnviar } from "../sesion/cambios";
import { CambiosSinEnviar } from "../sesion/CambiosSinEnviar";

/** Cambios sin enviar: antes solo se sabía cuántos, no cuáles ni por qué. */

const cambio = (extra: Partial<CambioSinEnviar>): CambioSinEnviar => ({
  id: "op-1", tipo: "guardar_medicion", datos: { posicion: 3 }, orden: "OS-FUN-000004",
  intentos: 0, ultimoError: null, motivoRechazo: null, ...extra,
});

describe("cómo se describe cada cambio", () => {
  it("en palabras del técnico, con su orden", () => {
    expect(describirCambio(cambio({}))).toBe("Medición de la posición 3 · OS-FUN-000004");
    expect(describirCambio(cambio({ tipo: "cambiar_estado", datos: { estado: "en_revision" } }))).toBe("Cambio de estado a en revisión · OS-FUN-000004");
    expect(describirCambio(cambio({ tipo: "firmar", datos: {}, orden: null }))).toBe("Firma del cliente");
  });

  it("distingue lo que espera de lo rechazado", () => {
    expect(situacionDe(cambio({}))).toEqual({ apartado: false, texto: "Esperando para enviarse" });
    expect(situacionDe(cambio({ intentos: 2, ultimoError: "sin señal" })).texto).toMatch(/Se reintenta solo \(2 intentos\)/);
    expect(situacionDe(cambio({ motivoRechazo: "POSICION_OCUPADA" }))).toMatchObject({ apartado: true });
  });
});

describe("pantalla de cambios sin enviar", () => {
  it("muestra el motivo; descartar pide un segundo toque; reintentar vuelve a enviar", async () => {
    const fuentes = {
      listar: vi.fn().mockResolvedValue([cambio({ motivoRechazo: "POSICION_OCUPADA: otra medición ocupa la posición 3" })]),
      reintentar: vi.fn().mockResolvedValue(undefined),
      descartar: vi.fn().mockResolvedValue(undefined),
    };
    render(<CambiosSinEnviar fuentes={fuentes} />);
    expect(await screen.findByText(/POSICION_OCUPADA/)).toBeTruthy();
    expect(screen.getByText("Uno fue rechazado por el servidor")).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByTestId("descartar-op-1")); });
    expect(fuentes.descartar).not.toHaveBeenCalled();
    expect(screen.getByText(/no llegará nunca al servidor/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("descartar-op-1")); });
    expect(fuentes.descartar).toHaveBeenCalledWith("op-1");

    await act(async () => { fireEvent.click(screen.getByTestId("reintentar-op-1")); });
    expect(fuentes.reintentar).toHaveBeenCalledWith("op-1");
  });

  it("sin nada pendiente no muestra nada", async () => {
    const { container } = render(<CambiosSinEnviar fuentes={{ listar: async () => [], reintentar: vi.fn(), descartar: vi.fn() }} />);
    await act(async () => {});
    expect(container.textContent).toBe("");
  });
});
