import { describe, it, expect } from "vitest";
import {
  resumirFirma,
  requisitosParaEnviar,
  puedeEnviarARevision,
  accionesDisponibles,
  estadoSincronizacion,
  resumirPosiciones,
  posicionesFaltantes,
  type DetalleOrden,
  type ContextoUsuario,
} from "../ordenes/detalle";
import type { MedicionLocal, OrdenLocal } from "../datos/repositorio";

/**
 * Lógica del detalle.
 *
 * Lo que se verifica aquí es sobre todo que la app **explique por qué no se
 * puede**: un botón gris sin motivo en el patio termina en una llamada al
 * coordinador.
 */

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
  fecha: "2026-09-17",
  configuracionEjeId: "cfg-1",
  kilometraje: 78900,
  hallazgos: null,
  accion: null,
  firmaNombre: null,
  firmaCedula: null,
  firmaVersion: null,
  firmaTrazo: null,
  firmaCargo: null,
  firmaFechaHora: null,
  version: 3,
  versionContenido: 2,
  sincronizada: true,
};

function medicion(posicion: number, extra: Partial<MedicionLocal> = {}): MedicionLocal {
  return {
    id: `med-${posicion}`,
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

function detalle(
  orden: Partial<OrdenLocal> = {},
  extra: Partial<DetalleOrden> = {},
): DetalleOrden {
  return {
    orden: { ...ordenBase, ...orden },
    vehiculoCodigo: "CA-12",
    vehiculoPlaca: "SXK482",
    clienteNombre: "Transportes Reyna",
    sedeClienteNombre: "Planta Fundación",
    mediciones: [medicion(1)],
    posicionesTotales: 22,
    fotosSinSubir: 0,
    ...extra,
  };
}

const TECNICO: ContextoUsuario = { usuarioId: "u-tec1", rol: "tecnico" };

describe("estado de la firma", () => {
  it("sin firma lo dice sin alarmar", () => {
    const r = resumirFirma(ordenBase);
    expect(r.estado).toBe("sin_firmar");
    expect(r.mensaje).toBeNull();
  });

  it("es vigente si ampara el contenido actual", () => {
    const r = resumirFirma({
      ...ordenBase,
      firmaNombre: "Luis Reyna",
      firmaVersion: 2,
      versionContenido: 2,
    });
    expect(r.estado).toBe("vigente");
    expect(r.nombre).toBe("Luis Reyna");
  });

  it("cambiar de estado NO la invalida", () => {
    // Se ancla a versionContenido, no a version: el documento que el cliente
    // firmó no cambia porque la orden avance en el flujo.
    const r = resumirFirma({
      ...ordenBase,
      firmaNombre: "Luis Reyna",
      firmaVersion: 2,
      versionContenido: 2,
      version: 99,
    });
    expect(r.estado).toBe("vigente");
  });

  it("editar una medición sí la invalida", () => {
    const r = resumirFirma({
      ...ordenBase,
      firmaNombre: "Luis Reyna",
      firmaVersion: 2,
      versionContenido: 3,
    });
    expect(r.estado).toBe("invalidada");
  });

  it("explica que no es culpa del técnico", () => {
    const r = resumirFirma({
      ...ordenBase,
      firmaNombre: "Luis Reyna",
      firmaVersion: 1,
      versionContenido: 5,
    });
    expect(r.mensaje).toContain("cambió después de firmarse");
    expect(r.mensaje).toContain("volver a capturar");
  });
});

describe("requisitos para enviar", () => {
  it("muestra todos, no solo el primero que falla", () => {
    // El técnico está en el patio: necesita saber todo lo que le falta antes
    // de guardar el celular, no descubrirlo de a uno.
    const r = requisitosParaEnviar(detalle({ kilometraje: null }, { mediciones: [] }));
    const pendientes = r.filter((x) => !x.cumplido);
    expect(pendientes).toHaveLength(3);
  });

  it("marca los cumplidos con el detalle", () => {
    const r = requisitosParaEnviar(detalle({}, { mediciones: [medicion(1), medicion(2)] }));
    const mediciones = r.find((x) => x.clave === "mediciones");
    expect(mediciones?.cumplido).toBe(true);
    expect(mediciones?.texto).toBe("2 de 22 posiciones capturadas");
  });

  it("distingue firma faltante de firma invalidada", () => {
    const sinFirma = requisitosParaEnviar(detalle());
    expect(sinFirma.find((r) => r.clave === "firma")?.texto).toContain("Falta la firma");

    const invalidada = requisitosParaEnviar(
      detalle({ firmaNombre: "Luis", firmaVersion: 1, versionContenido: 5 }),
    );
    expect(invalidada.find((r) => r.clave === "firma")?.texto).toContain("invalidada");
  });

  it("permite enviar cuando todo está", () => {
    const d = detalle({ firmaNombre: "Luis Reyna", firmaVersion: 2, versionContenido: 2 });
    expect(puedeEnviarARevision(d).permitido).toBe(true);
  });

  it("el motivo del bloqueo enumera lo que falta", () => {
    const v = puedeEnviarARevision(detalle({ kilometraje: null }));
    expect(v.permitido).toBe(false);
    expect(v.mensaje).toContain("kilometraje");
    expect(v.mensaje).toContain("firma");
  });
});

describe("acciones disponibles", () => {
  const firmada = { firmaNombre: "Luis Reyna", firmaVersion: 2, versionContenido: 2 };

  it("con la orden abierta se puede capturar", () => {
    const acciones = accionesDisponibles(detalle(), TECNICO);
    expect(acciones.find((a) => a.accion === "capturar")?.habilitada).toBe(true);
  });

  it("en revisión ya no se captura, y se dice por qué", () => {
    const acciones = accionesDisponibles(detalle({ estado: "en_revision" }), TECNICO);
    const capturar = acciones.find((a) => a.accion === "capturar");
    expect(capturar?.habilitada).toBe(false);
    expect(capturar?.motivo).toBeTruthy();
  });

  it("no se firma sin capturar nada", () => {
    // Firmar con cero posiciones no ampara nada.
    const acciones = accionesDisponibles(detalle({}, { mediciones: [] }), TECNICO);
    const firmar = acciones.find((a) => a.accion === "firmar");
    expect(firmar?.habilitada).toBe(false);
    expect(firmar?.motivo).toContain("al menos una posición");
  });

  it("avisa cuando hay que volver a firmar", () => {
    const acciones = accionesDisponibles(
      detalle({ firmaNombre: "Luis", firmaVersion: 1, versionContenido: 5 }),
      TECNICO,
    );
    expect(acciones.find((a) => a.accion === "firmar")?.motivo).toContain("Vuelve a firmar");
  });

  it("enviar se habilita solo con todos los requisitos", () => {
    const sinFirma = accionesDisponibles(detalle(), TECNICO);
    expect(sinFirma.find((a) => a.accion === "enviar")?.habilitada).toBe(false);

    const completa = accionesDisponibles(detalle(firmada), TECNICO);
    expect(completa.find((a) => a.accion === "enviar")?.habilitada).toBe(true);
  });

  it("toda acción bloqueada explica el motivo", () => {
    // Es la regla que evita la llamada al coordinador.
    const acciones = accionesDisponibles(
      detalle({ estado: "cerrada", kilometraje: null }, { mediciones: [] }),
      TECNICO,
    );
    for (const a of acciones.filter((x) => !x.habilitada)) {
      expect(a.motivo, `${a.accion} sin motivo`).toBeTruthy();
    }
  });

  it("el informe se puede ver aunque la orden esté cerrada", () => {
    const acciones = accionesDisponibles(detalle({ estado: "cerrada" }), TECNICO);
    expect(acciones.find((a) => a.accion === "ver_informe")?.habilitada).toBe(true);
  });

  it("sin mediciones no hay informe que ver", () => {
    const acciones = accionesDisponibles(detalle({}, { mediciones: [] }), TECNICO);
    expect(acciones.find((a) => a.accion === "ver_informe")?.habilitada).toBe(false);
  });
});

describe("estado de sincronización", () => {
  it("al día no muestra aviso", () => {
    expect(estadoSincronizacion(detalle()).alDia).toBe(true);
  });

  it("dice qué falta por enviar, no solo que hay algo", () => {
    // El técnico decide si vale la pena buscar señal ahora o al terminar.
    const r = estadoSincronizacion(detalle({ sincronizada: false }, { fotosSinSubir: 3 }));
    expect(r.alDia).toBe(false);
    expect(r.mensaje).toContain("cambios");
    expect(r.mensaje).toContain("3 fotos");
  });

  it("solo fotos pendientes", () => {
    const r = estadoSincronizacion(detalle({}, { fotosSinSubir: 1 }));
    expect(r.mensaje).toBe("Sin enviar: 1 foto");
  });

  it("solo cambios pendientes", () => {
    const r = estadoSincronizacion(detalle({ sincronizada: false }));
    expect(r.mensaje).toBe("Sin enviar: cambios");
  });
});

describe("posiciones del diagrama", () => {
  it("devuelve todas, capturadas o no", () => {
    // El diagrama tiene que mostrar los huecos: es su razón de existir.
    const p = resumirPosiciones(4, [medicion(1), medicion(3)]);
    expect(p).toHaveLength(4);
    expect(p.map((x) => x.capturada)).toEqual([true, false, true, false]);
  });

  it("marca las que no se pudieron identificar", () => {
    const p = resumirPosiciones(2, [medicion(1, { noIdentificada: true })]);
    expect(p[0]?.noIdentificada).toBe(true);
  });

  it("trae la profundidad para poder pintarla en el diagrama", () => {
    const p = resumirPosiciones(2, [medicion(1, { profundidad: 4.5 })]);
    expect(p[0]?.profundidad).toBe(4.5);
    expect(p[1]?.profundidad).toBeNull();
  });

  it("lista los números que faltan", () => {
    const p = resumirPosiciones(6, [medicion(1), medicion(2), medicion(5)]);
    expect(posicionesFaltantes(p)).toEqual([3, 4, 6]);
  });

  it("sin configuración no inventa posiciones", () => {
    expect(resumirPosiciones(0, [])).toEqual([]);
  });
});
