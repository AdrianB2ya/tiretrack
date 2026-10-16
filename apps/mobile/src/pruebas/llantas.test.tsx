import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PantallaLlantas, dondeEsta, nombreLlanta, type LlantaVista } from "../llantas/PantallaLlantas";
import { FichaLlanta, type FichaVista } from "../llantas/FichaLlanta";
import { AltaLlanta } from "../llantas/AltaLlanta";
import { PantallaStock, faltante } from "../llantas/PantallaStock";
import { abrirLista, elegirOpcion } from "./listas";

/** La llanta como activo (R8) en el teléfono. */

const llanta = (extra: Partial<LlantaVista> = {}): LlantaVista => ({
  id: "ll-1", serial: "MX10023", numeroInterno: "A-17", numCalor: null, marca: "Michelin", diseno: "XZE",
  medida: "295/80R22.5", estado: "montada", clienteNombre: "Transportes Reyna", sedeNombre: null,
  vehiculoCodigo: "CA-12", posicion: 3, vidas: 0, ...extra,
});

describe("inventario", () => {
  it("dice dónde está cada llanta, en palabras", () => {
    expect(nombreLlanta(llanta())).toBe("A-17 · MX10023");
    expect(dondeEsta(llanta())).toBe("CA-12, posición 3");
    expect(dondeEsta(llanta({ estado: "bodega", sedeNombre: "Fundación", vehiculoCodigo: null }))).toBe("Bodega de Fundación");
    expect(dondeEsta(llanta({ estado: "reencauche" }))).toBe("En reencauche");
  });

  it("filtra por estado y busca; la oficina puede dar de alta", async () => {
    const listar = vi.fn().mockResolvedValue({ ok: true, datos: [llanta()] });
    const onAlta = vi.fn();
    render(<PantallaLlantas fuentes={{ listar }} onAbrir={vi.fn()} onAlta={onAlta} />);
    expect(await screen.findByText("A-17 · MX10023")).toBeTruthy();
    await elegirOpcion({ testID: "estado-bodega" });
    expect(listar).toHaveBeenLastCalledWith({ estado: "bodega" });
    await act(async () => { fireEvent.click(screen.getByTestId("alta-llanta")); });
    expect(onAlta).toHaveBeenCalled();
  });

  it("sin señal lo dice", async () => {
    render(<PantallaLlantas fuentes={{ listar: vi.fn().mockResolvedValue({ ok: false, status: 0, mensaje: "x" }) }} onAbrir={vi.fn()} />);
    expect(await screen.findByText(/Sin señal/)).toBeTruthy();
    expect(screen.queryByTestId("alta-llanta")).toBeNull();
  });
});

