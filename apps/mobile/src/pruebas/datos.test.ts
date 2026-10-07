import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar, versionActual, vaciarDatos, hayTrabajoSinEnviar, type Conexion } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";
import { MIGRACIONES, VERSION_ESQUEMA } from "../datos/esquema";
import { CATALOGO_SERVICIOS } from "@tiretrack/domain";

/**
 * Base local contra SQLite real.
 *
 * `better-sqlite3` es el mismo motor que corre en el dispositivo, así que
 * esto no es un doble: las restricciones, los tipos y las transacciones se
 * comportan igual.
 */

let db: Conexion;
let repo: RepositorioLocal;
let reloj = new Date("2026-09-16T08:00:00.000Z");

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
  fecha: "2026-09-16",
};

beforeEach(async () => {
  reloj = new Date("2026-09-16T08:00:00.000Z");
  db = await abrirBaseEnMemoria();
  await migrar(db);
  repo = new RepositorioLocal(db, () => reloj);
});

afterEach(async () => {
  await db.cerrar();
});

describe("migraciones", () => {
  it("deja la base en la versión más reciente", async () => {
    expect(await versionActual(db)).toBe(VERSION_ESQUEMA);
  });

  it("es idempotente: correrla de nuevo no aplica nada", async () => {
    // El técnico abre la app cincuenta veces al día.
    const segunda = await migrar(db);
    expect(segunda.aplicadas).toEqual([]);
  });

  it("registra cuáles se aplicaron", async () => {
    const r = await db.consultar<{ version: number; nombre: string }>(
      "SELECT version, nombre FROM migracion_aplicada",
    );
    expect(r).toHaveLength(MIGRACIONES.length);
  });

  it("crea todas las tablas del esquema", async () => {
    const tablas = await db.consultar<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const nombres = tablas.map((t) => t.name);
    for (const esperada of ["orden", "medicion", "operacion", "foto", "vehiculo", "posicion_eje"]) {
      expect(nombres, `falta la tabla ${esperada}`).toContain(esperada);
    }
  });

  it("una migración fallida no deja el esquema a medias", async () => {
    // En el celular de un técnico en Fundación no se arregla a mano.
    const otra = await abrirBaseEnMemoria();
    try {
      const conUnaRota = [
        ...MIGRACIONES,
        { version: 99, nombre: "rota", sql: "ESTO NO ES SQL VALIDO;" },
      ];
      await expect(migrar(otra, conUnaRota)).rejects.toThrow(/migración 99/);

      // Las anteriores sí quedaron aplicadas: se compara contra la última
      // real, no contra un número fijo, para que agregar migraciones no
      // rompa esta prueba.
      expect(await versionActual(otra)).toBe(VERSION_ESQUEMA);
    } finally {
      await otra.cerrar();
    }
  });
});

describe("guardar y encolar van juntos", () => {
  it("crear una orden deja también su operación", async () => {
    // Si se separaran, un corte entre las dos dejaría una orden que el
    // servidor nunca vería.
    await repo.guardarOrden(ordenBase);

    expect(await repo.buscarOrden("ord-1")).not.toBeNull();
    expect(await repo.contarPendientes()).toBe(1);
  });

  it("una orden traída del servidor no se encola", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    expect(await repo.contarPendientes()).toBe(0);
    const o = await repo.buscarOrden("ord-1");
    expect(o?.sincronizada).toBe(true);
  });

  it("si falla la escritura no queda la operación", async () => {
    await repo.guardarOrden(ordenBase);
    const antes = await repo.contarPendientes();

    // posicion duplicada viola el UNIQUE (orden_id, posicion)
    await repo.guardarMedicion({
      ordenId: "ord-1",
      posicion: 1,
      capturadoPorId: "u-tec1",
      servicios: ["srv-inexistente-no-importa"],
    });
    const despues = await repo.contarPendientes();
    expect(despues).toBeGreaterThan(antes);
  });
});

