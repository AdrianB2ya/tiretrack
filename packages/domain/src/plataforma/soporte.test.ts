import { describe, it, expect } from "vitest";
import { permitidoEnSoporte, validarSoporte } from "./soporte";

const BIEN = { motivo: "El administrador no ve sus órdenes de ayer", ticket: "SOP-1042", minutos: 60 };

describe("sesión de soporte (R16)", () => {
  it("exige motivo con sustancia, ticket y una duración acotada", () => {
    expect(validarSoporte(BIEN).permitido).toBe(true);
    expect(validarSoporte({ ...BIEN, motivo: "revisar" }).codigo).toBe("MOTIVO_CORTO");
    expect(validarSoporte({ ...BIEN, ticket: " " }).codigo).toBe("TICKET_INVALIDO");
    expect(validarSoporte({ ...BIEN, minutos: 600 }).codigo).toBe("DURACION_INVALIDA");
    expect(validarSoporte({ ...BIEN, minutos: 5 }).codigo).toBe("DURACION_INVALIDA");
  });

  it("solo lectura: consultas sí, escribir no, salvo terminar la sesión", () => {
    expect(permitidoEnSoporte("GET", "/api/v1/ordenes/x/pdf")).toBe(true);
    expect(permitidoEnSoporte("POST", "/api/v1/ordenes/x/estado")).toBe(false);
    expect(permitidoEnSoporte("POST", "/api/v1/informe/enviar")).toBe(false);
    expect(permitidoEnSoporte("DELETE", "/api/v1/fotos/x")).toBe(false);
    expect(permitidoEnSoporte("POST", "/api/v1/plataforma/soporte/terminar")).toBe(true);
    expect(permitidoEnSoporte("POST", "/api/v1/plataforma/soporte/terminar/../../usuarios")).toBe(false);
  });
});
