import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  nitNormalizado,
  puedeCrearCliente,
  puedeCrearVehiculo,
  revisarCliente,
  revisarVehiculo,
} from "../flota/reglasFlota";
import { PantallaFlota, type AccionesFlota, type FuentesFlota } from "../flota/PantallaFlota";
import { FormularioNuevaOrden, type FuentesNuevaOrden } from "../ordenes/FormularioNuevaOrden";

/**
 * Flota en el celular.
 *
 * Los formularios se validan con los mismos contratos que el servidor: lo
 * que pasa aquí, pasa allá. Si no, quedaría apartado al sincronizar.
 */

describe("permisos", () => {
  it("el técnico crea clientes y sedes, no vehículos", () => {
    expect(puedeCrearCliente("tecnico")).toBe(true);
    expect(puedeCrearVehiculo("tecnico")).toBe(false);
    expect(puedeCrearVehiculo("coordinador")).toBe(true);
    expect(puedeCrearCliente("cliente")).toBe(false);
  });
});

describe("reglas", () => {
  const vacio = { nombre: "", nit: "", contacto: "", telefono: "" };

  it("el cliente exige nombre y NIT, como el contrato", () => {
    const campos = revisarCliente(vacio, []).problemas.map((p) => p.campo);
    expect(campos).toEqual(expect.arrayContaining(["nombre", "nit"]));
  });

  it("un NIT repetido se bloquea aunque se escriba distinto", () => {
    expect(nitNormalizado("900.555.111-2")).toBe(nitNormalizado("9005551112"));
    const r = revisarCliente({ ...vacio, nombre: "Otro", nit: "9005551112" }, [{ nombre: "Reyna", nit: "900.555.111-2" }]);
    expect(r.problemas[0]?.campo).toBe("nit");
  });

  it("un nombre igual con otro NIT se avisa, no se bloquea", () => {
    const r = revisarCliente({ ...vacio, nombre: "transportes reyna", nit: "800111222" }, [{ nombre: "Transportes Reyna", nit: "900555111" }]);
    expect(r.problemas).toEqual([]);
    expect(r.aviso).toMatch(/Transportes Reyna/);
  });

  it("el vehículo exige plantilla, y no repite código en la sede", () => {
    const base = { sedeClienteId: "00000000-0000-4000-8000-000000000001", codigo: "CA-12", placa: "", nombre: "T", tipo: "Tracto", km: "" };
    expect(revisarVehiculo({ ...base, configuracionEjeId: null }, []).map((p) => p.mensaje)).toContain("Elige la plantilla de ejes");
    const conPlantilla = { ...base, configuracionEjeId: "00000000-0000-4000-8000-000000000002" };
    expect(revisarVehiculo(conPlantilla, ["ca-12"]).map((p) => p.campo)).toContain("codigo");
    expect(revisarVehiculo(conPlantilla, [])).toEqual([]);
  });
});

// UUID, como los datos reales: el formulario valida con el contrato del servidor.
const SC = "00000000-0000-4000-8000-0000000000a1";
const CFG = "00000000-0000-4000-8000-0000000000a2";

const fuentes = (extra: Partial<FuentesFlota> = {}): FuentesFlota => ({
  clientes: async () => [{ id: "c-1", nombre: "Transportes Reyna", nit: "800112334" }],
  sedesDeCliente: async () => [{ id: SC, nombre: "Planta Fundación" }],
  vehiculos: async () => [{ id: "v-1", codigo: "CA-12", placa: "SXK482", nombre: "Tractocamión #12" }],
  plantillas: async () => [{ id: CFG, nombre: "Tractocamión 6x4", posiciones: 22 }],
  ...extra,
});
const acciones = (): AccionesFlota & Record<string, ReturnType<typeof vi.fn>> => ({
  crearCliente: vi.fn().mockResolvedValue("c-nuevo"),
  crearSede: vi.fn().mockResolvedValue("sc-nueva"),
  crearVehiculo: vi.fn().mockResolvedValue("v-nuevo"),
});
const escribir = (etiqueta: string, valor: string) =>
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });

