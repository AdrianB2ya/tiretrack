import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  EJE_NUEVO,
  aDefiniciones,
  aPosicionesLocales,
  desdePosiciones,
  revisarPlantilla,
  type EjeEditable,
} from "../flota/editorPlantilla";
import { PantallaPlantillas, type FuentesPlantillas } from "../flota/PantallaPlantillas";

const DIRECCIONAL: EjeEditable = { tipoEje: "direccional", dual: false, psi: "110", profMin: "3" };
const TRACCION: EjeEditable = { tipoEje: "traccion", dual: true, psi: "105", profMin: "2,5" };

describe("editor de plantillas", () => {
  it("numera eje por eje, de izquierda a derecha", () => {
    const d = aDefiniciones([DIRECCIONAL, TRACCION]);
    expect(d.map((e) => [e.posicionesIzquierda, e.posicionesDerecha])).toEqual([
      [[1], [2]],
      [[3, 4], [5, 6]],
    ]);
    expect(d[1]).toMatchObject({ tipoEje: "traccion", psiObjetivo: 105, profundidadMinima: 2.5 });
  });

  it("en una dual la interna es la que mira al centro", () => {
    const p = aPosicionesLocales(aDefiniciones([TRACCION]));
    expect(p.filter((x) => x.esInterna).map((x) => x.numero)).toEqual([2, 3]);
  });

  it("una sencilla no tiene interna", () => {
    expect(aPosicionesLocales(aDefiniciones([DIRECCIONAL])).some((x) => x.esInterna)).toBe(false);
  });

  it("partir de una plantilla existente reproduce sus ejes", () => {
    const ejes = [DIRECCIONAL, TRACCION, { ...EJE_NUEVO, tipoEje: "arrastre" as const, dual: false }];
    const vuelta = desdePosiciones(aPosicionesLocales(aDefiniciones(ejes)));
    expect(vuelta).toEqual(ejes);
  });

  it("una plantilla correcta no tiene problemas", () => {
    expect(revisarPlantilla("Tractocamión 6x4", [DIRECCIONAL, TRACCION, TRACCION])).toEqual([]);
  });

  it("señala el nombre, el número mal escrito y los ejes que faltan", () => {
    expect(revisarPlantilla("", [DIRECCIONAL])).toContain("Ponle un nombre a la plantilla");
    expect(revisarPlantilla("Camión", [])).toContain("Agrega al menos un eje");
    expect(revisarPlantilla("Camión", [{ ...DIRECCIONAL, psi: "1o5" }])).toContain("Eje 1: el PSI debe ser un número");
  });

  it("un campo vacío no es un número malo: queda sin dato", () => {
    const [e] = aDefiniciones([{ ...DIRECCIONAL, psi: "" }]);
    expect(e).not.toHaveProperty("psiObjetivo");
  });
});

describe("pantalla de plantillas", () => {
  const POS = aPosicionesLocales(aDefiniciones([DIRECCIONAL, TRACCION])).map((p) => ({ ...p, configuracionEjeId: "c-1" }));
  function fuentes(extra: Partial<FuentesPlantillas> = {}) {
    return {
      plantillas: vi.fn().mockResolvedValue([{ id: "c-1", nombre: "Tractocamión 4x2", posiciones: 6 }]),
      posicionesDe: vi.fn().mockResolvedValue(POS),
      crear: vi.fn().mockResolvedValue({ ok: true, datos: {} }),
      nuevaVersion: vi.fn().mockResolvedValue({ ok: true, datos: { vehiculosMovidos: 0 } }),
      ...extra,
    };
  }

  it("crea una plantilla con la vista previa del diagrama", async () => {
    const f = fuentes();
    render(<PantallaPlantillas fuentes={f} />);
    fireEvent.click(await screen.findByTestId("nueva-plantilla"));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Doble troque" } });
    fireEvent.click(screen.getByTestId("agregar-eje"));
    expect(screen.getByText(/Así lo verá el técnico \(6 posiciones\)/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("guardar-plantilla"));
    await waitFor(() => expect(f.crear).toHaveBeenCalled());
    const [nombre, ejes] = vi.mocked(f.crear).mock.calls[0] as [string, unknown[]];
    expect(nombre).toBe("Doble troque");
    expect(ejes).toHaveLength(2);
  });

  it("sin nombre no envía y dice por qué", async () => {
    const f = fuentes();
    render(<PantallaPlantillas fuentes={f} />);
    fireEvent.click(await screen.findByTestId("nueva-plantilla"));
    fireEvent.click(screen.getByTestId("guardar-plantilla"));
    expect(await screen.findByText(/Ponle un nombre/)).toBeTruthy();
    expect(f.crear).not.toHaveBeenCalled();
  });

  it("una versión nueva parte de la actual", async () => {
    render(<PantallaPlantillas fuentes={fuentes()} />);
    fireEvent.click(await screen.findByTestId("version-c-1"));
    expect(await screen.findByText("Nueva versión de Tractocamión 4x2")).toBeTruthy();
    expect(screen.getByTestId("eje-2")).toBeTruthy();
    expect(screen.queryByTestId("eje-3")).toBeNull();
  });

  it("si mueve vehículos en uso, lo dice y pide confirmar una vez", async () => {
    const nuevaVersion = vi.fn()
      .mockResolvedValueOnce({ ok: false, codigo: "REQUIERE_CONFIRMACION", mensaje: "3 vehículos pasan a dibujarse distinto" })
      .mockResolvedValueOnce({ ok: true, datos: { vehiculosMovidos: 3 } });
    render(<PantallaPlantillas fuentes={fuentes({ nuevaVersion })} />);
    fireEvent.click(await screen.findByTestId("version-c-1"));
    fireEvent.click(await screen.findByTestId("agregar-eje"));
    fireEvent.click(screen.getByTestId("guardar-plantilla"));
    expect(await screen.findByText(/3 vehículos pasan a dibujarse distinto/)).toBeTruthy();
    expect(screen.getByText("Confirmar y mover los vehículos")).toBeTruthy();
    fireEvent.click(screen.getByTestId("guardar-plantilla"));
    await waitFor(() => expect(nuevaVersion).toHaveBeenCalledTimes(2));
    expect(nuevaVersion.mock.calls[0]?.[2]).toBe(false);
    expect(nuevaVersion.mock.calls[1]?.[2]).toBe(true);
  });

  it("cambiar la plantilla después del aviso vuelve a pedir confirmación", async () => {
    const nuevaVersion = vi.fn().mockResolvedValue({ ok: false, codigo: "REQUIERE_CONFIRMACION", mensaje: "Cambia vehículos" });
    render(<PantallaPlantillas fuentes={fuentes({ nuevaVersion })} />);
    fireEvent.click(await screen.findByTestId("version-c-1"));
    fireEvent.click(await screen.findByTestId("guardar-plantilla"));
    expect(await screen.findByText("Confirmar y mover los vehículos")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Arrastre")[0]!);
    expect(screen.queryByText("Confirmar y mover los vehículos")).toBeNull();
  });
});
