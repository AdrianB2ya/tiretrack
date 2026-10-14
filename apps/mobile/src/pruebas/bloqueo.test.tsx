import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar, type Conexion } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";
import { Descargador, type PaqueteDescargado } from "../datos/descarga";
import { accionesDisponibles, situacionBloqueo, MENSAJE_RETIRADA } from "../ordenes/detalle";
import { BloqueoOrden } from "../ordenes/BloqueoOrden";
import { unaOrden } from "./fabrica";

/** Bloqueo de la orden (R7) en el teléfono. */

const TEC = { usuarioId: "u-tec1", rol: "tecnico" as const };
const COO = { usuarioId: "u-coo", rol: "coordinador" as const };

describe("qué se muestra del bloqueo", () => {
  it("el técnico asignado puede llevársela si está por hacer o en curso", () => {
    expect(situacionBloqueo(unaOrden({ estado: "programada" }), TEC)).toEqual({ tipo: "tomable" });
    expect(situacionBloqueo(unaOrden({ estado: "en_revision" }), TEC)).toBeNull();
  });

  it("la oficina ve quién la tiene y puede liberarla; otro técnico solo la ve", () => {
    const o = unaOrden({ bloqueadaPorId: "u-tec1", bloqueadaPorNombre: "Carlos Méndez", bloqueadaEn: "2026-10-14T13:00:00.000Z" });
    expect(situacionBloqueo(o, COO)).toMatchObject({ tipo: "de_otro", nombre: "Carlos Méndez", puedeLiberar: true });
    expect(situacionBloqueo(o, { usuarioId: "u-tec2", rol: "tecnico" })).toMatchObject({ tipo: "de_otro", puedeLiberar: false });
    expect(situacionBloqueo(o, TEC)).toMatchObject({ tipo: "mia" });
  });

  it("la que ya no es suya no se captura y dice por qué", () => {
    const d = { orden: unaOrden({ retirada: true }), mediciones: [], fotosSinSubir: 0 } as never;
    const capturar = accionesDisponibles(d, TEC).find((a) => a.accion === "capturar");
    expect(capturar).toMatchObject({ habilitada: false, motivo: MENSAJE_RETIRADA });
    expect(situacionBloqueo(unaOrden({ retirada: true }), TEC)).toEqual({ tipo: "retirada" });
  });
});

describe("pantalla del bloqueo", () => {
  it("el técnico se la lleva con un toque", async () => {
    const onTomar = vi.fn().mockResolvedValue(null);
    render(<BloqueoOrden situacion={{ tipo: "tomable" }} onTomar={onTomar} onLiberar={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByTestId("tomar-bloqueo")); });
    expect(onTomar).toHaveBeenCalled();
  });

  it("la oficina no libera sin un motivo con sustancia", async () => {
    const onLiberar = vi.fn().mockResolvedValue(null);
    render(<BloqueoOrden situacion={{ tipo: "de_otro", nombre: "Carlos", desde: null, puedeLiberar: true }} onTomar={vi.fn()} onLiberar={onLiberar} />);
    expect(screen.getByText("La tiene Carlos")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("liberar-bloqueo")); });
    expect(onLiberar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.change(screen.getByTestId("motivo-liberar"), { target: { value: "Carlos perdió el teléfono" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("liberar-bloqueo")); });
    expect(onLiberar).toHaveBeenCalledWith("Carlos perdió el teléfono");
  });

  it("si el servidor no deja, dice por qué", async () => {
    render(<BloqueoOrden situacion={{ tipo: "tomable" }} onTomar={vi.fn().mockResolvedValue("Sin señal: llévatela mientras tengas señal.")} onLiberar={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByTestId("tomar-bloqueo")); });
    expect(screen.getByText(/Sin señal/)).toBeTruthy();
  });
});

describe("la descarga reconoce la orden que ya no es suya", () => {
  let db: Conexion;
  let repo: RepositorioLocal;
  beforeEach(async () => {
    db = await abrirBaseEnMemoria();
    await migrar(db);
    repo = new RepositorioLocal(db);
  });

  const orden = (id: string) => ({
    id, sedeId: "s", clienteId: "c", sedeClienteId: "sc", vehiculoId: "v", tecnicoId: "u-tec1",
    configuracionEjeId: "cfg", folio: null, tipo: "preventivo", estado: "en_proceso", fecha: "2026-10-14",
    kilometraje: null, hallazgos: null, motivoDevolucion: null, notaCoordinador: null, version: 1, versionContenido: 0,
    codigoReferencia: null, accion: null, firmaNombre: null, firmaCedula: null, firmaCargo: null, firmaVersion: null, firmaFechaHora: null,
  });
  const paquete = (extra: Partial<PaqueteDescargado>): PaqueteDescargado => ({
    hasta: "2026-10-14T15:00:00.000Z", incremental: true, ordenes: [], mediciones: [],
    catalogo: { marcas: [], disenos: [], medidas: [] }, flota: { clientes: [], sedes: [], vehiculos: [] },
    configuraciones: [], tecnicos: [], ...extra,
  });
  const servidor = (p: PaqueteDescargado) => ({ traer: async () => p });

  it("sin trabajo pendiente se quita; con trabajo pendiente queda marcada", async () => {
    await repo.guardarOrdenDescargada(orden("o-limpia"));
    await repo.guardarOrdenDescargada(orden("o-con-trabajo"));
    await repo.guardarOrdenDescargada(orden("o-sigue"));
    await db.ejecutar(`UPDATE orden SET sincronizada = 0 WHERE id = 'o-con-trabajo'`);

    const r = await new Descargador(repo).descargar(servidor(paquete({ asignadas: ["o-sigue"] })));
    expect(r.retiradas).toBe(2);
    expect(await repo.buscarOrden("o-limpia")).toBeNull();
    expect((await repo.buscarOrden("o-con-trabajo"))?.retirada).toBe(true);
    expect((await repo.buscarOrden("o-sigue"))?.retirada).toBe(false);
  });

  it("una creada sin señal que el servidor todavía no conoce no se toca", async () => {
    await repo.guardarOrden({
      id: "o-nueva", sedeId: "s", clienteId: "c", sedeClienteId: "sc", vehiculoId: "v", tecnicoId: "u-tec1",
      configuracionEjeId: "cfg", tipo: "correctivo", estado: "en_proceso", fecha: "2026-10-14",
    });
    await new Descargador(repo).descargar(servidor(paquete({ asignadas: [] })));
    expect((await repo.buscarOrden("o-nueva"))?.retirada).toBe(false);
  });

  it("el bloqueo viaja: la oficina ve quién la tiene", async () => {
    await new Descargador(repo).descargar(servidor(paquete({
      ordenes: [{ ...orden("o-b"), bloqueadaPorId: "u-tec1", bloqueadaPorNombre: "Carlos", bloqueadaEn: "2026-10-14T13:00:00.000Z" }],
    })));
    expect(await repo.buscarOrden("o-b")).toMatchObject({ bloqueadaPorId: "u-tec1", bloqueadaPorNombre: "Carlos" });
  });
});