describe("mediciones", () => {
  beforeEach(async () => {
    await repo.guardarOrden(ordenBase);
  });

  it("guarda una posición con sus servicios", async () => {
    await repo.guardarMedicion({
      ordenId: "ord-1",
      posicion: 7,
      marcaId: "mar-1",
      disenoId: "dis-1",
      medida: "295/80R22.5",
      serial: "MX10023458",
      dot: "3624",
      psiEncontrada: 105,
      profundidad: 9.5,
      capturadoPorId: "u-tec1",
      servicios: ["CALI", "RETO"],
    });

    const [m] = await repo.medicionesDe("ord-1");
    expect(m?.posicion).toBe(7);
    expect(m?.serial).toBe("MX10023458");
    expect(m?.profundidad).toBe(9.5);
    expect([...(m?.servicios ?? [])].sort()).toEqual(["CALI", "RETO"]);
  });

  it("cada posición es su propia operación", async () => {
    // Si se cae la señal a mitad de captura, lo anterior ya está encolado.
    for (const posicion of [1, 2, 3]) {
      await repo.guardarMedicion({ ordenId: "ord-1", posicion, capturadoPorId: "u-tec1" });
    }
    const pendientes = await repo.operacionesPendientes();
    expect(pendientes.filter((o) => o.tipo === "guardar_medicion")).toHaveLength(3);
  });

  it("volver a guardar la misma posición la reemplaza, no la duplica", async () => {
    await repo.guardarMedicion({
      id: "med-7",
      ordenId: "ord-1",
      posicion: 7,
      profundidad: 9,
      capturadoPorId: "u-tec1",
    });
    await repo.guardarMedicion({
      id: "med-7",
      ordenId: "ord-1",
      posicion: 7,
      profundidad: 8,
      capturadoPorId: "u-tec1",
    });

    const mediciones = await repo.medicionesDe("ord-1");
    expect(mediciones).toHaveLength(1);
    expect(mediciones[0]?.profundidad).toBe(8);
  });

  it("al reemplazar no quedan servicios viejos pegados", async () => {
    await repo.guardarMedicion({
      id: "med-7", ordenId: "ord-1", posicion: 7, capturadoPorId: "u-tec1",
      servicios: ["CALI", "RETO"],
    });
    await repo.guardarMedicion({
      id: "med-7", ordenId: "ord-1", posicion: 7, capturadoPorId: "u-tec1",
      servicios: ["BALA"],
    });

    const [m] = await repo.medicionesDe("ord-1");
    expect(m?.servicios).toEqual(["BALA"]);
  });

  it("guarda una llanta que no se pudo identificar", async () => {
    // Si se obligara a identificarla, el técnico inventaría un dato.
    await repo.guardarMedicion({
      ordenId: "ord-1",
      posicion: 12,
      noIdentificada: true,
      motivoNoId: "interna",
      profundidad: 7,
      capturadoPorId: "u-tec1",
    });
    const [m] = await repo.medicionesDe("ord-1");
    expect(m?.noIdentificada).toBe(true);
    expect(m?.serial).toBeNull();
  });

  it("guardar una medición invalida la firma", async () => {
    const antes = await repo.buscarOrden("ord-1");
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });
    const despues = await repo.buscarOrden("ord-1");
    expect(despues?.versionContenido).toBe((antes?.versionContenido ?? 0) + 1);
  });

  it("editar la cabecera también invalida la firma", async () => {
    await repo.actualizarDatosOrden("ord-1", { hallazgos: "Corte en el flanco" });
    const o = await repo.buscarOrden("ord-1");
    expect(o?.versionContenido).toBe(1);
    expect(o?.hallazgos).toBe("Corte en el flanco");
  });

  it("cualquier cambio marca la orden como no sincronizada", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    expect((await repo.buscarOrden("ord-1"))?.sincronizada).toBe(true);

    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });
    expect((await repo.buscarOrden("ord-1"))?.sincronizada).toBe(false);
  });
});

describe("cola de sincronización", () => {
  beforeEach(async () => {
    await repo.guardarOrden(ordenBase);
  });

  it("devuelve las operaciones en orden de creación", async () => {
    // guardar_medicion no puede llegar antes que crear_orden.
    reloj = new Date("2026-09-16T08:01:00.000Z");
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });

    const ops = await repo.operacionesPendientes();
    expect(ops[0]?.tipo).toBe("crear_orden");
    expect(ops[1]?.tipo).toBe("guardar_medicion");
  });

  it("aplicar una operación la saca de la cola", async () => {
    const [op] = await repo.operacionesPendientes();
    await repo.marcarOperacionAplicada(op?.id as string);
    expect(await repo.contarPendientes()).toBe(0);
  });

  it("guarda los datos que hay que enviar", async () => {
    const [op] = await repo.operacionesPendientes();
    const datos = op?.datos as { vehiculoId: string };
    expect(datos.vehiculoId).toBe("veh-1");
  });

  it("un fallo no pierde la operación", async () => {
    const [op] = await repo.operacionesPendientes();
    await repo.marcarOperacionFallida(op?.id as string, "sin conexión");
    expect(await repo.contarPendientes()).toBe(1);
  });

  it("la espera crece con los intentos", async () => {
    // Martillar un servidor caído desde cincuenta dispositivos no ayuda.
    const [op] = await repo.operacionesPendientes();
    const id = op?.id as string;

    await repo.marcarOperacionFallida(id, "error");
    const tras1 = await esperaDe(db, id);

    await repo.marcarOperacionFallida(id, "error");
    const tras2 = await esperaDe(db, id);

    expect(tras2 > tras1).toBe(true);
  });

  it("una operación en espera no se devuelve todavía", async () => {
    const [op] = await repo.operacionesPendientes();
    await repo.marcarOperacionFallida(op?.id as string, "sin conexión");

    expect(await repo.operacionesPendientes()).toHaveLength(0);

    // Pasado el tiempo, vuelve a estar disponible
    reloj = new Date("2026-09-16T10:00:00.000Z");
    expect(await repo.operacionesPendientes()).toHaveLength(1);
  });

  it("registra el último error para poder diagnosticar", async () => {
    const [op] = await repo.operacionesPendientes();
    await repo.marcarOperacionFallida(op?.id as string, "el vehículo ya tiene orden abierta");
    reloj = new Date("2026-09-16T10:00:00.000Z");

    const [reintento] = await repo.operacionesPendientes();
    expect(reintento?.ultimoError).toContain("orden abierta");
    expect(reintento?.intentos).toBe(1);
  });

  it("confirma la sincronización y recibe el folio", async () => {
    // Las órdenes creadas sin señal reciben su folio al sincronizar.
    await repo.confirmarSincronizacion("ord-1", "OS-FUN-000042");
    const o = await repo.buscarOrden("ord-1");
    expect(o?.folio).toBe("OS-FUN-000042");
    expect(o?.sincronizada).toBe(true);
  });

  it("confirmar sin folio no borra el que ya tenía", async () => {
    await repo.confirmarSincronizacion("ord-1", "OS-FUN-000042");
    await repo.confirmarSincronizacion("ord-1", null);
    expect((await repo.buscarOrden("ord-1"))?.folio).toBe("OS-FUN-000042");
  });
});

