import { describe, it, expect } from "vitest";
import { claveOrdenHistorica, fechaDeCarga, leerCSV, numeroDeCarga, plantillaCSV, posicionDeCarga, TIPOS_CARGA, validarCarga } from "./carga";
import { esFolioHistorico, esFolioValido, formatearFolio, PREFIJO_HISTORICA } from "../folio/folio";

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
    for (const tipo of TIPOS_CARGA) {
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

describe("órdenes anteriores (2026-10-17)", () => {
  const encabezado = "NUMERO ANTERIOR;FECHA;SEDE;NIT CLIENTE;VEHICULO;POSICION;MARCA;PROF EXT;PSI ENCONTRADA";
  const validar = (filas: string[], hoy = "2026-10-17") => validarCarga("ordenes", leerCSV([encabezado, ...filas].join("\n")), hoy);

  it("acepta la fecha como la escribe Excel en español, y rechaza la imposible", () => {
    expect(fechaDeCarga("2025-03-14")).toBe("2025-03-14");
    expect(fechaDeCarga("14/03/2025")).toBe("2025-03-14");
    expect(fechaDeCarga("31/02/2025")).toBeNull();
    expect(fechaDeCarga("marzo")).toBeNull();
  });

  it("la posición es un número de eje o R1… para los repuestos", () => {
    expect(posicionDeCarga("3")).toBe(3);
    expect(posicionDeCarga("r2")).toBe(102);
    expect(posicionDeCarga("0")).toBeNull();
    expect(posicionDeCarga("R11")).toBeNull();
    expect(posicionDeCarga("X")).toBeNull();
  });

  it("las filas del mismo vehículo, fecha y número son una sola orden, se escriban como se escriban", () => {
    const a = leerCSV(`${encabezado}\n1234;2025-03-14;fun;800.112.334-1;CA-12;1;;;`).filas[0]!;
    const b = leerCSV(`${encabezado}\n1234;14/03/2025;FUN;800112334-1;ca 12;2;;;`).filas[0]!;
    expect(claveOrdenHistorica((c) => a[c] ?? "")).toBe(claveOrdenHistorica((c) => b[c] ?? ""));
  });

  it("una fila correcta pasa; la fecha futura, la posición repetida y los valores imposibles se dicen", () => {
    expect(validar(["1234;2025-03-14;FUN;800;CA-12;1;Michelin;12,5;100"]).errores).toEqual([]);
    const v = validar([
      "1234;2026-12-01;FUN;800;CA-12;1;;;",
      "1;2025-03-14;FUN;800;CA-12;2;;;",
      "1;2025-03-14;FUN;800;CA-12;2;;;",
      "1;2025-03-14;FUN;800;CA-12;3;;75;",
      "1;2025-03-14;FUN;800;CA-12;Z;;;",
    ]);
    expect(v.errores.map((e) => [e.fila, e.mensaje])).toEqual([
      [2, "FECHA en el futuro: aquí van órdenes ya hechas"],
      [4, "Posición 2 repetida en la misma orden"],
      [5, "PROF EXT debe estar entre 0 y 60 mm"],
      [6, "POSICION inválida: un número (1, 2…) o R1 para el repuesto 1"],
    ]);
  });
});

describe("folio de las órdenes anteriores", () => {
  it("van en la serie HIS, que es un folio válido y se reconoce como histórico", () => {
    const f = formatearFolio("FUN", 7, PREFIJO_HISTORICA);
    expect(f).toBe("HIS-FUN-000007");
    expect(esFolioValido(f)).toBe(true);
    expect(esFolioHistorico(f)).toBe(true);
    expect(esFolioHistorico("OS-FUN-000007")).toBe(false);
    expect(esFolioValido("OS-FUN-000007")).toBe(true);
  });
});
