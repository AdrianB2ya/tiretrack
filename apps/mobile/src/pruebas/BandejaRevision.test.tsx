import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BandejaRevision, DecisionRevision, TarjetaRevision } from "../coordinador/BandejaRevision";
import { construirDiagrama } from "../ordenes/diagrama";
import type { ContextoCoordinador, OrdenEnBandeja } from "../coordinador/bandeja";
import type { MedicionLocal, OrdenLocal } from "../datos/repositorio";
import {
  CONFIGURACION_CUATRO,
  unaMedicion,
  unaOrdenFirmada,
} from "./fabrica";

/**
 * Componentes de la bandeja.
 *
 * Lo central: que el coordinador sepa **cuáles abrir sin abrirlas todas**, y
 * que devolver una orden obligue a decir qué corregir.
 */

const configuracion = CONFIGURACION_CUATRO;

const med = unaMedicion;

const ordenBase: OrdenLocal = unaOrdenFirmada({ estado: "en_revision", firmaVersion: 4, versionContenido: 4 });

const COORD: ContextoCoordinador = { usuarioId: "u-coo", rol: "coordinador" };

function enBandeja(
  orden: Partial<OrdenLocal> = {},
  mediciones: MedicionLocal[] = [1, 2, 3, 4].map((n) => med(n)),
  extra: Partial<OrdenEnBandeja> = {},
): OrdenEnBandeja {
  return {
    orden: { ...ordenBase, ...orden },
    vehiculoCodigo: "CA-12",
    clienteNombre: "Transportes Reyna",
    tecnicoNombre: "Carlos Méndez",
    diagrama: construirDiagrama(configuracion, mediciones),
    diasEsperando: 0,
    ...extra,
  };
}

describe("bandeja", () => {
  it("lista las órdenes por revisar", () => {
    render(
      <BandejaRevision
        items={[enBandeja({ id: "a" }), enBandeja({ id: "b" })]}
        ctx={COORD}
        onAbrir={vi.fn()}
      />,
    );
    expect(screen.getByTestId("revisar-a")).toBeTruthy();
    expect(screen.getByTestId("revisar-b")).toBeTruthy();
  });

  it("vacía lo dice en vez de quedar en blanco", () => {
    render(<BandejaRevision items={[]} ctx={COORD} onAbrir={vi.fn()} />);
    expect(screen.getByText("No hay órdenes esperando revisión")).toBeTruthy();
  });

  it("abre la orden al tocarla", () => {
    const abrir = vi.fn();
    render(<BandejaRevision items={[enBandeja({ id: "x" })]} ctx={COORD} onAbrir={abrir} />);
    fireEvent.click(screen.getByTestId("revisar-x"));
    expect(abrir).toHaveBeenCalledWith("x");
  });
});

describe("tarjeta", () => {
  it("muestra folio, vehículo, cliente y técnico", () => {
    render(<TarjetaRevision item={enBandeja()} ctx={COORD} onPress={vi.fn()} />);
    expect(screen.getByText("OS-FUN-000001")).toBeTruthy();
    expect(screen.getByText("CA-12")).toBeTruthy();
    expect(screen.getByText(/Carlos Méndez/)).toBeTruthy();
  });

  it("muestra el avance de captura", () => {
    render(<TarjetaRevision item={enBandeja({}, [med(1), med(2)])} ctx={COORD} onPress={vi.fn()} />);
    expect(screen.getByText("2/4")).toBeTruthy();
  });

  it("las señales se ven sin abrir la orden", () => {
    // Con veinte órdenes, lo que no está en la tarjeta no se revisa.
    render(
      <TarjetaRevision
        item={enBandeja({ firmaNombre: null }, [med(1)])}
        ctx={COORD}
        onPress={vi.fn()}
      />,
    );
    expect(screen.getByText("Sin firma del cliente")).toBeTruthy();
    expect(screen.getByText("Faltan 3 de 4 posiciones")).toBeTruthy();
  });

  it("una orden correcta no muestra señales", () => {
    render(<TarjetaRevision item={enBandeja()} ctx={COORD} onPress={vi.fn()} />);
    expect(screen.queryByText(/Faltan/)).toBeNull();
  });
});