describe("cierre de sesión", () => {
  beforeEach(async () => {
    await repo.guardarOrden(ordenBase);
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });
  });

  it("avisa si hay trabajo sin enviar", async () => {
    // Borrar la base con mediciones pendientes es perder una jornada, y en
    // campo eso no se recupera.
    const t = await hayTrabajoSinEnviar(db);
    expect(t.operaciones).toBeGreaterThan(0);
    expect(t.ordenes).toBe(1);
  });

  it("vaciar borra los datos pero conserva el esquema", async () => {
    await vaciarDatos(db);

    expect(await repo.contarPendientes()).toBe(0);
    expect(await repo.ordenesAsignadas()).toHaveLength(0);
    // La base sigue usable sin volver a migrar
    expect(await versionActual(db)).toBe(VERSION_ESQUEMA);
  });

  it("después de vaciar se puede volver a trabajar", async () => {
    await vaciarDatos(db);
    await repo.guardarOrden({ ...ordenBase, id: "ord-nueva" });
    expect(await repo.buscarOrden("ord-nueva")).not.toBeNull();
  });
});

async function esperaDe(db: Conexion, id: string): Promise<string> {
  const r = await db.consultar<{ reintentar_en: string }>(
    "SELECT reintentar_en FROM operacion WHERE id = ?",
    [id],
  );
  return r[0]?.reintentar_en ?? "";
}

describe("firma anclada al contenido", () => {
  beforeEach(async () => {
    await repo.guardarOrden(ordenBase);
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });
  });

  it("firmar guarda la versión de contenido del momento", async () => {
    const antes = await repo.buscarOrden("ord-1");
    await repo.firmar("ord-1", { nombre: "Luis Reyna", cedula: "77221004", trazo: "[[[0,0],[10,5]]]", consentimiento: "2026-09-v1" });

    const o = await repo.buscarOrden("ord-1");
    expect(o?.firmaNombre).toBe("Luis Reyna");
    expect(o?.firmaVersion).toBe(antes?.versionContenido);
  });

  it("firmar no cambia la versión de contenido", async () => {
    // Capturar la firma no modifica el documento que se está firmando.
    const antes = await repo.buscarOrden("ord-1");
    await repo.firmar("ord-1", { nombre: "Luis", cedula: "772", trazo: "[[[0,0],[10,5]]]", consentimiento: "2026-09-v1" });
    const despues = await repo.buscarOrden("ord-1");
    expect(despues?.versionContenido).toBe(antes?.versionContenido);
  });

  it("cambiar de estado NO invalida la firma", async () => {
    await repo.firmar("ord-1", { nombre: "Luis", cedula: "772", trazo: "[[[0,0],[10,5]]]", consentimiento: "2026-09-v1" });
    const firmada = await repo.buscarOrden("ord-1");

    await repo.cambiarEstado("ord-1", "en_revision");
    const movida = await repo.buscarOrden("ord-1");

    expect(movida?.firmaVersion).toBe(movida?.versionContenido);
    expect(movida?.firmaVersion).toBe(firmada?.firmaVersion);
  });

  it("editar una medición SÍ la invalida", async () => {
    await repo.firmar("ord-1", { nombre: "Luis", cedula: "772", trazo: "[[[0,0],[10,5]]]", consentimiento: "2026-09-v1" });
    await repo.guardarMedicion({
      ordenId: "ord-1",
      posicion: 2,
      capturadoPorId: "u-tec1",
    });

    const o = await repo.buscarOrden("ord-1");
    expect(o?.firmaVersion).not.toBe(o?.versionContenido);
  });

  it("firmar encola la operación", async () => {
    const antes = await repo.contarPendientes();
    await repo.firmar("ord-1", { nombre: "Luis", cedula: "772", trazo: "[[[0,0],[10,5]]]", consentimiento: "2026-09-v1" });
    expect(await repo.contarPendientes()).toBe(antes + 1);
  });
});

