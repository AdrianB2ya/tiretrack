import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  aContratoProgramacion,
  cambiarProgramacion,
  estadoProgramacion,
  fechaLegible,
  programacionVacia,
  revisarFormProgramacion,
  vistaPrevia,
  type FormularioProgramacion,
  type ProgramacionListada,
} from "../coordinador/programacion";
import { PantallaProgramaciones, type FuentesProgramaciones } from "../coordinador/PantallaProgramaciones";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SEDE = U(1);
const HOY = "2026-10-06"; // martes

const completo: FormularioProgramacion = {
  ...programacionVacia(HOY, [SEDE]),
  clienteId: U(2), sedeClienteId: U(3), vehiculoId: U(4), tecnicoId: U(5),
  inicio: "2026-10-15",
};

describe("reglas de la programación", () => {
  it("con una sola sede no se pregunta", () => {
    expect(programacionVacia(HOY, [SEDE]).sedeId).toBe(SEDE);
    expect(programacionVacia(HOY, [SEDE, U(9)]).sedeId).toBeNull();
  });

  it("cambiar el cliente limpia la sede del cliente y el vehículo; cambiar la sede, el técnico", () => {
    expect(cambiarProgramacion(completo, "clienteId", U(8))).toMatchObject({ sedeClienteId: null, vehiculoId: null, tecnicoId: U(5) });
    expect(cambiarProgramacion(completo, "sedeId", U(9)).tecnicoId).toBeNull();
  });

  it("completa pasa la revisión y el contrato del servidor", () => {
    expect(revisarFormProgramacion(completo, HOY, [SEDE])).toEqual([]);
    expect(aContratoProgramacion(completo, U(10))).toMatchObject({ id: U(10), cada: 1, frecuencia: "mensual" });
  });

  it("señala lo que falta, la fecha imposible, la pasada y el periodo absurdo", () => {
    const campos = (f: Partial<FormularioProgramacion>) => revisarFormProgramacion({ ...completo, ...f }, HOY, [SEDE]).map((p) => p.campo);
    expect(campos({ tecnicoId: null })).toEqual(["tecnicoId"]);
    expect(campos({ inicio: "2026-02-31" })).toEqual(["inicio"]);
    expect(campos({ inicio: "2026-10-05" })).toEqual(["inicio"]);
    expect(campos({ cada: "0" })).toEqual(["cada"]);
    expect(campos({ cada: "dos" })).toEqual(["cada"]);
    expect(campos({ sedeId: U(9) })).toEqual(["sedeId"]);
  });

  it("la vista previa son las fechas que generará el servidor", () => {
    // 15 de noviembre es domingo: esa visita va el lunes 16, y diciembre
    // vuelve al 15.
    expect(vistaPrevia(completo)).toEqual(["2026-10-15", "2026-11-16", "2026-12-15"]);
    expect(vistaPrevia({ ...completo, cada: "3" })).toEqual(["2026-10-15", "2027-01-15", "2027-04-15"]);
    expect(vistaPrevia({ ...completo, inicio: "15/10/2026" })).toBeNull();
  });

  it("las fechas se leen con el día de la semana", () => {
    expect(fechaLegible("2026-11-16")).toBe("lun 16 nov 2026");
  });

  describe("estado en la tarjeta", () => {
    const base: ProgramacionListada = {
      id: "p", sedeId: SEDE, sedeCodigo: "FUN", clienteNombre: "Transportes Reyna", sedeClienteNombre: "Planta",
      vehiculoCodigo: "CA-12", vehiculoPlaca: "SXK482", tecnicoId: U(5), tecnicoNombre: "Carlos Méndez",
      tipo: "preventivo", descripcion: "Cada mes", proxima: "2026-10-15", activa: true, ultimoAviso: null,
    };

    it("lo que no se generó lo dice, en texto, sin la fecha técnica delante", () => {
      const e = estadoProgramacion({ ...base, ultimoAviso: "2026-10-06: El técnico está inactivo: elige otro" }, HOY);
      expect(e).toEqual({ tono: "peligro", texto: "No se generó: El técnico está inactivo: elige otro" });
      expect(estadoProgramacion({ ...base, ultimoAviso: "2026-10-06: El vehículo ya tiene una orden sin cerrar" }, HOY).tono).toBe("advertencia");
    });

    it("la próxima visita, en días hábiles", () => {
      expect(estadoProgramacion(base, HOY).texto).toBe("Próxima visita: jue 15 oct 2026 (en 7 días hábiles)");
      expect(estadoProgramacion({ ...base, proxima: HOY }, HOY).texto).toBe("Se genera hoy");
      expect(estadoProgramacion({ ...base, activa: false }, HOY).texto).toMatch(/^Pausada/);
    });
  });
});

