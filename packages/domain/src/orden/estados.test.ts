import { describe, it, expect } from "vitest";
import {
  evaluarTransicion,
  transicionesPosibles,
  esEstadoFinal,
  estaAbierta,
  type ContextoTransicion,
} from "./estados";

const base: ContextoTransicion = {
  rol: "tecnico",
  esTecnicoAsignado: true,
  firmaVigente: true,
};

const tecnico = (extra: Partial<ContextoTransicion> = {}): ContextoTransicion => ({
  ...base,
  ...extra,
});
const coordinador = (extra: Partial<ContextoTransicion> = {}): ContextoTransicion => ({
  ...base,
  rol: "coordinador",
  esTecnicoAsignado: false,
  ...extra,
});
const cliente = (extra: Partial<ContextoTransicion> = {}): ContextoTransicion => ({
  ...base,
  rol: "cliente",
  esTecnicoAsignado: false,
  ...extra,
});

describe("flujo normal de la orden", () => {
  it("el coordinador programa una orden en borrador", () => {
    expect(evaluarTransicion("borrador", "programada", coordinador()).permitido).toBe(true);
  });

  it("el técnico asignado la inicia", () => {
    expect(evaluarTransicion("programada", "en_proceso", tecnico()).permitido).toBe(true);
  });

  it("el técnico la envía a revisión con firma vigente", () => {
    expect(evaluarTransicion("en_proceso", "en_revision", tecnico()).permitido).toBe(true);
  });

  it("el coordinador la aprueba y pasa al cliente", () => {
    expect(evaluarTransicion("en_revision", "pendiente_cliente", coordinador()).permitido).toBe(
      true,
    );
  });

  it("el cliente la aprueba y queda cerrada", () => {
    expect(evaluarTransicion("pendiente_cliente", "cerrada", cliente()).permitido).toBe(true);
  });
});

describe("la firma sostiene el cierre", () => {
  it("no se envía a revisión sin firma vigente", () => {
    const r = evaluarTransicion("en_proceso", "en_revision", tecnico({ firmaVigente: false }));
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe("SIN_FIRMA");
  });

  it("no se aprueba si la firma quedó invalidada", () => {
    // Caso real: se firmó, el coordinador devolvió, el técnico corrigió.
    // Lo firmado ya no corresponde con lo que quedó.
    const r = evaluarTransicion(
      "en_revision",
      "pendiente_cliente",
      coordinador({ firmaVigente: false }),
    );
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe("FIRMA_INVALIDA");
  });
});

describe("el coordinador devuelve, no corrige", () => {
  it("puede devolver con motivo", () => {
    const r = evaluarTransicion("en_revision", "en_proceso", coordinador({ motivo: "Falta el parche" }));
    expect(r.permitido).toBe(true);
  });

  it("no puede devolver sin motivo", () => {
    const r = evaluarTransicion("en_revision", "en_proceso", coordinador());
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe("SIN_MOTIVO");
  });

  it("un motivo en blanco no cuenta como motivo", () => {
    const r = evaluarTransicion("en_revision", "en_proceso", coordinador({ motivo: "   " }));
    expect(r.codigo).toBe("SIN_MOTIVO");
  });

  it("el técnico no puede devolverse la orden a sí mismo", () => {
    const r = evaluarTransicion("en_revision", "en_proceso", tecnico({ motivo: "me faltó algo" }));
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe("SOLO_GESTOR");
  });
});

describe("permisos por rol", () => {
  it("un técnico no asignado no puede iniciar la orden", () => {
    const r = evaluarTransicion("programada", "en_proceso", tecnico({ esTecnicoAsignado: false, rol: "tecnico" }));
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe("SOLO_ASIGNADO");
  });

  it("el técnico no puede aprobar su propia orden hacia el cliente", () => {
    const r = evaluarTransicion("en_revision", "pendiente_cliente", tecnico());
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe("SOLO_GESTOR");
  });

  it("el administrador puede lo mismo que el coordinador", () => {
    const admin = coordinador({ rol: "administrador" });
    expect(evaluarTransicion("en_revision", "pendiente_cliente", admin).permitido).toBe(true);
  });
});

