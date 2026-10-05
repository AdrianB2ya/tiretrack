import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { nuevoId } from "@tiretrack/domain";

// El servidor REAL
import { construirServidor, PREFIJO_API } from "../apps/api/src/http/servidor";
import { crearEsquemaCompleto, sembrar, SEMILLA, authFalso } from "../apps/api/src/pruebas/esquemas";
import { hayBaseDeDatos, poolAislado } from "../apps/api/src/pruebas/base";
import type { Claims } from "../apps/api/src/acceso/servicio";
import type { Almacenamiento } from "../apps/api/src/fotos/almacenamiento";

// El cliente REAL del celular
import { abrirBaseEnMemoria } from "../apps/mobile/src/datos/conexionNode";
import { migrar, type Conexion } from "../apps/mobile/src/datos/base";
import { RepositorioLocal } from "../apps/mobile/src/datos/repositorio";
import { ClienteHttp } from "../apps/mobile/src/datos/clienteHttp";
import { MotorSincronizacion } from "../apps/mobile/src/datos/sincronizacion";
import { Descargador } from "../apps/mobile/src/datos/descarga";

/**
 * Una jornada completa, de punta a punta.
 *
 * El celular de verdad —su base SQLite, su cola de operaciones, su cliente
 * HTTP— hablando por HTTP real con el servidor de verdad y PostgreSQL. Sin
 * dobles en el medio.
 *
 * Es la prueba que justifica el trabajo de contratos: cada desajuste entre lo
 * que la app envía y lo que el servidor espera aparece aquí, no en campo.
 */

const disponible = await hayBaseDeDatos();

const TOKEN = "tok-e2e";
const CLAIMS: Record<string, Claims> = {
  [TOKEN]: { sub: SEMILLA.tecnico, empresaId: SEMILLA.empresa, rol: "tecnico", clienteId: null },
};

const almacenFalso: Almacenamiento = {
  urlDeSubida: async (ruta) => ({ url: `https://subir.test/${ruta}`, expiraEn: 600 }),
  urlDeLectura: async (ruta) => ({ url: `https://leer.test/${ruta}`, expiraEn: 600 }),
  borrar: async () => undefined,
  existe: async () => true,
};

let pool: pg.Pool;
let servidor: ReturnType<typeof construirServidor>;
let base: string;

let db: Conexion;
let repo: RepositorioLocal;
let motor: MotorSincronizacion;
/** Permite simular que una respuesta se pierde después de aplicarse. */
let perderRespuestaDe: string | null = null;
/** Reloj del dispositivo, para dejar pasar el tiempo de reintento. */
let ahora = new Date("2026-09-21T08:00:00.000Z");
const avanzarMinutos = (m: number) => {
  ahora = new Date(ahora.getTime() + m * 60_000);
};

const ORDEN = "22222222-2222-4222-8222-000000000001";

function construirCliente(): ClienteHttp {
  return new ClienteHttp({
    baseUrl: base,
    obtenerToken: async () => TOKEN,
    fetch: (async (url: string, init: RequestInit) => {
      const r = await fetch(url, init);
      const clave = (init.headers as Record<string, string>)["Idempotency-Key"];
      if (clave && clave === perderRespuestaDe) {
        // El servidor YA aplicó la operación; lo que se pierde es la
        // respuesta. Es el caso que la idempotencia debe resolver.
        perderRespuestaDe = null;
        throw new Error("conexión interrumpida");
      }
      return r;
    }) as unknown as typeof globalThis.fetch,
  });
}

/** Una jornada de trabajo sin señal: nada de esto toca la red. */
async function jornadaSinSenal() {
  await repo.guardarOrden({
    id: ORDEN,
    sedeId: SEMILLA.sede,
    clienteId: SEMILLA.cliente,
    sedeClienteId: SEMILLA.sedeCliente,
    vehiculoId: SEMILLA.vehiculo,
    tecnicoId: SEMILLA.tecnico,
    configuracionEjeId: SEMILLA.configuracion,
    tipo: "preventivo",
    estado: "en_proceso",
    fecha: "2026-09-21",
    sinConductor: true,
  });

  for (const posicion of [1, 2, 3, 4]) {
    await repo.guardarMedicion({
      ordenId: ORDEN,
      posicion,
      serial: `MX100234${posicion}`,
      dot: "3624",
      psiEncontrada: 105,
      psiCalibrado: 110,
      profundidad: 9 - posicion,
      capturadoPorId: SEMILLA.tecnico,
      servicios: posicion === 1 ? ["CALI"] : [],
    });
  }

  await repo.actualizarDatosOrden(ORDEN, { kilometraje: 78900, hallazgos: "Desgaste en el eje 2" });
  await repo.firmar(ORDEN, {
    nombre: "Luis Reyna",
    cedula: "77221004",
    trazo: "[[[0,0],[10,5],[20,2]]]",
    consentimiento: "2026-09-v1",
  });
  await repo.cambiarEstado(ORDEN, "en_revision");
}

