import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PantallaEnvio } from "../ordenes/PantallaEnvio";
import { construirDiagrama } from "../ordenes/diagrama";
import type { EstadoEnvio } from "../ordenes/envio";
import type { MedicionLocal, OrdenLocal } from "../datos/repositorio";
import {
  CONFIGURACION_CUATRO,
  unaMedicion,
  unaOrdenFirmada,
} from "./fabrica";

/**
 * Pantalla de envío.
 *
 * Lo que se prueba es que el técnico vea de una **qué le falta y qué va a
 * pasar**, en vez de descubrirlo al volver al camión.
 */

const configuracion = CONFIGURACION_CUATRO;

const med = unaMedicion;

// La pantalla de envío parte de una orden todavía en proceso.
const ordenBase: OrdenLocal = unaOrdenFirmada({ firmaVersion: 4, versionContenido: 4 });

function montar(
  orden: Partial<OrdenLocal> = {},
  mediciones: MedicionLocal[] = [1, 2, 3, 4].map((n) => med(n)),
  extra: Partial<EstadoEnvio> = {},
  props: Record<string, unknown> = {},
) {
  const onEnviar = vi.fn();
  const onVolver = vi.fn();
  const estado: EstadoEnvio = {
    orden: { ...ordenBase, ...orden },
    diagrama: construirDiagrama(configuracion, mediciones),
    fotosSinSubir: 0,
    operacionesPendientes: 0,
    ...extra,
  };

  render(
    <PantallaEnvio
      estado={estado}
      rol="tecnico"
      usuarioId="u-tec1"
      onEnviar={onEnviar}
      onVolver={onVolver}
      {...props}
    />,
  );
  return { onEnviar, onVolver };
}

describe("resumen", () => {
  it("muestra el avance en grande", () => {
    montar({}, [med(1), med(2)]);
    expect(screen.getByText("2 de 4")).toBeTruthy();
  });

  it("señala las llantas bajo el mínimo", () => {
    montar({}, [med(1, { profundidad: 1 }), med(2), med(3), med(4)]);
    expect(screen.getByText("1 bajo el mínimo de profundidad")).toBeTruthy();
  });

  it("sin alertas no menciona nada", () => {
    montar();
    expect(screen.queryByText(/bajo el mínimo/)).toBeNull();
  });
});

describe("lista de revisión", () => {
  it("muestra los requisitos cumplidos y pendientes juntos", () => {
    // Ver solo el primero que falla obliga a volver al camión varias veces.
    montar({ kilometraje: null, firmaNombre: null });
    expect(screen.getByTestId("punto-mediciones")).toBeTruthy();
    expect(screen.getByTestId("punto-kilometraje")).toBeTruthy();
    expect(screen.getByTestId("punto-firma")).toBeTruthy();
  });

  it("explica cómo resolver lo que no es obvio", () => {
    montar({ versionContenido: 7 });
    expect(screen.getByText(/Vuelve a capturar la firma/)).toBeTruthy();
  });

  it("separa lo que impide de lo que solo advierte", () => {
    montar({}, [med(1)]);
    expect(screen.getByText("Requisitos")).toBeTruthy();
    expect(screen.getByText("Revisa antes de enviar")).toBeTruthy();
  });

  it("sin advertencias no muestra esa sección", () => {
    montar();
    expect(screen.queryByText("Revisa antes de enviar")).toBeNull();
  });

  it("dice qué posiciones faltan, no solo cuántas", () => {
    montar({}, [med(1), med(2)]);
    expect(screen.getByText(/3, 4/)).toBeTruthy();
  });
});

describe("consecuencias", () => {
  it("se muestran antes del botón, no después", () => {
    // Si el técnico se entera después, ya no puede corregir.
    montar();
    expect(screen.getByText("Al enviar")).toBeTruthy();
    expect(screen.getByText(/no podrás editar las mediciones/)).toBeTruthy();
  });

  it("avisa que puede volver devuelta", () => {
    montar();
    expect(screen.getByText(/devolvértela/)).toBeTruthy();
  });

  it("sin señal aclara que queda en el dispositivo", () => {
    // Sin esto, el técnico cree que envió y la orden sigue en el celular.
    montar({}, undefined, { operacionesPendientes: 4 });
    expect(screen.getByText(/queda en el dispositivo/)).toBeTruthy();
  });
});

describe("envío", () => {
  it("una orden completa se envía directo", () => {
    const { onEnviar } = montar();
    fireEvent.click(screen.getByTestId("enviar"));
    expect(onEnviar).toHaveBeenCalledOnce();
  });

  it("con advertencias pide confirmar una vez", () => {
    // Enviar con posiciones sin capturar es legítimo, pero no por descuido.
    const { onEnviar } = montar({}, [med(1), med(2)]);

    fireEvent.click(screen.getByTestId("enviar"));
    expect(onEnviar).not.toHaveBeenCalled();
    expect(screen.getByText("Confirma el envío")).toBeTruthy();

    fireEvent.click(screen.getByTestId("enviar"));
    expect(onEnviar).toHaveBeenCalledOnce();
  });

  it("el botón dice qué va a pasar al confirmar", () => {
    montar({}, [med(1)]);
    fireEvent.click(screen.getByTestId("enviar"));
    expect(screen.getByText("Enviar de todos modos")).toBeTruthy();
  });

  it("con requisitos pendientes el botón está bloqueado", () => {
    montar({ kilometraje: null });
    expect(screen.getByTestId("enviar")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Todavía no se puede enviar")).toBeTruthy();
  });

  it("no se envía dos veces mientras está enviando", () => {
    const { onEnviar } = montar({}, undefined, {}, { enviando: true });
    fireEvent.click(screen.getByTestId("enviar"));
    expect(onEnviar).not.toHaveBeenCalled();
  });

  it("se puede volver a capturar sin enviar", () => {
    const { onVolver, onEnviar } = montar();
    fireEvent.click(screen.getByText("Seguir capturando"));
    expect(onVolver).toHaveBeenCalledOnce();
    expect(onEnviar).not.toHaveBeenCalled();
  });
});

describe("permisos", () => {
  it("otro técnico no puede enviar la orden ajena", () => {
    montar({}, undefined, {}, { usuarioId: "u-otro" });
    expect(screen.getByTestId("enviar")).toHaveAttribute("aria-disabled", "true");
  });
});
