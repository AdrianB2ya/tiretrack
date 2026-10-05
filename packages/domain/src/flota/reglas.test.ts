import { describe, it, expect } from "vitest";
import {
  puedeGestionarFlota,
  puedeGestionarConfiguraciones,
  validarConfiguracion,
  siguienteVersion,
  evaluarNuevaVersion,
  puedeDesactivar,
  cadenaCoherente,
  evaluarKilometraje,
  type ConfiguracionExistente,
} from "./reglas";
import type { DefinicionEje } from "../llanta/medicion";

const montacargas: DefinicionEje[] = [
  {
    numero: 1,
    tipoEje: "direccional",
    psiObjetivo: 110,
    profundidadMinima: 3,
    posicionesIzquierda: [1],
    posicionesDerecha: [2],
  },
  {
    numero: 2,
    tipoEje: "traccion",
    psiObjetivo: 105,
    profundidadMinima: 2.5,
    posicionesIzquierda: [3],
    posicionesDerecha: [4],
  },
];

describe("permisos sobre la flota", () => {
  it("administrador y coordinador gestionan clientes y vehículos", () => {
    expect(puedeGestionarFlota("administrador")).toBe(true);
    expect(puedeGestionarFlota("coordinador")).toBe(true);
    expect(puedeGestionarFlota("tecnico")).toBe(false);
    expect(puedeGestionarFlota("cliente")).toBe(false);
  });

  it("solo el administrador define plantillas de eje", () => {
    // Son estructura, no operación: una plantilla mal hecha rompe el
    // diagrama de todos los vehículos que la usan.
    expect(puedeGestionarConfiguraciones("administrador")).toBe(true);
    expect(puedeGestionarConfiguraciones("coordinador")).toBe(false);
  });
});

describe("validación de configuraciones de eje", () => {
  it("acepta una configuración coherente", () => {
    expect(validarConfiguracion(montacargas).permitido).toBe(true);
  });

  it("rechaza una sin ejes", () => {
    expect(validarConfiguracion([]).codigo).toBe("SIN_EJES");
  });

  it("rechaza posiciones con huecos", () => {
    const conHueco: DefinicionEje[] = [
      { numero: 1, tipoEje: "direccional", posicionesIzquierda: [1], posicionesDerecha: [2] },
      { numero: 2, tipoEje: "traccion", posicionesIzquierda: [5], posicionesDerecha: [6] },
    ];
    expect(validarConfiguracion(conHueco).codigo).toBe("POSICIONES_INCOHERENTES");
  });

  it("rechaza posiciones repetidas", () => {
    const repetida: DefinicionEje[] = [
      { numero: 1, tipoEje: "direccional", posicionesIzquierda: [1], posicionesDerecha: [2] },
      { numero: 2, tipoEje: "traccion", posicionesIzquierda: [2], posicionesDerecha: [3] },
    ];
    expect(validarConfiguracion(repetida).codigo).toBe("POSICIONES_INCOHERENTES");
  });

  it("rechaza dos ejes con el mismo número", () => {
    const duplicado: DefinicionEje[] = [
      { numero: 1, tipoEje: "direccional", posicionesIzquierda: [1], posicionesDerecha: [2] },
      { numero: 1, tipoEje: "traccion", posicionesIzquierda: [3], posicionesDerecha: [4] },
    ];
    expect(validarConfiguracion(duplicado).codigo).toBe("EJES_REPETIDOS");
  });

  it("rechaza umbrales imposibles", () => {
    const psiMala = [{ ...montacargas[0], psiObjetivo: 900 }] as DefinicionEje[];
    expect(validarConfiguracion(psiMala).codigo).toBe("PSI_FUERA_DE_RANGO");

    const profMala = [{ ...montacargas[0], profundidadMinima: 200 }] as DefinicionEje[];
    expect(validarConfiguracion(profMala).codigo).toBe("PROFUNDIDAD_FUERA_DE_RANGO");
  });

  it("permite umbrales sin definir", () => {
    const sinUmbrales: DefinicionEje[] = [
      { numero: 1, tipoEje: "multiuso", posicionesIzquierda: [1], posicionesDerecha: [2] },
    ];
    expect(validarConfiguracion(sinUmbrales).permitido).toBe(true);
  });
});

