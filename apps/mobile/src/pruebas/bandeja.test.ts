import { describe, it, expect } from "vitest";
import {
  senalesDe,
  ordenarBandeja,
  contarPorRevisar,
  accionesDe,
  validarDevolucion,
  motivosSugeridos,
  LARGO_MINIMO_MOTIVO,
  type ContextoCoordinador,
  type OrdenEnBandeja,
} from "../coordinador/bandeja";
import { construirDiagrama } from "../ordenes/diagrama";
import type { MedicionLocal, OrdenLocal } from "../datos/repositorio";
import {
  CONFIGURACION_CUATRO,
  unaMedicion,
  unaOrdenFirmada,
} from "./fabrica";

/**
 * Bandeja del coordinador.
 *
 * Su trabajo es decidir rápido sobre órdenes que otro ejecutó. Lo que se
 * prueba es que lo dudoso se vea **antes de abrir**: con veinte órdenes, lo
 * que no está en la tarjeta no se revisa.
 */

const configuracion = CONFIGURACION_CUATRO;

const med = unaMedicion;

const ordenBase: OrdenLocal = unaOrdenFirmada({ estado: "en_revision", firmaVersion: 4, versionContenido: 4 });

const COORD: ContextoCoordinador = { usuarioId: "u-coo", rol: "coordinador" };

function enBandeja(
  orden: Partial<OrdenLocal> = {},
  mediciones: MedicionLocal[] = [1, 2, 3, 4].map((n) => med(n)),
  extra: Partial<OrdenEnBandeja> = {},
): OrdenEnBandeja {
  return {
    orden: { ...ordenBase, ...orden },
    vehiculoCodigo: "CA-12",
    clienteNombre: "Transportes Reyna",
    tecnicoNombre: "Carlos Méndez",
    diagrama: construirDiagrama(configuracion, mediciones),
    diasEsperando: 0,
    ...extra,
  };
}

describe("señales visibles sin abrir la orden", () => {
  it("una orden correcta no genera señales", () => {
    expect(senalesDe(enBandeja(), COORD)).toEqual([]);
  });

  it("una firma que no ampara el contenido es crítica", () => {
    // El cliente firmó otra cosa: la orden cambió después.
    const s = senalesDe(enBandeja({ versionContenido: 8 }), COORD);
    const firma = s.find((x) => x.clave === "firma_invalidada");
    expect(firma?.clase).toBe("critica");
  });

  it("sin firma también es crítica", () => {
    const s = senalesDe(enBandeja({ firmaNombre: null, firmaVersion: null }), COORD);
    expect(s.find((x) => x.clave === "sin_firma")?.clase).toBe("critica");
  });

  it("marca la autoaprobación sin bloquearla", () => {
    // En una sede de dos personas puede ser inevitable, pero queda a la
    // vista y en la auditoría.
    const s = senalesDe(enBandeja({ tecnicoId: "u-coo" }), COORD);
    const auto = s.find((x) => x.clave === "autoaprobacion");
    expect(auto?.clase).toBe("atencion");
    expect(auto?.texto).toContain("Tú ejecutaste");
  });

  it("no marca autoaprobación si la ejecutó otro", () => {
    expect(senalesDe(enBandeja(), COORD).some((s) => s.clave === "autoaprobacion")).toBe(false);
  });

  it("señala las órdenes incompletas con la cuenta", () => {
    const s = senalesDe(enBandeja({}, [med(1), med(2)]), COORD);
    expect(s.find((x) => x.clave === "incompleta")?.texto).toBe("Faltan 2 de 4 posiciones");
  });

  it("señala las llantas bajo el mínimo", () => {
    const s = senalesDe(enBandeja({}, [med(1, { profundidad: 1 }), med(2), med(3), med(4)]), COORD);
    expect(s.some((x) => x.clave === "alertas")).toBe(true);
  });

  it("señala la falta de hallazgos como informativa", () => {
    // No impide aprobar, pero conviene verlo.
    const s = senalesDe(enBandeja({ hallazgos: null }), COORD);
    expect(s.find((x) => x.clave === "sin_hallazgos")?.clase).toBe("informativa");
  });

  it("señala las que llevan días esperando", () => {
    const s = senalesDe(enBandeja({}, undefined, { diasEsperando: 3 }), COORD);
    expect(s.find((x) => x.clave === "demorada")?.texto).toContain("3 días");
  });

  it("un día esperando todavía no alarma", () => {
    const s = senalesDe(enBandeja({}, undefined, { diasEsperando: 1 }), COORD);
    expect(s.some((x) => x.clave === "demorada")).toBe(false);
  });
});

