import { describe, it, expect } from "vitest";
import { leerDOT, dotValido, ANIOS_VIDA_DOT } from "./dot";
import {
  calcularDesgaste,
  bajoMinimo,
  presionFueraDeRango,
  ejeDePosicion,
  posicionesHermanas,
  totalPosiciones,
  configuracionCoherente,
  type DefinicionEje,
} from "./medicion";

const HOY = new Date("2026-09-04T00:00:00.000Z");

describe("lectura del DOT", () => {
  it("interpreta semana y año", () => {
    const r = leerDOT("3624", HOY);
    expect(r?.semana).toBe(36);
    expect(r?.anio).toBe(2024);
    expect(r?.fabricacionTexto).toBe("Semana 36 de 2024");
  });

  it("calcula el vencimiento a los seis años de fabricada", () => {
    // El DOT es fecha de FABRICACIÓN, no de vencimiento. El caucho se
    // degrada aunque la llanta no se use.
    const r = leerDOT("3624", HOY);
    expect(r?.vencimiento.startsWith("2030")).toBe(true);
    expect(ANIOS_VIDA_DOT).toBe(6);
  });

  it("marca como vencida una llanta de más de seis años", () => {
    const r = leerDOT("0819", HOY); // semana 8 de 2019
    expect(r?.vencida).toBe(true);
    expect(r?.aniosCumplidos).toBeGreaterThanOrEqual(7);
  });

  it("avisa cuando le queda menos de un año", () => {
    // Semana 45 de 2020 vence en noviembre de 2026: quedan dos meses.
    const r = leerDOT("4520", HOY);
    expect(r?.vencida).toBe(false);
    expect(r?.porVencer).toBe(true);
  });

  it("una llanta reciente no está vencida ni por vencer", () => {
    const r = leerDOT("2126", HOY);
    expect(r?.vencida).toBe(false);
    expect(r?.porVencer).toBe(false);
  });

  it("acepta el código completo del flanco y toma los últimos cuatro", () => {
    expect(leerDOT("DOT B3UN R4TR 3624", HOY)?.semana).toBe(36);
  });

  it("interpreta años de los noventa", () => {
    const r = leerDOT("1095", HOY);
    expect(r?.anio).toBe(1995);
    expect(r?.vencida).toBe(true);
  });

  it("devuelve null en vez de inventar una fecha", () => {
    // Un dato inventado en el cálculo de vencimiento es peor que uno faltante.
    expect(leerDOT("", HOY)).toBeNull();
    expect(leerDOT(null, HOY)).toBeNull();
    expect(leerDOT("abc", HOY)).toBeNull();
    expect(leerDOT("362", HOY)).toBeNull();
    expect(leerDOT("9924", HOY)).toBeNull(); // semana 99 no existe
    expect(leerDOT("0024", HOY)).toBeNull(); // semana 0 no existe
  });

  it("dotValido resume la validez del formato", () => {
    expect(dotValido("3624")).toBe(true);
    expect(dotValido("xx")).toBe(false);
  });
});

describe("cálculo de desgaste", () => {
  it("calcula el porcentaje contra la profundidad de fábrica", () => {
    // La profundidad original depende de diseño Y medida: un XZY-3 en
    // 295/80R22.5 trae 16 mm.
    expect(calcularDesgaste(8, 16)).toBe(50);
    expect(calcularDesgaste(12, 16)).toBe(25);
  });

  it("una llanta nueva no tiene desgaste", () => {
    expect(calcularDesgaste(16, 16)).toBe(0);
  });

  it("no devuelve valores fuera de 0 a 100", () => {
    expect(calcularDesgaste(20, 16)).toBe(0); // midieron de más
    expect(calcularDesgaste(-2, 16)).toBe(100);
  });

  it("devuelve null si falta el dato de fábrica", () => {
    expect(calcularDesgaste(8, null)).toBeNull();
    expect(calcularDesgaste(null, 16)).toBeNull();
    expect(calcularDesgaste(8, 0)).toBeNull();
  });
});

