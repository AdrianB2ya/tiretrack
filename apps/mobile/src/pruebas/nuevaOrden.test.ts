import { describe, it, expect } from "vitest";
import { zCrearOrden } from "@tiretrack/contracts";
import {
  armarOrden,
  cambiar,
  formularioVacio,
  puedeCrearOrden,
  revisarOrden,
  type FormularioOrden,
  type QuienCrea,
} from "../ordenes/nuevaOrden";
import { ordenAContrato } from "../datos/contrato";

/**
 * Orden nueva.
 *
 * Lo central: que la orden armada pase el contrato del servidor —si no, se
 * apartaría al sincronizar—, y que el estado y el técnico salgan del rol de
 * quien la crea, no de lo que diga el formulario.
 */

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const coord: QuienCrea = { usuarioId: ID(1), rol: "coordinador", sedes: [ID(2), ID(3)] };
const tecnico: QuienCrea = { usuarioId: ID(4), rol: "tecnico", sedes: [ID(2)] };
const vehiculo = { id: ID(5), configuracionEjeId: ID(6), kmActual: 78_900 };

function completo(quien: QuienCrea, extra: Partial<FormularioOrden> = {}): FormularioOrden {
  return {
    ...formularioVacio("2026-10-05", quien),
    sedeId: ID(2), clienteId: ID(7), sedeClienteId: ID(8), vehiculoId: vehiculo.id,
    tecnicoId: quien.rol === "tecnico" ? quien.usuarioId : ID(4),
    conductorNombre: "Pedro Gómez",
    ...extra,
  };
}

let n = 10;
const ids = () => `00000000-0000-4000-8000-0000000000${n++}`;

describe("quién crea", () => {
  it("todos menos el cliente", () => {
    expect(puedeCrearOrden("tecnico")).toBe(true);
    expect(puedeCrearOrden("coordinador")).toBe(true);
    expect(puedeCrearOrden("administrador")).toBe(true);
    expect(puedeCrearOrden("cliente")).toBe(false);
  });

  it("el coordinador la programa; el técnico la ejecuta ya", () => {
    expect(armarOrden(completo(coord), coord, vehiculo, "FUN", ids).estado).toBe("programada");
    expect(armarOrden(completo(tecnico), tecnico, vehiculo, "FUN", ids).estado).toBe("en_proceso");
  });

  it("el técnico se asigna a sí mismo aunque el formulario diga otro", () => {
    const o = armarOrden(completo(tecnico, { tecnicoId: ID(9) }), tecnico, vehiculo, "FUN", ids);
    expect(o.tecnicoId).toBe(tecnico.usuarioId);
  });
});

describe("la orden armada cumple el contrato del servidor", () => {
  it.each([["coordinador", coord], ["técnico", tecnico]] as const)("creada por %s", (_n, quien) => {
    const o = armarOrden(completo(quien, { nota: "Revisar presión del direccional" }), quien, vehiculo, "FUN", ids);
    const r = zCrearOrden.safeParse(ordenAContrato(o));
    expect(r.success ? [] : r.error.issues.map((i) => `${i.path}: ${i.message}`)).toEqual([]);
  });

  it("lleva código de referencia de su sede y congela la plantilla del vehículo", () => {
    const o = armarOrden(completo(coord), coord, vehiculo, "FUN", ids);
    expect(o.codigoReferencia).toMatch(/^FUN-[A-Z0-9]{4}$/);
    expect(o.configuracionEjeId).toBe(vehiculo.configuracionEjeId);
  });

  it("las instrucciones del coordinador viajan al servidor", () => {
    // ordenAContrato no mandaba notaCoordinador: el técnico nunca las veía.
    const o = armarOrden(completo(coord, { nota: "Llevar compresor" }), coord, vehiculo, "FUN", ids);
    expect(ordenAContrato(o).notaCoordinador).toBe("Llevar compresor");
  });

  it("sin conductor también cumple", () => {
    const o = armarOrden(completo(coord, { sinConductor: true, conductorNombre: "" }), coord, vehiculo, "FUN", ids);
    expect(zCrearOrden.safeParse(ordenAContrato(o)).success).toBe(true);
  });
});

describe("formulario", () => {
  it("dice todo lo que falta a la vez", () => {
    const campos = revisarOrden(formularioVacio("2026-10-05", coord), coord).map((p) => p.campo);
    expect(campos).toEqual(expect.arrayContaining(["sedeId", "clienteId", "sedeClienteId", "vehiculoId", "tecnicoId", "conductorNombre"]));
  });

  it("completo no tiene problemas", () => {
    expect(revisarOrden(completo(coord), coord)).toEqual([]);
  });

  it("una fecha imposible no pasa", () => {
    expect(revisarOrden(completo(coord, { fecha: "2026-02-31" }), coord)[0]?.campo).toBe("fecha");
  });

  it("no deja crear en una sede ajena", () => {
    expect(revisarOrden(completo(coord, { sedeId: ID(9) }), coord)[0]?.campo).toBe("sedeId");
  });

  it("con una sola sede la elige sola, y el técnico queda asignado", () => {
    const f = formularioVacio("2026-10-05", tecnico);
    expect(f.sedeId).toBe(ID(2));
    expect(f.tecnicoId).toBe(tecnico.usuarioId);
  });

  it("cambiar el cliente limpia la sede del cliente y el vehículo", () => {
    const f = cambiar(completo(coord), "clienteId", ID(9), coord);
    expect(f.sedeClienteId).toBeNull();
    expect(f.vehiculoId).toBeNull();
  });

  it("cambiar la sede limpia el técnico elegido por el coordinador, no al técnico que crea", () => {
    expect(cambiar(completo(coord), "sedeId", ID(3), coord).tecnicoId).toBeNull();
    expect(cambiar(completo(tecnico), "sedeId", ID(3), tecnico).tecnicoId).toBe(tecnico.usuarioId);
  });
});
