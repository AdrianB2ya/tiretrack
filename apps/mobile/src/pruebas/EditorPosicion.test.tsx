import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent , act } from "@testing-library/react";
import { EditorPosicion, type CatalogoEditor } from "../ordenes/EditorPosicion";
import { borradorNuevo, type BorradorMedicion } from "../ordenes/reglasEditorPosicion";
import type { Casilla } from "../ordenes/diagrama";
import { abrirLista } from "./listas";

/**
 * Componente del editor.
 *
 * Lo que se prueba es que la pantalla **no empuje al técnico a inventar
 * datos** y que no lo interrumpa mientras captura.
 */

const casilla: Casilla = {
  numero: 7,
  estado: "vacia",
  esInterna: true,
  profundidad: null,
  profundidadMinima: 3,
  psiObjetivo: 110,
  tipoEje: "traccion",
};

const catalogo: CatalogoEditor = {
  marcas: [
    { id: "mar-1", nombre: "Michelin", esGlobal: true, creadaLocal: false },
    { id: "mar-2", nombre: "Recauchadora Fundación", esGlobal: false, creadaLocal: true },
  ],
  disenos: [{ id: "dis-1", marcaId: "mar-1", nombre: "XDN-2", tipoEje: "traccion", creadaLocal: false }],
  medidas: [{ id: "med-1", disenoId: "dis-1", medida: "295/80R22.5", profundidadOriginal: 16 }],
  // Los servicios son la prop del componente, con el código como id. Se
  // incluye uno del vehículo para comprobar que el editor lo filtra.
  servicios: [
    { id: "CALI", nombre: "Calibración", porLlanta: true, orden: 3 },
    { id: "ROTA", nombre: "Rotación", porLlanta: true, orden: 2 },
    { id: "ENGR", nombre: "Engrase", porLlanta: false, orden: 8 },
  ],
};

function montar(borrador: Partial<BorradorMedicion> = {}, props: Record<string, unknown> = {}) {
  const onCambiar = vi.fn();
  const onGuardar = vi.fn();
  const completo = { ...borradorNuevo(casilla), ...borrador };

  render(
    <EditorPosicion
      casilla={casilla}
      borrador={completo}
      catalogo={catalogo}
      onCambiar={onCambiar}
      onGuardar={onGuardar}
      onCancelar={vi.fn()}
      {...props}
    />,
  );
  return { onCambiar, onGuardar, borrador: completo };
}

describe("cabecera", () => {
  it("muestra el número de posición en grande", () => {
    montar();
    expect(screen.getByText("Posición 7")).toBeTruthy();
  });

  it("dice si la rueda es interna", () => {
    // Saberlo evita medir la de al lado.
    montar();
    expect(screen.getByText("Interna")).toBeTruthy();
  });

  it("muestra el tipo de eje", () => {
    montar();
    expect(screen.getByText("Tracción")).toBeTruthy();
  });
});

describe("llanta que no se pudo identificar", () => {
  it("el interruptor está a la vista, no escondido", () => {
    // Si cuesta encontrarlo, el técnico escribe cualquier cosa en el serial.
    montar();
    expect(screen.getByTestId("switch-no-identificada")).toBeTruthy();
    expect(screen.getByText(/en vez de dejar el serial en blanco/)).toBeTruthy();
  });

  it("al marcarlo, el serial se reemplaza por el motivo", () => {
    montar({ noIdentificada: true });
    expect(screen.queryByLabelText("Serial")).toBeNull();
    expect(screen.getByText("Motivo")).toBeTruthy();
    // Se muestra la etiqueta, aunque lo que se guarda es el código.
    abrirLista("lista-motivo-no-id");
    expect(screen.getByText("Llanta interna sin acceso")).toBeTruthy();
    expect(screen.getByTestId("opcion-interna")).toBeTruthy();
  });

  it("el motivo se marca como obligatorio", () => {
    montar({ noIdentificada: true });
    expect(screen.getByText("*")).toBeTruthy();
  });
});