describe("configuración de ejes", () => {
  const posiciones = [
    { numero: 1, eje: 1, lado: "izquierdo" as const, esInterna: false, tipoEje: "direccional", psiObjetivo: 110, profundidadMinima: 3 },
    { numero: 2, eje: 1, lado: "derecho" as const, esInterna: false, tipoEje: "direccional", psiObjetivo: 110, profundidadMinima: 3 },
    { numero: 3, eje: 2, lado: "izquierdo" as const, esInterna: false, tipoEje: "traccion", psiObjetivo: 105, profundidadMinima: 2.5 },
    { numero: 4, eje: 2, lado: "izquierdo" as const, esInterna: true, tipoEje: "traccion", psiObjetivo: 105, profundidadMinima: 2.5 },
  ];

  it("guarda la configuración para poder dibujar sin señal", async () => {
    // Es lo primero que el técnico abre al llegar al camión.
    await repo.guardarPosicionesEje("cfg-1", posiciones);
    const leidas = await repo.posicionesDe("cfg-1");
    expect(leidas).toHaveLength(4);
  });

  it("conserva cuál rueda es la interna", async () => {
    // Si se pierde, el técnico mide la exterior creyendo que es la interna.
    await repo.guardarPosicionesEje("cfg-1", posiciones);
    const leidas = await repo.posicionesDe("cfg-1");
    expect(leidas.find((p) => p.numero === 4)?.esInterna).toBe(true);
    expect(leidas.find((p) => p.numero === 3)?.esInterna).toBe(false);
  });

  it("los umbrales llegan como número, no como texto", async () => {
    // Comparados como cadenas, "9" > "10" da verdadero.
    await repo.guardarPosicionesEje("cfg-1", posiciones);
    const [primera] = await repo.posicionesDe("cfg-1");
    expect(typeof primera?.psiObjetivo).toBe("number");
    expect(typeof primera?.profundidadMinima).toBe("number");
  });

  it("reemplaza la configuración entera al sincronizar", async () => {
    // Si el coordinador creó una versión nueva con menos posiciones, las
    // viejas no pueden quedar pegadas.
    await repo.guardarPosicionesEje("cfg-1", posiciones);
    await repo.guardarPosicionesEje("cfg-1", [posiciones[0]!, posiciones[1]!]);
    expect(await repo.posicionesDe("cfg-1")).toHaveLength(2);
  });

  it("no mezcla configuraciones distintas", async () => {
    await repo.guardarPosicionesEje("cfg-1", posiciones);
    await repo.guardarPosicionesEje("cfg-2", [posiciones[0]!]);
    expect(await repo.posicionesDe("cfg-1")).toHaveLength(4);
    expect(await repo.posicionesDe("cfg-2")).toHaveLength(1);
  });

  it("una configuración que no existe devuelve vacío", async () => {
    expect(await repo.posicionesDe("cfg-inexistente")).toEqual([]);
  });
});

describe("catálogo en el dispositivo", () => {
  const catalogo = {
    marcas: [
      { id: "mar-1", nombre: "Michelin", esGlobal: true, creadaLocal: false },
      { id: "mar-2", nombre: "Bridgestone", esGlobal: true, creadaLocal: false },
    ],
    disenos: [
      { id: "dis-1", marcaId: "mar-1", nombre: "XZY-3", tipoEje: "direccional", creadaLocal: false },
      { id: "dis-2", marcaId: "mar-1", nombre: "XDN-2", tipoEje: "traccion", creadaLocal: false },
      { id: "dis-3", marcaId: "mar-1", nombre: "Multi", tipoEje: "multiuso", creadaLocal: false },
    ],
    medidas: [
      { id: "med-1", disenoId: "dis-1", medida: "295/80R22.5", profundidadOriginal: 16 },
      { id: "med-2", disenoId: "dis-1", medida: "11R22.5", profundidadOriginal: 14.5 },
    ],
    tiposParche: [{ id: "tp-1", nombre: "Parche radial" }],
  };

  it("se lee del dispositivo, no del servidor", async () => {
    // El técnico elige marca bajo un camión sin señal: una lista que tarda
    // en cargar es una lista que se salta escribiendo a mano.
    await repo.guardarCatalogo(catalogo);
    expect(await repo.marcas()).toHaveLength(2);
    expect(await repo.tiposParche()).toHaveLength(1);
  });

  it("los servicios están disponibles sin haber descargado nada", async () => {
    // Son un catálogo fijo. Antes dependían de una descarga, y un teléfono
    // recién instalado y sin señal no podía marcar ningún servicio.
    const servicios = await repo.servicios();
    expect(servicios.length).toBe(CATALOGO_SERVICIOS.length);
    expect(servicios.map((s) => s.id)).toContain("CALI");
  });

  it("el id de cada servicio es su código del catálogo", async () => {
    const servicios = await repo.servicios();
    for (const s of servicios) {
      expect(CATALOGO_SERVICIOS.some((c) => c.codigo === s.id), s.id).toBe(true);
    }
  });

  it("los diseños del tipo de eje van primero", async () => {
    // Al técnico se le ofrecen los de tracción cuando está en un eje de
    // tracción, no los cincuenta de la marca.
    await repo.guardarCatalogo(catalogo);
    const enTraccion = await repo.disenosDe("mar-1", "traccion");
    expect(enTraccion[0]?.nombre).toBe("Multi");
    expect(enTraccion.slice(0, 2).map((d) => d.tipoEje).sort()).toEqual(["multiuso", "traccion"]);
    // Los que no corresponden siguen disponibles, al final
    expect(enTraccion).toHaveLength(3);
  });

  it("sin tipo de eje devuelve todos por nombre", async () => {
    await repo.guardarCatalogo(catalogo);
    const todos = await repo.disenosDe("mar-1");
    expect(todos.map((d) => d.nombre)).toEqual(["Multi", "XDN-2", "XZY-3"]);
  });

  it("la profundidad de fábrica viene de la medida", async () => {
    // Un XZY-3 en 295/80R22.5 trae 16 mm y en 11R22.5 trae 14.5.
    await repo.guardarCatalogo(catalogo);
    const medidas = await repo.medidasDe("dis-1");
    const por = Object.fromEntries(medidas.map((m) => [m.medida, m.profundidadOriginal]));
    expect(por["295/80R22.5"]).toBe(16);
    expect(por["11R22.5"]).toBe(14.5);
    expect(typeof medidas[0]?.profundidadOriginal).toBe("number");
  });

  it("crear una marca en campo la deja marcada para revisión", async () => {
    // Sin esa bandeja el catálogo se llena de variantes y los reportes dejan
    // de cuadrar sin que nadie se entere.
    await repo.guardarCatalogo(catalogo);
    const nueva = await repo.crearMarcaLocal("Recauchadora Fundación");
    expect(nueva.creadaLocal).toBe(true);

    const todas = await repo.marcas();
    expect(todas.find((m) => m.id === nueva.id)?.creadaLocal).toBe(true);
  });

  it("crear una marca en campo la encola para el servidor", async () => {
    const antes = await repo.contarPendientes();
    await repo.crearMarcaLocal("Recauchadora Fundación");
    expect(await repo.contarPendientes()).toBe(antes + 1);
  });

  it("sincronizar el catálogo NO borra lo creado en campo", async () => {
    // Todavía no llegó al servidor: borrarlo perdería el trabajo del técnico
    // y dejaría mediciones apuntando a una marca inexistente.
    const local = await repo.crearMarcaLocal("Recauchadora Fundación");
    await repo.guardarCatalogo(catalogo);

    const todas = await repo.marcas();
    expect(todas.map((m) => m.id)).toContain(local.id);
    expect(todas).toHaveLength(3);
  });

  it("un diseño creado en campo cuelga de su marca", async () => {
    const marca = await repo.crearMarcaLocal("Recauchadora Fundación");
    const diseno = await repo.crearDisenoLocal(marca.id, "Reencauche liso", "traccion");
    const suyos = await repo.disenosDe(marca.id);
    expect(suyos.map((d) => d.id)).toEqual([diseno.id]);
  });
});

