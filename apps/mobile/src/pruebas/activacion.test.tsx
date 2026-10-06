import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { activar, revisarActivacion, secretoLegible } from "../sesion/activacion";
import { PantallaActivacion } from "../sesion/PantallaActivacion";

/**
 * Activación con código (no hay correo: decisión del usuario).
 *
 * Un código equivocado cuenta como intento fallido de la cuenta: lo que se
 * pueda revisar antes de enviar, se revisa.
 */

const datos = { email: "pedro@asistectire.com", codigo: "k7m2 x9qp", password: "CampoFundacion26", confirmacion: "CampoFundacion26" };

describe("antes de enviar", () => {
  it("completo no tiene problemas, aunque el código venga en minúsculas", () => {
    expect(revisarActivacion(datos)).toEqual([]);
  });

  it("un código de largo equivocado no se envía", () => {
    expect(revisarActivacion({ ...datos, codigo: "K7M2-X9Q" }).map((p) => p.campo)).toContain("codigo");
  });

  it("contraseñas distintas o débiles no se envían", () => {
    expect(revisarActivacion({ ...datos, confirmacion: "otra" }).map((p) => p.campo)).toContain("confirmacion");
    expect(revisarActivacion({ ...datos, password: "123", confirmacion: "123" }).map((p) => p.campo)).toContain("password");
  });

  it("el secreto se muestra de a cuatro para copiarlo a mano", () => {
    expect(secretoLegible("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });
});

describe("respuesta del servidor", () => {
  const con = (status: number, cuerpo: unknown) => ({
    baseUrl: "https://api/v1",
    fetch: vi.fn().mockResolvedValue({ ok: status < 300, status, json: async () => cuerpo } as Response) as unknown as typeof fetch,
  });

  it.each([
    [200, { activada: true }, "ok"],
    [200, { configurar2fa: { secreto: "S", uri: "otpauth://x" } }, "configurar_2fa"],
    [409, { empresas: [] }, "elegir_empresa"],
    [401, { error: { mensaje: "Correo o código de activación no válidos" } }, "rechazada"],
    [503, {}, "sin_conexion"],
  ])("%s %j → %s", async (status, cuerpo, tipo) => {
    expect((await activar(con(status, cuerpo), datos)).tipo).toBe(tipo);
  });

  it("sin red lo dice distinto de un código malo", async () => {
    const r = await activar({ baseUrl: "x", fetch: vi.fn().mockRejectedValue(new Error("red")) as unknown as typeof fetch }, datos);
    expect(r.tipo).toBe("sin_conexion");
  });
});

describe("pantalla", () => {
  const escribir = (etiqueta: string, valor: string) =>
    fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });
  function llenar() {
    escribir("Correo", datos.email);
    escribir("Código de activación", datos.codigo);
    escribir("Contraseña nueva", datos.password);
    escribir("Repite la contraseña", datos.confirmacion);
  }

  it("el técnico activa en un paso", async () => {
    const onActivar = vi.fn().mockResolvedValue({ tipo: "ok" });
    render(<PantallaActivacion onActivar={onActivar} onAbrirAutenticador={vi.fn()} onVolver={vi.fn()} />);
    llenar();
    fireEvent.click(screen.getByTestId("activar"));
    await waitFor(() => expect(onActivar).toHaveBeenCalledWith(expect.objectContaining({ email: datos.email, password: datos.password })));
  });

  it("con datos inválidos no gasta un intento", () => {
    const onActivar = vi.fn();
    render(<PantallaActivacion onActivar={onActivar} onAbrirAutenticador={vi.fn()} onVolver={vi.fn()} />);
    fireEvent.click(screen.getByTestId("activar"));
    expect(onActivar).not.toHaveBeenCalled();
  });

  it("el administrador registra la app autenticadora y confirma con su código", async () => {
    const onActivar = vi.fn()
      .mockResolvedValueOnce({ tipo: "configurar_2fa", secreto: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/x" })
      .mockResolvedValueOnce({ tipo: "ok" });
    const onAbrir = vi.fn();
    render(<PantallaActivacion onActivar={onActivar} onAbrirAutenticador={onAbrir} onVolver={vi.fn()} />);
    llenar();
    fireEvent.click(screen.getByTestId("activar"));
    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP")).toBeTruthy();
    fireEvent.click(screen.getByTestId("abrir-autenticador"));
    expect(onAbrir).toHaveBeenCalledWith("otpauth://totp/x");
    escribir("Código de la app autenticadora", "123 456");
    fireEvent.click(screen.getByTestId("activar"));
    await waitFor(() => expect(onActivar).toHaveBeenLastCalledWith(expect.objectContaining({ codigo2fa: "123 456" })));
  });

  it("un código rechazado se explica", async () => {
    const onActivar = vi.fn().mockResolvedValue({ tipo: "rechazada", mensaje: "Correo o código de activación no válidos" });
    render(<PantallaActivacion onActivar={onActivar} onAbrirAutenticador={vi.fn()} onVolver={vi.fn()} />);
    llenar();
    fireEvent.click(screen.getByTestId("activar"));
    expect(await screen.findByText("No se pudo activar")).toBeTruthy();
  });
});
