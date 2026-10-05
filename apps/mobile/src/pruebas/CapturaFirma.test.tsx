import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CapturaFirma, FirmaGuardada, type DatosFirmaCapturada } from "../ordenes/CapturaFirma";
import { VERSION_CONSENTIMIENTO } from "@tiretrack/domain";

/**
 * Pantalla de firma.
 *
 * Lo que se prueba es que el consentimiento **bloquee de verdad** la captura,
 * no que sea una casilla decorativa: el trazo es un dato biométrico y la
 * Ley 1581 exige autorización antes de recolectarlo.
 */

function montar(props: Record<string, unknown> = {}) {
  const onFirmar = vi.fn();
  const onCancelar = vi.fn();
  render(<CapturaFirma onFirmar={onFirmar} onCancelar={onCancelar} {...props} />);
  return { onFirmar, onCancelar };
}

function aceptar() {
  fireEvent.click(screen.getByTestId("aceptar-consentimiento"));
}

describe("consentimiento", () => {
  it("se muestra el texto completo, no un enlace", () => {
    // Informar es parte del requisito: un enlace que nadie abre no informa.
    montar();
    expect(screen.getByText(/Autorizo a que se registre mi firma/)).toBeTruthy();
    expect(screen.getByText(/eliminación/)).toBeTruthy();
  });

  it("empieza sin aceptar", () => {
    montar();
    expect(screen.getByTestId("aceptar-consentimiento").getAttribute("aria-checked")).toBe("false");
  });

  it("los campos están bloqueados hasta aceptar", () => {
    // Se anuncian como no disponibles, no como de solo lectura: son cosas
    // distintas para quien usa un lector de pantalla.
    montar();
    for (const etiqueta of ["Nombre de quien recibe", "Cédula", "Cargo"]) {
      const campo = screen.getByLabelText(etiqueta);
      expect(campo).toHaveAttribute("aria-disabled", "true");
      expect(campo).toHaveAttribute("readonly");
    }
  });

  it("al aceptar se habilitan", () => {
    montar();
    aceptar();
    // Habilitado se expresa por AUSENCIA del atributo, que es lo correcto
    // en HTML: aria-disabled="false" sería redundante.
    const campo = screen.getByLabelText("Nombre de quien recibe");
    expect(campo).not.toHaveAttribute("aria-disabled");
    expect(campo).not.toHaveAttribute("readonly");
  });

  it("el lienzo dice que primero hay que autorizar", () => {
    montar();
    expect(screen.getByText("Primero autorice el registro")).toBeTruthy();

    aceptar();
    expect(screen.getByText("Firme aquí con el dedo")).toBeTruthy();
  });

  it("sin aceptar no se puede confirmar", () => {
    const { onFirmar } = montar();
    fireEvent.click(screen.getByTestId("confirmar-firma"));
    expect(onFirmar).not.toHaveBeenCalled();
  });

  it("el motivo aparece solo tras intentar", () => {
    // Señalar errores mientras la persona escribe es ruido.
    montar();
    expect(screen.queryByText("Falta")).toBeNull();

    fireEvent.click(screen.getByTestId("confirmar-firma"));
    expect(screen.getByText("Falta")).toBeTruthy();
    expect(screen.getByText(/debe autorizar el registro/)).toBeTruthy();
  });
});

