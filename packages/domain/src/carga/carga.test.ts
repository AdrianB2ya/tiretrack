import { describe, it, expect } from "vitest";
import { leerCSV, numeroDeCarga, plantillaCSV, validarCarga } from "./carga";

describe("carga masiva (R12)", () => {
  it("lee el CSV de Excel en español: punto y coma, BOM, comillas y fin de línea de Windows", () => {
    const csv = leerCSV('﻿CLIENTE;NIT;SEDE\r\n"Transportes ""El Rápido""";800;Planta\r\n\r\n');
    expect(csv.columnas).toEqual(["CLIENTE", "NIT", "SEDE"]);
    expect(csv.filas).toEqual([{ CLIENTE: 'Transportes "El Rápido"', NIT: "800", SEDE: "Planta" }]);
  });

  it("también con coma, y las columnas sin importar tildes ni mayúsculas", () => {
    const csv = leerCSV("Marca,Diseño,Tipo eje,Medida\nMichelin,XZE,direccional,295/80R22.5\n");
    expect(csv.columnas).toEqual(["MARCA", "DISENO", "TIPO EJE", "MEDIDA"]);
  });

  it("la plantilla trae los encabezados y una fila de ejemplo que pasa la validación", () => {
    for (const tipo of ["flota", "llantas", "catalogo"] as const) {
      const v = validarCarga(tipo, leerCSV(plantillaCSV(tipo)));
      expect(v.errores, tipo).toEqual([]);
    }
  });

  it("dice todas las filas malas juntas, con su número de fila como en Excel", () => {
    const csv = leerCSV("NIT CLIENTE;SEDE;SERIAL;DOT;MEDIDA\n800;FUN;MX1;3624;295/80R22.5\n800;FUN;;99;grande\n800;FUN;MX1;;\n");
    expect(validarCarga("llantas", csv).errores).toEqual([
      { fila: 3, mensaje: "Sin serial ni número interno: la llanta no se puede seguir" },
      { fila: 3, mensaje: "DOT inválido: son 4 dígitos, semana y año" },
      { fila: 3, mensaje: "Medida inválida (ej. 295/80R22.5)" },
      { fila: 4, mensaje: "Llanta repetida en el archivo" },
    ]);
  });

  it("si faltan columnas obligatorias lo dice de una vez", () => {
    expect(validarCarga("catalogo", leerCSV("MARCA;MEDIDA\nMichelin;295/80R22.5\n")).errores).toEqual([
      { fila: 1, mensaje: "Faltan columnas: DISEÑO, TIPO EJE" },
    ]);
  });

  it("los números del archivo aceptan puntos de miles y coma decimal", () => {
    expect(numeroDeCarga("1.850.000")).toBe(1850000);
    expect(numeroDeCarga("16,5")).toBe(16.5);
    expect(numeroDeCarga("")).toBeNull();
  });
});
