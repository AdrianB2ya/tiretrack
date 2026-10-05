import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { Text } from "react-native";
import { abrirBaseEnMemoria } from "../datos/conexion";
import { migrar, type Conexion } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";
import { MotorSincronizacion, type ClienteSincronizacion } from "../datos/sincronizacion";
import { ServicioSesion } from "../sesion/servicio";
import { AlmacenSeguroMemoria } from "../sesion/almacen";
import { ProveedorDatos, useDatos } from "../app/ProveedorDatos";

/**
 * Contexto de datos.
 *
 * Aquí se prueba lo que ninguna pantalla podía probar sola: que capturar sin
 * señal funcione de punta a punta y que guardar no espere a la red.
 */

let db: Conexion;
let repo: RepositorioLocal;
let sesion: ServicioSesion;

const ordenBase = {
  id: "ord-1",
  sedeId: "sede-fun",
  clienteId: "cli-1",
  sedeClienteId: "sc-1",
  vehiculoId: "veh-1",
  tecnicoId: "u-tec1",
  configuracionEjeId: "cfg-1",
  tipo: "preventivo",
  estado: "en_proceso",
  fecha: "2026-09-18",
};

const posicionesEje = [
  { numero: 1, eje: 1, lado: "izquierdo" as const, esInterna: false, tipoEje: "direccional", psiObjetivo: 110, profundidadMinima: 3 },
  { numero: 2, eje: 1, lado: "derecho" as const, esInterna: false, tipoEje: "direccional", psiObjetivo: 110, profundidadMinima: 3 },
  { numero: 3, eje: 2, lado: "izquierdo" as const, esInterna: false, tipoEje: "traccion", psiObjetivo: 105, profundidadMinima: 2.5 },
  { numero: 4, eje: 2, lado: "derecho" as const, esInterna: false, tipoEje: "traccion", psiObjetivo: 105, profundidadMinima: 2.5 },
];

/** Servidor que se puede apagar, para simular el patio sin señal. */
class ServidorSimulado implements ClienteSincronizacion {
  public sinRed = false;
  public recibidas = 0;

  async enviar() {
    if (this.sinRed) return { tipo: "sin_conexion" as const, mensaje: "sin red" };
    this.recibidas++;
    return { tipo: "aplicada" as const, folio: "OS-FUN-000001" };
  }
}

let servidor: ServidorSimulado;
let motor: MotorSincronizacion;

/** Expone el contexto para poder accionarlo desde la prueba. */
let contexto: ReturnType<typeof useDatos> | null = null;

function Sonda() {
  contexto = useDatos();
  return <Text>{contexto.cargando ? "cargando" : `ordenes:${contexto.ordenes.length}`}</Text>;
}

function montar(intervalo = 0) {
  return render(
    <ProveedorDatos
      db={db}
      sesion={sesion}
      motor={motor}
      // Servidor sin datos nuevos: estas pruebas miran lo local.
      descarga={{ traer: async () => null }}
      intervaloSincronizacionMs={intervalo}
    >
      <Sonda />
    </ProveedorDatos>,
  );
}

beforeEach(async () => {
  db = await abrirBaseEnMemoria();
  await migrar(db);
  repo = new RepositorioLocal(db);
  sesion = new ServicioSesion(new AlmacenSeguroMemoria(), db);
  servidor = new ServidorSimulado();
  motor = new MotorSincronizacion(repo, servidor);
  contexto = null;

  await repo.guardarPosicionesEje("cfg-1", posicionesEje);
});

afterEach(async () => {
  await db.cerrar();
});

describe("carga inicial", () => {
  it("lee las órdenes del dispositivo", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    montar();
    await waitFor(() => expect(screen.getByText("ordenes:1")).toBeTruthy());
  });

  it("sin órdenes no se queda cargando para siempre", async () => {
    montar();
    await waitFor(() => expect(screen.getByText("ordenes:0")).toBeTruthy());
  });

  it("cuenta las posiciones capturadas de cada orden", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });
    montar();

    await waitFor(() => expect(contexto?.ordenes).toHaveLength(1));
    expect(contexto?.ordenes[0]?.posicionesCapturadas).toBe(1);
    expect(contexto?.ordenes[0]?.posicionesTotales).toBe(4);
  });

  it("marca las órdenes con cambios sin enviar", async () => {
    await repo.guardarOrden(ordenBase);
    montar();
    await waitFor(() => expect(contexto?.ordenes).toHaveLength(1));
    expect(contexto?.ordenes[0]?.tieneCambiosSinEnviar).toBe(true);
  });
});

