import { describe, it, expect } from "vitest";
import {
  debeCerrarsePorVencimiento,
  debeGenerarOrden,
  avanzarProxima,
  evaluarAlertas,
  deduplicarAlertas,
  ordenarPorSeveridad,
  yaCaduco,
  MESES_AVISO_DOT,
  type Programacion,
  type LlantaParaRevisar,
} from "./reglas";

const HOY = new Date("2026-09-14T10:00:00.000Z");
const HOY_ISO = "2026-09-14";

describe("cierre por vencimiento del plazo", () => {
  const enEspera = { id: "o-1", estado: "pendiente_cliente", limiteCliente: "2026-09-11" };

  it("cierra cuando el plazo venció", () => {
    expect(debeCerrarsePorVencimiento(enEspera, HOY_ISO).permitido).toBe(true);
  });

  it("no cierra antes del plazo", () => {
    const r = debeCerrarsePorVencimiento({ ...enEspera, limiteCliente: "2026-09-20" }, HOY_ISO);
    expect(r.codigo).toBe("PLAZO_VIGENTE");
  });

  it("cierra justo el día del límite", () => {
    const r = debeCerrarsePorVencimiento({ ...enEspera, limiteCliente: HOY_ISO }, HOY_ISO);
    expect(r.permitido).toBe(true);
  });

  it("no toca órdenes en otro estado", () => {
    for (const estado of ["en_proceso", "cerrada", "en_revision"]) {
      expect(debeCerrarsePorVencimiento({ ...enEspera, estado }, HOY_ISO).codigo).toBe(
        "ESTADO_INVALIDO",
      );
    }
  });

  it("no cierra una orden sin plazo definido", () => {
    const r = debeCerrarsePorVencimiento({ ...enEspera, limiteCliente: null }, HOY_ISO);
    expect(r.codigo).toBe("SIN_PLAZO");
  });
});

describe("generación de órdenes recurrentes", () => {
  const prog: Programacion = {
    id: "p-1",
    vehiculoId: "veh-1",
    frecuencia: "mensual",
    cada: 1,
    proxima: "2026-09-14",
    activa: true,
  };
  const vehiculoSano = { activo: true, tieneOrdenAbierta: false };

  it("genera cuando toca", () => {
    expect(debeGenerarOrden(prog, vehiculoSano, HOY_ISO).permitido).toBe(true);
  });

  it("no genera antes de tiempo", () => {
    const r = debeGenerarOrden({ ...prog, proxima: "2026-10-01" }, vehiculoSano, HOY_ISO);
    expect(r.codigo).toBe("AUN_NO");
  });

  it("no genera si la programación está deshabilitada", () => {
    expect(debeGenerarOrden({ ...prog, activa: false }, vehiculoSano, HOY_ISO).codigo).toBe(
      "INACTIVA",
    );
  });

  it("no genera para un vehículo dado de baja", () => {
    const r = debeGenerarOrden(prog, { activo: false, tieneOrdenAbierta: false }, HOY_ISO);
    expect(r.codigo).toBe("VEHICULO_INACTIVO");
  });

  it("se salta la vuelta si el vehículo ya tiene una orden abierta", () => {
    // Sin esto, en tres meses hay cuatro órdenes abiertas del mismo camión y
    // la bandeja del coordinador es inservible.
    const r = debeGenerarOrden(prog, { activo: true, tieneOrdenAbierta: true }, HOY_ISO);
    expect(r.codigo).toBe("ORDEN_ABIERTA");
  });
});

describe("avance de la próxima ejecución", () => {
  const prog: Programacion = {
    id: "p-1",
    vehiculoId: "veh-1",
    frecuencia: "mensual",
    cada: 1,
    proxima: "2026-09-14",
    activa: true,
  };

  it("avanza un mes", () => {
    expect(avanzarProxima(prog, HOY_ISO).startsWith("2026-10")).toBe(true);
  });

  it("se calcula desde la fecha programada, no desde hoy", () => {
    // Si el trabajo corrió tarde, la recurrencia no debe correrse cada vez.
    const tarde = avanzarProxima(prog, "2026-09-16");
    expect(tarde.startsWith("2026-10-1")).toBe(true);
  });

  it("no acumula ciclos perdidos", () => {
    // El servidor estuvo caído seis meses: nadie quiere seis órdenes de golpe.
    const vieja = { ...prog, proxima: "2026-03-10" };
    const siguiente = avanzarProxima(vieja, HOY_ISO);
    expect(siguiente > HOY_ISO).toBe(true);
    expect(siguiente.startsWith("2026-10")).toBe(true);
  });

  it("nunca deja la próxima en fin de semana", () => {
    // Nadie atiende el sábado.
    for (const frecuencia of ["semanal", "quincenal", "mensual", "dias_calendario"] as const) {
      const r = avanzarProxima({ ...prog, frecuencia }, HOY_ISO);
      const dia = new Date(`${r}T00:00:00.000Z`).getUTCDay();
      expect(dia).not.toBe(0);
      expect(dia).not.toBe(6);
    }
  });

  it("respeta la frecuencia por días hábiles", () => {
    const r = avanzarProxima({ ...prog, frecuencia: "dias_habiles", cada: 5 }, "2026-09-14");
    expect(r).toBe("2026-09-21");
  });
});