async function ordenEnServidor() {
  const r = await pool.query(
    `SELECT folio, estado, kilometraje, hallazgos, "versionContenido", "firmaVersion",
            "firmaNombre", "firmaConsentimiento", "firmaTrazo"
       FROM "OrdenServicio" WHERE id = $1`,
    [ORDEN],
  );
  return r.rows[0];
}

describe.skipIf(!disponible)("jornada completa de punta a punta", () => {
  beforeAll(async () => {
    pool = await poolAislado(import.meta.url, 6);
    await crearEsquemaCompleto(pool);
    servidor = construirServidor({
      pool,
      verificarToken: (t) => CLAIMS[t] ?? null,
      almacen: almacenFalso,
      auth: authFalso,
    });
    await servidor.listen({ port: 0, host: "127.0.0.1" });
    const dir = servidor.server.address();
    // Igual que la app instalada: la URL base incluye /api/v1.
    base = typeof dir === "object" && dir ? `http://127.0.0.1:${dir.port}${PREFIJO_API}` : "";
  }, 60_000);

  afterAll(async () => {
    await servidor?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    await sembrar(pool);
    await pool.query(
      `INSERT INTO "Consecutivo" (id,"empresaId","sedeId",tipo,prefijo,valor)
       VALUES ($1,$2,$3,'OS','OS',0)`,
      [nuevoId(), SEMILLA.empresa, SEMILLA.sede],
    );
    db = await abrirBaseEnMemoria();
    await migrar(db);
    repo = new RepositorioLocal(db, () => ahora);
    ahora = new Date("2026-09-21T08:00:00.000Z");
    motor = new MotorSincronizacion(repo, construirCliente());
    perderRespuestaDe = null;
  });

  it("todo lo capturado sin señal llega al servidor al reconectar", async () => {
    await jornadaSinSenal();
    // Nada salió todavía: el trabajo está entero en el dispositivo.
    expect(await repo.contarPendientes()).toBe(8);

    const r = await motor.sincronizar();

    expect(r.rechazadas).toBe(0);
    expect(r.conflictos).toBe(0);
    expect(await repo.contarPendientes()).toBe(0);
    expect(await repo.operacionesRechazadas()).toEqual([]);

    const orden = await ordenEnServidor();
    expect(orden.estado).toBe("en_revision");
    expect(orden.kilometraje).toBe(78900);
    expect(orden.hallazgos).toContain("eje 2");

    const mediciones = await pool.query(
      `SELECT posicion, serial, profundidad FROM "LlantaRegistro" WHERE "ordenId" = $1 ORDER BY posicion`,
      [ORDEN],
    );
    expect(mediciones.rows.map((m) => m.posicion)).toEqual([1, 2, 3, 4]);
    expect(mediciones.rows[0].serial).toBe("MX1002341");
  });

  it("la firma queda VIGENTE en el servidor", async () => {
    // El corazón del diseño: el contador de contenido del celular y el del
    // servidor tienen que coincidir. Si subieran distinto, la firma llegaría
    // invalidada y el coordinador vería una orden que no puede aprobar.
    await jornadaSinSenal();
    await motor.sincronizar();

    const orden = await ordenEnServidor();
    expect(orden.firmaVersion).toBe(orden.versionContenido);
    expect(orden.firmaNombre).toBe("Luis Reyna");
    // La constancia que exige la Ley 1581 sobrevive el viaje.
    expect(orden.firmaConsentimiento).toBe("2026-09-v1");
    expect(orden.firmaTrazo).toContain("[[0,0]");
  });

  it("el folio lo asigna el servidor y vuelve al celular", async () => {
    await jornadaSinSenal();
    await motor.sincronizar();

    const orden = await ordenEnServidor();
    expect(orden.folio).toMatch(/^OS-FUN-\d+$/);
    expect((await repo.buscarOrden(ORDEN))?.folio).toBe(orden.folio);
  });

  it("los servicios viajan por código y quedan enlazados", async () => {
    await jornadaSinSenal();
    await motor.sincronizar();

    const r = await pool.query(
      `SELECT s.codigo FROM "LlantaServicio" ls
         JOIN "Servicio" s ON s.id = ls."servicioId"
         JOIN "LlantaRegistro" lr ON lr.id = ls."llantaRegistroId"
        WHERE lr."ordenId" = $1`,
      [ORDEN],
    );
    expect(r.rows.map((x) => x.codigo)).toEqual(["CALI"]);
  });

  it("una respuesta perdida no duplica nada", async () => {
    // El caso real: la operación llegó y se aplicó, pero el celular no vio
    // la respuesta. Al reintentar, el servidor responde 'ya aplicada'.
    await jornadaSinSenal();
    const [creacion] = await repo.operacionesPendientes();
    perderRespuestaDe = creacion?.id ?? null;

    const primera = await motor.sincronizar();
    expect(primera.interrumpida).toBe(true);

    // El envío fallido espera su turno antes de reintentarse: no tiene
    // sentido machacar al servidor de inmediato.
    const segunda = await motor.sincronizar();
    expect(segunda.rechazadas).toBe(0);

    avanzarMinutos(60);
    const tercera = await motor.sincronizar();
    // El servidor ya la tenía: responde "ya aplicada" y el celular la da por
    // enviada en vez de crear una segunda orden.
    expect(tercera.duplicadas).toBe(1);
    expect(await repo.contarPendientes()).toBe(0);

    const ordenes = await pool.query(`SELECT count(*)::int AS n FROM "OrdenServicio"`);
    expect(ordenes.rows[0].n).toBe(1);
    const orden = await ordenEnServidor();
    // Y la firma sigue vigente: el reintento no volvió a cambiar el contenido.
    expect(orden.firmaVersion).toBe(orden.versionContenido);
  });

  it("reenviar toda la jornada otra vez no la duplica", async () => {
    await jornadaSinSenal();
    await motor.sincronizar();
    const antes = await ordenEnServidor();

    // Se reencolan las MISMAS operaciones, con sus mismos identificadores.
    await db.ejecutar(`UPDATE operacion SET reintentar_en = NULL`);
    await db.ejecutar(
      `INSERT INTO operacion (id, tipo, recurso_id, orden_id, datos, intentos, creada_en)
       SELECT id, tipo, recurso_id, orden_id, datos, 0, creada_en FROM operacion`,
    ).catch(() => undefined);

    await motor.sincronizar();
    const despues = await ordenEnServidor();

    const mediciones = await pool.query(`SELECT count(*)::int AS n FROM "LlantaRegistro"`);
    expect(mediciones.rows[0].n).toBe(4);
    expect(despues.versionContenido).toBe(antes.versionContenido);
  });

  it("si el coordinador reasigna mientras tanto, el trabajo NO se pierde", async () => {
    // El técnico sigue sin señal; el coordinador reasigna la orden. Sus
    // mediciones se rechazan —ya no es el asignado— pero quedan apartadas
    // con su motivo, no borradas.
    await repo.guardarOrden({
      id: ORDEN, sedeId: SEMILLA.sede, clienteId: SEMILLA.cliente,
      sedeClienteId: SEMILLA.sedeCliente, vehiculoId: SEMILLA.vehiculo,
      tecnicoId: SEMILLA.tecnico, configuracionEjeId: SEMILLA.configuracion,
      tipo: "preventivo", estado: "en_proceso", fecha: "2026-09-21", sinConductor: true,
    });
    await motor.sincronizar();

    await pool.query(`UPDATE "OrdenServicio" SET tecnico_id = $1 WHERE id = $2`, [SEMILLA.otroTecnico, ORDEN]);

    await repo.guardarMedicion({
      ordenId: ORDEN, posicion: 1, profundidad: 9, capturadoPorId: SEMILLA.tecnico,
    });
    const r = await motor.sincronizar();

    expect(r.rechazadas).toBe(1);
    const apartadas = await repo.operacionesRechazadas();
    expect(apartadas).toHaveLength(1);
    expect(apartadas[0]?.tipo).toBe("guardar_medicion");
    // La medición sigue en el celular, intacta.
    expect((await repo.medicionesDe(ORDEN))[0]?.profundidad).toBe(9);
  });

  describe("un celular recién instalado", () => {
    /** Una orden que ya existe en el servidor, asignada al técnico. */
    async function ordenEnElServidor(id: string) {
      await pool.query(
        `INSERT INTO "OrdenServicio"
           (id,"empresaId","sedeId","clienteId","sedeClienteId","vehiculoId",tecnico_id,
            "configuracionEjeId",tipo,estado,fecha,folio,"creadoPorId","actualizadoEn")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'preventivo','en_proceso','2026-09-21','OS-FUN-000009',$7,now())`,
        [id, SEMILLA.empresa, SEMILLA.sede, SEMILLA.cliente, SEMILLA.sedeCliente,
         SEMILLA.vehiculo, SEMILLA.tecnico, SEMILLA.configuracion],
      );
    }

    it("descarga todo lo que necesita para trabajar sin señal", async () => {
      // Antes de esto, un técnico instalaba la app, ingresaba y veía una
      // lista vacía para siempre: el motor solo enviaba, nunca traía.
      await ordenEnElServidor("ord-servidor");
      const descargador = new Descargador(repo);

      const r = await descargador.descargar(construirCliente());

      expect(r.ordenesNuevas).toBe(1);
      expect(await repo.ordenesAsignadas()).toHaveLength(1);
      expect((await repo.buscarOrden("ord-servidor"))?.folio).toBe("OS-FUN-000009");
      // Y lo necesario para capturar: diagrama, catálogo, nombres.
      expect(await repo.posicionesDe(SEMILLA.configuracion)).toHaveLength(4);
      expect(await repo.marcas()).not.toEqual([]);
      expect((await repo.contextoDeOrden("ord-servidor"))?.vehiculoCodigo).toBe("CA-12");
    });

    it("después de descargar se puede capturar y enviar", async () => {
      // La prueba de que el ciclo cierra: bajar, trabajar, subir.
      await ordenEnElServidor("ord-servidor");
      await new Descargador(repo).descargar(construirCliente());

      await repo.guardarMedicion({
        ordenId: "ord-servidor", posicion: 1, profundidad: 9,
        serial: "MX999", capturadoPorId: SEMILLA.tecnico,
      });
      const envio = await motor.sincronizar();

      expect(envio.rechazadas).toBe(0);
      const m = await pool.query(
        `SELECT serial FROM "LlantaRegistro" WHERE "ordenId" = 'ord-servidor'`,
      );
      expect(m.rows[0]?.serial).toBe("MX999");
    });

    it("la segunda descarga no borra lo que todavía no se ha enviado", async () => {
      await ordenEnElServidor("ord-servidor");
      const descargador = new Descargador(repo);
      await descargador.descargar(construirCliente());

      // El técnico captura sin señal...
      await repo.actualizarDatosOrden("ord-servidor", { hallazgos: "Desgaste irregular" });
      // ...y mientras tanto el coordinador toca la orden en el servidor, así
      // que la descarga incremental SÍ la trae, con la versión vieja.
      await pool.query(
        `UPDATE "OrdenServicio" SET "notaCoordinador" = 'Revisar el eje 2', "actualizadoEn" = now()
          WHERE id = 'ord-servidor'`,
      );
      const r = await descargador.descargar(construirCliente());

      expect(r.ordenesRespetadas).toBe(1);
      expect((await repo.buscarOrden("ord-servidor"))?.hallazgos).toBe("Desgaste irregular");
    });
  });

  describe("toda operación del celular tiene ruta en el servidor", () => {
    /**
     * Pasó dos veces: se agregó un tipo de operación al celular y su ruta no
     * existía en el servidor. La operación recibía un 404, el cliente la
     * trataba como rechazo y quedaba apartada — una marca creada en campo
     * nunca llegaba.
     *
     * Aquí se recorren TODOS los tipos contra el servidor real. No se
     * comprueba que la operación funcione, sino que la ruta exista: basta con
     * que la respuesta no sea 404 por ruta inexistente.
     */
    const TIPOS = [
      "crear_orden", "actualizar_orden", "guardar_medicion", "cambiar_estado",
      "firmar", "subir_foto", "reasignar", "crear_marca", "crear_diseno",
      "adjuntar_foto",
    ] as const;

    it("ninguna cae en una ruta que no existe", async () => {
      const cliente = construirCliente();
      const sinRuta: string[] = [];

      for (const tipo of TIPOS) {
        const r = await cliente.enviar({
          id: nuevoId(), tipo, recursoId: nuevoId(), ordenId: ORDEN,
          datos: {}, intentos: 0, ultimoError: null, creadaEn: "2026-09-21T00:00:00Z",
        });
        // Un cuerpo vacío se rechaza por contenido (422) o por reglas; lo que
        // NO puede pasar es que la ruta no exista.
        if (r.tipo === "rechazada" && /no existe la ruta|not found|404/i.test(r.mensaje)) {
          sinRuta.push(tipo);
        }
      }
      expect(sinRuta).toEqual([]);
    });

    it("crear una marca en campo llega al servidor", async () => {
      // El caso concreto que estaba roto.
      const marca = await repo.crearMarcaLocal("Recauchadora Fundación");
      const r = await motor.sincronizar();

      expect(r.rechazadas).toBe(0);
      const filas = await pool.query(`SELECT nombre FROM "Marca" WHERE id = $1`, [marca.id]);
      expect(filas.rows[0]?.nombre).toBe("Recauchadora Fundación");
    });
  });
});