describe("capturar sin señal", () => {
  it("guardar termina sin esperar al servidor", async () => {
    // Es lo que permite capturar 22 posiciones seguidas bajo un camión.
    servidor.sinRed = true;
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    await act(async () => {
      await contexto?.guardarMedicion({
        ordenId: "ord-1",
        posicion: 1,
        profundidad: 9,
        capturadoPorId: "u-tec1",
      });
    });

    expect(servidor.recibidas).toBe(0);
    expect(await repo.contarMediciones("ord-1")).toBe(1);
  });

  it("una jornada completa sin señal queda encolada", async () => {
    servidor.sinRed = true;
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    await act(async () => {
      for (const posicion of [1, 2, 3, 4]) {
        await contexto?.guardarMedicion({
          ordenId: "ord-1",
          posicion,
          profundidad: 9,
          capturadoPorId: "u-tec1",
        });
      }
    });

    expect(contexto?.pendientesDeEnviar).toBe(4);
    expect(await repo.contarMediciones("ord-1")).toBe(4);
  });

  it("al volver la señal se envía todo", async () => {
    servidor.sinRed = true;
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    await act(async () => {
      for (const posicion of [1, 2, 3]) {
        await contexto?.guardarMedicion({ ordenId: "ord-1", posicion, capturadoPorId: "u-tec1" });
      }
    });

    servidor.sinRed = false;
    await act(async () => {
      await contexto?.sincronizar();
    });

    expect(servidor.recibidas).toBe(3);
    expect(contexto?.pendientesDeEnviar).toBe(0);
  });

  it("el contador de pendientes se actualiza en pantalla", async () => {
    // El técnico necesita ver cuánto le falta por enviar.
    servidor.sinRed = true;
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());
    expect(contexto?.pendientesDeEnviar).toBe(0);

    await act(async () => {
      await contexto?.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });
    });
    expect(contexto?.pendientesDeEnviar).toBe(1);
  });
});

describe("nombres de la flota", () => {
  beforeEach(async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
  });

  async function descargarFlota() {
    await repo.guardarFlota({
      clientes: [{ id: "cli-1", nombre: "Transportes Reyna", nit: "800.112.334-1" }],
      sedes: [{ id: "sc-1", clienteId: "cli-1", nombre: "Planta Fundación" }],
      vehiculos: [
        {
          id: "veh-1", sedeClienteId: "sc-1", configuracionEjeId: "cfg-1",
          codigo: "CA-12", placa: "SXK482", nombre: "Tractocamión 12", kmActual: 78900,
        },
      ],
    });
  }

  it("muestra el código del vehículo y el nombre del cliente", async () => {
    await descargarFlota();
    montar();
    await waitFor(() => expect(contexto?.ordenes).toHaveLength(1));

    expect(contexto?.ordenes[0]?.vehiculoCodigo).toBe("CA-12");
    expect(contexto?.ordenes[0]?.clienteNombre).toBe("Transportes Reyna");
  });

  it("sin flota descargada muestra el identificador, no un vacío", async () => {
    // Un código feo es más útil que una línea en blanco: al menos se puede
    // buscar y dictar por teléfono.
    montar();
    await waitFor(() => expect(contexto?.ordenes).toHaveLength(1));

    expect(contexto?.ordenes[0]?.vehiculoCodigo).toBe("veh-1");
    expect(contexto?.ordenes[0]?.clienteNombre).toBe("cli-1");
  });

  it("el detalle también trae el contexto resuelto", async () => {
    await descargarFlota();
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    const datos = await contexto?.cargarOrden("ord-1");
    expect(datos?.contexto?.vehiculoPlaca).toBe("SXK482");
    expect(datos?.contexto?.sedeClienteNombre).toBe("Planta Fundación");
  });

  it("el detalle sin flota descargada no falla", async () => {
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    const datos = await contexto?.cargarOrden("ord-1");
    expect(datos?.orden.id).toBe("ord-1");
    expect(datos?.contexto).toBeNull();
  });

  it("resuelve todas las órdenes en una sola consulta", async () => {
    // Pedirlo por orden haría una consulta de nombres por fila: con veinte
    // órdenes son veinte viajes extra a SQLite cada vez que la lista se
    // refresca. Se cuentan las consultas reales, no las llamadas al
    // repositorio: el proveedor crea el suyo y espiar el de la prueba no
    // observaría nada.
    await descargarFlota();
    for (const n of [2, 3, 4]) {
      await repo.guardarOrden({ ...ordenBase, id: `ord-${n}`, encolar: false });
    }

    let consultasDeNombres = 0;
    const original = db.consultar.bind(db);
    db.consultar = (async (sql: string, params?: readonly unknown[]) => {
      if (sql.includes("JOIN cliente c")) consultasDeNombres++;
      return original(sql, params);
    }) as typeof db.consultar;

    try {
      montar();
      await waitFor(() => expect(contexto?.ordenes).toHaveLength(4));

      expect(consultasDeNombres).toBe(1);
      expect(contexto?.ordenes.every((o) => o.vehiculoCodigo === "CA-12")).toBe(true);
    } finally {
      db.consultar = original;
    }
  });
});

