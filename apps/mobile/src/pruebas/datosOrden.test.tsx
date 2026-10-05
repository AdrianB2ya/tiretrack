import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  FormularioDatosOrden,
  avisoKilometraje,
  leerKilometraje,
  revisarDatos,
} from "../ordenes/FormularioDatosOrden";
import { accionesDisponibles, type DetalleOrden } from "../ordenes/detalle";
import { unaOrden } from "./fabrica";

/**
 * Datos del servicio y permisos del detalle.
 *
 * Sin la pantalla de datos, ninguna orden podía enviarse: el envío exige
 * kilometraje y nada lo pedía.
 */

describe("lectura del kilometraje", () => {
  it.each([
    ["78950", 78950],
    ["78.950", 78950],
    ["78 950", 78950],
    ["", null],
  ])("'%s' se lee como %s", (texto, esperado) => {
    expect(leerKilometraje(texto)).toBe(esperado);
  });

  it("con decimales o letras no es un número", () => {
    expect(leerKilometraje("78950,5")).toBeNaN();
    expect(leerKilometraje("mucho")).toBeNaN();
  });

  it("revisa los topes del contrato del servidor", () => {
    expect(revisarDatos("10000000", "", "")[0]?.campo).toBe("kilometraje");
    expect(revisarDatos("", "x".repeat(2001), "")[0]?.campo).toBe("hallazgos");
    expect(revisarDatos("78950", "ok", "ok")).toEqual([]);
  });
});

describe("kilometraje que retrocede", () => {
  it("avisa si es menor al último conocido", () => {
    expect(avisoKilometraje(70_000, 78_900)).toMatch(/odómetro/);
  });

  it("no avisa si avanza o si no se conoce el anterior", () => {
    expect(avisoKilometraje(80_000, 78_900)).toBeNull();
    expect(avisoKilometraje(70_000, null)).toBeNull();
  });
});

describe("formulario", () => {
  function montar(extra: Partial<Parameters<typeof FormularioDatosOrden>[0]> = {}) {
    const onGuardar = vi.fn();
    render(
      <FormularioDatosOrden
        inicial={{ kilometraje: null, hallazgos: null, accion: null }}
        kmVehiculo={78_900}
        onGuardar={onGuardar}
        {...extra}
      />,
    );
    return onGuardar;
  }
  const escribir = (etiqueta: string, valor: string) =>
    fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });

  it("guarda kilometraje, hallazgos y acción, sin espacios sobrantes", async () => {
    const onGuardar = montar();
    escribir("Kilometraje", "79.100");
    escribir("Hallazgos", "  Desgaste en eje 2  ");
    escribir("Acción realizada", "Calibración");
    fireEvent.click(screen.getByTestId("guardar-datos"));
    await waitFor(() =>
      expect(onGuardar).toHaveBeenCalledWith({ kilometraje: 79_100, hallazgos: "Desgaste en eje 2", accion: "Calibración" }),
    );
  });

  it("un kilometraje inválido no se guarda", () => {
    const onGuardar = montar();
    escribir("Kilometraje", "79.100,5");
    fireEvent.click(screen.getByTestId("guardar-datos"));
    expect(onGuardar).not.toHaveBeenCalled();
    expect(screen.getByText(/números enteros/)).toBeTruthy();
  });

  it("si retrocede, pide confirmar UNA vez y después guarda", async () => {
    const onGuardar = montar();
    escribir("Kilometraje", "70000");
    fireEvent.click(screen.getByTestId("guardar-datos"));
    expect(onGuardar).not.toHaveBeenCalled();
    expect(screen.getByText("El kilometraje bajó")).toBeTruthy();
    fireEvent.click(screen.getByText("Guardar de todos modos"));
    await waitFor(() => expect(onGuardar).toHaveBeenCalledWith({ kilometraje: 70_000 }));
  });

  it("precarga lo que ya estaba, incluida la acción", () => {
    montar({ inicial: { kilometraje: 79_000, hallazgos: "Golpe en flanco", accion: "Rotación" } });
    expect((screen.getByLabelText("Kilometraje") as HTMLInputElement).value).toBe("79000");
    expect((screen.getByLabelText("Acción realizada") as HTMLTextAreaElement).value).toBe("Rotación");
  });

  it("en solo lectura lo explica y no ofrece guardar", () => {
    montar({ soloLectura: "La orden está en revisión" });
    expect(screen.getByText("La orden está en revisión")).toBeTruthy();
    expect(screen.queryByTestId("guardar-datos")).toBeNull();
  });
});

describe("quién puede capturar en el detalle", () => {
  const detalle = (): DetalleOrden => ({
    orden: unaOrden({ tecnicoId: "u-tec1", estado: "en_proceso" }),
    vehiculoCodigo: "CA-12", vehiculoPlaca: null, clienteNombre: "Reyna", sedeClienteNombre: "",
    mediciones: [], posicionesTotales: 4, fotosSinSubir: 0,
  });

  it("el técnico asignado puede", () => {
    const a = accionesDisponibles(detalle(), { usuarioId: "u-tec1", rol: "tecnico" });
    expect(a.find((x) => x.accion === "capturar")?.habilitada).toBe(true);
  });

  it("el coordinador NO: devuelve, no corrige", () => {
    // Estaba fijo esTecnicoAsignado: true, y el coordinador veía habilitado
    // capturar en la orden de otro.
    const a = accionesDisponibles(detalle(), { usuarioId: "u-coord", rol: "coordinador" });
    const capturar = a.find((x) => x.accion === "capturar");
    expect(capturar?.habilitada).toBe(false);
    expect(capturar?.motivo).toBeTruthy();
  });

  it("otro técnico tampoco", () => {
    const a = accionesDisponibles(detalle(), { usuarioId: "u-tec2", rol: "tecnico" });
    expect(a.find((x) => x.accion === "capturar")?.habilitada).toBe(false);
  });
});