describe("llanta desmontada", () => {
  it("encuentra la que estaba antes en esa posición", async () => {
    // La que sale es la que estaba montada la visita anterior: precargarla
    // ahorra retranscribir datos que el sistema ya tiene.
    await repo.guardarOrden({ ...ordenBase, id: "ord-vieja", fecha: "2026-06-10" });
    await repo.guardarMedicion({
      id: "m-vieja", ordenId: "ord-vieja", posicion: 7,
      serial: "MX-ANTERIOR", profundidad: 4, capturadoPorId: "u-tec1",
    });
    await repo.guardarOrden({ ...ordenBase, id: "ord-nueva", fecha: "2026-09-17" });

    const anterior = await repo.ultimaMedicionDePosicion("veh-1", 7, "ord-nueva");
    expect(anterior?.serial).toBe("MX-ANTERIOR");
    expect(anterior?.profundidad).toBe(4);
  });

  it("no devuelve la medición de la orden en curso", async () => {
    await repo.guardarOrden(ordenBase);
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 7, serial: "ACTUAL", capturadoPorId: "u-tec1" });
    expect(await repo.ultimaMedicionDePosicion("veh-1", 7, "ord-1")).toBeNull();
  });

  it("toma la más reciente si hay varias", async () => {
    for (const [id, fecha, serial] of [
      ["ord-a", "2026-03-10", "VIEJA"],
      ["ord-b", "2026-06-10", "RECIENTE"],
    ] as const) {
      await repo.guardarOrden({ ...ordenBase, id, fecha });
      await repo.guardarMedicion({ ordenId: id, posicion: 7, serial, capturadoPorId: "u-tec1" });
    }
    await repo.guardarOrden({ ...ordenBase, id: "ord-hoy", fecha: "2026-09-17" });

    const anterior = await repo.ultimaMedicionDePosicion("veh-1", 7, "ord-hoy");
    expect(anterior?.serial).toBe("RECIENTE");
  });

  it("una posición sin histórico devuelve null", async () => {
    await repo.guardarOrden(ordenBase);
    expect(await repo.ultimaMedicionDePosicion("veh-1", 99, "ord-1")).toBeNull();
  });
});