describe("selección en cascada", () => {
  it("el diseño no aparece hasta elegir marca", () => {
    montar();
    expect(screen.queryByText("Diseño")).toBeNull();
  });

  it("la medida no aparece hasta elegir diseño", () => {
    montar({ marcaId: "mar-1" });
    expect(screen.getByText("Diseño")).toBeTruthy();
    expect(screen.queryByText("Medida")).toBeNull();
  });

  it("cambiar de marca limpia diseño y medida", () => {
    // Un diseño de otra marca sería un dato imposible.
    const { onCambiar } = montar({ marcaId: "mar-1", disenoId: "dis-1", medida: "295/80R22.5" });
    // Elegida, la marca se ve cerrada en una línea: se abre para cambiarla.
    fireEvent.click(screen.getByTestId("lista-marca-abrir"));
    fireEvent.click(screen.getByTestId("opcion-mar-2"));

    const nuevo = onCambiar.mock.calls[0]?.[0] as BorradorMedicion;
    expect(nuevo.marcaId).toBe("mar-2");
    expect(nuevo.disenoId).toBeNull();
    expect(nuevo.medida).toBeNull();
  });

  it("distingue lo creado en campo", () => {
    // Está pendiente de que el administrador lo revise.
    montar();
    abrirLista("lista-marca");
    expect(screen.getByText("Recauchadora Fundación (nueva)")).toBeTruthy();
  });

  it("lo que no está se agrega desde la posición y queda elegido (R1)", async () => {
    const onAgregar = { marca: vi.fn().mockResolvedValue(null), diseno: vi.fn(), medida: vi.fn() };
    montar({}, { onAgregar });
    abrirLista("lista-marca");
    await act(async () => { fireEvent.change(screen.getByTestId("lista-marca-buscar"), { target: { value: "Double Coin" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("lista-marca-agregar")); });
    expect(onAgregar.marca).toHaveBeenCalledWith("Double Coin");
  });

  it("una medida nueva se pide con su profundidad de fábrica, que puede quedar vacía", async () => {
    const onAgregar = { marca: vi.fn(), diseno: vi.fn(), medida: vi.fn().mockResolvedValue(null) };
    montar({ marcaId: "mar-1", disenoId: "dis-1" }, { onAgregar });
    abrirLista("lista-medida");
    await act(async () => { fireEvent.change(screen.getByTestId("lista-medida-buscar"), { target: { value: "11r22.5" } }); });
    await act(async () => { fireEvent.click(screen.getByTestId("lista-medida-agregar")); });
    expect(onAgregar.medida).toHaveBeenCalledWith("11R22.5", null);
  });

  it("en un levantamiento pide el costo de la llanta; en las demás órdenes no (R9)", async () => {
    const { onCambiar } = montar({}, { levantamiento: true });
    await act(async () => { fireEvent.change(screen.getByTestId("costo-llanta"), { target: { value: "1820000" } }); });
    expect(onCambiar).toHaveBeenLastCalledWith(expect.objectContaining({ costo: 1820000 }));
  });

  it("fuera de un levantamiento no hay campo de costo", () => {
    montar();
    expect(screen.queryByTestId("costo-llanta")).toBeNull();
  });

  it("sin permiso para agregar (onAgregar ausente) solo se elige", () => {
    montar();
    expect(screen.queryByTestId("lista-marca-agregar")).toBeNull();
  });

  it("sin catálogo descargado lo dice en vez de quedar en blanco", () => {
    render(
      <EditorPosicion
        casilla={casilla}
        borrador={borradorNuevo(casilla)}
        catalogo={{ ...catalogo, marcas: [] }}
        onCambiar={vi.fn()}
        onGuardar={vi.fn()}
        onCancelar={vi.fn()}
      />,
    );
    expect(screen.getByText(/Sincroniza cuando tengas señal/)).toBeTruthy();
  });
});

describe("medición", () => {
  it("el PSI calibrado viene precargado con el objetivo del eje", () => {
    montar();
    expect((screen.getByLabelText("PSI calibrada") as HTMLInputElement).value).toBe("110");
  });

  it("la presión encontrada viene vacía: hay que medirla", () => {
    montar();
    expect((screen.getByLabelText("PSI encontrada") as HTMLInputElement).value).toBe("");
  });

  it("muestra el mínimo del eje junto a la profundidad", () => {
    montar();
    expect(screen.getByText("Mínimo del eje: 3 mm")).toBeTruthy();
  });

  it("se anota el número de calor de la montada", () => {
    // Faltaba el campo (pendiente de las pruebas en campo): el dato existía pero no había dónde escribirlo.
    const { onCambiar } = montar();
    fireEvent.change(screen.getByLabelText("Número de calor"), { target: { value: "H2201" } });
    expect((onCambiar.mock.calls[0]?.[0] as BorradorMedicion).numCalor).toBe("H2201");
  });

  it("acepta coma decimal", () => {
    // El teclado del técnico tiene coma, no punto.
    const { onCambiar } = montar();
    fireEvent.change(screen.getByLabelText("Exterior"), { target: { value: "8,5" } });
    expect((onCambiar.mock.calls[0]?.[0] as BorradorMedicion).profundidades.exterior).toBe(8.5);
  });

  it("deja escribir el punto: '8.' no se vuelve '8' antes de poner el decimal", () => {
    // En el teléfono el punto desaparecía al teclearlo (pendiente de las pruebas en campo).
    const { onCambiar } = montar();
    const campo = screen.getByLabelText("Centro") as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "8." } });
    expect(campo.value).toBe("8.");
    fireEvent.change(campo, { target: { value: "8.5" } });
    expect((onCambiar.mock.calls.at(-1)?.[0] as BorradorMedicion).profundidades.centro).toBe(8.5);
  });

  it("las tres medidas: exterior, centro e interior", () => {
    montar();
    for (const etiqueta of ["Exterior", "Centro", "Interior"]) expect(screen.getByLabelText(etiqueta)).toBeTruthy();
  });

  it("calcula el desgaste respecto a fábrica", () => {
    // Ver "50% desgastada" le dice si vale la pena rotarla o ya no.
    montar({ marcaId: "mar-1", disenoId: "dis-1", medida: "295/80R22.5", profundidad: 8 });
    expect(screen.getByText("50% desgastada respecto a fábrica")).toBeTruthy();
  });

  it("sin medida elegida no calcula desgaste", () => {
    montar({ profundidad: 8 });
    expect(screen.queryByText(/desgastada/)).toBeNull();
  });
});

