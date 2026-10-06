import { describe, it, expect } from "vitest";
import {
  borradorNuevo,
  borradorDesde,
  copiarDeHermana,
  revisar,
  puedeGuardar,
  tieneContenido,
  advertenciasParaConfirmar,
  desgasteRespectoAFabrica,
  MOTIVOS_NO_IDENTIFICADA,
  ETIQUETA_MOTIVO,
  type BorradorMedicion,
} from "../ordenes/reglasEditorPosicion";
import { MOTIVOS_NO_IDENTIFICADA as MOTIVOS_DEL_CONTRATO } from "@tiretrack/contracts";
import type { Casilla } from "../ordenes/diagrama";
import type { MedicionLocal } from "../datos/repositorio";

/**
 * Editor de posición.
 *
 * Es donde el técnico pasa el noventa por ciento del tiempo. Lo que se prueba
 * aquí es que la app **no lo empuje a inventar datos**: si algo no se puede
 * saber, se registra que no se pudo, no se rellena con cualquier cosa.
 */

const HOY = new Date("2026-09-18T10:00:00.000Z");

const casillaDireccional: Casilla = {
  numero: 1,
  estado: "vacia",
  esInterna: false,
  profundidad: null,
  profundidadMinima: 3,
  psiObjetivo: 110,
  tipoEje: "direccional",
};

function borrador(extra: Partial<BorradorMedicion> = {}): BorradorMedicion {
  return { ...borradorNuevo(casillaDireccional), ...extra };
}

describe("borrador nuevo", () => {
  it("precarga el PSI objetivo del eje como calibrado", () => {
    // Es el valor al que el técnico va a dejar la llanta en la gran mayoría
    // de los casos: escribirlo 22 veces por orden es tiempo perdido.
    const b = borradorNuevo(casillaDireccional);
    expect(b.psiCalibrado).toBe(110);
  });

  it("no precarga la presión encontrada", () => {
    // Esa hay que medirla: precargarla sería sugerir un dato falso.
    expect(borradorNuevo(casillaDireccional).psiEncontrada).toBeNull();
  });

  it("sin PSI objetivo no inventa uno", () => {
    const b = borradorNuevo({ ...casillaDireccional, psiObjetivo: null });
    expect(b.psiCalibrado).toBeNull();
  });

  it("lleva el número de la posición", () => {
    expect(borradorNuevo({ ...casillaDireccional, numero: 7 }).posicion).toBe(7);
  });
});

describe("copiar de una hermana del mismo eje", () => {
  const hermana: MedicionLocal = {
    id: "m-3",
    ordenId: "ord-1",
    posicion: 3,
    marcaId: "mar-1",
    disenoId: "dis-1",
    medida: "295/80R22.5",
    numCalor: null, estadoLlanta: null, observaciones: null, motivoNoId: null, desmontada: null,
    serial: "MX10023458",
    dot: "3624",
    psiEncontrada: 98,
    psiCalibrado: 110,
    profundidad: 8.5,
    noIdentificada: false,
    servicios: ["CALI"],
  };

  it("copia la identificación de la llanta", () => {
    const r = copiarDeHermana(borrador(), hermana);
    expect(r.marcaId).toBe("mar-1");
    expect(r.disenoId).toBe("dis-1");
    expect(r.medida).toBe("295/80R22.5");
  });

  it("NO copia el serial", () => {
    // Dos llantas no comparten serial: copiarlo sería fabricar un dato.
    expect(copiarDeHermana(borrador(), hermana).serial).toBeNull();
  });

  it("NO copia las mediciones", () => {
    // Profundidad y presión son propias de cada llanta.
    const r = copiarDeHermana(borrador(), hermana);
    expect(r.profundidad).toBeNull();
    expect(r.psiEncontrada).toBeNull();
  });

  it("NO copia el DOT", () => {
    expect(copiarDeHermana(borrador(), hermana).dot).toBeNull();
  });

  it("conserva el PSI calibrado precargado", () => {
    expect(copiarDeHermana(borrador(), hermana).psiCalibrado).toBe(110);
  });
});

describe("llanta que no se pudo identificar", () => {
  it("se puede guardar sin serial si se dice por qué", () => {
    // Exigir el serial cuando no se ve empuja a inventarlo, y un dato
    // inventado es peor que uno ausente.
    const b = borrador({
      noIdentificada: true,
      motivoNoId: "interna",
      profundidad: 7,
    });
    expect(puedeGuardar(revisar(b, casillaDireccional, HOY)).permitido).toBe(true);
  });

  it("marcarla sin motivo sí bloquea", () => {
    // El motivo es información de flota: "interna sin acceso" no es un
    // descuido, es un dato del vehículo.
    const avisos = revisar(borrador({ noIdentificada: true }), casillaDireccional, HOY);
    expect(avisos.some((a) => a.campo === "motivoNoId" && a.severidad === "error")).toBe(true);
  });

  it("los motivos son los códigos del contrato, no una lista propia", () => {
    // La pantalla tenía su propia lista de etiquetas y el servidor esperaba
    // códigos: toda llanta no identificada habría sido rechazada.
    expect(MOTIVOS_NO_IDENTIFICADA).toBe(MOTIVOS_DEL_CONTRATO);
    expect(MOTIVOS_NO_IDENTIFICADA).toContain("interna");
  });

  it("cada código tiene una etiqueta legible", () => {
    // El técnico lee "Llanta interna sin acceso", no "interna".
    for (const codigo of MOTIVOS_NO_IDENTIFICADA) {
      expect(ETIQUETA_MOTIVO[codigo], codigo).toBeTruthy();
      expect(ETIQUETA_MOTIVO[codigo]).not.toBe(codigo);
    }
  });

  it("sin serial y sin marcarla, solo advierte", () => {
    const avisos = revisar(borrador({ profundidad: 7 }), casillaDireccional, HOY);
    const serial = avisos.find((a) => a.campo === "serial");
    expect(serial?.severidad).toBe("advertencia");
    expect(serial?.mensaje).toContain("no identificada");
  });
});