describe("pantalla de flota", () => {
  it("el técnico registra un cliente nuevo", async () => {
    const a = acciones();
    render(<PantallaFlota rol="tecnico" fuentes={fuentes()} acciones={a} />);
    fireEvent.click(await screen.findByTestId("nuevo-cliente"));
    escribir("Nombre", "Transportes Ciénaga");
    escribir("NIT", "900.777.333-1");
    fireEvent.click(screen.getByTestId("guardar-flota"));
    await waitFor(() => expect(a.crearCliente).toHaveBeenCalledWith({ nombre: "Transportes Ciénaga", nit: "900.777.333-1" }));
    // Queda en el cliente recién creado, listo para agregarle la sede.
    expect(await screen.findByTestId("nueva-sede")).toBeTruthy();
  });

  it("con datos inválidos no guarda", async () => {
    const a = acciones();
    render(<PantallaFlota rol="tecnico" fuentes={fuentes()} acciones={a} />);
    fireEvent.click(await screen.findByTestId("nuevo-cliente"));
    fireEvent.click(screen.getByTestId("guardar-flota"));
    expect(a.crearCliente).not.toHaveBeenCalled();
  });

  it("el técnico no ve cómo crear vehículos; el coordinador sí", async () => {
    const { unmount } = render(<PantallaFlota rol="tecnico" fuentes={fuentes()} acciones={acciones()} />);
    fireEvent.click(await screen.findByText("Transportes Reyna"));
    await screen.findByText(/CA-12/);
    expect(screen.queryByTestId(`nuevo-vehiculo-${SC}`)).toBeNull();
    unmount();
    render(<PantallaFlota rol="coordinador" fuentes={fuentes()} acciones={acciones()} />);
    fireEvent.click(await screen.findByText("Transportes Reyna"));
    expect(await screen.findByTestId(`nuevo-vehiculo-${SC}`)).toBeTruthy();
  });

  it("el coordinador registra un vehículo con su plantilla", async () => {
    const a = acciones();
    render(<PantallaFlota rol="coordinador" fuentes={fuentes()} acciones={a} />);
    fireEvent.click(await screen.findByText("Transportes Reyna"));
    fireEvent.click(await screen.findByTestId(`nuevo-vehiculo-${SC}`));
    escribir("Código interno", "CA-30");
    escribir("Nombre", "Tractocamión #30");
    escribir("Tipo", "Tractocamión");
    fireEvent.click(await screen.findByLabelText("Tractocamión 6x4, 22 posiciones"));
    fireEvent.click(screen.getByTestId("guardar-flota"));
    await waitFor(() =>
      expect(a.crearVehiculo).toHaveBeenCalledWith(expect.objectContaining({
        sedeClienteId: SC, configuracionEjeId: CFG, codigo: "CA-30",
      })),
    );
  });
});

describe("volver de registrar un cliente a la orden nueva", () => {
  it("la lista de clientes se recarga", async () => {
    let lista = [{ id: "c-1", nombre: "Transportes Reyna" }];
    const f: FuentesNuevaOrden = {
      sedes: async () => [{ id: "s-1", nombre: "Fundación", codigo: "FUN" }],
      clientes: async () => lista,
      sedesDeCliente: async () => [], vehiculos: async () => [], tecnicos: async () => [], ordenesAbiertas: async () => [],
    };
    const quien = { usuarioId: "t", rol: "tecnico" as const, sedes: ["s-1"] };
    const { rerender } = render(<FormularioNuevaOrden quien={quien} hoy="2026-10-05" fuentes={f} onCrear={vi.fn()} recarga={1} />);
    await screen.findByText("Transportes Reyna");
    lista = [...lista, { id: "c-2", nombre: "Transportes Ciénaga" }];
    rerender(<FormularioNuevaOrden quien={quien} hoy="2026-10-05" fuentes={f} onCrear={vi.fn()} recarga={2} />);
    expect(await screen.findByText("Transportes Ciénaga")).toBeTruthy();
  });
});

describe("deshabilitar flota", () => {
  it("el técnico no lo ve; el coordinador sí, con segundo toque, y si no se puede dice por qué", async () => {
    const deshabilitar = vi.fn().mockResolvedValue({ ok: false, mensaje: "No se puede deshabilitar: hay 1 orden(es) sin cerrar" });
    const { unmount } = render(<PantallaFlota rol="tecnico" fuentes={fuentes()} acciones={acciones()} deshabilitar={deshabilitar} />);
    fireEvent.click(await screen.findByText("Transportes Reyna"));
    await screen.findByText(/CA-12/);
    expect(screen.queryByTestId("deshabilitar-vehiculo-v-1")).toBeNull();
    unmount();

    render(<PantallaFlota rol="coordinador" fuentes={fuentes()} acciones={acciones()} deshabilitar={deshabilitar} />);
    fireEvent.click(await screen.findByText("Transportes Reyna"));
    fireEvent.click(await screen.findByTestId("deshabilitar-vehiculo-v-1"));
    expect(deshabilitar).not.toHaveBeenCalled();
    expect(screen.getByText("¿Deshabilitar el vehículo CA-12?")).toBeTruthy();
    fireEvent.click(screen.getByTestId("deshabilitar-vehiculo-v-1"));
    await waitFor(() => expect(deshabilitar).toHaveBeenCalledWith("vehiculo", "v-1"));
    expect(await screen.findByText(/sin cerrar/)).toBeTruthy();
  });

  it("al deshabilitar el cliente vuelve a la lista recargada", async () => {
    let quedan = [{ id: "c-1", nombre: "Transportes Reyna", nit: "800112334" }];
    const deshabilitar = vi.fn().mockImplementation(async () => { quedan = []; return { ok: true }; });
    render(<PantallaFlota rol="administrador" fuentes={fuentes({ clientes: async () => quedan })} acciones={acciones()} deshabilitar={deshabilitar} />);
    fireEvent.click(await screen.findByText("Transportes Reyna"));
    fireEvent.click(await screen.findByTestId("deshabilitar-cliente"));
    fireEvent.click(screen.getByTestId("deshabilitar-cliente"));
    await waitFor(() => expect(deshabilitar).toHaveBeenCalledWith("cliente", "c-1"));
    await waitFor(() => expect(screen.queryByText("Transportes Reyna")).toBeNull());
  });
});