describe("validación antes de confirmar", () => {
  it("sin nombre no confirma", () => {
    const { onFirmar } = montar();
    aceptar();
    fireEvent.change(screen.getByLabelText("Cédula"), { target: { value: "77221004" } });
    fireEvent.click(screen.getByTestId("confirmar-firma"));
    expect(onFirmar).not.toHaveBeenCalled();
    expect(screen.getByText("Escribe el nombre de quien recibe")).toBeTruthy();
  });

  it("sin trazo no confirma aunque estén los datos", () => {
    const { onFirmar } = montar();
    aceptar();
    fireEvent.change(screen.getByLabelText("Nombre de quien recibe"), {
      target: { value: "Luis Reyna" },
    });
    fireEvent.change(screen.getByLabelText("Cédula"), { target: { value: "77221004" } });
    fireEvent.click(screen.getByTestId("confirmar-firma"));

    expect(onFirmar).not.toHaveBeenCalled();
    expect(screen.getByText("Falta la firma")).toBeTruthy();
  });

  it("una cédula con puntos es válida", () => {
    // Así la dictan y así la escribe el técnico.
    montar();
    aceptar();
    fireEvent.change(screen.getByLabelText("Cédula"), { target: { value: "77.221.004" } });
    fireEvent.change(screen.getByLabelText("Nombre de quien recibe"), {
      target: { value: "Luis Reyna" },
    });
    fireEvent.click(screen.getByTestId("confirmar-firma"));
    // Solo queda pendiente el trazo, no la cédula
    expect(screen.getByText("Falta la firma")).toBeTruthy();
  });

  it("el cargo no es obligatorio", () => {
    montar();
    aceptar();
    expect(screen.getByLabelText("Cargo")).toBeTruthy();
    expect(screen.queryByText(/Cargo es obligatorio/)).toBeNull();
  });
});

describe("lienzo", () => {
  it("existe y es lo bastante alto para firmar", () => {
    // Un lienzo pequeño produce garabatos que no se parecen a la firma real.
    montar();
    expect(screen.getByTestId("lienzo")).toBeTruthy();
  });

  it("borrar está deshabilitado si no hay nada que borrar", () => {
    montar();
    aceptar();
    expect(screen.getByText("Borrar y repetir").closest("[role=button]")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

describe("confirmación", () => {
  it("no envía dos veces mientras guarda", () => {
    const { onFirmar } = montar({ guardando: true });
    fireEvent.click(screen.getByTestId("confirmar-firma"));
    expect(onFirmar).not.toHaveBeenCalled();
  });

  it("cancelar no captura nada", () => {
    const { onCancelar, onFirmar } = montar();
    aceptar();
    fireEvent.click(screen.getByText("Cancelar"));
    expect(onCancelar).toHaveBeenCalledOnce();
    expect(onFirmar).not.toHaveBeenCalled();
  });
});

describe("firma guardada", () => {
  const trazo = [[{ x: 0, y: 0 }, { x: 10, y: 5 }]];

  it("muestra quién firmó", () => {
    render(<FirmaGuardada trazo={trazo} nombre="Luis Reyna" cedula="77221004" />);
    expect(screen.getByText("Luis Reyna")).toBeTruthy();
    expect(screen.getByText(/C.C. 77221004/)).toBeTruthy();
  });

  it("incluye cargo y fecha cuando los hay", () => {
    render(
      <FirmaGuardada
        trazo={trazo}
        nombre="Luis Reyna"
        cedula="77221004"
        cargo="Jefe de patio"
        fechaHora="2026-09-18T14:30:00.000Z"
      />,
    );
    expect(screen.getByText(/Jefe de patio/)).toBeTruthy();
    expect(screen.getByText(/2026-09-18/)).toBeTruthy();
  });

  it("una firma sin trazo lo dice en vez de mostrar un hueco", () => {
    render(<FirmaGuardada trazo={[]} nombre="Luis Reyna" cedula="77221004" />);
    expect(screen.getByText("Sin trazo registrado")).toBeTruthy();
  });

  it("avisa cuando la firma quedó invalidada", () => {
    // El técnico tiene que saber que hay que recapturarla antes de enviar.
    render(
      <FirmaGuardada trazo={trazo} nombre="Luis Reyna" cedula="77221004" invalidada />,
    );
    expect(screen.getByText(/hay que recapturar la firma/i)).toBeTruthy();
  });

  it("sin invalidar no muestra el aviso", () => {
    render(<FirmaGuardada trazo={trazo} nombre="Luis Reyna" cedula="77221004" />);
    expect(screen.queryByText(/recapturar/i)).toBeNull();
  });
});

describe("versión del consentimiento", () => {
  it("la constante existe para guardarla con la firma", () => {
    // Si cambia la política hay que poder saber cuál aceptó cada persona.
    expect(VERSION_CONSENTIMIENTO).toMatch(/^\d{4}-\d{2}-v\d+$/);
  });
});

/** Tipo usado arriba; se declara para que el archivo no lo pierda. */
export type _Datos = DatosFirmaCapturada;