describe("detalle de la orden", () => {
  beforeEach(async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
  });

  it("trae orden, mediciones y diagrama juntos", async () => {
    await repo.guardarMedicion({
      ordenId: "ord-1", posicion: 1, profundidad: 9, capturadoPorId: "u-tec1",
    });
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    const datos = await contexto?.cargarOrden("ord-1");
    expect(datos?.orden.id).toBe("ord-1");
    expect(datos?.mediciones).toHaveLength(1);
    expect(datos?.diagrama.totalPosiciones).toBe(4);
    expect(datos?.diagrama.faltantes).toEqual([2, 3, 4]);
  });

  it("el diagrama marca las que están bajo el mínimo", async () => {
    await repo.guardarMedicion({
      ordenId: "ord-1", posicion: 1, profundidad: 2, capturadoPorId: "u-tec1",
    });
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    const datos = await contexto?.cargarOrden("ord-1");
    expect(datos?.diagrama.conAlerta).toEqual([1]);
  });

  it("una orden que no existe devuelve null", async () => {
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());
    expect(await contexto?.cargarOrden("no-existe")).toBeNull();
  });
});

describe("catálogo por niveles", () => {
  beforeEach(async () => {
    await repo.guardarCatalogo({
      marcas: [{ id: "mar-1", nombre: "Michelin", esGlobal: true, creadaLocal: false }],
      disenos: [
        { id: "dis-1", marcaId: "mar-1", nombre: "XZY-3", tipoEje: "direccional", creadaLocal: false },
        { id: "dis-2", marcaId: "mar-1", nombre: "XDN-2", tipoEje: "traccion", creadaLocal: false },
      ],
      medidas: [{ id: "med-1", disenoId: "dis-1", medida: "295/80R22.5", profundidadOriginal: 16 }],
    });
  });

  it("sin marca elegida no carga diseños ni medidas", async () => {
    // Un catálogo completo puede tener miles de medidas: cargarlas para
    // elegir una es tiempo de pantalla en blanco frente al camión.
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    const c = await contexto?.catalogoPara(null, null, "direccional");
    expect(c?.marcas).toHaveLength(1);
    expect(c?.disenos).toEqual([]);
    expect(c?.medidas).toEqual([]);
  });

  it("con marca elegida carga sus diseños, ordenados por tipo de eje", async () => {
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    const c = await contexto?.catalogoPara("mar-1", null, "traccion");
    expect(c?.disenos[0]?.nombre).toBe("XDN-2");
  });

  it("con diseño elegido carga sus medidas", async () => {
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    const c = await contexto?.catalogoPara("mar-1", "dis-1", "direccional");
    expect(c?.medidas).toHaveLength(1);
    expect(c?.medidas[0]?.profundidadOriginal).toBe(16);
  });
});

describe("cambio de estado", () => {
  it("intenta enviarlo pronto: el coordinador lo está esperando", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    await act(async () => {
      await contexto?.cambiarEstado("ord-1", "en_revision");
    });
    await waitFor(() => expect(servidor.recibidas).toBeGreaterThan(0));
  });

  it("sin señal no se pierde: queda encolado", async () => {
    servidor.sinRed = true;
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    await act(async () => {
      await contexto?.cambiarEstado("ord-1", "en_revision");
    });
    expect(await repo.contarPendientes()).toBe(1);
    expect((await repo.buscarOrden("ord-1"))?.estado).toBe("en_revision");
  });
});

