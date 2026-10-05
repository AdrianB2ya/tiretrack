import { describe, it, expect } from "vitest";
import {
  encabezados,
  gruposDeColumnas,
  aCeldas,
  aCSV,
  columnaDeServicio,
  nombreArchivo,
  resumirExportacion,
  construirTrazabilidad,
  desgasteEnElTiempo,
  BLOQUES,
  type FilaCruda,
} from "./formato";
import { CODIGOS_SERVICIO_LLANTA } from "../tipos";

const fila: FilaCruda = {
  fecha: "2026-09-14",
  vehiculoCodigo: "CA-12",
  vehiculoPlaca: "SXK482",
  folio: "OS-FUN-000123",
  codigoReferencia: null,
  estado: "cerrada",
  kilometraje: 78900,
  posicion: 7,
  servicios: ["CALI", "RETO"],
  numCalor: "H2201",
  serial: "MX10023458",
  dot: "3624",
  marca: "Michelin",
  diseno: "XZY-3",
  medida: "295/80R22.5",
  estadoLlanta: "Usada",
  psiEncontrada: 105,
  psiCalibrado: 110,
  profundidad: 9,
  noIdentificada: false,
  desPosicion: null,
  desNumCalor: null,
  desSerial: null,
  desDot: null,
  desMedida: null,
  desProfundidad: null,
  desMarca: null,
  desDiseno: null,
  desDestino: null,
  desDetalle: null,
};

describe("estructura del informe", () => {
  it("tiene los cuatro bloques del formato operativo", () => {
    const g = gruposDeColumnas();
    expect(g.map((x) => x.titulo)).toEqual([
      "",
      "Servicios realizados",
      "Datos de llanta intervenida",
      "Llanta desmontada · destino",
    ]);
  });

  it("los grupos suman exactamente las columnas que hay", () => {
    const total = gruposDeColumnas().reduce((n, g) => n + g.columnas, 0);
    expect(total).toBe(encabezados().length);
  });

  it("cada fila tiene tantas celdas como encabezados", () => {
    // Si se desalinean, todo el informe queda corrido una columna.
    expect(aCeldas(fila)).toHaveLength(encabezados().length);
  });

  it("las columnas de servicio salen del catálogo, no de una lista fija", () => {
    // Si mañana se agrega un servicio, el informe gana esa columna sola.
    const cabeceras = encabezados();
    for (const s of CODIGOS_SERVICIO_LLANTA) {
      expect(cabeceras).toContain(columnaDeServicio(s));
    }
  });

  it("usa los nombres de columna del formato del taller", () => {
    expect(columnaDeServicio("RETO")).toBe("RETORQUE");
    expect(columnaDeServicio("REPA")).toBe("REPARACION");
    expect(columnaDeServicio("ROTA")).toBe("ROTACION");
  });

  it("un código desconocido se ve, no desaparece", () => {
    expect(columnaDeServicio("XXXX")).toBe("XXXX");
  });

  it("mantiene el orden de los bloques", () => {
    const c = encabezados();
    expect(c[0]).toBe("FECHA");
    expect(c[BLOQUES.cabecera.length - 1]).toBe("POSICION LLANTA");
    expect(c[c.length - 1]).toBe("DETALLE");
  });
});

describe("contenido de la fila", () => {
  it("marca los servicios con X", () => {
    const celdas = aCeldas(fila);
    const inicio = BLOQUES.cabecera.length;
    const idxCalibracion = inicio + CODIGOS_SERVICIO_LLANTA.indexOf("CALI");
    const idxBalanceo = inicio + CODIGOS_SERVICIO_LLANTA.indexOf("BALA");
    expect(celdas[idxCalibracion]).toBe("X");
    expect(celdas[idxBalanceo]).toBe("");
  });

  it("calcula fabricación y vencimiento desde el DOT", () => {
    const celdas = aCeldas(fila);
    expect(celdas).toContain("Semana 36 de 2024");
    expect(celdas.some((c) => c.startsWith("2030"))).toBe(true);
  });

  it("el estado de la orden va en el archivo", () => {
    // Quien lo reciba debe poder ver si esas mediciones estaban aprobadas.
    expect(aCeldas(fila)).toContain("CERRADA");
    expect(aCeldas({ ...fila, estado: "en_proceso" })).toContain("EN_PROCESO");
  });

  it("una llanta sin identificar lo dice, no queda en blanco", () => {
    // El blanco parece un olvido; esto fue una decisión del técnico.
    const sinId = aCeldas({ ...fila, serial: null, noIdentificada: true });
    expect(sinId).toContain("SIN IDENTIFICAR");
  });

  it("un dato faltante sí queda en blanco", () => {
    const celdas = aCeldas({ ...fila, serial: null, noIdentificada: false });
    expect(celdas).not.toContain("SIN IDENTIFICAR");
  });

  it("usa el código de referencia cuando todavía no hay folio", () => {
    const sinFolio = aCeldas({ ...fila, folio: null, codigoReferencia: "FUN-K7M2" });
    expect(sinFolio).toContain("FUN-K7M2");
  });

  it("incluye el bloque de llanta desmontada cuando lo hay", () => {
    const conDesmontaje = aCeldas({
      ...fila,
      servicios: ["MONT"],
      desPosicion: 7,
      desSerial: "MX10023460",
      desDestino: "Desecho",
      desDetalle: "Desgaste al límite",
    });
    expect(conDesmontaje).toContain("MX10023460");
    expect(conDesmontaje).toContain("Desecho");
    expect(conDesmontaje).toContain("Desgaste al límite");
  });
});

