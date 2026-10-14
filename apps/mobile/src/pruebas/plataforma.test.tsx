import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { EmpresasPlataforma, revisarEmpresa, type FormEmpresa, type FuentesEmpresas } from "../plataforma/EmpresasPlataforma";

/** Alta de empresas desde la app (R16). */

const BIEN: FormEmpresa = {
  nombre: "Llantas del Norte", nit: "900777111", sedeNombre: "Valledupar", sedeCodigo: "VDP", sedeCiudad: "",
  adminNombre: "Laura Gómez", adminCedula: "1065443322", adminEmail: "laura@norte.co", adminTelefono: "",
};

function fuentes(extra: Partial<FuentesEmpresas> = {}): FuentesEmpresas {
  return {
    empresas: vi.fn().mockResolvedValue({ ok: true, datos: [{ id: "e1", nombre: "Asistectire", nit: "901", activa: true, creadaEn: "2026-10-01" }] }),
    crear: vi.fn().mockResolvedValue({ ok: true, datos: { codigo: "K7M2-X9QP", expiraEn: "2026-10-17T12:00:00Z" } }),
    compartir: vi.fn(),
    ...extra,
  };
}

const escribir = (testID: string, valor: string) => fireEvent.change(screen.getByTestId(testID), { target: { value: valor } });

describe("empresas de la plataforma", () => {
  it("las reglas del servidor se revisan antes de enviar", () => {
    expect(revisarEmpresa(BIEN)).toEqual([]);
    expect(revisarEmpresa({ ...BIEN, nit: "1", adminEmail: "mal" })).toEqual(["NIT", "Administrador: email"]);
  });

  it("lista las empresas", async () => {
    render(<EmpresasPlataforma fuentes={fuentes()} />);
    expect(await screen.findByText("Asistectire")).toBeTruthy();
  });

  it("da de alta y muestra el código del administrador una vez, listo para compartir", async () => {
    const f = fuentes();
    render(<EmpresasPlataforma fuentes={f} />);
    await act(async () => { fireEvent.click(screen.getByTestId("nueva-empresa")); });
    await act(async () => {
      escribir("empresa-nombre", BIEN.nombre);
      escribir("empresa-nit", BIEN.nit);
      escribir("empresa-sedeNombre", BIEN.sedeNombre);
      escribir("empresa-sedeCodigo", BIEN.sedeCodigo);
      escribir("empresa-adminNombre", BIEN.adminNombre);
      escribir("empresa-adminCedula", BIEN.adminCedula);
      escribir("empresa-adminEmail", BIEN.adminEmail);
    });
    await act(async () => { fireEvent.click(screen.getByTestId("crear-empresa")); });
    expect(f.crear).toHaveBeenCalledWith(expect.objectContaining({ nombre: BIEN.nombre, sedeCodigo: "VDP" }));
    expect(screen.getByTestId("codigo-activacion").textContent).toBe("K7M2-X9QP");
    await act(async () => { fireEvent.click(screen.getByTestId("compartir-codigo")); });
    expect(f.compartir).toHaveBeenCalledWith(expect.stringContaining("K7M2-X9QP"));
  });

  it("con datos incompletos no envía y dice qué falta", async () => {
    const f = fuentes();
    render(<EmpresasPlataforma fuentes={f} />);
    await act(async () => { fireEvent.click(screen.getByTestId("nueva-empresa")); });
    await act(async () => { fireEvent.click(screen.getByTestId("crear-empresa")); });
    expect(f.crear).not.toHaveBeenCalled();
    expect(screen.getByText("Revisa estos datos")).toBeTruthy();
  });
});