describe("servicios", () => {
  it("solo muestra los que aplican a una llanta", () => {
    // El lavado del vehículo no es de esta posición.
    montar();
    expect(screen.getByTestId("servicio-CALI")).toBeTruthy();
    expect(screen.queryByTestId("servicio-ENGR")).toBeNull();
  });

  it("se pueden marcar varios", () => {
    const { onCambiar } = montar({ servicios: ["CALI"] });
    fireEvent.click(screen.getByTestId("servicio-ROTA"));
    expect((onCambiar.mock.calls[0]?.[0] as BorradorMedicion).servicios).toEqual([
      "CALI",
      "ROTA",
    ]);
  });

  it("volver a tocar uno lo quita", () => {
    const { onCambiar } = montar({ servicios: ["CALI", "ROTA"] });
    fireEvent.click(screen.getByTestId("servicio-CALI"));
    expect((onCambiar.mock.calls[0]?.[0] as BorradorMedicion).servicios).toEqual(["ROTA"]);
  });

  it("el estado se anuncia a los lectores de pantalla", () => {
    // Sin esto, un lector lee la lista de servicios sin decir cuáles están
    // marcados.
    montar({ servicios: ["CALI"] });
    expect(screen.getByTestId("servicio-CALI").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("servicio-ROTA").getAttribute("aria-checked")).toBe("false");
  });

  it("las opciones únicas también anuncian cuál está elegida", () => {
    montar({ marcaId: "mar-1" });
    fireEvent.click(screen.getByTestId("lista-marca-abrir"));
    expect(screen.getByTestId("opcion-mar-1").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("opcion-mar-2").getAttribute("aria-checked")).toBe("false");
  });
});

describe("guardar", () => {
  it("no se guarda un borrador vacío", () => {
    // Sería una fila sin datos.
    montar();
    expect(screen.getByTestId("guardar").getAttribute("aria-disabled")).toBe("true");
  });

  it("con datos capturados se habilita", () => {
    montar({ serial: "MX1", profundidad: 9 });
    expect(screen.getByTestId("guardar").getAttribute("aria-disabled")).not.toBe("true");
  });

  it("un error bloquea y se explica", () => {
    montar({ noIdentificada: true, profundidad: 9 });
    expect(screen.getByText("Falta corregir")).toBeTruthy();
    expect(screen.getByTestId("guardar").getAttribute("aria-disabled")).toBe("true");
  });

  it("una advertencia pide confirmar una sola vez", () => {
    // Interrumpir mientras escribe es peor: se muestran juntas al final.
    const { onGuardar } = montar({ serial: "MX1", profundidades: { exterior: 45, centro: 45, interior: 45 } });

    fireEvent.click(screen.getByTestId("guardar"));
    expect(onGuardar).not.toHaveBeenCalled();
    expect(screen.getByText("Revisa antes de guardar")).toBeTruthy();

    fireEvent.click(screen.getByTestId("guardar"));
    expect(onGuardar).toHaveBeenCalledOnce();
  });

  it("sin advertencias guarda directo", () => {
    const { onGuardar } = montar({ serial: "MX1", profundidad: 9, psiEncontrada: 108 });
    fireEvent.click(screen.getByTestId("guardar"));
    expect(onGuardar).toHaveBeenCalledOnce();
  });

  it("el botón dice qué va a pasar al confirmar", () => {
    montar({ serial: "MX1", profundidades: { exterior: 45, centro: 45, interior: 45 } });
    fireEvent.click(screen.getByTestId("guardar"));
    expect(screen.getByText("Guardar de todos modos")).toBeTruthy();
  });

  it("no se guarda dos veces mientras está guardando", () => {
    const { onGuardar } = montar({ serial: "MX1", profundidad: 9 }, { guardando: true });
    fireEvent.click(screen.getByTestId("guardar"));
    expect(onGuardar).not.toHaveBeenCalled();
  });
});

