import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { zCrearMedida } from "@tiretrack/contracts";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar, type Conexion } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";
import { evaluarAltaMedida, evaluarAltaNombre, filtrarPorTexto } from "../catalogo/alta";
import { ElegirUno, ListaBuscable, MAX_A_LA_VISTA } from "../diseno/ListaBuscable";
import { PantallaCatalogo, type FuentesCatalogo } from "../catalogo/PantallaCatalogo";
import { describirCambio } from "../sesion/cambios";
import type { AccionesCatalogo } from "../app/ProveedorDatos";

/**
 * Catálogo de llantas desde la app (R1): agregar marca, diseño y medida sin
 * scripts ni SQL, también sin señal, sin crear duplicados.
 */

const MARCAS = [
  { id: "m-1", nombre: "Michelin" },
  { id: "m-2", nombre: "Bridgestone" },
];

describe("alta: lo que se escribe se compara con lo que hay", () => {
  it("el duplicado exacto se ofrece en vez de crearse, aunque cambien tildes o mayúsculas", () => {
    const r = evaluarAltaNombre("michelín", MARCAS);
    expect(r).toEqual({ estado: "existe", existente: MARCAS[0] });
  });

  it("lo parecido se muestra para elegirlo si era eso", () => {
    const r = evaluarAltaNombre("Michelim", MARCAS);
    expect(r.estado).toBe("nueva");
    expect(r.estado === "nueva" && r.parecidas.map((p) => p.nombre)).toEqual(["Michelin"]);
  });

  it("una marca de verdad nueva se crea limpia, sin espacios de más", () => {
    expect(evaluarAltaNombre("  Double   Coin ", MARCAS)).toEqual({ estado: "nueva", valor: "Double Coin", parecidas: [] });
  });

  it("la medida se normaliza antes de comparar: no quedan dos escrituras de la misma", () => {
    const hay = [{ id: "x", nombre: "295/80R22.5" }];
    expect(evaluarAltaMedida("295/80r22,5", hay).estado).toBe("existe");
    expect(evaluarAltaMedida("11r22.5", hay)).toEqual({ estado: "nueva", valor: "11R22.5", parecidas: [] });
    expect(evaluarAltaMedida("grande", hay).estado).toBe("invalida");
  });

  it("buscar ignora tildes, mayúsculas, espacios y guiones", () => {
    const o = [{ texto: "X-ZE" }, { texto: "XDN 2" }, { texto: "Ruta" }];
    expect(filtrarPorTexto(o, "xze").map((x) => x.texto)).toEqual(["X-ZE"]);
    expect(filtrarPorTexto(o, "xdn2").map((x) => x.texto)).toEqual(["XDN 2"]);
  });
});

describe("lista con búsqueda", () => {
  const muchas = Array.from({ length: 45 }, (_, i) => ({ id: `o-${i}`, texto: `Marca ${String(i).padStart(2, "0")}` }));

  it("con pocas opciones se ven todas, sin campo de búsqueda", () => {
    render(<ListaBuscable etiqueta="Marca" opciones={muchas.slice(0, 3)} seleccionado={null} onElegir={() => {}} />);
    expect(screen.queryByTestId("lista-buscar")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("con muchas, muestra un tope y deja buscar el resto", async () => {
    render(<ListaBuscable etiqueta="Marca" opciones={muchas} seleccionado={null} onElegir={() => {}} />);
    expect(screen.getAllByRole("radio")).toHaveLength(MAX_A_LA_VISTA);
    expect(screen.getByText(/Hay 15 más/)).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByTestId("lista-buscar"), { target: { value: "44" } }); });
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Marca 44"]);
  });

  it("la elegida sigue a la vista aunque la búsqueda no la incluya", async () => {
    render(<ListaBuscable etiqueta="Marca" opciones={muchas} seleccionado="o-44" onElegir={() => {}} />);
    await act(async () => { fireEvent.change(screen.getByTestId("lista-buscar"), { target: { value: "Marca 01" } }); });
    const textos = screen.getAllByRole("radio").map((r) => r.textContent);
    expect(textos).toContain("✓ Marca 44");
    expect(textos).toContain("Marca 01");
  });

  it("agregar algo parecido pide un segundo toque", async () => {
    const onCrear = vi.fn().mockResolvedValue(null);
    render(
      <ListaBuscable
        etiqueta="Marca"
        opciones={MARCAS.map((m) => ({ id: m.id, texto: m.nombre }))}
        seleccionado={null}
        onElegir={() => {}}
        alta={{ etiqueta: "Agregar marca", evaluar: (t) => evaluarAltaNombre(t, MARCAS), onCrear }}
      />,
    );
    await act(async () => { fireEvent.change(screen.getByTestId("lista-buscar"), { target: { value: "Michelim" } }); });
    expect(screen.getByText("¿Es alguna de estas?")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("lista-agregar")); });
    expect(onCrear).not.toHaveBeenCalled();
    expect(screen.getByText(/de todos modos/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("lista-agregar")); });
    expect(onCrear).toHaveBeenCalledWith("Michelim", null);
  });

  it("si ya existe, ofrece elegirla en vez de crear otra", async () => {
    const onElegir = vi.fn();
    const onCrear = vi.fn();
    render(
      <ListaBuscable
        etiqueta="Marca"
        opciones={MARCAS.map((m) => ({ id: m.id, texto: m.nombre }))}
        seleccionado={null}
        onElegir={onElegir}
        alta={{ etiqueta: "Agregar marca", evaluar: (t) => evaluarAltaNombre(t, MARCAS), onCrear }}
      />,
    );
    await act(async () => { fireEvent.change(screen.getByTestId("lista-buscar"), { target: { value: "MICHELIN" } }); });
    expect(screen.queryByTestId("lista-agregar")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId("lista-elegir-existente")); });
    expect(onElegir).toHaveBeenCalledWith("m-1");
    expect(onCrear).not.toHaveBeenCalled();
  });
});