describe("validación del DOT", () => {
  it("acepta uno válido", () => {
    const avisos = revisar(borrador({ dot: "3624", serial: "MX1" }), casillaDireccional, HOY);
    expect(avisos.filter((a) => a.campo === "dot")).toHaveLength(0);
  });

  it("un formato imposible es error", () => {
    const avisos = revisar(borrador({ dot: "abc" }), casillaDireccional, HOY);
    const dot = avisos.find((a) => a.campo === "dot");
    expect(dot?.severidad).toBe("error");
    expect(dot?.mensaje).toContain("4 dígitos");
  });

  it("una llanta vencida se advierte, no se bloquea", () => {
    // Está montada: el técnico tiene que poder registrarla para que quede
    // constancia de que hay que cambiarla.
    const avisos = revisar(borrador({ dot: "0819", serial: "MX1" }), casillaDireccional, HOY);
    const dot = avisos.find((a) => a.campo === "dot");
    expect(dot?.severidad).toBe("advertencia");
    expect(puedeGuardar(avisos).permitido).toBe(true);
  });

  it("sin DOT no se inventa un aviso", () => {
    const avisos = revisar(borrador({ serial: "MX1" }), casillaDireccional, HOY);
    expect(avisos.filter((a) => a.campo === "dot")).toHaveLength(0);
  });
});

describe("profundidad", () => {
  it("una negativa es imposible", () => {
    const avisos = revisar(borrador({ profundidad: -2 }), casillaDireccional, HOY);
    expect(avisos.find((a) => a.campo === "profundidad")?.severidad).toBe("error");
  });

  it("una enorme se advierte pero se permite", () => {
    // Probablemente sea un error de dedo, pero una llanta de cargador puede
    // tenerla. El técnico está frente a ella; la app no.
    const avisos = revisar(borrador({ profundidad: 45, serial: "MX1" }), casillaDireccional, HOY);
    expect(avisos.find((a) => a.campo === "profundidad")?.severidad).toBe("advertencia");
    expect(puedeGuardar(avisos).permitido).toBe(true);
  });

  it("bajo el mínimo del eje se advierte", () => {
    const avisos = revisar(borrador({ profundidad: 2, serial: "MX1" }), casillaDireccional, HOY);
    const aviso = avisos.find((a) => a.campo === "profundidad");
    expect(aviso?.severidad).toBe("advertencia");
    expect(aviso?.mensaje).toContain("3 mm");
  });

  it("sin umbral configurado no se compara", () => {
    const sinUmbral = { ...casillaDireccional, profundidadMinima: null };
    const avisos = revisar(borrador({ profundidad: 1, serial: "MX1" }), sinUmbral, HOY);
    expect(avisos.filter((a) => a.campo === "profundidad")).toHaveLength(0);
  });
});

describe("presión", () => {
  it("una imposible es error", () => {
    const avisos = revisar(borrador({ psiEncontrada: 900 }), casillaDireccional, HOY);
    expect(avisos.find((a) => a.campo === "psiEncontrada")?.severidad).toBe("error");
  });

  it("fuera del rango objetivo solo informa", () => {
    // Es justo lo que el técnico va a corregir calibrando: no es un error
    // suyo, es el hallazgo.
    const avisos = revisar(
      borrador({ psiEncontrada: 80, serial: "MX1" }),
      casillaDireccional,
      HOY,
    );
    const aviso = avisos.find((a) => a.campo === "psiEncontrada");
    expect(aviso?.severidad).toBe("informacion");
    expect(aviso?.mensaje).toContain("baja");
  });

  it("distingue presión alta de baja", () => {
    const avisos = revisar(
      borrador({ psiEncontrada: 150, serial: "MX1" }),
      casillaDireccional,
      HOY,
    );
    expect(avisos.find((a) => a.campo === "psiEncontrada")?.mensaje).toContain("alta");
  });

  it("dentro del rango no dice nada", () => {
    const avisos = revisar(
      borrador({ psiEncontrada: 108, serial: "MX1" }),
      casillaDireccional,
      HOY,
    );
    expect(avisos.filter((a) => a.campo === "psiEncontrada")).toHaveLength(0);
  });
});