describe("flota descargada", () => {
  const flota = {
    clientes: [
      { id: "cli-1", nombre: "Transportes Reyna", nit: "800.112.334-1" },
      { id: "cli-2", nombre: "Almacenadora del Norte", nit: "900.221.443-5" },
    ],
    sedes: [
      { id: "sc-1", clienteId: "cli-1", nombre: "Planta Fundación" },
      { id: "sc-2", clienteId: "cli-2", nombre: "Bodega Valledupar" },
    ],
    vehiculos: [
      { id: "veh-1", sedeClienteId: "sc-1", configuracionEjeId: "cfg-1", codigo: "CA-12", placa: "SXK482", nombre: "Tractocamión 12", kmActual: 78900 },
      { id: "veh-2", sedeClienteId: "sc-2", configuracionEjeId: "cfg-1", codigo: "CV-07", placa: null, nombre: "Volqueta 7", kmActual: 45200 },
    ],
  };

  it("resuelve cliente, sede y vehículo de una orden", async () => {
    await repo.guardarFlota(flota);
    await repo.guardarOrden({ ...ordenBase, encolar: false });

    const ctx = await repo.contextoDeOrden("ord-1");
    expect(ctx?.clienteNombre).toBe("Transportes Reyna");
    expect(ctx?.sedeClienteNombre).toBe("Planta Fundación");
    expect(ctx?.vehiculoCodigo).toBe("CA-12");
    expect(ctx?.vehiculoPlaca).toBe("SXK482");
  });

  it("lo deshabilitado no se ofrece para trabajo nuevo, pero las órdenes viejas conservan su nombre", async () => {
    await repo.guardarFlota({
      clientes: [flota.clientes[0]!, { ...flota.clientes[1]!, activo: false }],
      sedes: flota.sedes,
      vehiculos: [{ ...flota.vehiculos[0]!, activo: false }, flota.vehiculos[1]!],
    });
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    expect((await repo.clientes()).map((c) => c.id)).toEqual(["cli-1"]);
    expect(await repo.vehiculosDeSedeCliente("sc-1")).toEqual([]);
    expect((await repo.contextoDeOrden("ord-1"))?.vehiculoCodigo).toBe("CA-12");
  });

  it("sin la marca de activo (servidor anterior) todo se toma como activo", async () => {
    await repo.guardarFlota(flota);
    expect(await repo.clientes()).toHaveLength(2);
  });

  it("sin flota descargada devuelve null en vez de fallar", async () => {
    // La orden puede llegar antes que la flota si la sincronización se
    // interrumpió a mitad.
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    expect(await repo.contextoDeOrden("ord-1")).toBeNull();
  });

  it("un vehículo sin placa no rompe la consulta", async () => {
    await repo.guardarFlota(flota);
    await repo.guardarOrden({ ...ordenBase, id: "ord-2", vehiculoId: "veh-2", encolar: false });

    const ctx = await repo.contextoDeOrden("ord-2");
    expect(ctx?.vehiculoCodigo).toBe("CV-07");
    expect(ctx?.vehiculoPlaca).toBeNull();
  });

  it("resuelve varias órdenes de un golpe", async () => {
    await repo.guardarFlota(flota);
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.guardarOrden({ ...ordenBase, id: "ord-2", vehiculoId: "veh-2", encolar: false });

    const mapa = await repo.contextosDeOrdenes(["ord-1", "ord-2"]);
    expect(mapa.size).toBe(2);
    expect(mapa.get("ord-1")?.vehiculoCodigo).toBe("CA-12");
    expect(mapa.get("ord-2")?.clienteNombre).toBe("Almacenadora del Norte");
  });

  it("omite las órdenes cuya flota falta, sin fallar", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    const mapa = await repo.contextosDeOrdenes(["ord-1"]);
    expect(mapa.size).toBe(0);
  });

  it("una lista vacía no consulta nada", async () => {
    expect((await repo.contextosDeOrdenes([])).size).toBe(0);
  });

  it("el vehículo trae su configuración de ejes", async () => {
    // Es lo que decide cuántas posiciones dibuja el diagrama.
    await repo.guardarFlota(flota);
    const v = await repo.buscarVehiculo("veh-1");
    expect(v?.configuracionEjeId).toBe("cfg-1");
    expect(v?.kmActual).toBe(78900);
  });

  it("sincronizar reemplaza la flota entera", async () => {
    await repo.guardarFlota(flota);
    await repo.guardarFlota({ vehiculos: [flota.vehiculos[0]!] });
    expect(await repo.buscarVehiculo("veh-2")).toBeNull();
    expect(await repo.buscarVehiculo("veh-1")).not.toBeNull();
  });
});

