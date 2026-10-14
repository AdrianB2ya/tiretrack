import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";
import { revisarEnvio, puedeEnviar, type EstadoEnvio } from "../ordenes/envio";
import { PantallaCausas, resumirGrupos } from "../llantas/PantallaCausas";
import { PantallaReclamos, type ReclamoVista } from "../llantas/PantallaReclamos";
import { unaOrden } from "./fabrica";

/** Retiro y fallas (R10) en el teléfono. */

describe("motivo de retiro", () => {
  it("se guarda con la llanta que sale y viaja en la operación", async () => {
    const db = await abrirBaseEnMemoria();
    await migrar(db);
    const repo = new RepositorioLocal(db);
    await repo.guardarOrden({
      id: "o-1", sedeId: "s", clienteId: "c", sedeClienteId: "sc", vehiculoId: "v", tecnicoId: "u-tec1",
      configuracionEjeId: "cfg", tipo: "preventivo", estado: "en_proceso", fecha: "2026-10-14", encolar: false,
    });
    await repo.guardarMedicion({
      ordenId: "o-1", posicion: 2, serial: "NUEVA", capturadoPorId: "u-tec1",
      desmontada: { posicionOrigen: 2, marcaId: null, disenoId: null, medida: null, numCalor: null, serial: "VIEJA", dot: null, profundidad: null, destino: "Desecho", detalle: null, motivoRetiro: "corte" },
    });
    expect((await repo.medicionesDe("o-1"))[0]?.desmontada?.motivoRetiro).toBe("corte");
    const op = await db.consultar<{ datos: string }>(`SELECT datos FROM operacion WHERE tipo = 'guardar_medicion'`);
    expect(JSON.parse(op[0]!.datos).desmontada.motivoRetiro).toBe("corte");
  });
});

describe("envío con una falla sin foto", () => {
  const estado = (retirosSinFoto: number[]): EstadoEnvio => ({
    orden: unaOrden({ firmaNombre: "Luis", firmaCedula: "1", firmaVersion: 0, versionContenido: 0 }),
    diagrama: { ejes: [], totalPosiciones: 4, capturadas: 4, faltantes: [], conAlerta: [] },
    fotosSinSubir: 0,
    operacionesPendientes: 0,
    retirosSinFoto,
  });

  it("impide enviar y dice qué posición y cómo resolverlo", () => {
    const punto = revisarEnvio(estado([3])).find((p) => p.clave === "fallas_sin_foto");
    expect(punto).toMatchObject({ clase: "impide", texto: "Llanta retirada por falla sin foto: posición 3" });
    expect(puedeEnviar(estado([3]), "tecnico", "u-tec1").permitido).toBe(false);
  });

  it("con la foto tomada, no hay nada que impedir por eso", () => {
    expect(revisarEnvio(estado([])).find((p) => p.clave === "fallas_sin_foto")).toBeUndefined();
  });
});

describe("causas de retiro", () => {
  it("agrupa y dice el motivo principal y cuántas por falla", () => {
    expect(
      resumirGrupos([
        { grupo: "Michelin", motivo: "desgaste_normal", cantidad: 5 },
        { grupo: "Michelin", motivo: "corte", cantidad: 2 },
        { grupo: "Firestone", motivo: "separacion", cantidad: 3 },
      ]),
    ).toEqual([
      { grupo: "Michelin", total: 7, principal: "Desgaste normal", fallas: 2 },
      { grupo: "Firestone", total: 3, principal: "Separación", fallas: 3 },
    ]);
  });

  it("muestra cifras y porcentajes en texto", async () => {
    const cargar = vi.fn().mockResolvedValue({
      ok: true,
      datos: { total: 4, porMotivo: [{ motivo: "corte", cantidad: 3 }, { motivo: "desgaste_normal", cantidad: 1 }], porMarca: [], porPosicion: [], porVehiculo: [] },
    });
    render(<PantallaCausas fuentes={{ cargar }} hoy={new Date("2026-10-14T12:00:00Z")} />);
    const bloque = await screen.findByTestId("por-motivo");
    expect(bloque.textContent).toContain("Corte: 3 (75 %) · falla");
    expect(cargar).toHaveBeenCalledWith({ desde: "2025-10-14" });
  });
});

describe("reclamos", () => {
  const reclamo: ReclamoVista = {
    id: "r1", proveedor: "Michelin", motivoRetiro: "separacion", estado: "enviado", fecha: "2026-10-01",
    valorReconocido: null, notas: "2026-10-01: Enviado al distribuidor", llantaId: "ll1", llanta: "A-9", clienteNombre: "Reyna",
  };

  it("aprobar pide el valor reconocido antes de guardar", async () => {
    const cambiar = vi.fn().mockResolvedValue({ ok: true, datos: {} });
    render(<PantallaReclamos fuentes={{ cargar: vi.fn().mockResolvedValue({ ok: true, datos: [reclamo] }), cambiar }} onAbrirLlanta={vi.fn()} />);
    const aprobar = await screen.findByTestId("reclamo-r1-aprobado");
    await act(async () => { fireEvent.click(aprobar); });
    await act(async () => { fireEvent.click(screen.getByTestId("reclamo-r1-guardar")); });
    expect(cambiar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.change(screen.getByTestId("reclamo-r1-valor"), { target: { value: "600000" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("reclamo-r1-guardar")); });
    expect(cambiar).toHaveBeenCalledWith("r1", { estado: "aprobado", valorReconocido: 600000 });
  });
});
