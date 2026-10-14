import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PantallaUsuarios, type FuentesUsuarios, type UsuarioListado } from "../admin/PantallaUsuarios";

/** Códigos de activación en lote desde la app. */

const u = (id: string, nombre: string, extra: Partial<UsuarioListado> = {}): UsuarioListado => ({
  id, nombre, email: `${id}@x.co`, rol: "tecnico", activo: true, sedes: [], sinActivar: true, ...extra,
});

function fuentes(extra: Partial<FuentesUsuarios> = {}): FuentesUsuarios {
  return {
    usuarios: vi.fn().mockResolvedValue({ ok: true, datos: [u("a", "Ana"), u("b", "Beto"), u("c", "Caro", { sinActivar: false })] }),
    sedes: vi.fn().mockResolvedValue({ ok: true, datos: [] }),
    clientes: vi.fn().mockResolvedValue([]),
    crear: vi.fn(),
    nuevoCodigo: vi.fn(),
    cambiarActivo: vi.fn(),
    compartir: vi.fn(),
    codigosEnLote: vi.fn().mockResolvedValue({
      ok: true,
      datos: {
        codigos: [
          { usuarioId: "a", nombre: "Ana", email: "a@x.co", codigo: "K7M2-X9QP", expiraEn: "2026-10-17T12:00:00Z" },
          { usuarioId: "b", nombre: "Beto", email: "b@x.co", codigo: "H4N7-W3RT", expiraEn: "2026-10-17T12:00:00Z" },
        ],
      },
    }),
    ...extra,
  };
}

describe("códigos en lote", () => {
  it("ofrece a los que no han activado, todos elegidos, y se puede quitar alguno", async () => {
    const f = fuentes();
    render(<PantallaUsuarios fuentes={f} />);
    const boton = await screen.findByTestId("codigos-lote");
    expect(boton.textContent).toContain("(2)");
    await act(async () => { fireEvent.click(boton); });
    await act(async () => { fireEvent.click(screen.getByTestId("lote-b")); });
    await act(async () => { fireEvent.click(screen.getByTestId("generar-lote")); });
    expect(f.codigosEnLote).toHaveBeenCalledWith(["a"]);
  });

  it("cada código se envía en su propio mensaje, a su persona, y se marca enviado", async () => {
    const f = fuentes();
    render(<PantallaUsuarios fuentes={f} />);
    const boton = await screen.findByTestId("codigos-lote");
    await act(async () => { fireEvent.click(boton); });
    await act(async () => { fireEvent.click(screen.getByTestId("generar-lote")); });
    await act(async () => { fireEvent.click(screen.getByTestId("enviar-lote-a")); });
    expect(f.compartir).toHaveBeenCalledTimes(1);
    const mensaje = vi.mocked(f.compartir).mock.calls[0]?.[0] ?? "";
    expect(mensaje).toContain("K7M2-X9QP");
    expect(mensaje).not.toContain("H4N7-W3RT");
    expect(screen.getByText("Enviado")).toBeTruthy();
    expect(screen.getByText(/Falta enviar 1/)).toBeTruthy();
  });
});
