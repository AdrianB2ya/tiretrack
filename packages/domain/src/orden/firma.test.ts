import { describe, it, expect } from "vitest";
import {
  firmaVigente,
  firmaInvalidada,
  puedeEditarMediciones,
  puedeAprobar,
  esAutoaprobacion,
  type Firma,
} from "./firma";
import { congelar, resolverDatos, puedeCerrarse, type DatosVivos } from "./congelado";

const firma = (version: number): Firma => ({
  nombre: "Luis Reyna",
  cedula: "77.221.004",
  fecha: "2026-08-24 16:05",
  version,
});

describe("firma atada a la versión", () => {
  it("es vigente cuando coincide con la versión de la orden", () => {
    expect(firmaVigente({ versionContenido: 6, firma: firma(6) })).toBe(true);
  });

  it("queda invalidada si la orden cambió después de firmar", () => {
    const orden = { versionContenido: 8, firma: firma(6) };
    expect(firmaVigente(orden)).toBe(false);
    expect(firmaInvalidada(orden)).toBe(true);
  });

  it("avanzar de estado NO invalida la firma", () => {
    // El contador de contenido no se mueve al cambiar de estado: el documento
    // que el cliente firmó no cambia porque el coordinador lo apruebe.
    // Este caso lo destapó una prueba de integración: antes la firma se ataba
    // a la versión general y aprobar la invalidaba.
    const alFirmar = { versionContenido: 6, firma: firma(6) };
    expect(firmaVigente(alFirmar)).toBe(true);

    const trasAvanzarDeEstado = { versionContenido: 6, firma: firma(6) };
    expect(firmaVigente(trasAvanzarDeEstado)).toBe(true);
  });

  it("editar el contenido SÍ la invalida", () => {
    const trasEditarMedicion = { versionContenido: 7, firma: firma(6) };
    expect(firmaVigente(trasEditarMedicion)).toBe(false);
    expect(firmaInvalidada(trasEditarMedicion)).toBe(true);
  });

  it("sin firma no está vigente ni invalidada", () => {
    expect(firmaVigente({ versionContenido: 3, firma: null })).toBe(false);
    expect(firmaInvalidada({ versionContenido: 3, firma: null })).toBe(false);
    expect(firmaVigente({ versionContenido: 3 })).toBe(false);
  });
});

describe("quién edita mediciones", () => {
  it("el técnico asignado edita mientras captura", () => {
    const r = puedeEditarMediciones({
      estado: "en_proceso",
      rol: "tecnico",
      esTecnicoAsignado: true,
    });
    expect(r.permitido).toBe(true);
  });

  it("el coordinador NO edita: debe devolver la orden", () => {
    // Si pudiera corregir lo que midió el técnico, la autoría y la firma
    // dejarían de respaldar nada.
    const r = puedeEditarMediciones({
      estado: "en_proceso",
      rol: "coordinador",
      esTecnicoAsignado: false,
    });
    expect(r.permitido).toBe(false);
    expect(r.codigo).toBe("SOLO_ASIGNADO");
  });

  it("nadie edita una orden en revisión", () => {
    const r = puedeEditarMediciones({
      estado: "en_revision",
      rol: "tecnico",
      esTecnicoAsignado: true,
    });
    expect(r.codigo).toBe("EN_REVISION");
  });

  it("nadie edita mientras el cliente decide", () => {
    const r = puedeEditarMediciones({
      estado: "pendiente_cliente",
      rol: "tecnico",
      esTecnicoAsignado: true,
    });
    expect(r.codigo).toBe("ESPERA_CLIENTE");
  });

  it("una orden cerrada no se toca", () => {
    for (const estado of ["cerrada", "anulada"] as const) {
      const r = puedeEditarMediciones({ estado, rol: "administrador", esTecnicoAsignado: true });
      expect(r.codigo).toBe("ORDEN_CERRADA");
    }
  });

  it("el portal del cliente es de solo lectura", () => {
    const r = puedeEditarMediciones({
      estado: "en_proceso",
      rol: "cliente",
      esTecnicoAsignado: true,
      vistaCliente: true,
    });
    expect(r.codigo).toBe("VISTA_CLIENTE");
  });
});

describe("aprobación", () => {
  it("aprueban coordinador y administrador", () => {
    expect(puedeAprobar("coordinador")).toBe(true);
    expect(puedeAprobar("administrador")).toBe(true);
    expect(puedeAprobar("tecnico")).toBe(false);
    expect(puedeAprobar("cliente")).toBe(false);
  });

  it("no se aprueba desde el portal del cliente", () => {
    expect(puedeAprobar("administrador", true)).toBe(false);
  });

  it("detecta cuando quien aprueba es quien ejecutó", () => {
    // Está permitido, pero debe quedar marcado en el registro.
    expect(esAutoaprobacion("u-coo", "u-coo")).toBe(true);
    expect(esAutoaprobacion("u-tec1", "u-coo")).toBe(false);
  });
});

const vivos: DatosVivos = {
  clienteNombre: "Transportes Reyna",
  clienteNit: "800.112.334-1",
  sedeClienteNombre: "Planta Fundación",
  vehiculoCodigo: "CA-12",
  vehiculoPlaca: "SXK-482",
  tecnicoNombre: "Carlos Méndez",
  tecnicoCedula: "1.082.334.556",
};

describe("congelado al cerrar", () => {
  it("guarda una copia con la fecha del cierre", () => {
    const c = congelar(vivos, "2026-08-23");
    expect(c.clienteNombre).toBe("Transportes Reyna");
    expect(c.congeladoEn).toBe("2026-08-23");
  });

  it("los datos congelados mandan sobre los vivos", () => {
    // El cliente cambió de razón social después de cerrar la orden.
    const congelado = congelar(vivos, "2026-08-23");
    const nuevosVivos: DatosVivos = { ...vivos, clienteNombre: "Reyna Logística S.A.S." };
    expect(resolverDatos(congelado, nuevosVivos).clienteNombre).toBe("Transportes Reyna");
  });

  it("mientras no hay congelado se usan los datos vivos", () => {
    expect(resolverDatos(null, vivos).clienteNombre).toBe("Transportes Reyna");
    expect(resolverDatos(undefined, vivos).vehiculoCodigo).toBe("CA-12");
  });
});

describe("requisitos de cierre", () => {
  it("cierra cuando están los tres requisitos", () => {
    const r = puedeCerrarse({
      tieneFirmaVigente: true,
      tieneCongelado: true,
      posicionesCapturadas: 4,
    });
    expect(r.permitido).toBe(true);
  });

  it("no cierra sin firma vigente", () => {
    const r = puedeCerrarse({
      tieneFirmaVigente: false,
      tieneCongelado: true,
      posicionesCapturadas: 4,
    });
    expect(r.codigo).toBe("SIN_FIRMA");
  });

  it("no cierra sin estampar los datos", () => {
    const r = puedeCerrarse({
      tieneFirmaVigente: true,
      tieneCongelado: false,
      posicionesCapturadas: 4,
    });
    expect(r.codigo).toBe("SIN_CONGELADO");
  });

  it("no cierra una orden sin mediciones", () => {
    const r = puedeCerrarse({
      tieneFirmaVigente: true,
      tieneCongelado: true,
      posicionesCapturadas: 0,
    });
    expect(r.codigo).toBe("SIN_MEDICIONES");
  });
});
