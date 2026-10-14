import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ROLES } from "@tiretrack/domain";
import { MenuMas } from "../app/MenuMas";
import { GRUPO_DE_OPCION, agruparOpciones, buscarOpciones, opcionesMas } from "../app/navegacion";

/** "Más" por secciones y con búsqueda (R17). */

describe("Más por secciones", () => {
  it("toda opción de todos los roles tiene sección: una nueva no puede quedar suelta", () => {
    const sueltas = ROLES.flatMap((r) => opcionesMas(r)).filter((o) => !GRUPO_DE_OPCION[o.clave]).map((o) => o.clave);
    expect(sueltas).toEqual([]);
  });

  it("las secciones van de lo diario a la cuenta", () => {
    expect(agruparOpciones(opcionesMas("coordinador")).map((g) => g.grupo)).toEqual([
      "Trabajo diario", "Llantas", "Informes", "Administración", "Cuenta",
    ]);
    expect(agruparOpciones(opcionesMas("tecnico")).map((g) => g.grupo)).toEqual(["Trabajo diario", "Llantas", "Informes", "Cuenta"]);
  });

  it("la búsqueda mira el nombre y para qué sirve, sin tildes", () => {
    const o = opcionesMas("administrador");
    expect(buscarOpciones(o, "excel").map((x) => x.clave)).toEqual(["carga"]);
    expect(buscarOpciones(o, "AUDITORIA").map((x) => x.clave)).toContain("auditoria");
    expect(buscarOpciones(o, "")).toHaveLength(o.length);
  });

  it("con muchas opciones ofrece buscar; con pocas no estorba", async () => {
    const onAbrir = vi.fn();
    const { unmount } = render(<MenuMas opciones={opcionesMas("administrador")} onAbrir={onAbrir} />);
    expect(screen.getByTestId("seccion-Administración")).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByTestId("mas-buscar"), { target: { value: "codigo qr" } }); });
    expect(screen.getByTestId("mas-codigos-qr")).toBeTruthy();
    expect(screen.queryByTestId("mas-usuarios")).toBeNull();
    await act(async () => { fireEvent.change(screen.getByTestId("mas-buscar"), { target: { value: "zzz" } }); });
    expect(screen.getByText('Nada con "zzz".')).toBeTruthy();
    unmount();
    render(<MenuMas opciones={opcionesMas("cliente")} onAbrir={onAbrir} />);
    expect(screen.queryByTestId("mas-buscar")).toBeNull();
  });
});
