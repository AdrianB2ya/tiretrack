import { describe, it, expect } from "vitest";
import {
  construirDiagrama,
  siguienteSinCapturar,
  hermanasDe,
  hermanaCapturada,
  estaCompleto,
} from "../ordenes/diagrama";
import type { MedicionLocal, PosicionEjeLocal } from "../datos/repositorio";

/**
 * Diagrama de llantas.
 *
 * Una posición mal ubicada hace que el técnico mida la llanta equivocada, y
 * eso no se detecta después: el dato queda mal para siempre.
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
    psiObjetivo: eje === 1 ? 110 : 105,
    profundidadMinima: eje === 1 ? 3 : 2.5,
    ...extra,
  };
}

/** Tractocamión reducido: eje direccional simple y eje de tracción dual. */
const configuracion: PosicionEjeLocal[] = [
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
    numCalor: null, estadoLlanta: null, observaciones: null, motivoNoId: null,
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

describe("disposición", () => {
  it("agrupa las posiciones por eje", () => {
    const d = construirDiagrama(configuracion, []);
    expect(d.ejes).toHaveLength(2);
    expect(d.totalPosiciones).toBe(6);
  });

  it("ordena los ejes de adelante hacia atrás", () => {
    // Como se ve el camión de pie frente a él.
    const desordenado = [...configuracion].reverse();
    const d = construirDiagrama(desordenado, []);
    expect(d.ejes.map((e) => e.numero)).toEqual([1, 2]);
  });

  it("separa izquierda de derecha", () => {
    const d = construirDiagrama(configuracion, []);
    const traccion = d.ejes[1];
    expect(traccion?.izquierda.map((c) => c.numero)).toEqual([3, 4]);
    expect(traccion?.derecha.map((c) => c.numero)).toEqual([5, 6]);
  });

  it("conserva cuál rueda es la interna en los ejes duales", () => {
    // Si se pierde, el técnico mide la exterior creyendo que es la interna.
    const d = construirDiagrama(configuracion, []);
    const traccion = d.ejes[1];
    expect(traccion?.izquierda.map((c) => c.esInterna)).toEqual([false, true]);
    expect(traccion?.derecha.map((c) => c.esInterna)).toEqual([true, false]);
  });

  it("un eje sencillo no tiene internas", () => {
    const d = construirDiagrama(configuracion, []);
    const direccional = d.ejes[0];
    expect(direccional?.izquierda.every((c) => !c.esInterna)).toBe(true);
  });

  it("lleva el tipo de eje a cada casilla", () => {
    const d = construirDiagrama(configuracion, []);
    expect(d.ejes[0]?.tipoEje).toBe("direccional");
    expect(d.ejes[0]?.izquierda[0]?.tipoEje).toBe("direccional");
  });

  it("lleva los umbrales del eje a cada casilla", () => {
    // El editor de la posición los necesita para precargar el PSI objetivo.
    const d = construirDiagrama(configuracion, []);
    expect(d.ejes[0]?.izquierda[0]?.psiObjetivo).toBe(110);
    expect(d.ejes[1]?.izquierda[0]?.profundidadMinima).toBe(2.5);
  });

  it("sin configuración no inventa un diagrama", () => {
    const d = construirDiagrama([], []);
    expect(d.ejes).toEqual([]);
    expect(d.totalPosiciones).toBe(0);
  });
});

describe("estado de las casillas", () => {
  it("las posiciones sin medir se muestran igual, vacías", () => {
    // Mostrar los huecos es la razón de existir del diagrama.
    const d = construirDiagrama(configuracion, [med(1)]);
    expect(d.totalPosiciones).toBe(6);
    expect(d.faltantes).toEqual([2, 3, 4, 5, 6]);
  });

  it("marca las capturadas", () => {
    const d = construirDiagrama(configuracion, [med(1), med(2)]);
    expect(d.capturadas).toBe(2);
    expect(d.ejes[0]?.izquierda[0]?.estado).toBe("capturada");
  });

  it("distingue las que no se pudieron identificar", () => {
    const d = construirDiagrama(configuracion, [med(4, { noIdentificada: true })]);
    const interna = d.ejes[1]?.izquierda[1];
    expect(interna?.estado).toBe("no_identificada");
    // Cuenta como capturada: la medición existe
    expect(d.capturadas).toBe(1);
  });

  it("alerta cuando la profundidad baja del mínimo del eje", () => {
    // El técnico tiene que verla al mirar el diagrama, no al abrir la
    // posición.
    const d = construirDiagrama(configuracion, [med(1, { profundidad: 2 })]);
    expect(d.ejes[0]?.izquierda[0]?.estado).toBe("alerta_profundidad");
    expect(d.conAlerta).toEqual([1]);
  });

  it("usa el umbral de cada eje, no uno global", () => {
    // El direccional exige 3.0 y el de tracción 2.5: con 2.8 uno alerta y el
    // otro no.
    const d = construirDiagrama(configuracion, [
      med(1, { profundidad: 2.8 }),
      med(3, { profundidad: 2.8 }),
    ]);
    expect(d.conAlerta).toEqual([1]);
  });

  it("la alerta pesa más que el no identificada", () => {
    // Una llanta gastada hay que sacarla aunque no se sepa cuál es.
    const d = construirDiagrama(configuracion, [
      med(1, { profundidad: 1, noIdentificada: true }),
    ]);
    expect(d.ejes[0]?.izquierda[0]?.estado).toBe("alerta_profundidad");
  });

  it("sin umbral configurado no alerta", () => {
    const sinUmbral = [pos(1, 1, "izquierdo", { profundidadMinima: null })];
    const d = construirDiagrama(sinUmbral, [med(1, { profundidad: 0.5 })]);
    expect(d.conAlerta).toEqual([]);
  });

  it("sin profundidad capturada tampoco", () => {
    const d = construirDiagrama(configuracion, [med(1, { profundidad: null })]);
    expect(d.conAlerta).toEqual([]);
    expect(d.ejes[0]?.izquierda[0]?.estado).toBe("capturada");
  });
});

describe("navegación entre posiciones", () => {
  it("lleva a la siguiente sin capturar", () => {
    // Con 22 posiciones, obligar a volver al diagrama cada vez son 22
    // vueltas evitadas.
    const d = construirDiagrama(configuracion, [med(1), med(2)]);
    expect(siguienteSinCapturar(d, 2)).toBe(3);
  });

  it("al llegar al final vuelve a los huecos de atrás", () => {
    const d = construirDiagrama(configuracion, [med(2), med(3), med(4), med(5)]);
    expect(siguienteSinCapturar(d, 6)).toBe(1);
  });

  it("devuelve null cuando no falta ninguna", () => {
    const todas = [1, 2, 3, 4, 5, 6].map((n) => med(n));
    const d = construirDiagrama(configuracion, todas);
    expect(siguienteSinCapturar(d, 1)).toBeNull();
  });
});

describe("posiciones hermanas", () => {
  it("encuentra las del mismo eje", () => {
    const d = construirDiagrama(configuracion, []);
    expect(hermanasDe(d, 3).sort()).toEqual([4, 5, 6]);
    expect(hermanasDe(d, 1)).toEqual([2]);
  });

  it("una posición que no existe no tiene hermanas", () => {
    const d = construirDiagrama(configuracion, []);
    expect(hermanasDe(d, 99)).toEqual([]);
  });

  it("ofrece la hermana capturada más cercana para copiar", () => {
    // Las llantas de un mismo eje suelen ser idénticas.
    const d = construirDiagrama(configuracion, [med(3), med(6)]);
    expect(hermanaCapturada(d, 4)).toBe(3);
  });

  it("no ofrece copiar de una sin identificar", () => {
    // Copiar datos en blanco no ahorra nada.
    const d = construirDiagrama(configuracion, [med(3, { noIdentificada: true })]);
    expect(hermanaCapturada(d, 4)).toBeNull();
  });

  it("no ofrece nada si ninguna hermana está capturada", () => {
    const d = construirDiagrama(configuracion, [med(1)]);
    expect(hermanaCapturada(d, 3)).toBeNull();
  });
});

describe("diagrama completo", () => {
  it("lo detecta cuando no falta ninguna", () => {
    const todas = [1, 2, 3, 4, 5, 6].map((n) => med(n));
    expect(estaCompleto(construirDiagrama(configuracion, todas))).toBe(true);
  });

  it("no lo está si falta alguna", () => {
    expect(estaCompleto(construirDiagrama(configuracion, [med(1)]))).toBe(false);
  });

  it("un diagrama sin posiciones no cuenta como completo", () => {
    expect(estaCompleto(construirDiagrama([], []))).toBe(false);
  });
});