describe("serialización a CSV", () => {
  it("separa con punto y coma", () => {
    // Excel en español interpreta la coma como separador decimal: con `,`
    // las profundidades se parten en dos columnas.
    const csv = aCSV([fila]);
    expect(csv).toContain(";");
    const primeraLinea = csv.split("\n")[0] ?? "";
    expect(primeraLinea.split(";").length).toBe(encabezados().length);
  });

  it("empieza con BOM para que Excel reconozca UTF-8", () => {
    // Sin BOM, Excel muestra "PosiciÃ³n" en vez de "Posición".
    expect(aCSV([fila]).charCodeAt(0)).toBe(0xfeff);
  });

  it("escapa las comillas dentro de los valores", () => {
    const conComillas = aCSV([{ ...fila, desDetalle: 'Corte de 5" en el flanco' }]);
    expect(conComillas).toContain('""');
  });

  it("un detalle con punto y coma no rompe las columnas", () => {
    const csv = aCSV([{ ...fila, desDetalle: "Corte; separación de banda" }]);
    const lineas = csv.split("\n");
    // Sigue habiendo dos líneas: encabezado y fila
    expect(lineas).toHaveLength(2);
  });

  it("una fila sin datos igual produce todas las columnas", () => {
    const vacia: FilaCruda = {
      ...fila,
      servicios: [],
      numCalor: null, serial: null, dot: null, marca: null, diseno: null,
      medida: null, estadoLlanta: null, psiEncontrada: null, psiCalibrado: null,
      profundidad: null, kilometraje: null, vehiculoPlaca: null,
    };
    expect(aCeldas(vacia)).toHaveLength(encabezados().length);
  });
});

describe("nombre del archivo", () => {
  it("usa el folio cuando es una sola orden", () => {
    expect(nombreArchivo(["OS-FUN-000123"], "2026-09-14")).toBe("OS-FUN-000123.csv");
  });

  it("indica la cantidad cuando son varias", () => {
    expect(nombreArchivo(["a", "b", "c"], "2026-09-14")).toBe("informe-3-ordenes-2026-09-14.csv");
  });
});

describe("resumen para la auditoría", () => {
  const otra = { ...fila, folio: "OS-FUN-000124", estado: "en_proceso", posicion: 1 };

  it("cuenta registros y órdenes distintas", () => {
    const r = resumirExportacion([fila, { ...fila, posicion: 8 }, otra]);
    expect(r.registros).toBe(3);
    expect(r.ordenes).toBe(2);
  });

  it("señala cuántas iban sin cerrar", () => {
    // Si aparece un archivo con datos que no cuadran, se puede ver que
    // salió preliminar.
    const r = resumirExportacion([fila, otra]);
    expect(r.sinCerrar).toBe(1);
  });

  it("recorta la lista de folios", () => {
    const muchas = Array.from({ length: 50 }, (_, i) => ({ ...fila, folio: `OS-FUN-${i}` }));
    const r = resumirExportacion(muchas);
    expect(r.ordenes).toBe(50);
    expect(r.folios).toHaveLength(20);
  });
});

describe("trazabilidad de una llanta", () => {
  const pasos = [
    { ...fila, fecha: "2026-03-10", posicion: 3, profundidad: 14 },
    { ...fila, fecha: "2026-09-14", posicion: 7, profundidad: 9 },
    { ...fila, fecha: "2026-06-05", posicion: 3, profundidad: 11.5 },
  ];

  it("ordena el recorrido cronológicamente", () => {
    const t = construirTrazabilidad(pasos);
    expect(t.map((p) => p.fecha)).toEqual(["2026-03-10", "2026-06-05", "2026-09-14"]);
  });

  it("muestra el cambio de posición", () => {
    // Es lo que permite ver que la llanta se rotó.
    const t = construirTrazabilidad(pasos);
    expect(t.map((p) => p.posicion)).toEqual([3, 3, 7]);
  });

  it("calcula el desgaste acumulado", () => {
    const d = desgasteEnElTiempo(construirTrazabilidad(pasos));
    expect(d?.perdida).toBe(5);
    expect(d?.servicios).toBe(3);
  });

  it("no calcula desgaste con una sola medición", () => {
    const d = desgasteEnElTiempo(construirTrazabilidad([pasos[0] as FilaCruda]));
    expect(d).toBeNull();
  });

  it("ignora las mediciones sin profundidad", () => {
    const conVacia = [...pasos, { ...fila, fecha: "2026-10-01", profundidad: null }];
    const d = desgasteEnElTiempo(construirTrazabilidad(conVacia));
    expect(d?.servicios).toBe(3);
  });
});
