import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { PantallaAuditoria, consultaAuditoria, type RegistroAuditoria } from "../admin/PantallaAuditoria";

/** Auditoría (5.4): quién sacó datos y quién cambió qué. */

const registro = (id: string, extra: Partial<RegistroAuditoria> = {}): RegistroAuditoria => ({
  id, usuarioId: "u-1", usuarioNombre: "Jorge Ramírez", rol: "coordinador", accion: "exportar_informe",
  detalle: { registros: 44, sinCerrar: 2 }, ip: "10.0.0.1", creadoEn: "2026-10-07T02:15:00Z", ...extra,
});

describe("consulta de la auditoría", () => {
  it("arma días de Colombia y la acción; 'Todo' no pone fechas", () => {
    expect(consultaAuditoria("hoy", "deshabilitar", "2026-10-06")).toBe("?desde=2026-10-06&hasta=2026-10-06&accion=deshabilitar");
    expect(consultaAuditoria("todo", null, "2026-10-06")).toBe("");
    expect(consultaAuditoria("todo", null, "2026-10-06", "2026-10-06T12:00:00.000Z")).toBe("?antes=2026-10-06T12%3A00%3A00.000Z");
  });
});

describe("pantalla de auditoría", () => {
  it("muestra quién, cuándo en hora de Colombia y qué salió; lo automático es Sistema", async () => {
    const cargar = vi.fn().mockResolvedValue({ ok: true, datos: { registros: [registro("a"), registro("b", { usuarioId: null, usuarioNombre: null, accion: "cambiar_estado", detalle: null })], siguiente: null } });
    render(<PantallaAuditoria cargar={cargar} hoy="2026-10-06" />);
    expect(await screen.findByText("Jorge Ramírez · coordinador")).toBeTruthy();
    expect(screen.getAllByText("2026-10-06 21:15")).toHaveLength(2);
    expect(screen.getByText("44 registros · 2 sin cerrar")).toBeTruthy();
    expect(screen.getByText("Sistema")).toBeTruthy();
  });

  it("cambiar el filtro vuelve a consultar; 'Ver más' agrega con el cursor", async () => {
    const cargar = vi.fn()
      .mockResolvedValueOnce({ ok: true, datos: { registros: [registro("a")], siguiente: "2026-10-06T12:00:00.000Z" } })
      .mockResolvedValueOnce({ ok: true, datos: { registros: [registro("b")], siguiente: null } })
      .mockResolvedValue({ ok: true, datos: { registros: [], siguiente: null } });
    render(<PantallaAuditoria cargar={cargar} hoy="2026-10-06" />);
    const mas = await screen.findByTestId("ver-mas-auditoria");
    await act(async () => { fireEvent.click(mas); });
    expect(cargar.mock.calls[1]?.[0]).toContain("antes=");
    expect(screen.getByTestId("registro-a")).toBeTruthy();
    expect(screen.getByTestId("registro-b")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("accion-login_fallido")); });
    await waitFor(() => expect(cargar.mock.calls.at(-1)?.[0]).toContain("accion=login_fallido"));
    expect(await screen.findByText("Nada registrado en ese período.")).toBeTruthy();
  });

  it("sin señal lo dice y deja reintentar", async () => {
    const cargar = vi.fn().mockResolvedValueOnce({ ok: false, status: 0, mensaje: "x" })
      .mockResolvedValue({ ok: true, datos: { registros: [], siguiente: null } });
    render(<PantallaAuditoria cargar={cargar} hoy="2026-10-06" />);
    expect(await screen.findByText(/Sin señal/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("reintentar-auditoria")); });
    expect(await screen.findByText("Nada registrado en ese período.")).toBeTruthy();
  });
});
