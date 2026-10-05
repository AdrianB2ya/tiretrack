import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ReasignarOrden,
  validarReasignacion,
  mensajeHerencia,
  MOTIVOS_REASIGNACION,
} from "../coordinador/ReasignarOrden";
import type { TecnicoLocal } from "../datos/repositorio";

/**
 * Reasignación.
 *
 * Lo central: que el técnico nuevo herede el contexto. Si recibe una orden a
 * medias sin saberlo, rehace lo hecho o se salta lo que faltaba.
 */

const tecnicos: TecnicoLocal[] = [
  { id: "u-tec1", nombre: "Carlos Méndez", sedeId: "sede-fun", activo: true },
  { id: "u-tec2", nombre: "Ana Torres", sedeId: "sede-fun", activo: true },
  { id: "u-tec3", nombre: "Luis García", sedeId: "sede-fun", activo: true },
];

describe("validación", () => {
  const base = {
    tecnicoActualId: "u-tec1",
    tecnicoNuevoId: "u-tec2",
    motivo: "Cambio de turno",
    posicionesCapturadas: 0,
  };

  it("acepta una reasignación completa", () => {
    expect(validarReasignacion(base).permitido).toBe(true);
  });

  it("exige elegir a alguien", () => {
    expect(validarReasignacion({ ...base, tecnicoNuevoId: null }).codigo).toBe("SIN_TECNICO");
  });

  it("no reasigna a la misma persona", () => {
    expect(validarReasignacion({ ...base, tecnicoNuevoId: "u-tec1" }).codigo).toBe("MISMO_TECNICO");
  });

  it("exige motivo", () => {
    // Queda en la auditoría: sin motivo, una reasignación es indistinguible
    // de alguien quitándole trabajo a otro.
    expect(validarReasignacion({ ...base, motivo: "  " }).codigo).toBe("SIN_MOTIVO");
  });

  it("los motivos predefinidos pasan la validación", () => {
    for (const motivo of MOTIVOS_REASIGNACION) {
      expect(validarReasignacion({ ...base, motivo }).permitido, motivo).toBe(true);
    }
  });
});

describe("lo que hereda el técnico nuevo", () => {
  it("una orden sin mediciones empieza de cero", () => {
    expect(mensajeHerencia(0, 22)).toContain("empieza desde el principio");
  });

  it("una orden a medias dice cuánto hay y cuánto falta", () => {
    // Sin esto, el técnico nuevo rehace lo hecho o se salta lo que faltaba.
    const m = mensajeHerencia(15, 22);
    expect(m).toContain("15 posiciones ya capturadas");
    expect(m).toContain("7 por capturar");
  });

  it("una sola posición usa el singular", () => {
    expect(mensajeHerencia(1, 22)).toContain("1 posición ya capturada");
  });

  it("una captura completa lo dice", () => {
    expect(mensajeHerencia(22, 22)).toContain("la captura está completa");
  });
});

describe("pantalla", () => {
  function montar(props: Record<string, unknown> = {}) {
    const onReasignar = vi.fn();
    const onCancelar = vi.fn();
    render(
      <ReasignarOrden
        tecnicos={tecnicos}
        tecnicoActualId="u-tec1"
        posicionesCapturadas={15}
        posicionesTotales={22}
        onReasignar={onReasignar}
        onCancelar={onCancelar}
        {...props}
      />,
    );
    return { onReasignar, onCancelar };
  }

  it("no ofrece al técnico actual como opción", () => {
    // Ofrecerlo invita al error.
    montar();
    expect(screen.queryByTestId("tecnico-u-tec1")).toBeNull();
    expect(screen.getByTestId("tecnico-u-tec2")).toBeTruthy();
  });

  it("muestra lo que hereda antes de confirmar", () => {
    montar();
    expect(screen.getByText(/15 posiciones ya capturadas/)).toBeTruthy();
  });

  it("anuncia cuál está elegido", () => {
    montar();
    fireEvent.click(screen.getByTestId("tecnico-u-tec2"));
    expect(screen.getByTestId("tecnico-u-tec2")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("tecnico-u-tec3")).toHaveAttribute("aria-checked", "false");
  });

  it("reasigna con técnico y motivo", () => {
    const { onReasignar } = montar();
    fireEvent.click(screen.getByTestId("tecnico-u-tec2"));
    fireEvent.click(screen.getByTestId("motivo-1"));
    fireEvent.click(screen.getByTestId("confirmar-reasignacion"));
    expect(onReasignar).toHaveBeenCalledWith("u-tec2", "Cambio de turno");
  });

  it("no reasigna sin elegir técnico", () => {
    const { onReasignar } = montar();
    fireEvent.click(screen.getByTestId("motivo-0"));
    fireEvent.click(screen.getByTestId("confirmar-reasignacion"));
    expect(onReasignar).not.toHaveBeenCalled();
    expect(screen.getByText("Elige a quién reasignar")).toBeTruthy();
  });

  it("no reasigna sin motivo", () => {
    const { onReasignar } = montar();
    fireEvent.click(screen.getByTestId("tecnico-u-tec2"));
    fireEvent.click(screen.getByTestId("confirmar-reasignacion"));
    expect(onReasignar).not.toHaveBeenCalled();
  });

  it("permite escribir un motivo propio", () => {
    const { onReasignar } = montar();
    fireEvent.click(screen.getByTestId("tecnico-u-tec3"));
    fireEvent.change(screen.getByLabelText("Detalle del motivo"), {
      target: { value: "El vehículo se movió a otra planta" },
    });
    fireEvent.click(screen.getByTestId("confirmar-reasignacion"));
    expect(onReasignar).toHaveBeenCalledWith("u-tec3", "El vehículo se movió a otra planta");
  });

  it("sin otros técnicos lo dice en vez de mostrar una lista vacía", () => {
    montar({ tecnicos: [tecnicos[0]] });
    expect(screen.getByText("No hay otros técnicos activos en esta sede")).toBeTruthy();
  });

  it("no reasigna dos veces mientras procesa", () => {
    const { onReasignar } = montar({ procesando: true });
    fireEvent.click(screen.getByTestId("tecnico-u-tec2"));
    fireEvent.click(screen.getByTestId("motivo-0"));
    fireEvent.click(screen.getByTestId("confirmar-reasignacion"));
    expect(onReasignar).not.toHaveBeenCalled();
  });
});