describe("bandeja del coordinador", () => {
  const tecnicos = [
    { id: "u-tec1", nombre: "Carlos Méndez", sedeId: "sede-fun", activo: true },
    { id: "u-tec2", nombre: "Ana Torres", sedeId: "sede-fun", activo: true },
    { id: "u-tec3", nombre: "Luis García", sedeId: "sede-vdp", activo: true },
    { id: "u-baja", nombre: "Pedro Retirado", sedeId: "sede-fun", activo: false },
  ];

  it("trae los técnicos de la sede para reasignar sin señal", async () => {
    await repo.guardarTecnicos(tecnicos);
    const deFundacion = await repo.tecnicosDeSede("sede-fun");
    expect(deFundacion.map((t) => t.nombre)).toEqual(["Ana Torres", "Carlos Méndez"]);
  });

  it("excluye a los dados de baja", async () => {
    // Reasignar a alguien que ya no trabaja deja la orden en un limbo que
    // nadie nota hasta que el cliente reclama.
    await repo.guardarTecnicos(tecnicos);
    const deFundacion = await repo.tecnicosDeSede("sede-fun");
    expect(deFundacion.some((t) => t.id === "u-baja")).toBe(false);
  });

  it("no mezcla técnicos de otras sedes", async () => {
    await repo.guardarTecnicos(tecnicos);
    expect(await repo.tecnicosDeSede("sede-vdp")).toHaveLength(1);
  });

  it("lista las órdenes que esperan revisión", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.guardarOrden({ ...ordenBase, id: "ord-2", estado: "cerrada", encolar: false });
    await repo.cambiarEstado("ord-1", "en_revision");

    const enRevision = await repo.ordenesEnRevision();
    expect(enRevision.map((o) => o.id)).toEqual(["ord-1"]);
  });

  it("estampa cuándo entró a revisión", async () => {
    // Es lo que permite contar los días que lleva esperando.
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.cambiarEstado("ord-1", "en_revision");

    const o = await repo.buscarOrden("ord-1");
    expect(o?.enviadaRevisionEn).toBeTruthy();
  });

  it("otros cambios de estado no tocan esa marca", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.cambiarEstado("ord-1", "en_revision");
    const marcaOriginal = (await repo.buscarOrden("ord-1"))?.enviadaRevisionEn;

    await repo.cambiarEstado("ord-1", "pendiente_cliente");
    expect((await repo.buscarOrden("ord-1"))?.enviadaRevisionEn).toBe(marcaOriginal);
  });

  it("devolver guarda el motivo para que el técnico lo vea", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.cambiarEstado("ord-1", "en_revision");
    await repo.cambiarEstado("ord-1", "en_proceso", "Falta el parche en la posición 6");

    const o = await repo.buscarOrden("ord-1");
    expect(o?.motivoDevolucion).toContain("posición 6");
    expect(o?.estado).toBe("en_proceso");
  });

  it("aprobar no deja un motivo de devolución pegado", async () => {
    // Si quedara, el técnico vería una orden aprobada con un reclamo viejo.
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.cambiarEstado("ord-1", "en_revision");
    await repo.cambiarEstado("ord-1", "en_proceso", "Corregir la posición 6");
    await repo.cambiarEstado("ord-1", "en_revision");
    await repo.cambiarEstado("ord-1", "pendiente_cliente");

    const o = await repo.buscarOrden("ord-1");
    expect(o?.estado).toBe("pendiente_cliente");
  });

  it("congela el nombre de quien la ejecutó al entrar a revisión", async () => {
    await repo.guardarTecnicos(tecnicos);
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.cambiarEstado("ord-1", "en_revision");

    expect((await repo.buscarOrden("ord-1"))?.tecnicoNombre).toBe("Carlos Méndez");
  });

  it("reasignar después NO cambia quién la ejecutó", async () => {
    // La bandeja debe seguir mostrando quién hizo el trabajo, aunque la
    // orden ya esté en manos de otro.
    await repo.guardarTecnicos(tecnicos);
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.cambiarEstado("ord-1", "en_revision");
    await repo.reasignar("ord-1", "u-tec2", "Rotación");

    const o = await repo.buscarOrden("ord-1");
    expect(o?.tecnicoId).toBe("u-tec2");
    expect(o?.tecnicoNombre).toBe("Carlos Méndez");
  });

  it("la orden expone su sede, para saber a quién se puede reasignar", async () => {
    // Sin la sede, la lista de técnicos saldría vacía sin explicación.
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    expect((await repo.buscarOrden("ord-1"))?.sedeId).toBe("sede-fun");
  });

  it("reasignar cambia el técnico y encola la operación", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    const antes = await repo.contarPendientes();

    await repo.reasignar("ord-1", "u-tec2", "Carlos está incapacitado");

    const o = await repo.buscarOrden("ord-1");
    expect(o?.tecnicoId).toBe("u-tec2");
    expect(o?.sincronizada).toBe(false);
    expect(await repo.contarPendientes()).toBe(antes + 1);
  });

  it("reasignar no invalida la firma", async () => {
    // Cambiar quién la ejecuta no altera lo que el cliente firmó.
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });
    await repo.firmar("ord-1", { nombre: "Luis", cedula: "772", trazo: "[[[0,0],[10,5]]]", consentimiento: "2026-09-v1" });
    const antes = await repo.buscarOrden("ord-1");

    await repo.reasignar("ord-1", "u-tec2", "Rotación de turno");

    const despues = await repo.buscarOrden("ord-1");
    expect(despues?.versionContenido).toBe(antes?.versionContenido);
    expect(despues?.firmaVersion).toBe(despues?.versionContenido);
  });
});

describe("migración 6: servicios por código", () => {
  it("convierte los servicios que ya estaban guardados en un teléfono", async () => {
    // Un teléfono en campo puede tener mediciones con los ids viejos
    // ("srv-cali"). Al actualizar la app, deben quedar como códigos.
    const vieja = await abrirBaseEnMemoria();
    try {
      await migrar(vieja, MIGRACIONES.filter((m) => m.version <= 5));
      await vieja.ejecutar(
        `INSERT INTO medicion_servicio (medicion_id, servicio_id) VALUES
           ('m-1','srv-cali'), ('m-1','srv-reto'), ('m-2','srv-engr')`,
      );

      await migrar(vieja);

      const filas = await vieja.consultar<{ medicion_id: string; servicio_codigo: string }>(
        `SELECT medicion_id, servicio_codigo FROM medicion_servicio ORDER BY medicion_id, servicio_codigo`,
      );
      expect(filas.map((f) => f.servicio_codigo)).toEqual(["CALI", "RETO", "ENGR"]);
    } finally {
      await vieja.cerrar();
    }
  });

  it("lo convertido son códigos válidos del catálogo", async () => {
    const vieja = await abrirBaseEnMemoria();
    try {
      await migrar(vieja, MIGRACIONES.filter((m) => m.version <= 5));
      for (const c of CATALOGO_SERVICIOS) {
        await vieja.ejecutar(
          `INSERT INTO medicion_servicio (medicion_id, servicio_id) VALUES (?, ?)`,
          [`m-${c.codigo}`, `srv-${c.codigo.toLowerCase()}`],
        );
      }
      await migrar(vieja);

      const filas = await vieja.consultar<{ servicio_codigo: string }>(
        `SELECT servicio_codigo FROM medicion_servicio`,
      );
      for (const f of filas) {
        expect(CATALOGO_SERVICIOS.some((c) => c.codigo === f.servicio_codigo), f.servicio_codigo).toBe(true);
      }
    } finally {
      await vieja.cerrar();
    }
  });

  it("la columna vieja ya no existe", async () => {
    // Si quedara, alguien podría escribir en ella creyendo que es la buena.
    const columnas = await db.consultar<{ name: string }>(`PRAGMA table_info(medicion_servicio)`);
    const nombres = columnas.map((c) => c.name);
    expect(nombres).toContain("servicio_codigo");
    expect(nombres).not.toContain("servicio_id");
  });

  it("lo guardado hoy se lee como código", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.guardarMedicion({
      ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1", servicios: ["CALI", "BALA"],
    });
    const [m] = await repo.medicionesDe("ord-1");
    expect([...(m?.servicios ?? [])].sort()).toEqual(["BALA", "CALI"]);
  });
});

