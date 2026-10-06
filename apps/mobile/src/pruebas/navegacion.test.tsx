import { describe, it, expect, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { opcionesMas, pestanasPara } from "../app/navegacion";
import { BarraNavegacion } from "../app/BarraNavegacion";
import { MenuMas } from "../app/MenuMas";
import { filtrarOrdenes, type OrdenParaLista } from "../ordenes/lista";
import { calcularIndicadores } from "../coordinador/PanelCoordinador";
import { unaOrden } from "./fabrica";

/** Ruta de expo-router → archivo en app/. */
const archivoDe = (ruta: string) => join(__dirname, "..", "..", "app", `${ruta.split("?")[0]}.tsx`);

describe("navegación de la oficina", () => {
  it("coordinador y administrador tienen Panel, Órdenes, Revisar y Más; el técnico y el cliente, nada", () => {
    expect(pestanasPara("coordinador").map((p) => p.etiqueta)).toEqual(["Panel", "Órdenes", "Revisar", "Más"]);
    expect(pestanasPara("administrador")).toHaveLength(4);
    // El técnico entra directo a sus órdenes: una barra sería un toque más.
    expect(pestanasPara("tecnico")).toEqual([]);
    expect(pestanasPara("cliente")).toEqual([]);
  });

  it("'Más' ofrece a cada rol solo lo que puede hacer", () => {
    const coordinador = opcionesMas("coordinador").map((o) => o.clave);
    expect(coordinador).toEqual(["nueva-orden", "programaciones", "flota", "informe", "cuenta"]);
    const admin = opcionesMas("administrador").map((o) => o.clave);
    expect(admin).toEqual(expect.arrayContaining(["usuarios", "sedes", "plantillas"]));
    expect(coordinador).not.toContain("usuarios");
  });

  it("cada destino tiene su archivo de ruta", () => {
    // Un destino sin pantalla no falla al compilar: se descubre en el
    // teléfono con un "no encontrado".
    const rutas = [...pestanasPara("administrador"), ...opcionesMas("administrador")].map((d) => d.ruta);
    expect(rutas.filter((r) => !existsSync(archivoDe(r)))).toEqual([]);
  });

  it("la barra marca la activa en texto y cuántas esperan revisión", () => {
    const onIr = vi.fn();
    render(<BarraNavegacion pestanas={pestanasPara("coordinador")} activa="panel" porRevisar={3} onIr={onIr} />);
    expect(screen.getByLabelText("Revisar (3)")).toBeTruthy();
    expect(screen.getByTestId("pestana-panel").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByTestId("pestana-ordenes"));
    expect(onIr).toHaveBeenCalledWith(expect.objectContaining({ ruta: "/ordenes" }));
    // Tocar la que ya está abierta no la vuelve a montar.
    fireEvent.click(screen.getByTestId("pestana-panel"));
    expect(onIr).toHaveBeenCalledTimes(1);
  });

  it("sin pestañas no se dibuja nada", () => {
    const { container } = render(<BarraNavegacion pestanas={[]} activa="panel" onIr={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("'Más' dice para qué sirve cada entrada y abre su ruta", () => {
    const onAbrir = vi.fn();
    render(<MenuMas opciones={opcionesMas("coordinador")} onAbrir={onAbrir} />);
    expect(screen.getByText("Órdenes que se generan solas cada cierto tiempo")).toBeTruthy();
    fireEvent.click(screen.getByTestId("mas-informe"));
    expect(onAbrir).toHaveBeenCalledWith(expect.objectContaining({ ruta: "/informe" }));
  });
});

describe("filtros desde el panel", () => {
  const item = (extra: Parameters<typeof unaOrden>[0]): OrdenParaLista => ({
    orden: unaOrden(extra), vehiculoCodigo: "CA-12", clienteNombre: "Reyna",
    posicionesCapturadas: 0, posicionesTotales: 4, tieneCambiosSinEnviar: false,
  });
  const lista = [
    item({ id: "a", estado: "en_proceso", motivoDevolucion: "Revisa la 3" }),
    item({ id: "b", estado: "en_proceso", motivoDevolucion: null }),
    item({ id: "c", estado: "pendiente_cliente" }),
    item({ id: "d", estado: "en_revision" }),
  ];

  it("cada filtro cuenta lo mismo que su tarjeta del panel", () => {
    // Tocar "1 devuelta" y ver otra cantidad sería peor que no filtrar.
    const ind = calcularIndicadores(lista.map((i) => i.orden), "2026-10-06", 0);
    expect(filtrarOrdenes(lista, "devueltas")).toHaveLength(ind.devueltas);
    expect(filtrarOrdenes(lista, "en_curso")).toHaveLength(ind.enCurso);
    expect(filtrarOrdenes(lista, "cliente")).toHaveLength(ind.esperandoCliente);
    expect(filtrarOrdenes(lista, "devueltas").map((i) => i.orden.id)).toEqual(["a"]);
  });

  it("sin filtro, todas", () => {
    expect(filtrarOrdenes(lista, null)).toHaveLength(4);
  });
});
