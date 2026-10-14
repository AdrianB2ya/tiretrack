import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { EnviarPorCorreo } from "../informe/EnviarPorCorreo";

/** Enviar por correo desde el servidor (R13). */

const escribir = (testID: string, valor: string) => fireEvent.change(screen.getByTestId(testID), { target: { value: valor } });

describe("enviar por correo", () => {
  it("revisa los destinatarios antes de enviar y no deja enviar con uno mal escrito", async () => {
    const enviar = vi.fn();
    render(<EnviarPorCorreo enviar={enviar} />);
    await act(async () => { fireEvent.click(screen.getByTestId("correo-abrir")); });
    await act(async () => { escribir("correo-para", "jefe@flota.co, mal@"); });
    expect(screen.getByText("No son correos válidos: mal@")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("correo-enviar")); });
    expect(enviar).not.toHaveBeenCalled();
  });

  it("envía los destinatarios limpios, el mensaje y el formato elegido", async () => {
    const enviar = vi.fn().mockResolvedValue({ ok: true, datos: { enviadoA: ["jefe@flota.co"] } });
    render(<EnviarPorCorreo enviar={enviar} formatos={["csv", "pdf"]} testID="ci" />);
    await act(async () => { fireEvent.click(screen.getByTestId("ci-abrir")); });
    await act(async () => { escribir("ci-para", "Jefe@Flota.co"); escribir("ci-mensaje", "Buen día"); });
    await act(async () => { fireEvent.click(screen.getByTestId("ci-formato-pdf")); });
    await act(async () => { fireEvent.click(screen.getByTestId("ci-enviar")); });
    expect(enviar).toHaveBeenCalledWith(["jefe@flota.co"], "Buen día", "pdf");
    expect(screen.getByText("A jefe@flota.co")).toBeTruthy();
  });

  it("si el servidor no tiene correo activado, lo dice", async () => {
    const enviar = vi.fn().mockResolvedValue({
      ok: false, status: 422, mensaje: 'El envío por correo no está activado. Usa "Compartir" para enviarlo por WhatsApp u otra app.',
    });
    render(<EnviarPorCorreo enviar={enviar} />);
    await act(async () => { fireEvent.click(screen.getByTestId("correo-abrir")); });
    await act(async () => { escribir("correo-para", "a@b.co"); });
    await act(async () => { fireEvent.click(screen.getByTestId("correo-enviar")); });
    expect(screen.getByText("No se envió")).toBeTruthy();
    expect(screen.getByText(/Compartir/)).toBeTruthy();
  });
});