describe("corregir una posición reutiliza su medición", () => {
  beforeEach(async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
  });

  it("guardar dos veces la misma posición conserva el identificador", async () => {
    // Si cambiara, el servidor vería dos mediciones para una posición y
    // rechazaría la corrección del técnico.
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 7, profundidad: 9, capturadoPorId: "u-tec1" });
    const [primera] = await repo.medicionesDe("ord-1");

    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 7, profundidad: 8, capturadoPorId: "u-tec1" });
    const [corregida] = await repo.medicionesDe("ord-1");

    expect(corregida?.id).toBe(primera?.id);
    expect(corregida?.profundidad).toBe(8);
  });

  it("las dos operaciones encoladas apuntan a la misma medición", async () => {
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 7, profundidad: 9, capturadoPorId: "u-tec1" });
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 7, profundidad: 8, capturadoPorId: "u-tec1" });

    const ops = (await repo.operacionesPendientes()).filter((o) => o.tipo === "guardar_medicion");
    expect(ops).toHaveLength(2);
    expect(ops[0]?.recursoId).toBe(ops[1]?.recursoId);
  });

  it("posiciones distintas siguen teniendo identificadores distintos", async () => {
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 2, capturadoPorId: "u-tec1" });
    const [a, b] = await repo.medicionesDe("ord-1");
    expect(a?.id).not.toBe(b?.id);
  });
});

describe("lectura de órdenes", () => {
  it("toda columna que lee aOrden está en COLUMNAS_ORDEN", async () => {
    // Las consultas tenían su lista a mano y omitían accion y la firma
    // completa: esos campos llegaban siempre nulos aunque estuvieran
    // guardados.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { COLUMNAS_ORDEN } = await import("../datos/repositorio");
    const fuente = readFileSync(join(__dirname, "..", "datos", "repositorio.ts"), "utf8");
    const cuerpo = fuente.slice(fuente.indexOf("function aOrden("));
    const leidas = [...cuerpo.slice(0, cuerpo.indexOf("\n}\n")).matchAll(/f\["(\w+)"\]/g)].map((m) => m[1]);
    const columnas = COLUMNAS_ORDEN.split(",").map((c) => c.trim());
    expect(leidas.length).toBeGreaterThan(20);
    expect(leidas.filter((c) => !columnas.includes(c as string))).toEqual([]);
  });
});

describe("una orden programada se inicia al capturar", () => {
  // Las operaciones se encolan en el mismo milisegundo: el reloj no avanza.
  const tipos = async () =>
    (await repo.operacionesPendientes()).map((o) => `${o.tipo}${o.tipo === "cambiar_estado" ? ":" + (o.datos as { estado: string }).estado : ""}`);

  beforeEach(async () => {
    await repo.guardarOrden({ ...ordenBase, estado: "programada", encolar: false });
  });

  it("la primera medición la pasa a en proceso y encola el inicio ANTES de la medición", async () => {
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, profundidad: 9, capturadoPorId: "u-tec1" });
    expect((await repo.buscarOrden("ord-1"))?.estado).toBe("en_proceso");
    expect(await tipos()).toEqual(["cambiar_estado:en_proceso", "guardar_medicion"]);
  });

  it("la segunda medición no vuelve a iniciarla", async () => {
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, profundidad: 9, capturadoPorId: "u-tec1" });
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 2, profundidad: 8, capturadoPorId: "u-tec1" });
    expect((await tipos()).filter((t) => t.startsWith("cambiar_estado"))).toHaveLength(1);
  });

  it("el kilometraje también la inicia", async () => {
    await repo.actualizarDatosOrden("ord-1", { kilometraje: 1000 });
    expect((await repo.buscarOrden("ord-1"))?.estado).toBe("en_proceso");
  });

  it("enviar una que quedó programada encola los dos pasos, en orden, en el mismo milisegundo", async () => {
    await repo.cambiarEstado("ord-1", "en_revision");
    expect((await repo.buscarOrden("ord-1"))?.estado).toBe("en_revision");
    expect(await tipos()).toEqual(["cambiar_estado:en_proceso", "cambiar_estado:en_revision"]);
  });
});

describe("cambios sin enviar, uno por uno", () => {
  it("lista pendientes y rechazados con el folio de su orden; solo un rechazado se descarta", async () => {
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 3, profundidad: 9, capturadoPorId: "u-tec1" });
    await repo.cambiarEstado("ord-1", "en_revision");
    const [medicion, envio] = await repo.cambiosSinEnviar();
    expect(medicion).toMatchObject({ tipo: "guardar_medicion", motivoRechazo: null });
    await repo.apartarOperacion(envio!.id, "FIRMA_DESACTUALIZADA: la orden cambió después de firmar");

    // Una pendiente no se descarta: todavía puede llegar.
    await repo.descartarRechazada(medicion!.id);
    expect(await repo.cambiosSinEnviar()).toHaveLength(2);

    expect((await repo.cambiosSinEnviar())[1]?.motivoRechazo).toMatch(/FIRMA_DESACTUALIZADA/);
    await repo.descartarRechazada(envio!.id);
    expect((await repo.cambiosSinEnviar()).map((c) => c.tipo)).toEqual(["guardar_medicion"]);
    // Lo guardado en el celular queda.
    expect(await repo.medicionesDe("ord-1")).toHaveLength(1);
  });
});
