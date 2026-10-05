import { describe, it, expect } from "vitest";
import {
  validarFirma,
  cedulaValida,
  normalizarCedula,
  serializarTrazo,
  deserializarTrazo,
  trazoASvg,
  registrarConsentimiento,
  VERSION_CONSENTIMIENTO,
  TEXTO_CONSENTIMIENTO,
  PUNTOS_MINIMOS_TRAZO,
  type DatosFirma,
} from "./captura-firma";

/**
 * Captura de firma.
 *
 * El trazo es un dato biométrico: la Ley 1581 exige consentimiento informado
 * antes de recolectarlo. Eso condiciona el orden de las validaciones.
 */

function trazoDe(puntos: number): { x: number; y: number }[][] {
  return [Array.from({ length: puntos }, (_, i) => ({ x: i, y: i * 2 }))];
}

const firmaValida: DatosFirma = {
  nombre: "Luis Reyna",
  cedula: "77221004",
  cargo: "Jefe de patio",
  trazo: trazoDe(20),
  consentimientoAceptado: true,
};

describe("consentimiento", () => {
  it("sin autorización no se puede firmar", () => {
    const r = validarFirma({ ...firmaValida, consentimientoAceptado: false });
    expect(r.codigo).toBe("SIN_CONSENTIMIENTO");
  });

  it("se comprueba ANTES que cualquier otro dato", () => {
    // Capturar el trazo y después preguntar sería recolectar el dato
    // biométrico antes de tener permiso.
    const todoMal: DatosFirma = {
      nombre: "",
      cedula: "",
      trazo: [],
      consentimientoAceptado: false,
    };
    expect(validarFirma(todoMal).codigo).toBe("SIN_CONSENTIMIENTO");
  });

  it("el texto explica para qué se usan los datos y qué derechos hay", () => {
    // No basta con pedir permiso: la ley exige informar.
    expect(TEXTO_CONSENTIMIENTO).toContain("solo para respaldar esta orden");
    expect(TEXTO_CONSENTIMIENTO).toContain("eliminación");
  });

  it("la constancia guarda qué versión se aceptó", () => {
    // Si cambia la política, hay que saber cuál aceptó cada persona.
    const r = registrarConsentimiento(new Date("2026-09-18T10:00:00.000Z"));
    expect(r.version).toBe(VERSION_CONSENTIMIENTO);
    expect(r.aceptadoEn).toBe("2026-09-18T10:00:00.000Z");
  });
});

describe("identificación de quien recibe", () => {
  it("acepta una firma completa", () => {
    expect(validarFirma(firmaValida).permitido).toBe(true);
  });

  it("exige un nombre con sustancia", () => {
    expect(validarFirma({ ...firmaValida, nombre: "L" }).codigo).toBe("NOMBRE_INVALIDO");
    expect(validarFirma({ ...firmaValida, nombre: "   " }).codigo).toBe("NOMBRE_INVALIDO");
  });

  it("el cargo es opcional", () => {
    // No siempre lo sabe el técnico, y exigirlo lo haría inventarlo.
    expect(validarFirma({ ...firmaValida, cargo: null }).permitido).toBe(true);
  });

  it("valida la cédula", () => {
    expect(cedulaValida("77221004")).toBe(true);
    expect(cedulaValida("1082334556")).toBe(true);
    expect(cedulaValida("123")).toBe(false);
    expect(cedulaValida("abc123456")).toBe(false);
  });

  it("acepta la cédula escrita con puntos", () => {
    // Así la dictan y así la escribe el técnico.
    expect(cedulaValida("77.221.004")).toBe(true);
    expect(normalizarCedula("77.221.004")).toBe("77221004");
    expect(normalizarCedula("1 082 334 556")).toBe("1082334556");
  });
});

describe("trazo", () => {
  it("sin trazo no hay firma", () => {
    expect(validarFirma({ ...firmaValida, trazo: [] }).codigo).toBe("SIN_TRAZO");
  });

  it("un roce accidental no cuenta como firma", () => {
    // Un punto suelto suele ser la palma tocando la pantalla.
    const r = validarFirma({ ...firmaValida, trazo: trazoDe(3) });
    expect(r.codigo).toBe("TRAZO_INSUFICIENTE");
    expect(r.mensaje).toContain("Inténtalo de nuevo");
  });

  it("acepta justo en el mínimo", () => {
    expect(validarFirma({ ...firmaValida, trazo: trazoDe(PUNTOS_MINIMOS_TRAZO) }).permitido).toBe(
      true,
    );
  });

  it("suma los puntos de varios segmentos", () => {
    // Una firma con el bolígrafo levantado son varios trazos.
    const enPartes = [trazoDe(4)[0]!, trazoDe(5)[0]!];
    expect(validarFirma({ ...firmaValida, trazo: enPartes }).permitido).toBe(true);
  });
});

describe("serialización del trazo", () => {
  it("guarda puntos, no una imagen", () => {
    // Ocupan mucho menos, se sincronizan por conexiones malas y se pueden
    // redibujar a cualquier tamaño, incluido el PDF.
    const crudo = serializarTrazo([[{ x: 1, y: 2 }, { x: 3, y: 4 }]]);
    expect(crudo).toBe("[[[1,2],[3,4]]]");
  });

  it("redondea a un decimal", () => {
    // La precisión de un dedo no da para más y el tamaño baja a la mitad.
    const crudo = serializarTrazo([[{ x: 1.23456, y: 2.98765 }]]);
    expect(crudo).toBe("[[[1.2,3]]]");
  });

  it("ida y vuelta conserva el trazo", () => {
    const original = [
      [{ x: 1, y: 2 }, { x: 3, y: 4 }],
      [{ x: 5, y: 6 }],
    ];
    expect(deserializarTrazo(serializarTrazo(original))).toEqual(original);
  });

  it("un trazo corrupto no impide abrir la orden", () => {
    // Se muestra sin firma en vez de reventar la pantalla.
    expect(deserializarTrazo("esto-no-es-json")).toEqual([]);
    expect(deserializarTrazo(null)).toEqual([]);
  });
});

describe("dibujo del trazo", () => {
  it("produce una ruta SVG", () => {
    const d = trazoASvg([[{ x: 0, y: 0 }, { x: 10, y: 5 }]]);
    expect(d).toBe("M 0 0 L 10 5");
  });

  it("separa los segmentos", () => {
    const d = trazoASvg([
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      [{ x: 5, y: 5 }, { x: 6, y: 6 }],
    ]);
    expect(d).toBe("M 0 0 L 1 1 M 5 5 L 6 6");
  });

  it("un punto solo se dibuja igual", () => {
    // Si no, un punto de la firma desaparecería al redibujarla.
    expect(trazoASvg([[{ x: 3, y: 4 }]])).toBe("M 3 4 L 3.5 4");
  });

  it("ignora los segmentos vacíos", () => {
    expect(trazoASvg([[], [{ x: 1, y: 1 }, { x: 2, y: 2 }]])).toBe("M 1 1 L 2 2");
  });

  it("un trazo vacío produce una ruta vacía", () => {
    expect(trazoASvg([])).toBe("");
  });
});
