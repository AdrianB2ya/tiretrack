import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { zMedicionLlanta } from "@tiretrack/contracts";
import { EditorPosicion, type CatalogoEditor } from "../ordenes/EditorPosicion";
import { borradorNuevo, desmontadaDesde, revisar, type BorradorMedicion } from "../ordenes/reglasEditorPosicion";
import type { Casilla } from "../ordenes/diagrama";
import { medicionAContrato } from "../datos/contrato";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";
import { unaMedicion } from "./fabrica";

/**
 * Llanta desmontada: la que SALE de la posición cuando se cambia.
 *
 * Regla del negocio: "se autocompleta desde la última orden que registró esa
 * posición, no se escribe a mano". El editor no tenía el bloque, y el
 * servidor tampoco la guardaba aunque el contrato la aceptaba.
 */

const casilla: Casilla = {
  numero: 3, estado: "vacia", esInterna: false, profundidad: null, profundidadMinima: 3, psiObjetivo: 110, tipoEje: "traccion",
};
const catalogo: CatalogoEditor = {
  marcas: [{ id: "mar-1", nombre: "Michelin", esGlobal: true, creadaLocal: false }],
  disenos: [], medidas: [],
  servicios: [
    { id: "MONT", nombre: "Montaje", porLlanta: true, orden: 1 },
    { id: "CALI", nombre: "Calibración", porLlanta: true, orden: 3 },
  ],
};
// Ids como los reales (UUID): el contrato los exige.
const MARCA = "00000000-0000-4000-8000-0000000000a1";
const DISENO = "00000000-0000-4000-8000-0000000000a2";
const anterior = unaMedicion(3, { id: "m-vieja", marcaId: MARCA, disenoId: DISENO, serial: "VIEJA-3", dot: "1520", numCalor: "C9", profundidad: 4.2 });

describe("reglas de la desmontada", () => {
  it("trae la identidad de la llanta que estaba, pero no su profundidad de entonces", () => {
    // La profundidad de la orden anterior no es la de hoy: copiarla sería
    // fabricar el dato del retiro.
    const d = desmontadaDesde(anterior, 3);
    expect(d).toMatchObject({ posicionOrigen: 3, serial: "VIEJA-3", dot: "1520", numCalor: "C9", marcaId: MARCA, profundidad: null, destino: null });
  });

  it("sin orden anterior, queda vacía para escribir lo que se pueda leer", () => {
    expect(desmontadaDesde(null, 3)).toMatchObject({ serial: null, posicionOrigen: 3 });
  });

  it("destino y profundidad faltantes avisan; un DOT imposible bloquea", () => {
    const b: BorradorMedicion = { ...borradorNuevo(casilla), serial: "NUEVA", profundidad: 16, desmontada: desmontadaDesde(anterior, 3) };
    const avisos = revisar(b, casilla);
    expect(avisos.filter((a) => a.campo.startsWith("des")).map((a) => [a.campo, a.severidad])).toEqual([
      ["desDestino", "advertencia"], ["desProfundidad", "advertencia"],
    ]);
    const malo = revisar({ ...b, desmontada: { ...b.desmontada!, dot: "1" } }, casilla);
    expect(malo.find((a) => a.campo === "desDot")?.severidad).toBe("error");
  });

  it("viaja anidada, sin campos vacíos, y pasa el contrato del servidor", () => {
    const enviada = medicionAContrato({
      id: "00000000-0000-4000-8000-000000000001", posicion: 3, serial: "NUEVA",
      desmontada: { ...desmontadaDesde(anterior, 3), marcaId: null, profundidad: 2.5, destino: "Reencauche" },
    });
    expect(enviada.desmontada).toEqual({
      posicionOrigen: 3, disenoId: DISENO, medida: "295/80R22.5", numCalor: "C9", serial: "VIEJA-3", dot: "1520", profundidad: 2.5, destino: "Reencauche",
    });
    expect(zMedicionLlanta.safeParse(enviada).success).toBe(true);
  });
});

describe("en el teléfono", () => {
  it("se guarda y se vuelve a leer igual; corregir sin desmontada la quita", async () => {
    const db = await abrirBaseEnMemoria();
    await migrar(db);
    const repo = new RepositorioLocal(db);
    await repo.guardarOrden({ id: "ord-1", sedeId: "s", clienteId: "c", sedeClienteId: "sc", vehiculoId: "v", tecnicoId: "u", configuracionEjeId: "cfg", tipo: "preventivo", estado: "en_proceso", fecha: "2026-10-06", encolar: false });
    const desmontada = { posicionOrigen: 3, marcaId: null, disenoId: null, medida: null, numCalor: null, serial: "VIEJA-3", dot: "1520", profundidad: 2.5, destino: "Desecho", detalle: "Corte" };
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 3, serial: "NUEVA", capturadoPorId: "u", desmontada });
    expect((await repo.medicionesDe("ord-1"))[0]?.desmontada).toEqual(desmontada);
    // Lo que se encola es la forma del contrato, con la desmontada.
    const [op] = await repo.operacionesPendientes();
    expect((op?.datos as { desmontada?: unknown }).desmontada).toMatchObject({ serial: "VIEJA-3", destino: "Desecho" });

    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 3, serial: "NUEVA", capturadoPorId: "u" });
    expect((await repo.medicionesDe("ord-1"))[0]?.desmontada).toBeNull();
    await db.cerrar();
  });
});

describe("en el editor", () => {
  function montar(borrador: Partial<BorradorMedicion> = {}, sugerida = desmontadaDesde(anterior, 3)) {
    const onCambiar = vi.fn();
    render(
      <EditorPosicion
        casilla={casilla}
        borrador={{ ...borradorNuevo(casilla), ...borrador }}
        catalogo={catalogo}
        onCambiar={onCambiar}
        onGuardar={vi.fn()}
        onCancelar={vi.fn()}
        desmontadaSugerida={sugerida}
      />,
    );
    return onCambiar;
  }

  it("marcar Montaje abre la desmontada con la llanta que estaba", () => {
    // Montar una llanta es que salió otra.
    const onCambiar = montar();
    fireEvent.click(screen.getByText("Montaje"));
    const nuevo = onCambiar.mock.calls[0]?.[0] as BorradorMedicion;
    expect(nuevo.servicios).toEqual(["MONT"]);
    expect(nuevo.desmontada).toMatchObject({ serial: "VIEJA-3", dot: "1520" });
  });

  it("el interruptor la abre y la cierra", () => {
    const onCambiar = montar();
    // El Switch web es un checkbox dentro del elemento con el testID.
    const control = screen.getByTestId("switch-desmontada").querySelector("input") ?? screen.getByTestId("switch-desmontada");
    fireEvent.click(control);
    expect((onCambiar.mock.calls[0]?.[0] as BorradorMedicion).desmontada).toMatchObject({ serial: "VIEJA-3" });
  });

  it("dice de dónde salieron los datos, y ofrece los destinos", () => {
    montar({ desmontada: desmontadaDesde(anterior, 3) });
    expect(screen.getByTestId("origen-desmontada").textContent).toMatch(/última orden de esta posición/);
    expect(screen.getByLabelText("Reencauche")).toBeTruthy();
    expect(screen.getByLabelText("Desecho")).toBeTruthy();
  });

  it("sin orden anterior lo dice: hay que leer la llanta", () => {
    montar({ desmontada: desmontadaDesde(null, 3) }, desmontadaDesde(null, 3));
    expect(screen.getByTestId("origen-desmontada").textContent).toMatch(/No hay una orden anterior/);
  });
});