describe("alertas de llanta", () => {
  const base: LlantaParaRevisar = {
    ordenId: "o-1",
    vehiculoId: "veh-1",
    posicion: 7,
    serial: "MX10023458",
    dot: "3624",
    profundidad: 9,
    profundidadMinima: 3,
  };

  it("una llanta sana no genera alertas", () => {
    expect(evaluarAlertas(base, HOY)).toHaveLength(0);
  });

  it("alerta crítica por DOT vencido", () => {
    const a = evaluarAlertas({ ...base, dot: "0819" }, HOY);
    expect(a).toHaveLength(1);
    expect(a[0]?.tipo).toBe("dot_vencido");
    expect(a[0]?.severidad).toBe("critica");
    expect(a[0]?.mensaje).toContain("Semana 8 de 2019");
  });

  it("avisa con antelación antes de que venza", () => {
    // Seis meses dan tiempo a comprar y programar el cambio.
    const a = evaluarAlertas({ ...base, dot: "4520" }, HOY);
    expect(a[0]?.tipo).toBe("dot_por_vencer");
    expect(a[0]?.severidad).toBe("media");
    expect(MESES_AVISO_DOT).toBe(6);
  });

  it("alerta crítica por profundidad bajo el mínimo del eje", () => {
    const a = evaluarAlertas({ ...base, profundidad: 2.5 }, HOY);
    expect(a[0]?.tipo).toBe("profundidad_baja");
    expect(a[0]?.severidad).toBe("critica");
    expect(a[0]?.mensaje).toContain("2.5");
  });

  it("una llanta puede disparar varias alertas a la vez", () => {
    // Estar vencida y estar gastada son dos motivos distintos para sacarla.
    const a = evaluarAlertas({ ...base, dot: "0819", profundidad: 2 }, HOY);
    expect(a).toHaveLength(2);
    expect(a.map((x) => x.tipo).sort()).toEqual(["dot_vencido", "profundidad_baja"]);
  });

  it("identifica por serial cuando lo hay", () => {
    expect(evaluarAlertas({ ...base, dot: "0819" }, HOY)[0]?.mensaje).toContain("MX10023458");
  });

  it("identifica por posición cuando no se pudo leer el serial", () => {
    const a = evaluarAlertas({ ...base, serial: null, dot: "0819" }, HOY);
    expect(a[0]?.mensaje).toContain("posición 7");
  });

  it("sin DOT no inventa una alerta de vencimiento", () => {
    // Un dato faltante no es un dato malo.
    expect(evaluarAlertas({ ...base, dot: null }, HOY)).toHaveLength(0);
  });

  it("sin umbral configurado no alerta por profundidad", () => {
    const a = evaluarAlertas({ ...base, profundidad: 1, profundidadMinima: null }, HOY);
    expect(a).toHaveLength(0);
  });
});

describe("deduplicación de alertas", () => {
  const alerta = {
    vehiculoId: "veh-1",
    posicion: 7,
    serial: "MX1",
    tipo: "dot_vencido" as const,
    severidad: "critica" as const,
    mensaje: "x",
  };

  it("conserva una por vehículo, posición y tipo", () => {
    // La misma llanta aparece en cada orden donde se midió: alertar por cada
    // medición llenaría la bandeja de repetidos.
    const r = deduplicarAlertas([alerta, alerta, alerta]);
    expect(r).toHaveLength(1);
  });

  it("no mezcla posiciones distintas", () => {
    const r = deduplicarAlertas([alerta, { ...alerta, posicion: 8 }]);
    expect(r).toHaveLength(2);
  });

  it("no mezcla tipos distintos de la misma llanta", () => {
    const r = deduplicarAlertas([alerta, { ...alerta, tipo: "profundidad_baja" }]);
    expect(r).toHaveLength(2);
  });

  it("no mezcla vehículos distintos", () => {
    const r = deduplicarAlertas([alerta, { ...alerta, vehiculoId: "veh-2" }]);
    expect(r).toHaveLength(2);
  });

  it("ordena lo crítico primero", () => {
    const r = ordenarPorSeveridad([
      { ...alerta, severidad: "media" },
      { ...alerta, severidad: "critica" },
    ]);
    expect(r[0]?.severidad).toBe("critica");
  });
});

describe("caducidad", () => {
  it("detecta lo ya vencido", () => {
    expect(yaCaduco({ expiraEn: new Date("2026-09-13") }, HOY)).toBe(true);
    expect(yaCaduco({ expiraEn: new Date("2026-09-15") }, HOY)).toBe(false);
  });
});
