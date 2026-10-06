import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar, vaciarDatos, type Conexion } from "../datos/base";
import { RepositorioLocal, type RecomendacionLocal } from "../datos/repositorio";
import { TABLAS_DE_DATOS } from "../datos/esquema";
import { Recomendaciones, separarRecomendaciones } from "../ordenes/Recomendaciones";

/**
 * Recomendaciones persistentes: lo que el técnico encuentra y no ejecuta
 * sobrevive al cierre y reaparece en la siguiente orden del vehículo.
 */

const rec = (id: string, extra: Partial<RecomendacionLocal> = {}): RecomendacionLocal => ({
  id, vehiculoId: "veh-1", posicion: 3, texto: `Recomendación ${id}`, prioridad: "proxima", estado: "abierta",
  origenOrdenId: "ord-vieja", resueltaOrdenId: null, creadaEn: "2026-09-01T10:00:00.000Z", ...extra,
});

describe("en el teléfono", () => {
  let db: Conexion;
  let repo: RepositorioLocal;
  beforeEach(async () => {
    db = await abrirBaseEnMemoria();
    await migrar(db);
    repo = new RepositorioLocal(db);
  });
  afterEach(async () => {
    await db.cerrar();
  });

  it("registrar y resolver se encolan, sin tocar el contenido firmado", async () => {
    await repo.guardarOrden({ id: "ord-1", sedeId: "s", clienteId: "c", sedeClienteId: "sc", vehiculoId: "veh-1", tecnicoId: "u", configuracionEjeId: "cfg", tipo: "preventivo", estado: "en_proceso", fecha: "2026-10-06", encolar: false });
    const antes = (await repo.buscarOrden("ord-1"))?.versionContenido;
    const id = await repo.crearRecomendacion({ ordenId: "ord-1", vehiculoId: "veh-1", posicion: null, texto: "Revisar alineación", prioridad: "urgente" });
    await repo.resolverRecomendacion(id, "descartada", "ord-1");
    const ops = await repo.operacionesPendientes();
    expect(ops.map((o) => o.tipo)).toEqual(["crear_recomendacion", "resolver_recomendacion"]);
    expect(ops[0]?.datos).toEqual({ id, vehiculoId: "veh-1", texto: "Revisar alineación", prioridad: "urgente" });
    expect(ops[1]?.datos).toEqual({ estado: "descartada", ordenId: "ord-1" });
    // No es contenido: no invalida la firma.
    expect((await repo.buscarOrden("ord-1"))?.versionContenido).toBe(antes);
  });

  it("en una orden se ven las abiertas del vehículo y las de esa visita", async () => {
    await repo.guardarRecomendacionesDescargadas([
      rec("abierta-vieja"),
      rec("de-esta", { origenOrdenId: "ord-1" }),
      rec("cerrada-antes", { estado: "ejecutada", resueltaOrdenId: "ord-0" }),
      rec("otro-vehiculo", { vehiculoId: "veh-2" }),
    ]);
    const ids = (await repo.recomendacionesParaOrden("ord-1", "veh-1")).map((r) => r.id).sort();
    expect(ids).toEqual(["abierta-vieja", "de-esta"]);
  });

  it("la descarga las reemplaza, pero respeta lo que este celular no ha enviado", async () => {
    await repo.guardarRecomendacionesDescargadas([rec("vieja")]);
    const local = await repo.crearRecomendacion({ ordenId: "ord-1", vehiculoId: "veh-1", posicion: null, texto: "Nueva sin enviar", prioridad: "proxima" });
    await repo.guardarRecomendacionesDescargadas([rec("otra")]);
    const ids = (await db.consultar<{ id: string }>("SELECT id FROM recomendacion ORDER BY id")).map((r) => r.id);
    expect(ids).toEqual([local, "otra"].sort());
  });

  it("al cambiar de usuario, la siguiente descarga es completa", async () => {
    // La marca de la descarga anterior sobrevivía: el usuario nuevo pedía
    // "lo que cambió desde" la marca del anterior y recibía casi nada.
    await repo.guardarMarcaDeDescarga("2026-10-06T15:00:00.000Z");
    await vaciarDatos(db);
    expect(await repo.marcaDeDescarga()).toBeNull();
  });

  it("al cambiar de usuario se vacían TODAS las tablas de datos", async () => {
    // Faltaban técnico, sede y configuración de ejes: el siguiente usuario,
    // de otra empresa, veía los de la anterior hasta la descarga.
    const tablas = (await db.consultar<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'migracion_aplicada'",
    )).map((t) => t.name);
    expect(tablas.filter((t) => !(TABLAS_DE_DATOS as readonly string[]).includes(t))).toEqual([]);
  });
});

describe("en la pantalla", () => {
  it("separa lo pendiente de antes, lo resuelto aquí y lo de esta visita", () => {
    const s = separarRecomendaciones("ord-1", [rec("a"), rec("b", { origenOrdenId: "ord-1" }), rec("c", { estado: "ejecutada", resueltaOrdenId: "ord-1" })]);
    expect([s.anteriores.map((r) => r.id), s.deEstaVisita.map((r) => r.id), s.resueltasAqui.map((r) => r.id)]).toEqual([["a"], ["b"], ["c"]]);
  });

  it("muestra lo pendiente de visitas anteriores y deja marcarlo hecho", async () => {
    const onResolver = vi.fn().mockResolvedValue(undefined);
    render(<Recomendaciones ordenId="ord-1" recomendaciones={[rec("a", { prioridad: "urgente" })]} bloqueo={null} onCrear={vi.fn()} onResolver={onResolver} />);
    expect(screen.getByText("Pendientes de visitas anteriores (1)")).toBeTruthy();
    expect(screen.getByText("Urgente")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("hecha-a")); });
    expect(onResolver).toHaveBeenCalledWith("a", "ejecutada");
  });

  it("registrar exige decir qué hay que hacer, y la posición es solo un número", async () => {
    const onCrear = vi.fn().mockResolvedValue(undefined);
    render(<Recomendaciones ordenId="ord-1" recomendaciones={[]} bloqueo={null} onCrear={onCrear} onResolver={vi.fn()} />);
    fireEvent.click(screen.getByTestId("nueva-recomendacion"));
    await act(async () => { fireEvent.click(screen.getByTestId("guardar-recomendacion")); });
    expect(onCrear).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Qué hay que hacer"), { target: { value: "Cambiar la llanta de la 3" } });
    fireEvent.click(screen.getByLabelText("Urgente"));
    fireEvent.change(screen.getByLabelText("Posición (opcional)"), { target: { value: "3" } });
    await act(async () => { fireEvent.click(screen.getByTestId("guardar-recomendacion")); });
    expect(onCrear).toHaveBeenCalledWith({ texto: "Cambiar la llanta de la 3", prioridad: "urgente", posicion: 3 });
  });

  it("sin permiso se ven, pero se dice por qué no se pueden tocar", () => {
    render(<Recomendaciones ordenId="ord-1" recomendaciones={[rec("a")]} bloqueo="La orden ya no está abierta" onCrear={vi.fn()} onResolver={vi.fn()} />);
    expect(screen.getByText("La orden ya no está abierta")).toBeTruthy();
    expect(screen.queryByTestId("hecha-a")).toBeNull();
    expect(screen.queryByTestId("nueva-recomendacion")).toBeNull();
  });
});
