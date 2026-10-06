import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ClienteHttp } from "../datos/clienteHttp";
import { BotonPdf } from "../ordenes/BotonPdf";

/** PDF de la orden: se baja al teléfono y se comparte. */

describe("descarga de archivos", () => {
  it("baja con la sesión y la renueva una vez ante un 401", async () => {
    let token = "viejo";
    const bajar = vi.fn()
      .mockResolvedValueOnce({ status: 401, uri: "" })
      .mockResolvedValueOnce({ status: 200, uri: "file:///cache/OS-1.pdf" });
    const c = new ClienteHttp({ baseUrl: "https://api/v1", obtenerToken: async () => token, renovarSesion: async () => { token = "nuevo"; return true; } });
    const r = await c.descargarArchivo("/ordenes/o-1/pdf", bajar);
    expect(r).toEqual({ ok: true, uri: "file:///cache/OS-1.pdf" });
    expect(bajar.mock.calls[1]).toEqual(["https://api/v1/ordenes/o-1/pdf", { Authorization: "Bearer nuevo" }]);
  });

  it("una orden no disponible y la falta de señal se distinguen", async () => {
    const c = new ClienteHttp({ baseUrl: "x", obtenerToken: async () => "t" });
    expect(await c.descargarArchivo("/p", async () => ({ status: 404, uri: "" }))).toMatchObject({ ok: false, status: 404 });
    expect(await c.descargarArchivo("/p", async () => { throw new Error("red"); })).toMatchObject({ ok: false, status: 0 });
  });
});

describe("botón del PDF", () => {
  it("descarga y abre la hoja de compartir con el archivo", async () => {
    const compartir = vi.fn().mockResolvedValue({ ok: true });
    render(<BotonPdf descargar={async () => ({ ok: true, uri: "file:///x.pdf" })} compartir={compartir} />);
    await act(async () => { fireEvent.click(screen.getByTestId("descargar-pdf")); });
    expect(compartir).toHaveBeenCalledWith("file:///x.pdf");
  });

  it("si falla lo dice, con el motivo", async () => {
    render(<BotonPdf descargar={async () => ({ ok: false, status: 0, mensaje: "No hay señal. Descargar el PDF necesita conexión" })} compartir={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByTestId("descargar-pdf")); });
    expect(screen.getByText(/necesita conexión/)).toBeTruthy();
  });
});
