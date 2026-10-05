import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * Se prueba sobre react-native-web, no sobre el renderizador nativo:
 * Testing Library para React Native importa internos de React Native con
 * sintaxis Flow que Vitest no transpila.
 *
 * Lo que esto cubre bien es el COMPORTAMIENTO —qué se muestra, qué pasa al
 * tocar, qué anuncia a un lector de pantalla— que es lo que puede romperse
 * sin que nadie lo note. La apariencia real en el dispositivo se valida en
 * el emulador.
 */
import { Aviso, Boton, Campo, CampoNumerico, Insignia, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, conOpacidad, estadosOrden, tactil, texto } from "../diseno/tokens";

/**
 * Pruebas del sistema visual.
 *
 * No prueban que se vea bien —eso se valida en el dispositivo— sino que se
 * comporte bien: que los objetivos táctiles cumplan el mínimo, que un botón
 * deshabilitado no dispare la acción y que el estado no dependa solo del
 * color.
 */

describe("tokens", () => {
  it("los objetivos táctiles superan el mínimo accesible", () => {
    // Las guías piden 44; aquí se exige más porque un dedo con guante de
    // trabajo es más ancho y menos preciso.
    expect(tactil.minimo).toBeGreaterThanOrEqual(48);
    expect(tactil.comodo).toBeGreaterThanOrEqual(tactil.minimo);
    expect(tactil.posicionLlanta).toBeGreaterThanOrEqual(48);
  });

  it("ningún tamaño de texto baja de 13", () => {
    // El técnico mira la pantalla a distancia de brazo, con reflejo del sol.
    for (const [nombre, estilo] of Object.entries(texto)) {
      expect(estilo.fontSize, `${nombre} es demasiado pequeño`).toBeGreaterThanOrEqual(13);
    }
  });

  it("los folios usan monoespaciada", () => {
    // Se leen y se dictan por teléfono: la monoespaciada evita confundir
    // caracteres parecidos.
    expect(texto.codigo.fontFamily).toBe("monospace");
  });

  it("cada estado de orden tiene etiqueta y color", () => {
    for (const [clave, def] of Object.entries(estadosOrden)) {
      expect(def.etiqueta, `${clave} sin etiqueta`).toBeTruthy();
      expect(def.color).toMatch(/^#/);
    }
  });

  it("conOpacidad produce un hexadecimal válido", () => {
    expect(conOpacidad("#F57C00", 0.5)).toBe("#F57C0080");
    expect(conOpacidad("#F57C00", 1)).toBe("#F57C00ff");
    expect(conOpacidad("#F57C00", 0)).toBe("#F57C0000");
  });

  it("acota la opacidad fuera de rango", () => {
    expect(conOpacidad("#FFFFFF", 5)).toBe("#FFFFFFff");
    expect(conOpacidad("#FFFFFF", -2)).toBe("#FFFFFF00");
  });
});

describe("Botón", () => {
  it("muestra su texto y responde al toque", () => {
    const alTocar = vi.fn();
    render(<Boton onPress={alTocar}>Guardar</Boton>);
    fireEvent.click(screen.getByText("Guardar"));
    expect(alTocar).toHaveBeenCalledOnce();
  });

  it("deshabilitado no dispara la acción", () => {
    const alTocar = vi.fn();
    render(
      <Boton onPress={alTocar} deshabilitado>
        Guardar
      </Boton>,
    );
    fireEvent.click(screen.getByText("Guardar"));
    expect(alTocar).not.toHaveBeenCalled();
  });

  it("cargando tampoco: evita el doble envío", () => {
    // El técnico con señal mala toca dos veces porque no ve respuesta.
    const alTocar = vi.fn();
    render(
      <Boton onPress={alTocar} cargando testID="btn">
        Enviar
      </Boton>,
    );
    fireEvent.click(screen.getByTestId("btn"));
    expect(alTocar).not.toHaveBeenCalled();
  });

  it("anuncia su estado a los lectores de pantalla", () => {
    // Sin esto, un lector anuncia "botón Guardar" y la persona lo toca sin
    // saber que no hace nada.
    render(
      <Boton deshabilitado testID="btn">
        Guardar
      </Boton>,
    );
    expect(screen.getByTestId("btn").getAttribute("aria-disabled")).toBe("true");
  });

  it("anuncia que está procesando", () => {
    // Sin esto, un lector de pantalla no distingue un botón que está
    // trabajando de uno que no respondió.
    render(
      <Boton cargando testID="btn">
        Enviar
      </Boton>,
    );
    expect(screen.getByTestId("btn").getAttribute("aria-busy")).toBe("true");
  });

  it("se renderiza como botón accesible", () => {
    render(<Boton testID="btn">Guardar</Boton>);
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("los cuatro tipos se renderizan", () => {
    for (const tipo of ["primario", "secundario", "peligro", "fantasma"] as const) {
      const { unmount } = render(<Boton tipo={tipo}>Texto</Boton>);
      expect(screen.getByText("Texto")).toBeTruthy();
      unmount();
    }
  });
});

describe("Insignia", () => {
  it("el estado va en el texto, no solo en el color", () => {
    // Bajo el sol los tonos se confunden, y hay técnicos con daltonismo.
    render(<Insignia color={colores.exito}>Cerrada</Insignia>);
    expect(screen.getByText("Cerrada")).toBeTruthy();
  });

  it("se renderiza con el texto del estado", () => {
    render(<Insignia color={colores.peligro} compacta>Anulada</Insignia>);
    expect(screen.getByText("Anulada")).toBeTruthy();
  });
});

describe("Campo", () => {
  it("asocia la etiqueta con el campo para accesibilidad", () => {
    render(<Campo etiqueta="Serial" />);
    expect(screen.getByLabelText("Serial")).toBeTruthy();
  });

  it("marca los obligatorios", () => {
    render(<Campo etiqueta="Serial" requerido />);
    expect(screen.getByText("*")).toBeTruthy();
  });

  it("muestra el texto de ayuda", () => {
    render(<Campo etiqueta="DOT" ayuda="Semana y año: 3624" />);
    expect(screen.getByText("Semana y año: 3624")).toBeTruthy();
  });

  it("el error reemplaza a la ayuda", () => {
    // Dos textos bajo el campo compiten y el técnico lee el equivocado.
    render(<Campo etiqueta="DOT" ayuda="Semana y año" error="Formato inválido" />);
    expect(screen.getByText("Formato inválido")).toBeTruthy();
    expect(screen.queryByText("Semana y año")).toBeNull();
  });

  it("refleja lo que se escribe", () => {
    const alCambiar = vi.fn();
    render(<Campo etiqueta="Serial" onChangeText={alCambiar} />);
    fireEvent.change(screen.getByLabelText("Serial"), { target: { value: "MX10023458" } });
    expect(alCambiar).toHaveBeenCalledWith("MX10023458");
  });

  it("el campo numérico pide teclado numérico", () => {
    // El técnico captura decenas de cifras por orden: cambiar de teclado
    // cada vez cuesta tiempo real. En web se traduce a inputMode.
    render(<CampoNumerico etiqueta="Profundidad" />);
    const campo = screen.getByLabelText("Profundidad");
    expect(campo.getAttribute("inputmode")).toBe("decimal");
  });
});

describe("Tarjeta", () => {
  it("muestra su contenido", () => {
    render(
      <Tarjeta>
        <Insignia color={colores.exito}>OK</Insignia>
      </Tarjeta>,
    );
    expect(screen.getByText("OK")).toBeTruthy();
  });

  it("es tocable solo si recibe una acción", () => {
    const alTocar = vi.fn();
    const { rerender } = render(
      <Tarjeta onPress={alTocar} testID="t">
        <Insignia color={colores.exito}>OK</Insignia>
      </Tarjeta>,
    );
    fireEvent.click(screen.getByTestId("t"));
    expect(alTocar).toHaveBeenCalledOnce();

    rerender(
      <Tarjeta>
        <Insignia color={colores.exito}>OK</Insignia>
      </Tarjeta>,
    );
    expect(screen.queryByTestId("t")).toBeNull();
  });
});

describe("Aviso", () => {
  it("se anuncia como alerta", () => {
    render(<Aviso titulo="Llanta vencida" tono="peligro" />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("muestra título y detalle", () => {
    render(<Aviso titulo="Firma invalidada" detalle="La orden cambió después de firmarse" />);
    expect(screen.getByText("Firma invalidada")).toBeTruthy();
    expect(screen.getByText("La orden cambió después de firmarse")).toBeTruthy();
  });

  it("los cuatro tonos se renderizan", () => {
    for (const tono of ["info", "advertencia", "peligro", "exito"] as const) {
      const { unmount } = render(<Aviso titulo="Mensaje" tono={tono} />);
      expect(screen.getByText("Mensaje")).toBeTruthy();
      unmount();
    }
  });
});

describe("Vacío", () => {
  it("explica por qué no hay nada", () => {
    render(<Vacio mensaje="No tienes órdenes asignadas" />);
    expect(screen.getByText("No tienes órdenes asignadas")).toBeTruthy();
  });
});