describe("orden de la bandeja", () => {
  it("las críticas van primero", () => {
    // Devolverlas tarde obliga al técnico a volver al vehículo cuando ya se
    // fue.
    const items = [
      enBandeja({ id: "normal" }, undefined, { diasEsperando: 5 }),
      enBandeja({ id: "critica", firmaNombre: null }, undefined, { diasEsperando: 0 }),
    ];
    expect(ordenarBandeja(items, COORD)[0]?.orden.id).toBe("critica");
  });

  it("entre iguales, lo que lleva más tiempo esperando", () => {
    // Cada día que pasa es un día que el cliente no recibe su documento.
    const items = [
      enBandeja({ id: "nueva" }, undefined, { diasEsperando: 1 }),
      enBandeja({ id: "vieja" }, undefined, { diasEsperando: 6 }),
      enBandeja({ id: "media" }, undefined, { diasEsperando: 3 }),
    ];
    expect(ordenarBandeja(items, COORD).map((i) => i.orden.id)).toEqual([
      "vieja",
      "media",
      "nueva",
    ]);
  });

  it("cuenta solo las que están en revisión", () => {
    const items = [
      enBandeja({ id: "a", estado: "en_revision" }),
      enBandeja({ id: "b", estado: "pendiente_cliente" }),
      enBandeja({ id: "c", estado: "en_revision" }),
    ];
    expect(contarPorRevisar(items)).toBe(2);
  });
});

describe("acciones del coordinador", () => {
  it("puede aprobar una orden en revisión", () => {
    const a = accionesDe(enBandeja(), COORD);
    expect(a.find((x) => x.decision === "aprobar")?.habilitada).toBe(true);
  });

  it("no aprueba una orden con la firma invalidada", () => {
    const a = accionesDe(enBandeja({ versionContenido: 8 }), COORD);
    const aprobar = a.find((x) => x.decision === "aprobar");
    expect(aprobar?.habilitada).toBe(false);
    expect(aprobar?.motivo).toBeTruthy();
  });

  it("devolver exige motivo", () => {
    // Sin decir qué corregir, el técnico adivina y vuelve con el mismo
    // problema.
    const a = accionesDe(enBandeja(), COORD);
    expect(a.find((x) => x.decision === "devolver")?.exigeMotivo).toBe(true);
  });

  it("aprobar no exige motivo", () => {
    const a = accionesDe(enBandeja(), COORD);
    expect(a.find((x) => x.decision === "aprobar")?.exigeMotivo).toBe(false);
  });

  it("el técnico no revisa órdenes", () => {
    const a = accionesDe(enBandeja(), { usuarioId: "u-tec1", rol: "tecnico" });
    expect(a.every((x) => !x.habilitada)).toBe(true);
    expect(a[0]?.motivo).toContain("Solo el coordinador");
  });

  it("el cliente tampoco, ni en vista de cliente", () => {
    const a = accionesDe(enBandeja(), { usuarioId: "u-cli", rol: "cliente", vistaCliente: true });
    expect(a.every((x) => !x.habilitada)).toBe(true);
  });

  it("no se reasigna una orden cerrada", () => {
    const a = accionesDe(enBandeja({ estado: "cerrada" }), COORD);
    expect(a.find((x) => x.decision === "reasignar")?.habilitada).toBe(false);
  });
});

describe("motivo de la devolución", () => {
  it("acepta un motivo con sustancia", () => {
    expect(validarDevolucion("Falta el número de parche en la posición 6").permitido).toBe(true);
  });

  it("rechaza un motivo vacío", () => {
    expect(validarDevolucion("   ").codigo).toBe("SIN_MOTIVO");
  });

  it("rechaza un motivo demasiado corto", () => {
    // Un "corregir" suelto obliga al técnico a volver sin saber qué revisar.
    const r = validarDevolucion("revisar");
    expect(r.codigo).toBe("MOTIVO_CORTO");
    expect(r.mensaje).toContain("sin preguntar");
  });

  it("el mínimo es corto pero no trivial", () => {
    expect(LARGO_MINIMO_MOTIVO).toBeGreaterThanOrEqual(10);
  });
});

describe("motivos sugeridos", () => {
  it("propone uno por cada señal detectada", () => {
    // Escribir a mano en el celular es lento, y lo lento se omite: sin
    // sugerencias el coordinador escribe "revisar" y no resuelve nada.
    const item = enBandeja({ hallazgos: null }, [med(1), med(2)]);
    const s = motivosSugeridos(item, COORD);
    expect(s.length).toBeGreaterThanOrEqual(2);
  });

  it("nombra las posiciones concretas que faltan", () => {
    const s = motivosSugeridos(enBandeja({}, [med(1), med(2)]), COORD);
    expect(s.some((x) => x.includes("3, 4"))).toBe(true);
  });

  it("las sugerencias pasan su propia validación", () => {
    // Una sugerencia que el sistema rechazaría sería absurda.
    const item = enBandeja({ hallazgos: null, versionContenido: 8 }, [med(1)]);
    for (const sugerencia of motivosSugeridos(item, COORD)) {
      expect(validarDevolucion(sugerencia).permitido, sugerencia).toBe(true);
    }
  });

  it("una orden correcta no genera sugerencias", () => {
    expect(motivosSugeridos(enBandeja(), COORD)).toEqual([]);
  });
});