describe("ficha", () => {
  const ficha = (extra: Partial<LlantaVista> = {}): FichaVista => ({
    llanta: llanta({ estado: "bodega", vehiculoCodigo: null, sedeNombre: "Fundación", ...extra }),
    vidas: [{ numero: 0, banda: null, reencauchadora: null, costo: 1850000, profundidadInicial: 16, inicio: "2026-01-10" }],
    movimientos: [{ tipo: "ingreso", fecha: "2026-01-10", posicion: null, kilometraje: null, detalle: null, vehiculoCodigo: null, sedeNombre: "Fundación", folio: null }],
    mediciones: [],
  });

  it("solo ofrece los pasos posibles desde su estado", async () => {
    render(<FichaLlanta fuentes={{ cargar: vi.fn().mockResolvedValue({ ok: true, datos: ficha() }), mover: vi.fn(), sedes: [] }} />);
    await screen.findByTestId("lista-mover");
    abrirLista("lista-mover");
    expect(await screen.findByTestId("mover-envio_reencauche")).toBeTruthy();
    expect(screen.queryByTestId("mover-retorno_reencauche")).toBeNull();
  });

  it("al volver del reencauche pide la vida nueva y la envía", async () => {
    const mover = vi.fn().mockResolvedValue({ ok: true, datos: {} });
    render(<FichaLlanta fuentes={{ cargar: vi.fn().mockResolvedValue({ ok: true, datos: ficha({ estado: "reencauche" }) }), mover, sedes: [] }} />);
    const boton = await screen.findByTestId("mover-retorno_reencauche");
    await act(async () => { fireEvent.click(boton); });
    await act(async () => { fireEvent.change(screen.getByTestId("mov-banda"), { target: { value: "XDY" } }); });
    await act(async () => { fireEvent.change(screen.getByTestId("mov-costo"), { target: { value: "450000" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("enviar-movimiento")); });
    expect(mover).toHaveBeenCalledWith({ tipo: "retorno_reencauche", banda: "XDY", costo: 450000 });
  });

  it("desechar pide un segundo toque", async () => {
    const mover = vi.fn().mockResolvedValue({ ok: true, datos: {} });
    render(<FichaLlanta fuentes={{ cargar: vi.fn().mockResolvedValue({ ok: true, datos: ficha() }), mover, sedes: [] }} />);
    await elegirOpcion({ testID: "mover-desecho" });
    await act(async () => { fireEvent.click(screen.getByTestId("enviar-movimiento")); });
    expect(mover).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByTestId("enviar-movimiento")); });
    expect(mover).toHaveBeenCalledWith({ tipo: "desecho" });
  });

  it("muestra el rendimiento: % rodado, km por mm, proyección y costo por km (R9)", async () => {
    const datos = {
      ...ficha(),
      indicadores: { profInicial: 16, profBaja: 3, mmDesgaste: 7, pctRodado: 53.8, referencia: "PROYECCIÓN 50% - 70%", kmRecorrido: 70000, kmPorMm: 10000, proyeccionKm: 130000, costo: 1820000, cpk: 14 },
    };
    render(<FichaLlanta fuentes={{ cargar: vi.fn().mockResolvedValue({ ok: true, datos }), mover: null, sedes: [] }} />);
    const bloque = await screen.findByTestId("indicadores-llanta");
    expect(bloque.textContent).toContain("PROYECCIÓN 50% - 70%");
    expect(bloque.textContent).toContain("Rodado 53,8 %");
    expect(bloque.textContent).toContain("costo por km $14");
  });

  it("quien no maneja el inventario solo la ve", async () => {
    render(<FichaLlanta fuentes={{ cargar: vi.fn().mockResolvedValue({ ok: true, datos: ficha() }), mover: null, sedes: [] }} />);
    expect(await screen.findByText("Historia")).toBeTruthy();
    expect(screen.queryByTestId("mover-desecho")).toBeNull();
  });
});

describe("alta en bodega", () => {
  it("sin serial ni número interno no deja guardar", async () => {
    const crear = vi.fn().mockResolvedValue({ ok: true, datos: { id: "x" } });
    const onCreada = vi.fn();
    render(
      <AltaLlanta
        fuentes={{ clientes: async () => [{ id: "c1", nombre: "Reyna" }], sedes: async () => [{ id: "s1", nombre: "Fundación" }], crear }}
        onCreada={onCreada}
      />,
    );
    await elegirOpcion("Reyna");
    expect(screen.getByText(/Falta el serial o el número interno/)).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByTestId("alta-interno"), { target: { value: "A-17" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("guardar-alta")); });
    expect(crear).toHaveBeenCalledWith(expect.objectContaining({ clienteId: "c1", sedeId: "s1", numeroInterno: "A-17" }));
    expect(onCreada).toHaveBeenCalledWith("x");
  });
});

describe("stock", () => {
  it("lo que está bajo el mínimo se dice en texto", async () => {
    const filas = [
      { sedeId: "s1", sedeNombre: "Fundación", medida: "295/80R22.5", cantidad: 1, minimo: 4 },
      { sedeId: "s1", sedeNombre: "Fundación", medida: "11R22.5", cantidad: 5, minimo: 2 },
    ];
    expect(faltante(filas[0]!)).toBe(3);
    render(<PantallaStock fuentes={{ cargar: vi.fn().mockResolvedValue({ ok: true, datos: filas }), fijarMinimo: null }} />);
    expect(await screen.findByText(/1 medida está por debajo del mínimo/)).toBeTruthy();
    expect(screen.getByText(/POR DEBAJO: faltan 3/)).toBeTruthy();
  });
});