describe("parche", () => {
  it("un número de parche sin tipo se advierte", () => {
    const avisos = revisar(borrador({ numParche: "P-4471", serial: "MX1" }), casillaDireccional, HOY);
    expect(avisos.find((a) => a.campo === "tipoParcheId")?.severidad).toBe("advertencia");
  });

  it("con ambos no dice nada", () => {
    const b = borrador({ numParche: "P-4471", tipoParcheId: "tp-1", serial: "MX1" });
    expect(revisar(b, casillaDireccional, HOY).filter((a) => a.campo === "tipoParcheId")).toHaveLength(0);
  });
});

describe("reglas para guardar", () => {
  it("solo los errores bloquean", () => {
    const soloAdvertencias = revisar(
      borrador({ profundidad: 2, dot: "0819", serial: "MX1" }),
      casillaDireccional,
      HOY,
    );
    expect(soloAdvertencias.length).toBeGreaterThan(0);
    expect(puedeGuardar(soloAdvertencias).permitido).toBe(true);
  });

  it("el motivo del bloqueo enumera todos los errores", () => {
    const avisos = revisar(
      borrador({ noIdentificada: true, dot: "xx", profundidad: -1 }),
      casillaDireccional,
      HOY,
    );
    const v = puedeGuardar(avisos);
    expect(v.permitido).toBe(false);
    expect(v.mensaje?.split("·").length).toBeGreaterThanOrEqual(3);
  });

  it("las advertencias se separan para confirmarlas antes de guardar", () => {
    // Mostrarlas una vez atrapa el error de dedo sin estorbar cuando el dato
    // es correcto.
    const avisos = revisar(borrador({ profundidad: 45, serial: "MX1" }), casillaDireccional, HOY);
    const confirmar = advertenciasParaConfirmar(avisos);
    expect(confirmar).toHaveLength(1);
    expect(confirmar[0]?.severidad).toBe("advertencia");
  });

  it("la información no pide confirmación", () => {
    const avisos = revisar(borrador({ psiEncontrada: 80, serial: "MX1" }), casillaDireccional, HOY);
    expect(advertenciasParaConfirmar(avisos)).toHaveLength(0);
  });
});

describe("borrador vacío", () => {
  it("no se guarda: sería una fila sin datos", () => {
    expect(tieneContenido(borradorNuevo(casillaDireccional))).toBe(false);
  });

  it("cualquier dato capturado ya cuenta", () => {
    expect(tieneContenido(borrador({ profundidad: 9 }))).toBe(true);
    expect(tieneContenido(borrador({ serial: "MX1" }))).toBe(true);
    expect(tieneContenido(borrador({ servicios: ["CALI"] }))).toBe(true);
  });

  it("marcarla como no identificada también es contenido", () => {
    // Decir "no se pudo identificar" es un dato, no la ausencia de uno.
    expect(tieneContenido(borrador({ noIdentificada: true }))).toBe(true);
  });
});

describe("desgaste respecto a fábrica", () => {
  it("lo calcula con la profundidad original de la medida", () => {
    const d = desgasteRespectoAFabrica(8, 16);
    expect(d?.porcentaje).toBe(50);
    expect(d?.restante).toBe(8);
  });

  it("sin profundidad de fábrica no lo inventa", () => {
    expect(desgasteRespectoAFabrica(8, null)).toBeNull();
  });

  it("sin medición tampoco", () => {
    expect(desgasteRespectoAFabrica(null, 16)).toBeNull();
  });
});

describe("reanudar una posición ya capturada", () => {
  it("carga lo que había", () => {
    const previa: MedicionLocal = {
      id: "m-1",
      ordenId: "ord-1",
      posicion: 1,
      marcaId: "mar-1",
      disenoId: "dis-1",
      medida: "295/80R22.5",
      numCalor: null, estadoLlanta: null, observaciones: null, motivoNoId: null, desmontada: null,
      serial: "MX1",
      dot: "3624",
      psiEncontrada: 98,
      psiCalibrado: 110,
      profundidad: 8.5,
      noIdentificada: false,
      servicios: ["CALI", "RETO"],
    };
    const b = borradorDesde(previa);
    expect(b.serial).toBe("MX1");
    expect(b.profundidad).toBe(8.5);
    expect(b.servicios).toEqual(["CALI", "RETO"]);
  });

  it("los servicios se copian, no se comparten", () => {
    // Si compartieran el arreglo, editar el borrador mutaría la medición
    // guardada.
    const previa = {
      id: "m-1", ordenId: "ord-1", posicion: 1, marcaId: null, disenoId: null,
      medida: null, numCalor: null, serial: null, dot: null, estadoLlanta: null, observaciones: null,
      motivoNoId: null, desmontada: null, psiEncontrada: null, psiCalibrado: null,
      profundidad: null, noIdentificada: false, servicios: ["CALI"],
    };
    const b = borradorDesde(previa);
    b.servicios.push("RETO");
    expect(previa.servicios).toEqual(["CALI"]);
  });
});
