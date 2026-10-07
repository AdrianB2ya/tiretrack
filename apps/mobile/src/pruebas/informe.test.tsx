import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  FILTRO_VACIO,
  SERVICIOS_FILTRO,
  aConsulta,
  avisoSinCerrar,
  conBOM,
  conOrdenes,
  describirFila,
  motivoSinPdf,
  nombreDeDescarga,
  rangoRapido,
  resumen,
  revisarFiltro,
  type VistaPrevia,
} from "../informe/reglasInforme";
import { PantallaInforme, type FuentesInforme } from "../informe/PantallaInforme";
import { ClienteHttp } from "../datos/clienteHttp";

const CLIENTE = "00000000-0000-4000-8000-0000000000c1";

const fila = (posicion: number, extra: Partial<VistaPrevia["filas"][number]> = {}) => ({
  fecha: "2026-10-01", folio: "OS-FUN-000012", estado: "en_revision", vehiculo: "CA-01", posicion,
  serial: `MX${posicion}`, marca: "Michelin", noIdentificada: false, profundidad: 9.5, desSerial: null, servicios: ["CALI"],
  ...extra,
});
const VISTA: VistaPrevia = { registros: 2, ordenes: 1, sinCerrar: 1, filas: [fila(1), fila(2)] };

describe("reglas del informe", () => {
  it("lo vacío no viaja en la URL", () => {
    expect(aConsulta(FILTRO_VACIO)).toBe("");
    expect(aConsulta({ ...FILTRO_VACIO, serial: "  mx1 ", desde: "2026-10-01" })).toBe("?desde=2026-10-01&serial=mx1");
  });

  it("todos los filtros llegan con el nombre que espera el servidor", () => {
    const q = new URLSearchParams(aConsulta({
      clienteId: CLIENTE, desde: "2026-09-01", hasta: "2026-09-30", serial: "X", servicio: "CALI", estadoLlanta: "Nueva",
    }));
    expect(Object.fromEntries(q)).toEqual({
      clienteId: CLIENTE, desde: "2026-09-01", hasta: "2026-09-30", serial: "X", servicio: "CALI", estadoLlanta: "Nueva",
    });
  });

  it("una fecha que no existe se rechaza antes de gastar señal", () => {
    // 2026-02-31 no falla en JavaScript: se convierte en silencio al 3 de marzo.
    expect(revisarFiltro({ ...FILTRO_VACIO, desde: "2026-02-31" })).toEqual([{ campo: "desde", mensaje: expect.any(String) }]);
    expect(revisarFiltro({ ...FILTRO_VACIO, hasta: "1/10/2026" }).map((p) => p.campo)).toEqual(["hasta"]);
  });

  it("un rango al revés se señala", () => {
    expect(revisarFiltro({ ...FILTRO_VACIO, desde: "2026-10-05", hasta: "2026-10-01" })[0]?.mensaje).toMatch(/anterior/);
    expect(revisarFiltro({ ...FILTRO_VACIO, desde: "2026-10-01", hasta: "2026-10-01" })).toEqual([]);
  });

  it("rangos de un toque", () => {
    expect(rangoRapido("hoy", "2026-10-05")).toEqual({ desde: "2026-10-05", hasta: "2026-10-05" });
    expect(rangoRapido("7dias", "2026-10-05")).toEqual({ desde: "2026-09-29", hasta: "2026-10-05" });
    expect(rangoRapido("mes", "2026-10-05")).toEqual({ desde: "2026-10-01", hasta: "2026-10-05" });
    expect(rangoRapido("mesAnterior", "2026-03-15")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(rangoRapido("mesAnterior", "2026-01-10")).toEqual({ desde: "2025-12-01", hasta: "2025-12-31" });
  });

  it("los servicios del filtro son los de la llanta, por código", () => {
    expect(SERVICIOS_FILTRO.map((s) => s.codigo)).toContain("CALI");
    expect(SERVICIOS_FILTRO.every((s) => /^[A-Z]+$/.test(s.codigo))).toBe(true);
  });

  it("el resumen y el aviso de datos preliminares", () => {
    expect(resumen(VISTA)).toBe("2 llantas de 1 orden");
    expect(resumen({ ...VISTA, registros: 0, ordenes: 0, filas: [] })).toMatch(/No hay registros/);
    expect(avisoSinCerrar(VISTA)).toMatch(/^La orden va sin cerrar/);
    expect(avisoSinCerrar({ ...VISTA, ordenes: 3, sinCerrar: 1 })).toMatch(/^1 orden va sin cerrar/);
    expect(avisoSinCerrar({ ...VISTA, sinCerrar: 0 })).toBeNull();
  });

  it("una llanta sin identificar lo dice, no queda en blanco", () => {
    expect(describirFila(fila(3, { noIdentificada: true, serial: null, marca: null }))).toBe("Pos. 3 · SIN IDENTIFICAR · 9,5 mm");
  });

  it("el archivo conserva el BOM para que Excel lea las tildes", () => {
    expect(conBOM("Posición;Serial").charCodeAt(0)).toBe(0xfeff);
    const conMarca = `${String.fromCharCode(0xfeff)}x`;
    expect(conBOM(conMarca)).toBe(conMarca);
  });

  it("el nombre del archivo sale del servidor", () => {
    expect(nombreDeDescarga('attachment; filename="informe-OS-FUN-000012.csv"')).toBe("informe-OS-FUN-000012.csv");
    expect(nombreDeDescarga(null)).toBe("informe.csv");
  });
});

describe("pantalla del informe", () => {
  function fuentes(extra: Partial<FuentesInforme> = {}) {
    return {
      clientes: vi.fn().mockResolvedValue([{ id: CLIENTE, nombre: "Transportes Reyna" }]),
      vistaPrevia: vi.fn().mockResolvedValue({ ok: true, datos: VISTA }),
      trazabilidad: vi.fn().mockResolvedValue({ ok: true, datos: {
        pasos: [
          { fecha: "2026-08-01", folio: "OS-FUN-000003", vehiculoCodigo: "CA-01", posicion: 1, profundidad: 12, kilometraje: null },
          { fecha: "2026-10-01", folio: "OS-FUN-000012", vehiculoCodigo: "CA-02", posicion: 3, profundidad: 9.5, kilometraje: null },
        ],
        desgaste: { perdida: 2.5, servicios: 2 },
      } }),
      exportar: vi.fn().mockResolvedValue({ ok: true, texto: "Posición;Serial", nombre: "informe.csv" }),
      exportarPdf: vi.fn().mockResolvedValue({ ok: true }),
      compartir: vi.fn().mockResolvedValue({ ok: true }),
      hoy: () => "2026-10-05",
      ...extra,
    };
  }

  it("primero se ve: cuenta, aviso de preliminares y filas", async () => {
    const f = fuentes();
    render(<PantallaInforme fuentes={f} />);
    fireEvent.click(await screen.findByLabelText("Transportes Reyna"));
    fireEvent.click(screen.getByLabelText("Este mes"));
    fireEvent.click(screen.getByTestId("ver-informe"));
    expect((await screen.findByTestId("resumen-informe")).textContent).toBe("2 llantas de 1 orden");
    expect(screen.getByText(/La orden va sin cerrar/)).toBeTruthy();
    expect(screen.getByText("Pos. 1 · Michelin MX1 · 9,5 mm")).toBeTruthy();
    expect(f.vistaPrevia).toHaveBeenCalledWith(`?clienteId=${CLIENTE}&desde=2026-10-01&hasta=2026-10-05`);
  });

  it("se eligen órdenes: el CSV y el PDF salen solo con esas", async () => {
    const conLista: VistaPrevia = {
      ...VISTA, ordenes: 2,
      listaOrdenes: [
        { id: "o-1", folio: "OS-FUN-000001", fecha: "2026-10-01", estado: "cerrada", vehiculo: "CA-12", posiciones: 2 },
        { id: "o-2", folio: "OS-FUN-000002", fecha: "2026-10-02", estado: "en_revision", vehiculo: "CV-07", posiciones: 1 },
      ],
    };
    const f = fuentes({ vistaPrevia: vi.fn().mockResolvedValue({ ok: true, datos: conLista }) });
    render(<PantallaInforme fuentes={f} />);
    fireEvent.click(screen.getByTestId("ver-informe"));
    expect(await screen.findByText(/Se exportan todas las órdenes/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("elegir-orden-o-2"));
    expect(screen.getByText("1 orden elegida")).toBeTruthy();
    fireEvent.click(screen.getByTestId("exportar-pdf"));
    await waitFor(() => expect(f.exportarPdf).toHaveBeenCalledWith("?ordenIds=o-2"));
    expect(await screen.findByText("PDF listo")).toBeTruthy();
    fireEvent.click(screen.getByTestId("exportar-informe"));
    await waitFor(() => expect(f.exportar).toHaveBeenCalledWith("?ordenIds=o-2"));
  });

  it("exporta con los MISMOS filtros que se vieron, y conserva el BOM", async () => {
    const f = fuentes();
    render(<PantallaInforme fuentes={f} />);
    fireEvent.click(screen.getByLabelText("Calibración"));
    fireEvent.click(screen.getByTestId("ver-informe"));
    fireEvent.click(await screen.findByTestId("exportar-informe"));
    await waitFor(() => expect(f.compartir).toHaveBeenCalled());
    expect(f.exportar).toHaveBeenCalledWith(vi.mocked(f.vistaPrevia).mock.calls[0]?.[0]);
    expect((vi.mocked(f.compartir).mock.calls[0]?.[1] as string).charCodeAt(0)).toBe(0xfeff);
    expect(await screen.findByText("Informe listo")).toBeTruthy();
  });

  it("cambiar el filtro después de ver impide exportar lo que ya no se ve", async () => {
    const f = fuentes();
    render(<PantallaInforme fuentes={f} />);
    fireEvent.click(screen.getByTestId("ver-informe"));
    await screen.findByTestId("exportar-informe");
    fireEvent.click(screen.getByLabelText("Rotación"));
    expect(screen.getByText("Cambiaste el filtro")).toBeTruthy();
    fireEvent.click(screen.getByTestId("exportar-informe"));
    expect(f.exportar).not.toHaveBeenCalled();
  });

  it("una fecha imposible no consulta", async () => {
    const f = fuentes();
    render(<PantallaInforme fuentes={f} />);
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-02-31" } });
    fireEvent.click(screen.getByTestId("ver-informe"));
    expect(await screen.findByText(/que exista/)).toBeTruthy();
    expect(f.vistaPrevia).not.toHaveBeenCalled();
  });

  it("con serial muestra el recorrido de la llanta y cuánto se gastó", async () => {
    const f = fuentes();
    render(<PantallaInforme fuentes={f} />);
    fireEvent.change(screen.getByLabelText("Serial de la llanta"), { target: { value: "mx1" } });
    fireEvent.click(screen.getByTestId("ver-informe"));
    expect(await screen.findByTestId("trazabilidad")).toBeTruthy();
    expect(screen.getByText("Perdió 2,5 mm en 2 mediciones")).toBeTruthy();
    expect(f.trazabilidad).toHaveBeenCalledWith("mx1");
  });

  it("sin señal lo dice como señal, no como error de datos", async () => {
    render(<PantallaInforme fuentes={fuentes({ vistaPrevia: vi.fn().mockResolvedValue({ ok: false, status: 0, mensaje: "No hay señal" }) })} />);
    fireEvent.click(screen.getByTestId("ver-informe"));
    expect(await screen.findByText("Sin señal")).toBeTruthy();
  });

  it("sin registros no ofrece exportar un archivo vacío", async () => {
    render(<PantallaInforme fuentes={fuentes({ vistaPrevia: vi.fn().mockResolvedValue({ ok: true, datos: { registros: 0, ordenes: 0, sinCerrar: 0, filas: [] } }) })} />);
    fireEvent.click(screen.getByTestId("ver-informe"));
    expect(await screen.findByText(/No hay registros/)).toBeTruthy();
    expect(screen.queryByTestId("exportar-informe")).toBeNull();
  });
});

describe("descarga de texto", () => {
  it("entrega el texto y los encabezados, renovando la sesión ante un 401", async () => {
    let token = "viejo";
    const fetchFalso = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true, status: 200, json: async () => ({}), text: async () => "a;b",
        headers: new Headers({ "x-ordenes-sin-cerrar": "2" }),
      });
    const c = new ClienteHttp({
      baseUrl: "https://api/v1",
      obtenerToken: async () => token,
      renovarSesion: async () => { token = "nuevo"; return true; },
      fetch: fetchFalso as unknown as typeof fetch,
    });
    const r = await c.descargarTexto("/informe/exportar");
    expect(r.ok && r.texto).toBe("a;b");
    expect(r.ok && r.encabezado("x-ordenes-sin-cerrar")).toBe("2");
  });

  it("un rechazo trae su código", async () => {
    const c = new ClienteHttp({
      baseUrl: "x", obtenerToken: async () => "t",
      fetch: vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: { codigo: "SIN_REGISTROS", mensaje: "No hay registros" } }) }) as unknown as typeof fetch,
    });
    const r = await c.descargarTexto("/informe/exportar");
    expect(r).toMatchObject({ ok: false, status: 422, codigo: "SIN_REGISTROS" });
  });
});

describe("órdenes elegidas", () => {
  it("se agregan a la consulta; sin elegir, la consulta queda igual", () => {
    expect(conOrdenes("?desde=2026-10-01", ["a", "b"])).toBe("?desde=2026-10-01&ordenIds=a&ordenIds=b");
    expect(conOrdenes("", ["a"])).toBe("?ordenIds=a");
    expect(conOrdenes("?desde=2026-10-01", [])).toBe("?desde=2026-10-01");
  });

  it("el PDF tiene tope: con muchas órdenes pide elegir", () => {
    expect(motivoSinPdf(45, 0)).toMatch(/hasta 30 órdenes y son 45/);
    expect(motivoSinPdf(45, 3)).toBeNull();
    expect(motivoSinPdf(0, 0)).toMatch(/No hay órdenes/);
  });
});
