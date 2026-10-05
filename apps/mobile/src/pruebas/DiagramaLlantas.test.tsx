import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiagramaLlantas, ResumenDiagrama } from "../ordenes/DiagramaLlantas";
import { construirDiagrama } from "../ordenes/diagrama";
import type { MedicionLocal, PosicionEjeLocal } from "../datos/repositorio";

/**
 * Componente del diagrama.
 *
 * Lo que se verifica es que el técnico pueda usarlo sin leer con atención:
 * tocar la posición correcta, ver los huecos y notar las alertas.
 */

function pos(
  numero: number,
  eje: number,
  lado: "izquierdo" | "derecho",
  extra: Partial<PosicionEjeLocal> = {},
): PosicionEjeLocal {
  return {
    configuracionEjeId: "cfg-1",
    numero,
    eje,
    lado,
    esInterna: false,
    tipoEje: eje === 1 ? "direccional" : "traccion",
    psiObjetivo: 110,
    profundidadMinima: 3,
    ...extra,
  };
}

const configuracion = [
  pos(1, 1, "izquierdo"),
  pos(2, 1, "derecho"),
  pos(3, 2, "izquierdo"),
  pos(4, 2, "izquierdo", { esInterna: true }),
  pos(5, 2, "derecho", { esInterna: true }),
  pos(6, 2, "derecho"),
];

function med(posicion: number, extra: Partial<MedicionLocal> = {}): MedicionLocal {
  return {
    id: `m-${posicion}`,
    ordenId: "ord-1",
    posicion,
    marcaId: "mar-1",
    disenoId: "dis-1",
    medida: "295/80R22.5",
    serial: "MX1",
    dot: "3624",
    psiEncontrada: 105,
    psiCalibrado: 110,
    profundidad: 9,
    noIdentificada: false,
    servicios: [],
    ...extra,
  };
}

describe("diagrama", () => {
  it("dibuja todas las posiciones de la configuración", () => {
    render(
      <DiagramaLlantas diagrama={construirDiagrama(configuracion, [])} onTocarPosicion={vi.fn()} />,
    );
    for (let n = 1; n <= 6; n++) {
      expect(screen.getByTestId(`posicion-${n}`)).toBeTruthy();
    }
  });

  it("avisa cuando el vehículo no tiene configuración", () => {
    // Dejar la pantalla en blanco haría que el técnico crea que la app falló.
    render(<DiagramaLlantas diagrama={construirDiagrama([], [])} onTocarPosicion={vi.fn()} />);
    expect(screen.getByText(/no tiene configuración de ejes/)).toBeTruthy();
    expect(screen.queryByTestId("diagrama")).toBeNull();
  });

  it("abre la posición al tocarla", () => {
    const tocar = vi.fn();
    render(
      <DiagramaLlantas diagrama={construirDiagrama(configuracion, [])} onTocarPosicion={tocar} />,
    );
    fireEvent.click(screen.getByTestId("posicion-4"));
    expect(tocar).toHaveBeenCalledWith(4);
  });

  it("el número del eje no se confunde con el de una posición", () => {
    // Ambos son dígitos pequeños en la misma pantalla: sin distinguirlos, el
    // técnico puede medir la llanta equivocada.
    render(
      <DiagramaLlantas diagrama={construirDiagrama(configuracion, [])} onTocarPosicion={vi.fn()} />,
    );
    expect(screen.getByText("E1")).toBeTruthy();
    expect(screen.getByText("E2")).toBeTruthy();
  });
});

describe("estado de las casillas", () => {
  it("el lector de pantalla dice el estado, no solo el número", () => {
    // El color solo no basta: bajo el sol se pierde y hay daltonismo.
    render(
      <DiagramaLlantas
        diagrama={construirDiagrama(configuracion, [med(1)])}
        onTocarPosicion={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Posición 1, capturada")).toBeTruthy();
    expect(screen.getByLabelText("Posición 2, sin capturar")).toBeTruthy();
  });

  it("anuncia las que no se pudieron identificar", () => {
    render(
      <DiagramaLlantas
        diagrama={construirDiagrama(configuracion, [med(1, { noIdentificada: true })])}
        onTocarPosicion={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Posición 1, sin identificar")).toBeTruthy();
  });

  it("anuncia las que están bajo el mínimo", () => {
    render(
      <DiagramaLlantas
        diagrama={construirDiagrama(configuracion, [med(1, { profundidad: 2 })])}
        onTocarPosicion={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Posición 1, bajo el mínimo")).toBeTruthy();
  });

  it("muestra la profundidad en la casilla", () => {
    // Es el dato que el técnico compara entre posiciones sin abrir cada una.
    render(
      <DiagramaLlantas
        diagrama={construirDiagrama(configuracion, [med(1, { profundidad: 7.5 })])}
        onTocarPosicion={vi.fn()}
      />,
    );
    expect(screen.getByText("7.5")).toBeTruthy();
  });

  it("una posición sin medir no muestra profundidad", () => {
    render(
      <DiagramaLlantas diagrama={construirDiagrama(configuracion, [])} onTocarPosicion={vi.fn()} />,
    );
    expect(screen.queryByText("9")).toBeNull();
  });

  it("resalta la posición que se está capturando", () => {
    render(
      <DiagramaLlantas
        diagrama={construirDiagrama(configuracion, [])}
        onTocarPosicion={vi.fn()}
        posicionActiva={3}
      />,
    );
    expect(screen.getByTestId("posicion-3")).toBeTruthy();
  });
});

describe("resumen", () => {
  it("muestra el avance como cuentas", () => {
    render(<ResumenDiagrama diagrama={construirDiagrama(configuracion, [med(1), med(2)])} />);
    expect(screen.getByText("2 de 6 posiciones")).toBeTruthy();
  });

  it("enumera las que faltan", () => {
    // Con 22 posiciones, buscar el hueco a ojo en el diagrama cuesta.
    render(<ResumenDiagrama diagrama={construirDiagrama(configuracion, [med(1), med(2)])} />);
    expect(screen.getByText("Faltan: 3, 4, 5, 6")).toBeTruthy();
  });

  it("no dice que faltan si están todas", () => {
    const todas = [1, 2, 3, 4, 5, 6].map((n) => med(n));
    render(<ResumenDiagrama diagrama={construirDiagrama(configuracion, todas)} />);
    expect(screen.queryByText(/Faltan/)).toBeNull();
  });

  it("señala las que están bajo el mínimo", () => {
    const d = construirDiagrama(configuracion, [med(1, { profundidad: 1 }), med(2)]);
    render(<ResumenDiagrama diagrama={d} />);
    expect(screen.getByText("1 bajo el mínimo: 1")).toBeTruthy();
  });

  it("no menciona alertas si no las hay", () => {
    render(<ResumenDiagrama diagrama={construirDiagrama(configuracion, [med(1)])} />);
    expect(screen.queryByText(/bajo el mínimo/)).toBeNull();
  });
});
