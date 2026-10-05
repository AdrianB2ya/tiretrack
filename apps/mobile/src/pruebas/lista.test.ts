import { describe, it, expect } from "vitest";
import {
  grupoDe,
  construirSecciones,
  contarPendientes,
  progresoDe,
  identificadorVisible,
  puedeCapturar,
  filtrar,
  type OrdenParaLista,
} from "../ordenes/lista";
import type { OrdenLocal } from "../datos/repositorio";

/**
 * Lógica del listado.
 *
 * El orden en que aparecen las órdenes no es un detalle visual: decide qué
 * camión atiende primero alguien que abre la app con veinte pendientes.
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
  estado: "programada",
  motivoDevolucion: null,
  notaCoordinador: null,
  fecha: "2026-09-17",
  configuracionEjeId: "cfg-1",
  kilometraje: null,
  hallazgos: null,
  accion: null,
  firmaNombre: null,
  firmaCedula: null,
  firmaVersion: null,
  firmaTrazo: null,
  firmaCargo: null,
  firmaFechaHora: null,
  version: 0,
  versionContenido: 0,
  sincronizada: true,
};

function item(orden: Partial<OrdenLocal>, extra: Partial<OrdenParaLista> = {}): OrdenParaLista {
  return {
    orden: { ...ordenBase, ...orden },
    vehiculoCodigo: "CA-12",
    clienteNombre: "Transportes Reyna",
    posicionesCapturadas: 0,
    posicionesTotales: 22,
    tieneCambiosSinEnviar: false,
    ...extra,
  };
}

describe("agrupación", () => {
  it("una orden devuelta no se confunde con una a medias", () => {
    // La primera tiene a alguien esperando la corrección; la segunda la dejó
    // el propio técnico.
    expect(grupoDe({ ...ordenBase, estado: "en_proceso", motivoDevolucion: "Falta el parche" }))
      .toBe("devueltas");
    expect(grupoDe({ ...ordenBase, estado: "en_proceso" })).toBe("en_curso");
  });

  it("clasifica los demás estados", () => {
    expect(grupoDe({ ...ordenBase, estado: "programada" })).toBe("por_hacer");
    expect(grupoDe({ ...ordenBase, estado: "borrador" })).toBe("en_curso");
    expect(grupoDe({ ...ordenBase, estado: "en_revision" })).toBe("esperando");
    expect(grupoDe({ ...ordenBase, estado: "pendiente_cliente" })).toBe("esperando");
    expect(grupoDe({ ...ordenBase, estado: "cerrada" })).toBe("terminadas");
    expect(grupoDe({ ...ordenBase, estado: "anulada" })).toBe("terminadas");
  });
});

describe("orden de las secciones", () => {
  it("las devueltas van arriba de todo", () => {
    // El técnico ya dio ese trabajo por terminado: si no la ve arriba, no la
    // ve.
    const secciones = construirSecciones([
      item({ id: "a", estado: "en_proceso" }),
      item({ id: "b", estado: "programada" }),
      item({ id: "c", estado: "en_proceso", motivoDevolucion: "Corregir posición 6" }),
    ]);
    expect(secciones[0]?.grupo).toBe("devueltas");
  });

  it("mantiene el orden de prioridad completo", () => {
    const secciones = construirSecciones([
      item({ id: "a", estado: "cerrada" }),
      item({ id: "b", estado: "en_revision" }),
      item({ id: "c", estado: "programada" }),
      item({ id: "d", estado: "en_proceso" }),
      item({ id: "e", estado: "en_proceso", motivoDevolucion: "x" }),
    ]);
    expect(secciones.map((s) => s.grupo)).toEqual([
      "devueltas",
      "en_curso",
      "por_hacer",
      "esperando",
      "terminadas",
    ]);
  });

  it("no muestra secciones vacías", () => {
    const secciones = construirSecciones([item({ estado: "programada" })]);
    expect(secciones).toHaveLength(1);
    expect(secciones[0]?.titulo).toBe("Por hacer");
  });

  it("dentro del grupo, lo más antiguo primero", () => {
    // Una orden programada hace una semana lleva más tiempo esperando que la
    // de hoy. Es lo contrario a una bandeja de correo, y es deliberado.
    const secciones = construirSecciones([
      item({ id: "hoy", fecha: "2026-09-17" }),
      item({ id: "vieja", fecha: "2026-09-10" }),
      item({ id: "media", fecha: "2026-09-14" }),
    ]);
    expect(secciones[0]?.ordenes.map((o) => o.orden.id)).toEqual(["vieja", "media", "hoy"]);
  });

  it("las terminadas van al revés: ahí interesa lo reciente", () => {
    const secciones = construirSecciones([
      item({ id: "vieja", estado: "cerrada", fecha: "2026-09-10" }),
      item({ id: "reciente", estado: "cerrada", fecha: "2026-09-17" }),
    ]);
    expect(secciones[0]?.ordenes.map((o) => o.orden.id)).toEqual(["reciente", "vieja"]);
  });

  it("una lista vacía no produce secciones", () => {
    expect(construirSecciones([])).toEqual([]);
  });
});

describe("conteo de pendientes", () => {
  it("cuenta solo lo que el técnico todavía tiene que tocar", () => {
    const n = contarPendientes([
      item({ id: "a", estado: "programada" }),
      item({ id: "b", estado: "en_proceso" }),
      item({ id: "c", estado: "en_proceso", motivoDevolucion: "x" }),
      item({ id: "d", estado: "en_revision" }),
      item({ id: "e", estado: "cerrada" }),
    ]);
    expect(n).toBe(3);
  });

  it("lo que espera aprobación no cuenta como pendiente suyo", () => {
    // Ya hizo su parte; la pelota está en el coordinador.
    expect(contarPendientes([item({ estado: "pendiente_cliente" })])).toBe(0);
  });
});

describe("progreso de captura", () => {
  it("calcula el porcentaje", () => {
    const p = progresoDe(item({}, { posicionesCapturadas: 11, posicionesTotales: 22 }));
    expect(p.porcentaje).toBe(50);
    expect(p.completa).toBe(false);
  });

  it("marca completa al llegar al total", () => {
    const p = progresoDe(item({}, { posicionesCapturadas: 22, posicionesTotales: 22 }));
    expect(p.completa).toBe(true);
    expect(p.porcentaje).toBe(100);
  });

  it("no divide por cero si falta la configuración", () => {
    const p = progresoDe(item({}, { posicionesCapturadas: 0, posicionesTotales: 0 }));
    expect(p.porcentaje).toBe(0);
    expect(p.completa).toBe(false);
  });
});

describe("identificador visible", () => {
  it("muestra el folio cuando lo hay", () => {
    const r = identificadorVisible(ordenBase);
    expect(r.texto).toBe("OS-FUN-000001");
    expect(r.esProvisional).toBe(false);
  });

  it("muestra el código de referencia si aún no hay folio", () => {
    // No se parece a un folio a propósito: nadie debe confundirlo con el
    // consecutivo definitivo.
    const r = identificadorVisible({
      ...ordenBase,
      folio: null,
      codigoReferencia: "FUN-K7M2",
    });
    expect(r.texto).toBe("FUN-K7M2");
    expect(r.esProvisional).toBe(true);
  });

  it("sin ninguno de los dos lo dice claramente", () => {
    const r = identificadorVisible({ ...ordenBase, folio: null, codigoReferencia: null });
    expect(r.texto).toBe("Sin sincronizar");
    expect(r.esProvisional).toBe(true);
  });
});

describe("permiso de captura", () => {
  it("se puede capturar mientras la orden está abierta", () => {
    for (const estado of ["borrador", "programada", "en_proceso"]) {
      expect(puedeCapturar({ ...ordenBase, estado })).toBe(true);
    }
  });

  it("no se captura después de enviarla a revisión", () => {
    for (const estado of ["en_revision", "pendiente_cliente", "cerrada", "anulada"]) {
      expect(puedeCapturar({ ...ordenBase, estado })).toBe(false);
    }
  });
});

describe("búsqueda", () => {
  const lista = [
    item({ id: "a", folio: "OS-FUN-000001" }, { vehiculoCodigo: "CA-12" }),
    item({ id: "b", folio: "OS-FUN-000002" }, {
      vehiculoCodigo: "CV-07",
      clienteNombre: "Almacenadora del Norte",
    }),
    item({ id: "c", folio: null, codigoReferencia: "FUN-K7M2" }, { vehiculoCodigo: "MK-03" }),
  ];

  it("busca por folio", () => {
    expect(filtrar(lista, { texto: "000002" }).map((o) => o.orden.id)).toEqual(["b"]);
  });

  it("busca por código del vehículo", () => {
    expect(filtrar(lista, { texto: "CA-12" }).map((o) => o.orden.id)).toEqual(["a"]);
  });

  it("busca por cliente", () => {
    // Son las tres formas en que el técnico identifica una orden cuando le
    // preguntan por teléfono.
    expect(filtrar(lista, { texto: "almacenadora" }).map((o) => o.orden.id)).toEqual(["b"]);
  });

  it("encuentra también por código de referencia", () => {
    expect(filtrar(lista, { texto: "K7M2" }).map((o) => o.orden.id)).toEqual(["c"]);
  });

  it("ignora mayúsculas y espacios sobrantes", () => {
    expect(filtrar(lista, { texto: "  ca-12  " })).toHaveLength(1);
  });

  it("sin texto devuelve todo", () => {
    expect(filtrar(lista, {})).toHaveLength(3);
  });

  it("filtra solo pendientes", () => {
    const conCerrada = [...lista, item({ id: "d", estado: "cerrada" })];
    const r = filtrar(conCerrada, { soloPendientes: true });
    expect(r.map((o) => o.orden.id)).not.toContain("d");
  });

  it("combina búsqueda y filtro", () => {
    const conCerrada = [
      ...lista,
      item({ id: "d", estado: "cerrada" }, { vehiculoCodigo: "CA-12" }),
    ];
    const r = filtrar(conCerrada, { texto: "CA-12", soloPendientes: true });
    expect(r.map((o) => o.orden.id)).toEqual(["a"]);
  });
});