describe("aprobación del cliente", () => {
  it("el cliente objeta con motivo y la orden vuelve al técnico", () => {
    const r = evaluarTransicion(
      "pendiente_cliente",
      "en_proceso",
      cliente({ motivo: "La posición 7 no se tocó" }),
    );
    expect(r.permitido).toBe(true);
  });

  it("no puede objetar sin decir qué está mal", () => {
    expect(evaluarTransicion("pendiente_cliente", "en_proceso", cliente()).codigo).toBe("SIN_MOTIVO");
  });

  it("el coordinador puede cerrar sin respuesta, pero justificando", () => {
    const conJustificacion = coordinador({ motivo: "Cliente no responde hace 8 días" });
    expect(evaluarTransicion("pendiente_cliente", "cerrada", conJustificacion).permitido).toBe(true);
    expect(evaluarTransicion("pendiente_cliente", "cerrada", coordinador()).codigo).toBe("SIN_MOTIVO");
  });

  it("el vencimiento del plazo cierra sin intervención de nadie", () => {
    const r = evaluarTransicion("pendiente_cliente", "cerrada", {
      ...coordinador(),
      porVencimiento: true,
    });
    expect(r.permitido).toBe(true);
  });
});

describe("anulación", () => {
  it("el coordinador anula con motivo desde un estado abierto", () => {
    expect(
      evaluarTransicion("en_proceso", "anulada", coordinador({ motivo: "Cliente canceló" })).permitido,
    ).toBe(true);
  });

  it("no se anula sin motivo", () => {
    expect(evaluarTransicion("en_proceso", "anulada", coordinador()).codigo).toBe("SIN_MOTIVO");
  });

  it("no se anula una orden ya cerrada", () => {
    const r = evaluarTransicion("cerrada", "anulada", coordinador({ motivo: "error" }));
    expect(r.codigo).toBe("ESTADO_FINAL");
  });

  it("el técnico no puede anular", () => {
    expect(evaluarTransicion("en_proceso", "anulada", tecnico({ motivo: "x" })).codigo).toBe(
      "SOLO_GESTOR",
    );
  });
});

describe("transiciones inválidas", () => {
  it("no se salta de programada directo a cerrada", () => {
    const r = evaluarTransicion("programada", "cerrada", coordinador({ motivo: "x" }));
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe("TRANSICION_INVALIDA");
  });

  it("una orden cerrada no se reabre", () => {
    expect(evaluarTransicion("cerrada", "en_proceso", coordinador()).codigo).toBe(
      "TRANSICION_INVALIDA",
    );
  });

  it("quedarse en el mismo estado no es una transición", () => {
    expect(evaluarTransicion("en_proceso", "en_proceso", tecnico()).codigo).toBe("SIN_CAMBIO");
  });
});

describe("consultas de estado", () => {
  it("lista los destinos posibles desde en_revision", () => {
    const d = transicionesPosibles("en_revision");
    expect(d).toContain("en_proceso");
    expect(d).toContain("pendiente_cliente");
    expect(d).toContain("anulada");
  });

  it("desde un estado final no hay salidas", () => {
    expect(transicionesPosibles("cerrada")).toEqual([]);
    expect(transicionesPosibles("anulada")).toEqual([]);
  });

  it("distingue estados finales de abiertos", () => {
    expect(esEstadoFinal("cerrada")).toBe(true);
    expect(esEstadoFinal("anulada")).toBe(true);
    expect(esEstadoFinal("en_proceso")).toBe(false);
    expect(estaAbierta("pendiente_cliente")).toBe(true);
    expect(estaAbierta("cerrada")).toBe(false);
  });
});

describe("ramas de permiso menos frecuentes", () => {
  it("un técnico ajeno no puede arrancar una orden en borrador", () => {
    const r = evaluarTransicion(
      "borrador",
      "en_proceso",
      tecnico({ esTecnicoAsignado: false }),
    );
    expect(r.codigo).toBe("SOLO_ASIGNADO");
  });

  it("un técnico ajeno no puede enviar a revisión", () => {
    const r = evaluarTransicion(
      "en_proceso",
      "en_revision",
      tecnico({ esTecnicoAsignado: false }),
    );
    expect(r.codigo).toBe("SOLO_ASIGNADO");
  });

  it("el técnico no puede cerrar la orden que espera al cliente", () => {
    const r = evaluarTransicion("pendiente_cliente", "cerrada", tecnico());
    expect(r.codigo).toBe("SIN_PERMISO");
  });

  it("el superadmin no interviene en la operación", () => {
    const superadmin = coordinador({ rol: "superadmin" });
    expect(evaluarTransicion("en_revision", "pendiente_cliente", superadmin).codigo).toBe(
      "SOLO_GESTOR",
    );
  });
});