describe("umbral de profundidad por eje", () => {
  it("detecta cuando está bajo el mínimo del eje", () => {
    expect(bajoMinimo(2.5, 3.0)).toBe(true);
    expect(bajoMinimo(3.0, 3.0)).toBe(false);
    expect(bajoMinimo(4.0, 3.0)).toBe(false);
  });

  it("sin umbral configurado no alerta", () => {
    expect(bajoMinimo(1.0, null)).toBe(false);
    expect(bajoMinimo(null, 3.0)).toBe(false);
  });
});

describe("presión fuera de rango", () => {
  it("tolera hasta un 15% de diferencia", () => {
    expect(presionFueraDeRango(100, 110)).toBe(false); // 9%
    expect(presionFueraDeRango(88, 110)).toBe(true); // 20%
  });

  it("alerta igual si la presión está por encima", () => {
    expect(presionFueraDeRango(135, 110)).toBe(true);
  });

  it("permite ajustar la tolerancia", () => {
    expect(presionFueraDeRango(100, 110, 0.05)).toBe(true);
  });

  it("sin objetivo configurado no alerta", () => {
    expect(presionFueraDeRango(50, null)).toBe(false);
    expect(presionFueraDeRango(50, 0)).toBe(false);
  });
});

const tractocamion: DefinicionEje[] = [
  {
    numero: 1,
    tipoEje: "direccional",
    psiObjetivo: 110,
    profundidadMinima: 3.0,
    posicionesIzquierda: [1],
    posicionesDerecha: [2],
  },
  {
    numero: 2,
    tipoEje: "traccion",
    psiObjetivo: 105,
    profundidadMinima: 2.5,
    posicionesIzquierda: [3, 4],
    posicionesDerecha: [5, 6],
  },
  {
    numero: 3,
    tipoEje: "arrastre",
    psiObjetivo: 100,
    profundidadMinima: 2.0,
    posicionesIzquierda: [7, 8],
    posicionesDerecha: [9, 10],
  },
];

describe("configuración de ejes", () => {
  it("localiza el eje de una posición", () => {
    expect(ejeDePosicion(tractocamion, 1)?.tipoEje).toBe("direccional");
    expect(ejeDePosicion(tractocamion, 5)?.tipoEje).toBe("traccion");
    expect(ejeDePosicion(tractocamion, 9)?.tipoEje).toBe("arrastre");
  });

  it("devuelve null para una posición que no existe", () => {
    expect(ejeDePosicion(tractocamion, 47)).toBeNull();
  });

  it("encuentra las hermanas del mismo eje", () => {
    // Es lo que permite copiar en vez de teclear ocho campos por posición.
    expect(posicionesHermanas(tractocamion, 3).sort()).toEqual([4, 5, 6]);
    expect(posicionesHermanas(tractocamion, 1)).toEqual([2]);
    expect(posicionesHermanas(tractocamion, 99)).toEqual([]);
  });

  it("cuenta el total de posiciones", () => {
    expect(totalPosiciones(tractocamion)).toBe(10);
  });

  it("valida que la numeración sea consecutiva desde 1", () => {
    expect(configuracionCoherente(tractocamion)).toBe(true);
  });

  it("rechaza configuraciones con huecos", () => {
    const conHueco: DefinicionEje[] = [
      { numero: 1, tipoEje: "direccional", posicionesIzquierda: [1], posicionesDerecha: [2] },
      { numero: 2, tipoEje: "traccion", posicionesIzquierda: [4], posicionesDerecha: [5] },
    ];
    expect(configuracionCoherente(conHueco)).toBe(false);
  });

  it("rechaza posiciones repetidas", () => {
    const repetida: DefinicionEje[] = [
      { numero: 1, tipoEje: "direccional", posicionesIzquierda: [1], posicionesDerecha: [2] },
      { numero: 2, tipoEje: "traccion", posicionesIzquierda: [2], posicionesDerecha: [3] },
    ];
    expect(configuracionCoherente(repetida)).toBe(false);
  });

  it("rechaza una configuración vacía", () => {
    expect(configuracionCoherente([])).toBe(false);
  });
});
