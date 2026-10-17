import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar, type Conexion } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";
import { TarjetaOrden } from "../ordenes/ListaOrdenes";
import { PortalCliente } from "../cliente/PortalCliente";
import { PantallaCarga } from "../carga/PantallaCarga";
import { unaOrden } from "./fabrica";
import { elegirOpcion } from "./listas";

/** Órdenes anteriores al sistema, cargadas desde Excel (2026-10-17). */

describe("la marca histórica llega al teléfono", () => {
  let db: Conexion;
  let repo: RepositorioLocal;
  beforeEach(async () => {
    db = await abrirBaseEnMemoria();
    await migrar(db);
    repo = new RepositorioLocal(db);
  });

  const orden = (extra: Record<string, unknown> = {}) => ({
    id: "o-his", sedeId: "s", clienteId: "c", sedeClienteId: "sc", vehiculoId: "v", tecnicoId: "u-adm",
    configuracionEjeId: "cfg", folio: "HIS-FUN-000001", tipo: "preventivo", estado: "cerrada", fecha: "2025-03-14",
    kilometraje: 65400, hallazgos: null, motivoDevolucion: null, notaCoordinador: null, version: 1, versionContenido: 0,
    codigoReferencia: null, accion: null, firmaNombre: null, firmaCedula: null, firmaCargo: null, firmaVersion: null, firmaFechaHora: null,
    ...extra,
  });

  it("se guarda y se lee, con su número anterior", async () => {
    await repo.guardarOrdenDescargada({ ...orden(), historica: true, referenciaAnterior: "1234" });
    const o = await repo.buscarOrden("o-his");
    expect(o).toMatchObject({ historica: true, referenciaAnterior: "1234" });
  });

  it("de un servidor anterior (sin el campo) queda como no histórica", async () => {
    await repo.guardarOrdenDescargada(orden());
    expect((await repo.buscarOrden("o-his"))?.historica).toBe(false);
  });
});

describe("se ve que es histórica", () => {
  const item = (historica: boolean) => ({
    orden: unaOrden({ id: "o1", folio: "HIS-FUN-000001", estado: "cerrada", historica }),
    vehiculoCodigo: "CA-12", clienteNombre: "Reyna", posicionesCapturadas: 4, posicionesTotales: 4, tieneCambiosSinEnviar: false,
  });

  it("en la lista de órdenes", () => {
    render(<TarjetaOrden item={item(true)} onPress={vi.fn()} />);
    expect(screen.getByText("Histórica")).toBeTruthy();
  });

  it("en los servicios cerrados del cliente", () => {
    render(<PortalCliente ordenes={[item(true)]} hoy="2026-10-17" onAbrir={vi.fn()} />);
    expect(screen.getByText("Histórica")).toBeTruthy();
  });

  it("una orden normal no lleva la insignia", () => {
    render(<TarjetaOrden item={item(false)} onPress={vi.fn()} />);
    expect(screen.queryByText("Histórica")).toBeNull();
  });
});

describe("carga de órdenes anteriores", () => {
  it("antes de cargar explica cómo quedan: cerradas, históricas, sin firma, folio HIS", async () => {
    render(<PantallaCarga fuentes={{ elegir: vi.fn(), cargar: vi.fn(), compartirPlantilla: vi.fn() } as never} />);
    await elegirOpcion({ testID: "carga-ordenes" });
    const aviso = screen.getByText("Cómo quedan las órdenes anteriores").parentElement?.textContent ?? "";
    expect(aviso).toMatch(/cerradas y marcadas «Histórica», sin firma digital, con folio HIS/);
    expect(screen.getByText(/NUMERO ANTERIOR \(opcional\), FECHA, SEDE/)).toBeTruthy();
  });
});