describe("sincronización en segundo plano", () => {
  it("no se dispara al guardar cada posición", async () => {
    // Con 22 posiciones serían 22 intentos; en señal intermitente cada uno
    // gasta batería y datos para fallar igual.
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    await act(async () => {
      for (const posicion of [1, 2, 3]) {
        await contexto?.guardarMedicion({ ordenId: "ord-1", posicion, capturadoPorId: "u-tec1" });
      }
    });
    expect(servidor.recibidas).toBe(0);
  });

  it("corre sola cada cierto tiempo", async () => {
    vi.useFakeTimers();
    try {
      await repo.guardarOrden(ordenBase);
      montar(1000);
      await vi.advanceTimersByTimeAsync(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      expect(servidor.recibidas).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no arranca dos a la vez", async () => {
    await repo.guardarOrden(ordenBase);
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    await act(async () => {
      await Promise.all([contexto?.sincronizar(), contexto?.sincronizar()]);
    });
    // La segunda devuelve null sin enviar nada
    expect(servidor.recibidas).toBe(1);
  });
});

describe("uso fuera del proveedor", () => {
  it("falla claro y temprano", () => {
    // Un contexto ausente produce pantallas vacías sin explicación.
    const silenciar = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => render(<Sonda />)).toThrow(/ProveedorDatos/);
    } finally {
      silenciar.mockRestore();
    }
  });
});

describe("bandeja del coordinador", () => {
  beforeEach(async () => {
    await repo.guardarFlota({
      clientes: [{ id: "cli-1", nombre: "Transportes Reyna", nit: null }],
      sedes: [{ id: "sc-1", clienteId: "cli-1", nombre: "Planta Fundación" }],
      vehiculos: [
        {
          id: "veh-1", sedeClienteId: "sc-1", configuracionEjeId: "cfg-1",
          codigo: "CA-12", placa: "SXK482", nombre: "Tractocamión", kmActual: 0,
        },
      ],
    });
    await repo.guardarTecnicos([
      { id: "u-tec1", nombre: "Carlos Méndez", sedeId: "sede-fun", activo: true },
      { id: "u-tec2", nombre: "Ana Torres", sedeId: "sede-fun", activo: true },
    ]);
  });

  it("trae solo las órdenes que esperan revisión", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.guardarOrden({ ...ordenBase, id: "ord-2", estado: "cerrada", encolar: false });
    await repo.cambiarEstado("ord-1", "en_revision");

    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    const bandeja = await contexto?.bandejaRevision();
    expect(bandeja).toHaveLength(1);
    expect(bandeja?.[0]?.orden.id).toBe("ord-1");
  });

  it("incluye el diagrama para poder ver el avance sin abrir", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });
    await repo.cambiarEstado("ord-1", "en_revision");

    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    const bandeja = await contexto?.bandejaRevision();
    expect(bandeja?.[0]?.diagrama.capturadas).toBe(1);
    expect(bandeja?.[0]?.diagrama.totalPosiciones).toBe(4);
  });

  it("resuelve vehículo y cliente", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.cambiarEstado("ord-1", "en_revision");

    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    const bandeja = await contexto?.bandejaRevision();
    expect(bandeja?.[0]?.vehiculoCodigo).toBe("CA-12");
    expect(bandeja?.[0]?.clienteNombre).toBe("Transportes Reyna");
  });

  it("calcula los días de espera contra el reloj del dispositivo", async () => {
    // El coordinador revisa sin señal: no puede depender de que el servidor
    // le diga cuánto lleva esperando cada orden.
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.cambiarEstado("ord-1", "en_revision");
    await db.ejecutar(
      `UPDATE orden SET enviada_revision_en = ? WHERE id = 'ord-1'`,
      [new Date(Date.now() - 3 * 86_400_000).toISOString()],
    );

    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    const bandeja = await contexto?.bandejaRevision();
    expect(bandeja?.[0]?.diasEsperando).toBe(3);
  });

  it("muestra quién ejecutó la orden, no quién la tiene ahora", async () => {
    // Si se reasignó, el coordinador necesita saber de quién fue el trabajo.
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.cambiarEstado("ord-1", "en_revision");
    await repo.reasignar("ord-1", "u-tec2", "Rotación de turno");

    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    const bandeja = await contexto?.bandejaRevision();
    expect(bandeja?.[0]?.tecnicoNombre).toBe("Carlos Méndez");
    expect(bandeja?.[0]?.orden.tecnicoId).toBe("u-tec2");
  });

  it("trae los técnicos de la sede para reasignar", async () => {
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    const tecnicos = await contexto?.tecnicosDeSede("sede-fun");
    expect(tecnicos?.map((t) => t.nombre)).toEqual(["Ana Torres", "Carlos Méndez"]);
  });

  it("reasignar cambia el técnico y encola la operación", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    montar();
    await waitFor(() => expect(contexto).not.toBeNull());

    await act(async () => {
      await contexto?.reasignar("ord-1", "u-tec2", "Carlos está incapacitado");
    });

    expect((await repo.buscarOrden("ord-1"))?.tecnicoId).toBe("u-tec2");
  });
});
