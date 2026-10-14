import { describe, it, expect } from "vitest";
import { contenidoQRVehiculo, leerQRVehiculo } from "./qr";

const ID = "3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b";

describe("QR del vehículo (R15)", () => {
  it("ida y vuelta: lo que se imprime es lo que se lee", () => {
    expect(contenidoQRVehiculo(ID)).toBe(`asistectire://vehiculo/${ID}`);
    expect(leerQRVehiculo(contenidoQRVehiculo(ID))).toBe(ID);
  });

  it("acepta el UUID solo y no le importan mayúsculas ni espacios", () => {
    expect(leerQRVehiculo(`  ${ID.toUpperCase()} `)).toBe(ID);
    expect(leerQRVehiculo(`ASISTECTIRE://vehiculo/${ID}?x=1`)).toBe(ID);
  });

  it("otro QR cualquiera no abre nada", () => {
    expect(leerQRVehiculo("https://factura.dian.gov.co/123")).toBeNull();
    expect(leerQRVehiculo("asistectire://vehiculo/no-es-un-id")).toBeNull();
    expect(leerQRVehiculo("")).toBeNull();
  });
});