describe("copiar de una hermana", () => {
  it("se ofrece cuando hay una capturada en el mismo eje", () => {
    const onCopiar = vi.fn();
    montar({}, { hermanaCapturada: 8, onCopiarHermana: onCopiar });
    expect(screen.getByText("Copiar llanta de la posición 8")).toBeTruthy();

    fireEvent.click(screen.getByTestId("copiar-hermana"));
    expect(onCopiar).toHaveBeenCalledOnce();
  });

  it("no se ofrece si no hay ninguna", () => {
    montar();
    expect(screen.queryByTestId("copiar-hermana")).toBeNull();
  });
});

describe("captura de corrido (revisión de diseño)", () => {
  const identificada = { marcaId: "mar-1", disenoId: "dis-1", medida: "295/80R22.5", serial: "MX10323", dot: "3624" };

  it("una llanta ya identificada se resume en una línea y deja arriba la medición", () => {
    montar(identificada);
    expect(screen.getByTestId("resumen-identificacion").textContent).toContain("Michelin XDN-2 295/80R22.5");
    expect(screen.getByTestId("resumen-identificacion").textContent).toContain("Serial MX10323");
    expect(screen.queryByLabelText("Serial")).toBeNull();
    fireEvent.click(screen.getByTestId("cambiar-identificacion"));
    expect(screen.getByLabelText("Serial")).toBeTruthy();
  });

  it("una llanta sin identificar muestra la identificación completa", () => {
    montar();
    expect(screen.queryByTestId("resumen-identificacion")).toBeNull();
    expect(screen.getByLabelText("Serial")).toBeTruthy();
  });

  it("con un error en la identificación, el bloque se abre aunque esté completa", () => {
    montar({ ...identificada, dot: "12" });
    expect(screen.queryByTestId("resumen-identificacion")).toBeNull();
    expect(screen.getByLabelText("DOT")).toBeTruthy();
  });

  it("confirma que la posición anterior quedó guardada", () => {
    montar({}, { guardada: 3 });
    expect(screen.getByTestId("posicion-guardada").textContent).toBe("✓ Posición 3 guardada");
  });

  it("dice en qué posición va y pasa a la siguiente; con cambios sin guardar pide un segundo toque", () => {
    const onIr = vi.fn();
    montar({}, { navegacion: { actual: 7, total: 10, anterior: 6, siguiente: 8, onIr, sinGuardar: true } });
    expect(screen.getByTestId("indice-posicion").textContent).toBe("7 de 10");
    fireEvent.click(screen.getByTestId("posicion-siguiente"));
    expect(onIr).not.toHaveBeenCalled();
    expect(screen.getByTestId("aviso-sin-guardar")).toBeTruthy();
    fireEvent.click(screen.getByTestId("posicion-siguiente"));
    expect(onIr).toHaveBeenCalledWith(8);
  });

  it("sin cambios pasa de una vez", () => {
    const onIr = vi.fn();
    montar({}, { navegacion: { actual: 7, total: 10, anterior: 6, siguiente: 8, onIr, sinGuardar: false } });
    fireEvent.click(screen.getByTestId("posicion-anterior"));
    expect(onIr).toHaveBeenCalledWith(6);
  });

  it("el botón de guardar dice que sigue a la próxima", () => {
    montar();
    expect(screen.getByTestId("guardar").textContent).toBe("Guardar y seguir");
  });

  it("la tecla del teclado pasa de un campo de medición al siguiente", () => {
    montar();
    for (const etiqueta of ["PSI encontrada", "PSI calibrada", "Exterior", "Centro"]) {
      expect(screen.getAllByLabelText(etiqueta)[0]).toHaveAttribute("enterkeyhint", "next");
    }
    expect(screen.getAllByLabelText("Interior")[0]).toHaveAttribute("enterkeyhint", "done");
  });
});
