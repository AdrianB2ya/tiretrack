import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { VistaSoporte } from "../plataforma/VistaSoporte";
import { EmpresasPlataforma, type FuentesEmpresas } from "../plataforma/EmpresasPlataforma";
import { enLineaConToken, sesionSoporte, type SesionSoporte } from "../plataforma/soporte";

/** Sesión de soporte del superadmin (R16) en la app. */

const SESION: SesionSoporte = {
  token: "tok-soporte",
  sesionId: "s1",
  expiraEn: "2026-10-14T20:30:00Z",
  empresa: { id: "e1", nombre: "Asistectire" },
};

const ahora = () => new Date("2026-10-14T19:00:00Z");

describe("sesión de soporte", () => {
  it("el token de soporte viaja en cada consulta y no se guarda en ningún lado más que en memoria", async () => {
    const http = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    await enLineaConToken("https://api/api/v1", "tok-soporte", http)("GET", "/usuarios");
    expect(http).toHaveBeenCalledWith("https://api/api/v1/usuarios", { method: "GET", headers: { authorization: "Bearer tok-soporte" } });
    sesionSoporte.fijar(SESION);
    expect(sesionSoporte.actual()).toBe(SESION);
    sesionSoporte.limpiar();
    expect(sesionSoporte.actual()).toBeNull();
  });

  it("la vista avisa siempre dónde se está, que es de solo lectura y cuándo vence", async () => {
    const enLinea = vi.fn().mockResolvedValue({ ok: true, datos: { registros: [], hayMas: false } });
    render(<VistaSoporte sesion={SESION} enLinea={enLinea} onTerminada={vi.fn()} ahora={ahora} />);
    expect(screen.getByText("Soporte en Asistectire · solo lectura")).toBeTruthy();
    expect(screen.getByText(/Vence 2026-10-14 15:30/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("soporte-usuarios")); });
    expect(enLinea).toHaveBeenCalledWith("GET", "/usuarios");
  });

  it("terminarla avisa al servidor y sale; si ya había vencido, sale igual", async () => {
    const onTerminada = vi.fn();
    const enLinea = vi.fn(async (metodo: string) =>
      metodo === "POST" ? { ok: false, status: 401, codigo: "SOPORTE_TERMINADO", mensaje: "venció" } : { ok: true, datos: { registros: [] } },
    );
    render(<VistaSoporte sesion={SESION} enLinea={enLinea as never} onTerminada={onTerminada} ahora={ahora} />);
    await act(async () => { fireEvent.click(screen.getByTestId("terminar-soporte")); });
    expect(enLinea).toHaveBeenCalledWith("POST", "/plataforma/soporte/terminar", {});
    expect(onTerminada).toHaveBeenCalled();
  });

  it("abrirla exige motivo y ticket antes de pedirla", async () => {
    const abrirSoporte = vi.fn().mockResolvedValue({ ok: true, datos: SESION });
    const onSoporteAbierto = vi.fn();
    const fuentes: FuentesEmpresas = {
      empresas: vi.fn().mockResolvedValue({ ok: true, datos: [{ id: "e1", nombre: "Asistectire", nit: "901", activa: true, creadaEn: "2026-10-01" }] }),
      crear: vi.fn(),
      compartir: vi.fn(),
      abrirSoporte,
      onSoporteAbierto,
    };
    render(<EmpresasPlataforma fuentes={fuentes} />);
    const boton = await screen.findByTestId("soporte-e1");
    await act(async () => { fireEvent.click(boton); });
    await act(async () => { fireEvent.click(screen.getByTestId("abrir-soporte")); });
    expect(abrirSoporte).not.toHaveBeenCalled();
    expect(screen.getByText("Falta información")).toBeTruthy();
    await act(async () => {
      fireEvent.change(screen.getByTestId("soporte-motivo"), { target: { value: "El administrador no ve sus órdenes de ayer" } });
      fireEvent.change(screen.getByTestId("soporte-ticket"), { target: { value: "SOP-1042" } });
    });
    await act(async () => { fireEvent.click(screen.getByTestId("duracion-30")); });
    await act(async () => { fireEvent.click(screen.getByTestId("abrir-soporte")); });
    expect(abrirSoporte).toHaveBeenCalledWith("e1", { motivo: "El administrador no ve sus órdenes de ayer", ticket: "SOP-1042", minutos: 30 });
    expect(onSoporteAbierto).toHaveBeenCalledWith(SESION);
  });
});
