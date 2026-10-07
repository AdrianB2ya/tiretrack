import { describe, it, expect } from "vitest";
import { fechaEnColombia, fechaHoraEnColombia } from "./zona";

describe("fecha en Colombia", () => {
  it("después de las 7 p. m. sigue siendo el mismo día, aunque en UTC ya sea mañana", () => {
    // 2026-10-06T02:30Z son las 9:30 p. m. del 5 de octubre en Bogotá.
    expect(fechaEnColombia(new Date("2026-10-06T02:30:00Z"))).toBe("2026-10-05");
  });

  it("el día cambia a la medianoche de Colombia, no a la de UTC", () => {
    expect(fechaEnColombia(new Date("2026-10-06T04:59:59Z"))).toBe("2026-10-05");
    expect(fechaEnColombia(new Date("2026-10-06T05:00:00Z"))).toBe("2026-10-06");
  });

  it("de día coincide con UTC", () => {
    expect(fechaEnColombia(new Date("2026-10-06T15:00:00Z"))).toBe("2026-10-06");
  });

  it("cruza meses y años", () => {
    expect(fechaEnColombia(new Date("2027-01-01T03:00:00Z"))).toBe("2026-12-31");
    expect(fechaEnColombia(new Date("2028-03-01T01:00:00Z"))).toBe("2028-02-29");
  });

  it("sin horario de verano: el mismo desfase en junio que en diciembre", () => {
    expect(fechaEnColombia(new Date("2026-06-15T04:00:00Z"))).toBe("2026-06-14");
    expect(fechaEnColombia(new Date("2026-12-15T04:00:00Z"))).toBe("2026-12-14");
  });
});

describe("hora para mostrar", () => {
  it("un instante de la noche en UTC es la tarde del mismo día en Colombia", () => {
    expect(fechaHoraEnColombia("2026-10-07T02:15:00Z")).toBe("2026-10-06 21:15");
  });
});
