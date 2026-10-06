import { describe, it, expect } from "vitest";
import {
  revisarEnvio,
  puedeEnviar,
  advertenciasDe,
  consecuenciasDeEnviar,
  resumenEnvio,
  type EstadoEnvio,
} from "../ordenes/envio";
import { construirDiagrama } from "../ordenes/diagrama";
import type { MedicionLocal, OrdenLocal, PosicionEjeLocal } from "../datos/repositorio";

/**
 * Envío a revisión.
 *
 * Es la acción menos reversible del técnico: a partir de aquí no puede
 * editar y alguien más queda esperando. Lo que se prueba es que la pantalla
 * le diga **todo lo que falta y todo lo que va a pasar** antes del botón.
 */

const configuracion: PosicionEjeLocal[] = [1, 2, 3, 4].map((numero) => ({
  configuracionEjeId: "cfg-1",
  numero,
  eje: numero <= 2 ? 1 : 2,
  lado: numero % 2 === 1 ? ("izquierdo" as const) : ("derecho" as const),
  esInterna: false,
  tipoEje: numero <= 2 ? "direccional" : "traccion",
  psiObjetivo: 110,
  profundidadMinima: 3,
}));

function med(posicion: number, extra: Partial<MedicionLocal> = {}): MedicionLocal {
  return {
    id: `m-${posicion}`,
    ordenId: "ord-1",
    posicion,
    marcaId: "mar-1",
    disenoId: "dis-1",
    medida: "295/80R22.5",
    numCalor: null, estadoLlanta: null, observaciones: null, motivoNoId: null, desmontada: null,
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

const ordenBase: OrdenLocal = {
  id: "ord-1",
  folio: "OS-FUN-000001",
  codigoReferencia: null,
  sedeId: "sede-fun",
  vehiculoId: "veh-1",
  clienteId: "cli-1",
  tecnicoId: "u-tec1",
  tecnicoNombre: "Carlos Méndez",
  enviadaRevisionEn: null,
  limiteCliente: null,
  estado: "en_proceso",
  motivoDevolucion: null,
  notaCoordinador: null,
  fecha: "2026-09-18",
  configuracionEjeId: "cfg-1",
  kilometraje: 78900,
  hallazgos: "Desgaste irregular en el eje direccional",
  accion: null,
  firmaNombre: "Luis Reyna",
  firmaCedula: "77221004",
  firmaVersion: 4,
  firmaTrazo: "[[[0,0],[10,5]]]",
  firmaCargo: "Jefe de patio",
  firmaFechaHora: "2026-09-18T14:30:00.000Z",
  version: 9,
  versionContenido: 4,
  sincronizada: true,
};

function estado(
  orden: Partial<OrdenLocal> = {},
  mediciones: MedicionLocal[] = [1, 2, 3, 4].map((n) => med(n)),
  extra: Partial<EstadoEnvio> = {},
): EstadoEnvio {
  return {
    orden: { ...ordenBase, ...orden },
    diagrama: construirDiagrama(configuracion, mediciones),
    fotosSinSubir: 0,
    operacionesPendientes: 0,
    ...extra,
  };
}

describe("lo que impide enviar", () => {
  it("una orden lista se puede enviar", () => {
    expect(puedeEnviar(estado(), "tecnico", "u-tec1").permitido).toBe(true);
  });

  it("sin ninguna posición capturada", () => {
    const v = puedeEnviar(estado({}, []), "tecnico", "u-tec1");
    expect(v.permitido).toBe(false);
    expect(v.mensaje).toContain("ninguna posición");
  });

  it("sin kilometraje", () => {
    const v = puedeEnviar(estado({ kilometraje: null }), "tecnico", "u-tec1");
    expect(v.permitido).toBe(false);
    expect(v.mensaje).toContain("kilometraje");
  });

  it("sin firma", () => {
    const v = puedeEnviar(estado({ firmaNombre: null, firmaVersion: null }), "tecnico", "u-tec1");
    expect(v.permitido).toBe(false);
    expect(v.mensaje).toContain("firma");
  });

  it("con la firma invalidada porque la orden cambió", () => {
    const v = puedeEnviar(estado({ versionContenido: 7 }), "tecnico", "u-tec1");
    expect(v.permitido).toBe(false);
  });

  it("explica cómo resolver lo que no es obvio", () => {
    // "Falta la firma" se entiende; "la firma quedó invalidada" no.
    const puntos = revisarEnvio(estado({ versionContenido: 7 }));
    const firma = puntos.find((p) => p.clave === "firma");
    expect(firma?.texto).toContain("invalidada");
    expect(firma?.comoResolver).toContain("Vuelve a capturar");
  });

  it("enumera todos los bloqueos juntos", () => {
    // Descubrirlos de a uno obliga a volver al camión varias veces.
    const v = puedeEnviar(estado({ kilometraje: null, firmaNombre: null }, []), "tecnico", "u-tec1");
    expect(v.mensaje?.split("·")).toHaveLength(3);
  });
});

describe("lo que solo advierte", () => {
  it("las posiciones faltantes no impiden enviar", () => {
    // Un camión puede llegar con dos llantas desmontadas en el taller.
    // Obligar a inventar mediciones sería peor que dejar constancia.
    const parcial = estado({}, [med(1), med(2)]);
    expect(puedeEnviar(parcial, "tecnico", "u-tec1").permitido).toBe(true);

    const advertencias = advertenciasDe(parcial);
    expect(advertencias.some((a) => a.clave === "posiciones_faltantes")).toBe(true);
  });

  it("dice cuáles faltan, no solo cuántas", () => {
    const advertencias = advertenciasDe(estado({}, [med(1), med(2)]));
    const faltantes = advertencias.find((a) => a.clave === "posiciones_faltantes");
    expect(faltantes?.texto).toContain("3, 4");
  });

  it("sugiere anotar el motivo en vez de bloquear", () => {
    const advertencias = advertenciasDe(estado({}, [med(1)]));
    expect(advertencias.find((a) => a.clave === "posiciones_faltantes")?.comoResolver).toContain(
      "hallazgos",
    );
  });

  it("advierte de las llantas bajo el mínimo", () => {
    const conAlerta = estado({}, [med(1, { profundidad: 2 }), med(2), med(3), med(4)]);
    const advertencias = advertenciasDe(conAlerta);
    const alerta = advertencias.find((a) => a.clave === "alertas");
    expect(alerta?.texto).toContain("bajo el mínimo");
    // Pero no impide: registrar una llanta gastada es justo el trabajo
    expect(puedeEnviar(conAlerta, "tecnico", "u-tec1").permitido).toBe(true);
  });

  it("advierte de las fotos sin subir", () => {
    const advertencias = advertenciasDe(estado({}, undefined, { fotosSinSubir: 3 }));
    const fotos = advertencias.find((a) => a.clave === "fotos");
    expect(fotos?.texto).toContain("3 foto");
    expect(fotos?.comoResolver).toContain("solas cuando haya señal");
  });

  it("advierte si no escribió hallazgos", () => {
    // Es lo primero que lee el cliente si objeta la orden.
    const advertencias = advertenciasDe(estado({ hallazgos: null }));
    const hallazgos = advertencias.find((a) => a.clave === "hallazgos");
    expect(hallazgos?.comoResolver).toContain("si objeta");
  });

  it("unos hallazgos en blanco cuentan como vacíos", () => {
    const advertencias = advertenciasDe(estado({ hallazgos: "   " }));
    expect(advertencias.some((a) => a.clave === "hallazgos")).toBe(true);
  });

  it("una orden completa no genera advertencias", () => {
    expect(advertenciasDe(estado())).toEqual([]);
  });
});

describe("consecuencias del envío", () => {
  it("avisa que pierde la edición", () => {
    // Si se da cuenta al volver al camión, ya no puede corregir.
    const c = consecuenciasDeEnviar(estado());
    expect(c.some((x) => x.includes("no podrás editar"))).toBe(true);
  });

  it("avisa que puede volver devuelta", () => {
    const c = consecuenciasDeEnviar(estado());
    expect(c.some((x) => x.includes("devolvértela"))).toBe(true);
  });

  it("sin señal aclara que queda en el dispositivo", () => {
    // Sin esto, el técnico cree que envió y la orden sigue en el celular.
    const c = consecuenciasDeEnviar(estado({}, undefined, { operacionesPendientes: 5 }));
    expect(c.some((x) => x.includes("queda en el dispositivo"))).toBe(true);
  });

  it("también si quedan fotos por subir", () => {
    const c = consecuenciasDeEnviar(estado({}, undefined, { fotosSinSubir: 2 }));
    expect(c.some((x) => x.includes("queda en el dispositivo"))).toBe(true);
  });

  it("con todo sincronizado no menciona la espera", () => {
    const c = consecuenciasDeEnviar(estado());
    expect(c.some((x) => x.includes("queda en el dispositivo"))).toBe(false);
  });
});

describe("la máquina de estados tiene la última palabra", () => {
  it("una orden ya enviada no se envía otra vez", () => {
    // Es la misma regla que valida el servidor: descubrir allí el rechazo ya
    // sin señal sería peor.
    expect(puedeEnviar(estado({ estado: "en_revision" }), "tecnico", "u-tec1").permitido).toBe(false);
  });

  it("una orden cerrada tampoco", () => {
    expect(puedeEnviar(estado({ estado: "cerrada" }), "tecnico", "u-tec1").permitido).toBe(false);
  });

  it("el cliente no envía órdenes a revisión", () => {
    expect(puedeEnviar(estado(), "cliente", "u-cli").permitido).toBe(false);
  });

  it("otro técnico no envía la orden ajena", () => {
    // El permiso se deriva del técnico asignado: fijarlo a mano anularía la
    // comprobación y dejaría pasar a cualquiera.
    expect(puedeEnviar(estado(), "tecnico", "u-otro").permitido).toBe(false);
  });
});

describe("resumen", () => {
  it("cuenta lo capturado sobre el total", () => {
    const r = resumenEnvio(estado({}, [med(1), med(2)]));
    expect(r.capturadas).toBe(2);
    expect(r.totales).toBe(4);
    expect(r.completa).toBe(false);
  });

  it("marca completa cuando no falta ninguna", () => {
    expect(resumenEnvio(estado()).completa).toBe(true);
  });

  it("cuenta las alertas", () => {
    const r = resumenEnvio(estado({}, [med(1, { profundidad: 1 }), med(2), med(3), med(4)]));
    expect(r.conAlerta).toBe(1);
  });
});
