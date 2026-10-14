import { describe, it, expect } from "vitest";
import { armarCotizacion, montadoPorPosicion, type MedicionParaCotizar } from "./cotizacion";

const LIMITES = { cambioInmediato: 3, programarCambio: 5 };
const HOY = new Date("2026-10-14T15:00:00Z");
const m = (x: Partial<MedicionParaCotizar>): MedicionParaCotizar => ({
  vehiculo: "CA-12", posicion: 1, fecha: "2026-10-01", marca: "Michelin", diseno: "XZE", medida: "295/80R22.5",
  profundidad: 9, minimoEje: null, dot: "3624", ...x,
});

describe("cotización (R14)", () => {
  it("cotiza lo montado HOY: una llanta gastada que ya se cambió no se cotiza otra vez", () => {
    const filas = [m({ fecha: "2026-09-01", profundidad: 2 }), m({ fecha: "2026-10-01", profundidad: 15 })];
    expect(montadoPorPosicion(filas)).toHaveLength(1);
    expect(armarCotizacion(filas, [], LIMITES, HOY).totalLlantas).toBe(0);
  });

  it("agrupa por medida y urgencia, lo inmediato primero, con las posiciones en el detalle", () => {
    const c = armarCotizacion(
      [
        m({ posicion: 1, profundidad: 4.5 }),
        m({ posicion: 2, profundidad: 2.5 }),
        m({ vehiculo: "CA-14", posicion: 3, profundidad: 3 }),
        m({ vehiculo: "CA-14", posicion: 5, profundidad: 8, dot: "0118" }), // DOT vencido
        m({ posicion: 7, profundidad: 12 }),
      ],
      [],
      LIMITES,
      HOY,
    );
    expect(c.llantas).toEqual([
      {
        concepto: "Llanta 295/80R22.5",
        detalle: "Referencia actual: Michelin XZE. CA-12 (pos. 2); CA-14 (pos. 3, 5)",
        cantidad: 3,
        urgencia: "inmediato",
      },
      { concepto: "Llanta 295/80R22.5", detalle: "Referencia actual: Michelin XZE. CA-12 (pos. 1)", cantidad: 1, urgencia: "programar" },
    ]);
    expect(c.servicios[0]).toEqual({ concepto: "Montaje", detalle: "Una por llanta a cambiar", cantidad: 4, urgencia: null });
  });

  it("el mínimo del eje manda sobre el de la empresa", () => {
    const c = armarCotizacion([m({ profundidad: 3.5, minimoEje: 4 })], [], LIMITES, HOY);
    expect(c.llantas[0]?.urgencia).toBe("inmediato");
  });

  it("las recomendaciones abiertas se juntan por texto, sin importar mayúsculas", () => {
    const c = armarCotizacion(
      [],
      [
        { vehiculo: "CA-12", descripcion: "Alinear  eje direccional", prioridad: "urgente" },
        { vehiculo: "CA-14", descripcion: "alinear eje direccional", prioridad: "seguimiento" },
      ],
      LIMITES,
      HOY,
    );
    expect(c.servicios).toEqual([
      { concepto: "Alinear  eje direccional", detalle: "Recomendación de visitas anteriores: CA-12, CA-14", cantidad: 2, urgencia: "inmediato" },
    ]);
  });
});