describe("pantalla de visitas recurrentes", () => {
  const programada: ProgramacionListada = {
    id: "p-1", sedeId: SEDE, sedeCodigo: "FUN", clienteNombre: "Transportes Reyna", sedeClienteNombre: "Planta",
    vehiculoCodigo: "CA-12", vehiculoPlaca: "SXK482", tecnicoId: U(5), tecnicoNombre: "Carlos Méndez",
    tipo: "preventivo", descripcion: "Cada mes", proxima: "2026-10-15", activa: true,
    ultimoAviso: "2026-10-06: El técnico está inactivo: elige otro",
  };

  function fuentes(extra: Partial<FuentesProgramaciones> = {}) {
    return {
      listar: vi.fn().mockResolvedValue({ ok: true, datos: [programada] }),
      crear: vi.fn().mockResolvedValue({ ok: true, datos: { id: "x", proxima: "2026-10-15" } }),
      pausar: vi.fn().mockResolvedValue({ ok: true, datos: {} }),
      cambiarTecnico: vi.fn().mockResolvedValue({ ok: true, datos: {} }),
      sedes: vi.fn().mockResolvedValue([{ id: SEDE, nombre: "Fundación", codigo: "FUN" }]),
      clientes: vi.fn().mockResolvedValue([{ id: U(2), nombre: "Transportes Reyna" }]),
      sedesDeCliente: vi.fn().mockResolvedValue([{ id: U(3), nombre: "Planta" }]),
      vehiculos: vi.fn().mockResolvedValue([{ id: U(4), codigo: "CA-12", placa: "SXK482", nombre: "Tractocamión" }]),
      tecnicos: vi.fn().mockResolvedValue([{ id: U(5), nombre: "Carlos Méndez" }, { id: U(6), nombre: "Ana Torres" }]),
      ...extra,
    };
  }
  const pantalla = (f: FuentesProgramaciones) => render(<PantallaProgramaciones fuentes={f} hoy={HOY} sedesDelUsuario={[SEDE]} />);

  it("muestra por qué no se generó y permite cambiar el técnico, sin ofrecer el mismo", async () => {
    const f = fuentes();
    pantalla(f);
    expect(await screen.findByText("No se generó: El técnico está inactivo: elige otro")).toBeTruthy();
    fireEvent.click(screen.getByTestId("cambiar-tecnico-p-1"));
    fireEvent.click(await screen.findByLabelText("Ana Torres"));
    await waitFor(() => expect(f.cambiarTecnico).toHaveBeenCalledWith("p-1", U(6)));
    expect(screen.queryByLabelText("Carlos Méndez")).toBeNull();
    expect(f.listar).toHaveBeenCalledTimes(2);
  });

  it("pausar pide confirmar una vez", async () => {
    const f = fuentes();
    pantalla(f);
    fireEvent.click(await screen.findByTestId("pausar-p-1"));
    expect(f.pausar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirmar-pausa-p-1"));
    await waitFor(() => expect(f.pausar).toHaveBeenCalledWith("p-1"));
  });

  it("programa en cascada, muestra las próximas visitas y envía el contrato", async () => {
    const f = fuentes();
    pantalla(f);
    fireEvent.click(await screen.findByTestId("nueva-programacion"));
    fireEvent.click(await screen.findByLabelText("Transportes Reyna"));
    fireEvent.click(await screen.findByLabelText("Planta"));
    fireEvent.click(await screen.findByLabelText("CA-12 · SXK482, Tractocamión"));
    fireEvent.click(await screen.findByLabelText("Carlos Méndez"));
    fireEvent.change(screen.getByLabelText("Primera visita"), { target: { value: "2026-10-15" } });
    expect(screen.getByText("lun 16 nov 2026")).toBeTruthy();
    fireEvent.click(screen.getByTestId("guardar-programacion"));
    await waitFor(() => expect(f.crear).toHaveBeenCalled());
    expect(vi.mocked(f.crear).mock.calls[0]?.[0]).toMatchObject({
      sedeId: SEDE, clienteId: U(2), sedeClienteId: U(3), vehiculoId: U(4), tecnicoId: U(5), inicio: "2026-10-15", cada: 1,
    });
  });

  it("sin técnico no envía y lo dice", async () => {
    const f = fuentes();
    pantalla(f);
    fireEvent.click(await screen.findByTestId("nueva-programacion"));
    fireEvent.click(screen.getByTestId("guardar-programacion"));
    // Bajo el campo y en el resumen de lo que falta.
    expect((await screen.findAllByText(/Elige el técnico que hará las visitas/)).length).toBeGreaterThan(0);
    expect(f.crear).not.toHaveBeenCalled();
  });

  it("el rechazo del servidor se muestra tal cual", async () => {
    const f = fuentes({ crear: vi.fn().mockResolvedValue({ ok: false, status: 409, mensaje: "Ese vehículo ya tiene una programación activa de ese tipo" }) });
    pantalla(f);
    fireEvent.click(await screen.findByTestId("nueva-programacion"));
    fireEvent.click(await screen.findByLabelText("Transportes Reyna"));
    fireEvent.click(await screen.findByLabelText("Planta"));
    fireEvent.click(await screen.findByLabelText("CA-12 · SXK482, Tractocamión"));
    fireEvent.click(await screen.findByLabelText("Carlos Méndez"));
    fireEvent.click(screen.getByTestId("guardar-programacion"));
    expect(await screen.findByText(/ya tiene una programación activa/)).toBeTruthy();
  });

  it("sin señal lo dice como señal", async () => {
    pantalla(fuentes({ listar: vi.fn().mockResolvedValue({ ok: false, status: 0, mensaje: "x" }) }));
    expect(await screen.findByText(/Sin señal/)).toBeTruthy();
  });
});
