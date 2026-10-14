import { describe, it, expect } from "vitest";
import { proyeccionDeCompras, proyectarCambio, rendimientoPor, ultimaPorLlanta, vidaUtilPor, type FilaTablero } from "./tablero";

const fila = (extra: Partial<FilaTablero> = {}): FilaTablero => ({
  llantaId: "ll-1", vehiculo: "CA-12", posicion: 1, fecha: "2026-10-01", marca: "Michelin", diseno: "XZE",
  medida: "295/80R22.5", remanente: 9, profBaja: 3, mmDesgaste: 7, kmPorMm: 10_000, proyeccionKm: 130_000,
  cpk: 14, fechaMontaje: "2026-03-05", ...extra,
});

describe("tablero de la flota (R11)", () => {
  it("cada llanta cuenta una vez, con su última medición", () => {
    const u = ultimaPorLlanta([fila({ fecha: "2026-08-01", remanente: 11 }), fila(), fila({ llantaId: null, posicion: 2 })]);
    expect(u).toHaveLength(2);
    expect(u.find((f) => f.llantaId === "ll-1")?.remanente).toBe(9);
  });

  it("el rendimiento por marca se ordena por costo por km, el más barato primero", () => {
    const rs = rendimientoPor(
      [fila(), fila({ llantaId: "2", cpk: 16 }), fila({ llantaId: "3", marca: "Firestone", cpk: 11, kmPorMm: 9000 })],
      (f) => f.marca,
    );
    expect(rs.map((x) => [x.grupo, x.llantas, x.cpk])).toEqual([["Firestone", 1, 11], ["Michelin", 2, 15]]);
  });

  it("estima cuándo llega a su profundidad baja al ritmo al que se gasta", () => {
    // 7 mm en 210 días: 1/30 mm por día. Le quedan 6 mm hasta la baja: 180 días.
    expect(proyectarCambio(fila())).toBe("2027-03-30");
    // Sin fecha de montaje no se estima.
    expect(proyectarCambio(fila({ fechaMontaje: null }))).toBeNull();
  });

  it("la proyección de compras agrupa por medida en 30, 60 y 90 días", () => {
    const c = proyeccionDeCompras(
      [
        fila({ llantaId: "a", remanente: 3 }),
        // 1 mm sobre la baja a 1/30 mm por día: 30 días.
        fila({ llantaId: "b", remanente: 4 }),
        fila({ llantaId: "c", remanente: 4, medida: "11R22.5" }),
        fila({ llantaId: "d", remanente: 5 }),
        fila({ llantaId: "e", fechaMontaje: null }),
      ],
      "2026-10-01",
    );
    expect(c.yaPedidas).toEqual([{ medida: "295/80R22.5", cantidad: 1 }]);
    expect(c.en30).toEqual([{ medida: "11R22.5", cantidad: 1 }, { medida: "295/80R22.5", cantidad: 1 }]);
    expect(c.en60).toEqual([{ medida: "295/80R22.5", cantidad: 1 }]);
    expect(c.sinEstimar).toBe(1);
  });
});

describe("vida útil (brecha C)", () => {
  it("promedia lo que rodaron las retiradas por marca, sin contar las que no tienen km", () => {
    const v = vidaUtilPor(
      [
        { marca: "Michelin", diseno: "XZE", km: 120000 },
        { marca: "Michelin", diseno: "XZE", km: 100000 },
        { marca: "Michelin", diseno: "XZE", km: null },
        { marca: "Firestone", diseno: "FS591", km: 130000 },
      ],
      (l) => l.marca,
    );
    expect(v).toEqual([
      { grupo: "Firestone", llantas: 1, kmPromedio: 130000 },
      { grupo: "Michelin", llantas: 2, kmPromedio: 110000 },
    ]);
  });
});