describe("decisión", () => {
  function montar(item = enBandeja(), ctx = COORD, props: Record<string, unknown> = {}) {
    const onAprobar = vi.fn();
    const onDevolver = vi.fn();
    render(
      <DecisionRevision
        item={item}
        ctx={ctx}
        onAprobar={onAprobar}
        onDevolver={onDevolver}
        {...props}
      />,
    );
    return { onAprobar, onDevolver };
  }

  it("aprobar envía la orden al cliente", () => {
    const { onAprobar } = montar();
    fireEvent.click(screen.getByTestId("aprobar"));
    expect(onAprobar).toHaveBeenCalledOnce();
  });

  it("no se aprueba con la firma invalidada, y se explica", () => {
    montar(enBandeja({ versionContenido: 8 }));
    expect(screen.getByTestId("aprobar")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("La firma no ampara el contenido actual")).toBeTruthy();
  });

  it("avisa de la autoaprobación en el momento de decidir", () => {
    // Es cuando la persona decide, no solo al mirar la lista.
    montar(enBandeja({ tecnicoId: "u-coo" }));
    expect(screen.getByText("Tú ejecutaste esta orden")).toBeTruthy();
    expect(screen.getByText(/Quedará registrado/)).toBeTruthy();
  });

  it("no se aprueba dos veces mientras procesa", () => {
    const { onAprobar } = montar(enBandeja(), COORD, { procesando: true });
    fireEvent.click(screen.getByTestId("aprobar"));
    expect(onAprobar).not.toHaveBeenCalled();
  });
});

describe("devolución", () => {
  function abrirDevolucion(item = enBandeja()) {
    const onDevolver = vi.fn();
    render(
      <DecisionRevision
        item={item}
        ctx={COORD}
        onAprobar={vi.fn()}
        onDevolver={onDevolver}
      />,
    );
    fireEvent.click(screen.getByTestId("devolver"));
    return { onDevolver };
  }

  it("pide el motivo antes de devolver", () => {
    abrirDevolucion();
    expect(screen.getByText("¿Qué hay que corregir?")).toBeTruthy();
  });

  it("explica que el técnico lo verá en su lista", () => {
    abrirDevolucion();
    expect(screen.getByText(/verá esto en su lista/)).toBeTruthy();
  });

  it("no devuelve sin motivo", () => {
    const { onDevolver } = abrirDevolucion();
    fireEvent.click(screen.getByTestId("confirmar-devolucion"));
    expect(onDevolver).not.toHaveBeenCalled();
    expect(screen.getByText("Explica qué hay que corregir")).toBeTruthy();
  });

  it("rechaza un motivo demasiado corto", () => {
    // Un "revisar" suelto obliga al técnico a volver sin saber qué mirar.
    const { onDevolver } = abrirDevolucion();
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "revisar" } });
    fireEvent.click(screen.getByTestId("confirmar-devolucion"));
    expect(onDevolver).not.toHaveBeenCalled();
  });

  it("devuelve con un motivo con sustancia", () => {
    const { onDevolver } = abrirDevolucion();
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Falta el número de parche en la posición 6" },
    });
    fireEvent.click(screen.getByTestId("confirmar-devolucion"));
    expect(onDevolver).toHaveBeenCalledWith("Falta el número de parche en la posición 6");
  });

  it("ofrece sugerencias a partir de lo detectado", () => {
    // Escribir a mano en el celular es lento, y lo lento se omite.
    abrirDevolucion(enBandeja({}, [med(1), med(2)]));
    expect(screen.getByTestId("sugerencia-0")).toBeTruthy();
  });

  it("tocar una sugerencia la escribe en el campo", () => {
    const { onDevolver } = abrirDevolucion(enBandeja({}, [med(1), med(2)]));
    fireEvent.click(screen.getByTestId("sugerencia-0"));
    fireEvent.click(screen.getByTestId("confirmar-devolucion"));
    expect(onDevolver).toHaveBeenCalledWith(expect.stringContaining("3, 4"));
  });

  it("una orden correcta no ofrece sugerencias", () => {
    abrirDevolucion();
    expect(screen.queryByTestId("sugerencia-0")).toBeNull();
  });

  it("se puede cancelar sin devolver", () => {
    const { onDevolver } = abrirDevolucion();
    fireEvent.click(screen.getByText("Cancelar"));
    expect(onDevolver).not.toHaveBeenCalled();
    expect(screen.getByTestId("aprobar")).toBeTruthy();
  });
});