describe("versionado de plantillas", () => {
  const v1: ConfiguracionExistente = {
    id: "cfg-1",
    nombre: "Montacargas",
    version: 1,
    vigente: true,
    totalPosiciones: 4,
  };

  it("la primera versión es la 1", () => {
    expect(siguienteVersion([])).toBe(1);
  });

  it("cada cambio incrementa la versión", () => {
    expect(siguienteVersion([v1])).toBe(2);
    expect(siguienteVersion([v1, { ...v1, version: 5 }])).toBe(6);
  });

  it("no requiere confirmación si nadie la usa", () => {
    const r = evaluarNuevaVersion({
      anterior: v1,
      ejesNuevos: montacargas,
      vehiculosQueLaUsan: 0,
    });
    expect(r.requiereConfirmacion).toBe(false);
  });

  it("no requiere confirmación si el total de posiciones no cambia", () => {
    const r = evaluarNuevaVersion({
      anterior: v1,
      ejesNuevos: montacargas, // sigue teniendo 4
      vehiculosQueLaUsan: 3,
    });
    expect(r.requiereConfirmacion).toBe(false);
  });

  it("avisa si cambia el número de posiciones y hay vehículos usándola", () => {
    // Esos vehículos pasan a dibujarse distinto: debe ser consciente.
    const seisPosiciones: DefinicionEje[] = [
      ...montacargas,
      { numero: 3, tipoEje: "arrastre", posicionesIzquierda: [5], posicionesDerecha: [6] },
    ];
    const r = evaluarNuevaVersion({
      anterior: v1,
      ejesNuevos: seisPosiciones,
      vehiculosQueLaUsan: 3,
    });
    expect(r.requiereConfirmacion).toBe(true);
    expect(r.aviso).toContain("3 vehículo");
    expect(r.aviso).toContain("4");
    expect(r.aviso).toContain("6");
  });

  it("una configuración inválida no llega a pedir confirmación", () => {
    const r = evaluarNuevaVersion({
      anterior: v1,
      ejesNuevos: [],
      vehiculosQueLaUsan: 3,
    });
    expect(r.veredicto.permitido).toBe(false);
    expect(r.requiereConfirmacion).toBe(false);
  });
});

describe("desactivación", () => {
  it("permite desactivar lo que no tiene uso", () => {
    expect(puedeDesactivar("cliente", { ordenesAbiertas: 0, hijosActivos: 0 }).permitido).toBe(true);
  });

  it("no desactiva con órdenes abiertas", () => {
    // Quedarían órdenes apuntando a algo que ya no sale en ningún selector
    // y nadie podría cerrarlas.
    for (const e of ["cliente", "sede", "vehiculo"] as const) {
      const r = puedeDesactivar(e, { ordenesAbiertas: 2, hijosActivos: 0 });
      expect(r.codigo).toBe("TIENE_ORDENES_ABIERTAS");
    }
  });

  it("obliga a desactivar primero los hijos", () => {
    const cliente = puedeDesactivar("cliente", { ordenesAbiertas: 0, hijosActivos: 2 });
    expect(cliente.codigo).toBe("TIENE_HIJOS_ACTIVOS");
    expect(cliente.mensaje).toContain("sedes");

    const sede = puedeDesactivar("sede", { ordenesAbiertas: 0, hijosActivos: 3 });
    expect(sede.mensaje).toContain("vehículos");
  });

  it("el vehículo no tiene hijos que revisar", () => {
    const r = puedeDesactivar("vehiculo", { ordenesAbiertas: 0, hijosActivos: 5 });
    expect(r.permitido).toBe(true);
  });

  it("las órdenes abiertas pesan más que los hijos", () => {
    const r = puedeDesactivar("cliente", { ordenesAbiertas: 1, hijosActivos: 1 });
    expect(r.codigo).toBe("TIENE_ORDENES_ABIERTAS");
  });
});

describe("coherencia de la cadena", () => {
  it("acepta un vehículo del cliente elegido", () => {
    const r = cadenaCoherente({ clienteIdDelVehiculo: "cli-1", clienteIdElegido: "cli-1" });
    expect(r.permitido).toBe(true);
  });

  it("rechaza un vehículo de otro cliente", () => {
    // La base lo impide con llaves compuestas; esto da el mensaje útil antes.
    const r = cadenaCoherente({ clienteIdDelVehiculo: "cli-2", clienteIdElegido: "cli-1" });
    expect(r.codigo).toBe("VEHICULO_DE_OTRO_CLIENTE");
  });
});

describe("kilometraje", () => {
  it("acepta un avance normal", () => {
    const r = evaluarKilometraje(78900, 78000);
    expect(r.veredicto.permitido).toBe(true);
    expect(r.requiereConfirmacion).toBe(false);
  });

  it("acepta el mismo valor", () => {
    expect(evaluarKilometraje(78000, 78000).requiereConfirmacion).toBe(false);
  });

  it("avisa si retrocede, pero no bloquea", () => {
    // Cambiar el odómetro es real y frecuente en flotas viejas.
    const r = evaluarKilometraje(1200, 78000);
    expect(r.veredicto.permitido).toBe(true);
    expect(r.requiereConfirmacion).toBe(true);
  });

  it("rechaza un valor negativo", () => {
    expect(evaluarKilometraje(-5, 100).veredicto.codigo).toBe("KM_NEGATIVO");
  });
});
