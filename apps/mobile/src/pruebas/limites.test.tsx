import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { LIMITES_POR_DEFECTO } from "@tiretrack/domain";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";
import { PantallaLimites, type FuentesLimites } from "../admin/PantallaLimites";

/** Límites de cambio por empresa (R2): se fijan en línea y viajan al teléfono. */

describe("límites en el teléfono", () => {
  it("sin descarga todavía, los de por defecto: mejor un umbral razonable que ninguno", async () => {
    const db = await abrirBaseEnMemoria();
    await migrar(db);
    const repo = new RepositorioLocal(db);
    expect(await repo.limites()).toEqual(LIMITES_POR_DEFECTO);
    await repo.guardarLimites({ cambioInmediato: 4, programarCambio: 7 });
    expect(await repo.limites()).toEqual({ cambioInmediato: 4, programarCambio: 7 });
  });

  it("un valor corrupto no deja sin umbral", async () => {
    const db = await abrirBaseEnMemoria();
    await migrar(db);
    await db.ejecutar(`INSERT INTO ajuste (clave, valor) VALUES ('limites', '{roto')`);
    expect(await new RepositorioLocal(db).limites()).toEqual(LIMITES_POR_DEFECTO);
  });
});

describe("pantalla de límites", () => {
  const fuentes = (extra: Partial<FuentesLimites> = {}): FuentesLimites => ({
    cargar: vi.fn().mockResolvedValue({ ok: true, datos: { cambioInmediato: 3, programarCambio: 5 } }),
    guardar: vi.fn().mockImplementation(async (l) => ({ ok: true, datos: l })),
    ...extra,
  });

  it("dice qué significan antes de guardar, en las palabras de la oficina", async () => {
    render(<PantallaLimites fuentes={fuentes()} />);
    const resumen = await screen.findByTestId("resumen-limites");
    expect(resumen.textContent).toContain("3 mm o menos: CAMBIO INMEDIATO");
    expect(resumen.textContent).toContain("hasta 5 mm: PROGRAMAR CAMBIO");
  });

  it("guarda los nuevos y avisa que llegan con la sincronización", async () => {
    const f = fuentes();
    render(<PantallaLimites fuentes={f} />);
    const inmediato = await screen.findByTestId("limite-inmediato");
    await act(async () => { fireEvent.change(inmediato, { target: { value: "4" } }); });
    await act(async () => { fireEvent.change(screen.getByTestId("limite-programar"), { target: { value: "6,5" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("guardar-limites")); });
    expect(f.guardar).toHaveBeenCalledWith({ cambioInmediato: 4, programarCambio: 6.5 });
    expect(screen.getByText("Límites guardados")).toBeTruthy();
  });

  it("límites incoherentes no se envían y se dice por qué", async () => {
    const f = fuentes();
    render(<PantallaLimites fuentes={f} />);
    const programar = await screen.findByTestId("limite-programar");
    await act(async () => { fireEvent.change(programar, { target: { value: "2" } }); });
    expect(screen.getByText(/por encima del cambio inmediato/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("guardar-limites")); });
    expect(f.guardar).not.toHaveBeenCalled();
  });

  it("sin señal lo dice y deja reintentar", async () => {
    const cargar = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 0, mensaje: "red" })
      .mockResolvedValueOnce({ ok: true, datos: { cambioInmediato: 3, programarCambio: 5 } });
    render(<PantallaLimites fuentes={fuentes({ cargar })} />);
    const reintentar = await screen.findByTestId("reintentar-limites");
    expect(screen.getByText(/Sin señal/)).toBeTruthy();
    await act(async () => { fireEvent.click(reintentar); });
    expect(await screen.findByTestId("resumen-limites")).toBeTruthy();
  });
});
