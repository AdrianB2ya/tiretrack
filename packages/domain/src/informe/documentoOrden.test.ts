import { describe, it, expect } from "vitest";
import { armarDocumentoOrden, nombreArchivoOrden, type DatosDocumentoOrden } from "./documentoOrden";

const base: DatosDocumentoOrden = {
  empresa: { nombre: "Asistectire", nit: "900111222" },
  orden: {
    folio: "OS-FUN-000012", codigoReferencia: null, fecha: "2026-10-06", estado: "cerrada", tipo: "preventivo",
    kilometraje: 78900, hallazgos: "Desgaste irregular en el eje 2", accion: null, cierreTacito: false, versionContenido: 4,
  },
  cliente: { nombre: "Transportes Reyna", nit: "800123456", sede: "Planta" },
  vehiculo: { codigo: "CA-12", placa: "SXK482" },
  tecnico: { nombre: "Carlos Méndez", cedula: "1001" },
  posiciones: [
    {
      posicion: 2, marca: "Michelin", diseno: "XZE", medida: "295/80R22.5", serial: "MX2", dot: "3624", profundidad: 9.5,
      psiEncontrada: 105, psiCalibrado: 110, noIdentificada: false, servicios: ["CALI", "MONT"],
      desmontada: { serial: "VIEJA-2", profundidad: 2.5, destino: "Reencauche" },
    },
    {
      posicion: 1, marca: null, diseno: null, medida: null, serial: null, dot: null, profundidad: 8,
      psiEncontrada: null, psiCalibrado: null, noIdentificada: true, servicios: [], desmontada: null,
    },
  ],
  recomendaciones: [{ texto: "Cambiar la posición 3", prioridad: "urgente", posicion: 3 }],
  firma: { nombre: "Luis Reyna", cedula: "77221004", cargo: "Jefe de patio", fechaHora: "2026-10-06 10:30", version: 4, trazo: null },
};

describe("documento de la orden", () => {
  it("una orden aprobada y firmada vigente no lleva avisos", () => {
    expect(armarDocumentoOrden(base).avisos).toEqual([]);
  });

  it("una sin aprobar dice PRELIMINAR: no aparenta ser definitiva", () => {
    const d = armarDocumentoOrden({ ...base, orden: { ...base.orden, estado: "en_revision" } });
    expect(d.avisos[0]).toMatch(/^PRELIMINAR/);
  });

  it("el cierre por vencimiento nunca aparenta aprobación expresa", () => {
    const d = armarDocumentoOrden({ ...base, orden: { ...base.orden, cierreTacito: true } });
    expect(d.avisos).toContain("Cerrada por vencimiento del plazo de aprobación: el cliente no la aprobó expresamente.");
  });

  it("una firma que no ampara el contenido actual lo advierte; sin firma también", () => {
    expect(armarDocumentoOrden({ ...base, orden: { ...base.orden, versionContenido: 5 } }).avisos.join(" ")).toMatch(/no ampara/);
    expect(armarDocumentoOrden({ ...base, firma: null }).avisos.join(" ")).toMatch(/Sin firma/);
  });

  it("las posiciones van en orden, con servicios por nombre, la desmontada y SIN IDENTIFICAR", () => {
    const d = armarDocumentoOrden(base);
    expect(d.filas.map((f) => f[0])).toEqual(["1", "2"]);
    expect(d.filas[0]?.[1]).toBe("SIN IDENTIFICAR");
    expect(d.filas[1]).toEqual(["2", "Michelin XZE 295/80R22.5", "MX2", "3624", "9,5 mm", "105 / 110", "Calibración, Montaje", "VIEJA-2 · 2,5 mm · Reencauche"]);
  });

  it("con las tres medidas, la celda las muestra y debajo la mínima", () => {
    const p = { ...base.posiciones[0]!, profundidad: 8.5, profundidades: { exterior: 9.5, centro: 9, interior: 8.5 } };
    const d = armarDocumentoOrden({ ...base, posiciones: [p] });
    expect(d.columnas[4]).toBe("Prof. ext · cen · int");
    expect(d.filas[0]?.[4]).toBe("9,5 · 9 · 8,5\nmín 8,5 mm");
  });

  it("la cabecera identifica a todos, y las recomendaciones dicen su prioridad", () => {
    const d = armarDocumentoOrden(base);
    expect(d.cabecera).toContainEqual(["Cliente", "Transportes Reyna · NIT 800123456"]);
    expect(d.cabecera).toContainEqual(["Técnico", "Carlos Méndez · CC 1001"]);
    expect(d.recomendaciones).toEqual(["Urgente · posición 3: Cambiar la posición 3"]);
    expect(d.firma?.lineas[0]).toBe("Recibió: Luis Reyna · CC 77221004 · Jefe de patio");
  });

  it("el archivo se llama como el folio, o la referencia si aún no tiene", () => {
    expect(nombreArchivoOrden(base)).toBe("OS-FUN-000012.pdf");
    expect(nombreArchivoOrden({ ...base, orden: { ...base.orden, folio: null, codigoReferencia: "FUN-K7M2" } })).toBe("FUN-K7M2.pdf");
  });
});