describe("elegir uno (R3): la búsqueda aparece solo cuando hace falta", () => {
  const clientes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c-${i}`, texto: `Transportes ${i}` }));

  it("con pocas opciones, la lista de siempre", () => {
    render(<ElegirUno opciones={clientes(4)} seleccionado={null} onElegir={() => {}} />);
    expect(screen.queryByTestId("lista-buscar")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
  });

  it("con muchas, se busca y se elige", async () => {
    const onElegir = vi.fn();
    render(<ElegirUno opciones={clientes(60)} seleccionado={null} onElegir={onElegir} />);
    await act(async () => { fireEvent.change(screen.getByTestId("lista-buscar"), { target: { value: "transportes 57" } }); });
    const r = screen.getAllByRole("radio");
    expect(r).toHaveLength(1);
    await act(async () => { fireEvent.click(r[0]!); });
    expect(onElegir).toHaveBeenCalledWith("c-57");
  });
});

describe("medida creada en el celular", () => {
  let db: Conexion;
  let repo: RepositorioLocal;
  beforeEach(async () => {
    db = await abrirBaseEnMemoria();
    await migrar(db);
    repo = new RepositorioLocal(db);
    await repo.guardarCatalogo({
      marcas: [{ id: "00000000-0000-4000-8000-000000000001", nombre: "Michelin", esGlobal: true, creadaLocal: false }],
      disenos: [{ id: "00000000-0000-4000-8000-000000000002", marcaId: "00000000-0000-4000-8000-000000000001", nombre: "XZE", tipoEje: "direccional", creadaLocal: false }],
      medidas: [{ id: "00000000-0000-4000-8000-000000000003", disenoId: "00000000-0000-4000-8000-000000000002", medida: "295/80R22.5", profundidadOriginal: 16 }],
    });
  });
  const DISENO = "00000000-0000-4000-8000-000000000002";

  it("se ofrece de inmediato, viaja por la cola y cumple el contrato del servidor", async () => {
    const m = await repo.crearMedidaLocal(DISENO, "11R22.5", 14.5);
    expect((await repo.medidasDe(DISENO)).map((x) => [x.medida, x.creadaLocal])).toEqual([
      ["11R22.5", true],
      ["295/80R22.5", false],
    ]);
    const filas = await db.consultar<{ tipo: string; datos: string }>(`SELECT tipo, datos FROM operacion WHERE tipo = 'crear_medida'`);
    expect(filas).toHaveLength(1);
    const datos = JSON.parse(filas[0]!.datos);
    expect(datos.id).toBe(m.id);
    const r = zCrearMedida.safeParse(datos);
    expect(r.success ? [] : r.error.issues).toEqual([]);
  });

  it("sin profundidad de fábrica se guarda igual, y no viaja un null", async () => {
    await repo.crearMedidaLocal(DISENO, "12R22.5", null);
    const filas = await db.consultar<{ datos: string }>(`SELECT datos FROM operacion WHERE tipo = 'crear_medida'`);
    expect(JSON.parse(filas[0]!.datos)).not.toHaveProperty("profundidadOriginal");
  });

  it("descargar el catálogo no borra la medida que aún no llegó al servidor", async () => {
    const m = await repo.crearMedidaLocal(DISENO, "11R22.5", null);
    await repo.guardarCatalogo({ medidas: [{ id: "00000000-0000-4000-8000-000000000003", disenoId: DISENO, medida: "295/80R22.5", profundidadOriginal: 16 }] });
    expect((await repo.medidasDe(DISENO)).map((x) => x.id)).toContain(m.id);
  });

  it("en Mi cuenta se ve qué medida falta por enviar", () => {
    expect(
      describirCambio({ tipo: "crear_medida", datos: { medida: "11R22.5" } } as unknown as Parameters<typeof describirCambio>[0]),
    ).toBe("Medida nueva: 11R22.5");
  });
});

describe("pantalla del catálogo de llantas", () => {
  function catalogoFalso(): AccionesCatalogo & { creadas: string[] } {
    const marcas = [{ id: "m-1", nombre: "Michelin", esGlobal: true, creadaLocal: false }];
    const disenos = [{ id: "d-1", marcaId: "m-1", nombre: "XZE", tipoEje: "direccional", creadaLocal: false }];
    const medidas = [
      { id: "me-1", disenoId: "d-1", medida: "295/80R22.5", profundidadOriginal: 16, creadaLocal: false },
      { id: "me-2", disenoId: "d-1", medida: "11R22.5", profundidadOriginal: null, creadaLocal: false },
    ];
    const creadas: string[] = [];
    return {
      creadas,
      marcas: async () => [...marcas],
      disenosDe: async (id) => disenos.filter((d) => d.marcaId === id),
      medidasDe: async (id) => medidas.filter((m) => m.disenoId === id),
      crearMarca: async (nombre) => {
        const m = { id: `m-${nombre}`, nombre, esGlobal: false, creadaLocal: true };
        marcas.push(m);
        creadas.push(`marca:${nombre}`);
        return m;
      },
      crearDiseno: async (marcaId, nombre, tipoEje) => {
        const d = { id: `d-${nombre}`, marcaId, nombre, tipoEje, creadaLocal: true };
        disenos.push(d);
        creadas.push(`diseno:${nombre}:${tipoEje}`);
        return d;
      },
      crearMedida: async (disenoId, medida, prof) => {
        const m = { id: `me-${medida}`, disenoId, medida, profundidadOriginal: prof, creadaLocal: true };
        medidas.push(m);
        creadas.push(`medida:${medida}:${prof}`);
        return m;
      },
      fijarProfundidadLocal: async (id, prof) => {
        const m = medidas.find((x) => x.id === id);
        if (m) m.profundidadOriginal = prof;
      },
    };
  }

  it("marca → diseño con su tipo de eje → medida con profundidad de fábrica", async () => {
    const catalogo = catalogoFalso();
    render(<PantallaCatalogo fuentes={{ catalogo }} />);
    { const el = await screen.findByTestId("opcion-m-1"); await act(async () => { fireEvent.click(el); }); }
    await act(async () => { fireEvent.change(screen.getByTestId("cat-diseno-buscar"), { target: { value: "Pilote" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("cat-eje-traccion")); });
    await act(async () => { fireEvent.click(screen.getByTestId("cat-diseno-agregar")); });
    expect(catalogo.creadas).toEqual(["diseno:Pilote:traccion"]);
    await act(async () => { fireEvent.change(screen.getByTestId("cat-medida-buscar"), { target: { value: "315/80r22.5" } }); });
    await act(async () => { fireEvent.change(screen.getByTestId("cat-medida-numero"), { target: { value: "18,5" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("cat-medida-agregar")); });
    expect(catalogo.creadas).toContain("medida:315/80R22.5:18.5");
    expect(await screen.findByText("315/80R22.5 (nueva, sin enviar)")).toBeTruthy();
  });

  it("una medida sin profundidad lo dice, y la oficina la completa en línea", async () => {
    const catalogo = catalogoFalso();
    const fijarProfundidad = vi.fn<NonNullable<FuentesCatalogo["fijarProfundidad"]>>().mockResolvedValue({ ok: true });
    render(<PantallaCatalogo fuentes={{ catalogo, fijarProfundidad }} />);
    { const el = await screen.findByTestId("opcion-m-1"); await act(async () => { fireEvent.click(el); }); }
    { const el = await screen.findByTestId("opcion-d-1"); await act(async () => { fireEvent.click(el); }); }
    expect(await screen.findByText(/Sin profundidad de fábrica/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("cat-corregir-me-2")); });
    await act(async () => { fireEvent.change(screen.getByTestId("cat-prof-me-2"), { target: { value: "14,5" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("cat-guardar-prof-me-2")); });
    expect(fijarProfundidad).toHaveBeenCalledWith("me-2", 14.5);
    expect(await screen.findByText("Profundidad de fábrica: 14,5 mm")).toBeTruthy();
  });

  it("sin señal no se finge el cambio", async () => {
    const catalogo = catalogoFalso();
    const fijarProfundidad = vi.fn<NonNullable<FuentesCatalogo["fijarProfundidad"]>>().mockResolvedValue({ ok: false, status: 0, mensaje: "red" });
    render(<PantallaCatalogo fuentes={{ catalogo, fijarProfundidad }} />);
    { const el = await screen.findByTestId("opcion-m-1"); await act(async () => { fireEvent.click(el); }); }
    { const el = await screen.findByTestId("opcion-d-1"); await act(async () => { fireEvent.click(el); }); }
    { const el = await screen.findByTestId("cat-corregir-me-2"); await act(async () => { fireEvent.click(el); }); }
    await act(async () => { fireEvent.change(screen.getByTestId("cat-prof-me-2"), { target: { value: "14" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("cat-guardar-prof-me-2")); });
    expect(screen.getByText(/Sin señal/)).toBeTruthy();
    expect(screen.queryByText("Profundidad de fábrica: 14 mm")).toBeNull();
  });
});
