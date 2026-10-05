import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { hayBaseDeDatos, conectarAislado } from "./base";
import { RepositorioOrdenesPg } from "../ordenes/repositorio";
import { ServicioOrdenes, COMANDO, enLinea, type Contexto } from "../ordenes/servicio";
import { nuevoId } from "@tiretrack/domain";

/**
 * Órdenes de servicio contra PostgreSQL real.
 *
 * La prueba que más importa es la de concurrencia del folio: el prototipo
 * generaba el consecutivo con count()+1 y dos técnicos simultáneos obtenían
 * el mismo número.
 */

const disponible = await hayBaseDeDatos();

const EMP = "emp-ord";
const SEDE = "sede-fun";
const COORD: Contexto = { empresaId: EMP, rol: "coordinador", usuarioId: "u-coo" };
const TEC1: Contexto = { empresaId: EMP, rol: "tecnico", usuarioId: "u-tec1" };
const TEC2: Contexto = { empresaId: EMP, rol: "tecnico", usuarioId: "u-tec2" };
const CLIENTE: Contexto = {
  empresaId: EMP,
  rol: "cliente",
  usuarioId: "u-cli",
  clienteId: "cli-1",
  vistaCliente: true,
};

let db: pg.Client;
let servicio: ServicioOrdenes;
let reloj = new Date("2026-09-14T09:00:00.000Z");

const base = {
  sedeId: SEDE,
  clienteId: "cli-1",
  sedeClienteId: "sc-1",
  vehiculoId: "veh-1",
  tecnicoId: "u-tec1",
  configuracionEjeId: "cfg-1",
  tipo: "preventivo",
  fecha: "2026-09-14",
};

describe.skipIf(!disponible)("órdenes de servicio", () => {
  beforeAll(async () => {
    db = await conectarAislado(import.meta.url);

    await db.query(`
      DROP TABLE IF EXISTS "OrdenEstadoHistorial", "LlantaRegistro", "OrdenServicio",
                           "Consecutivo", "UsuarioSede", "Vehiculo", "SedeCliente",
                           "Cliente", "ConfiguracionEje", "Usuario", "Sede" CASCADE;
      DROP TYPE IF EXISTS "EstadoOrden" CASCADE;

      CREATE TYPE "EstadoOrden" AS ENUM
        ('borrador','programada','en_proceso','en_revision','pendiente_cliente','cerrada','anulada');

      CREATE TABLE "Sede" (id text PRIMARY KEY, "empresaId" text NOT NULL, nombre text, codigo text NOT NULL);
      CREATE TABLE "Usuario" (id text PRIMARY KEY, "empresaId" text, nombre text NOT NULL, cedula text NOT NULL);
      CREATE TABLE "UsuarioSede" ("usuarioId" text NOT NULL, "sedeId" text NOT NULL, PRIMARY KEY ("usuarioId","sedeId"));
      CREATE TABLE "Cliente" (id text PRIMARY KEY, "empresaId" text NOT NULL, nombre text NOT NULL, nit text NOT NULL);
      CREATE TABLE "SedeCliente" (id text PRIMARY KEY, "clienteId" text NOT NULL, nombre text NOT NULL);
      CREATE TABLE "ConfiguracionEje" (id text PRIMARY KEY, "empresaId" text NOT NULL, nombre text, "totalPosiciones" int);
      CREATE TABLE "Vehiculo" (id text PRIMARY KEY, "sedeClienteId" text NOT NULL, codigo text NOT NULL, placa text);

      CREATE TABLE "Consecutivo" (
        id text PRIMARY KEY,
        "empresaId" text NOT NULL, "sedeId" text NOT NULL,
        tipo text NOT NULL DEFAULT 'OS', prefijo text NOT NULL DEFAULT 'OS',
        valor integer NOT NULL DEFAULT 0,
        UNIQUE ("empresaId","sedeId",tipo)
      );

      CREATE TABLE "OrdenServicio" (
        id text PRIMARY KEY,
        "empresaId" text NOT NULL, "sedeId" text NOT NULL,
        "clienteId" text NOT NULL, "sedeClienteId" text NOT NULL, "vehiculoId" text NOT NULL,
        tecnico_id text NOT NULL, "configuracionEjeId" text NOT NULL,
        folio text, "codigoReferencia" text,
        tipo text NOT NULL, prioridad text NOT NULL DEFAULT 'normal',
        estado "EstadoOrden" NOT NULL DEFAULT 'borrador',
        fecha date NOT NULL,
        kilometraje integer, hallazgos text, accion text,
        "notaCoordinador" text, "motivoDevolucion" text,
        "horasTrabajo" numeric(6,2) DEFAULT 0,
        "sinConductor" boolean NOT NULL DEFAULT false, "conductorNombre" text,
        "firmaNombre" text, "firmaCedula" text, "firmaVersion" integer, "firmaFechaHora" timestamptz,
        "firmaCargo" text, "firmaTrazo" text, "firmaConsentimiento" text,
        "clienteNombre" text, "clienteNit" text, "sedeClienteNombre" text,
        "vehiculoCodigo" text, "vehiculoPlaca" text,
        "tecnicoNombre" text, "tecnicoCedula" text, "congeladoEn" timestamptz,
        "aprobadoPorId" text, "aprobadoEn" timestamptz, "autoAprobada" boolean NOT NULL DEFAULT false,
        "enviadoClienteEn" date, "limiteCliente" date,
        "cierreTacito" boolean NOT NULL DEFAULT false, "motivoCierre" text,
        version integer NOT NULL DEFAULT 0,
        "versionContenido" integer NOT NULL DEFAULT 0,
        "clientRequestId" text, "sincronizadoEn" timestamptz,
        "creadoPorId" text NOT NULL, "anuladaEn" timestamptz,
        UNIQUE ("empresaId", folio),
        UNIQUE ("empresaId", "clientRequestId")
      );

      CREATE TABLE "LlantaRegistro" (id text PRIMARY KEY, "ordenId" text NOT NULL, posicion int NOT NULL);

      CREATE TABLE "OrdenEstadoHistorial" (
        id text PRIMARY KEY,
        "ordenId" text NOT NULL,
        "estadoAnterior" "EstadoOrden", "estadoNuevo" "EstadoOrden" NOT NULL,
        "usuarioId" text NOT NULL, motivo text,
        "visibleCliente" boolean NOT NULL DEFAULT false,
        "creadoEn" timestamptz NOT NULL DEFAULT clock_timestamp()
      );
    `);

    servicio = new ServicioOrdenes(new RepositorioOrdenesPg(db), () => reloj);
  }, 60_000);

  afterAll(async () => {
    if (db) await db.end();
  });

  beforeEach(async () => {
    reloj = new Date("2026-09-14T09:00:00.000Z");
    await db.query(`TRUNCATE "OrdenEstadoHistorial", "LlantaRegistro", "OrdenServicio",
                             "Consecutivo", "UsuarioSede", "Vehiculo", "SedeCliente",
                             "Cliente", "ConfiguracionEje", "Usuario", "Sede" CASCADE`);

    await db.query(`INSERT INTO "Sede" (id,"empresaId",nombre,codigo) VALUES ($1,$2,'Fundación','FUN'),('sede-vdp',$2,'Valledupar','VDP')`, [SEDE, EMP]);
    await db.query(`INSERT INTO "Usuario" (id,"empresaId",nombre,cedula) VALUES
      ('u-coo',$1,'Jorge Ramírez','79445201'),
      ('u-tec1',$1,'Carlos Méndez','1082334556'),
      ('u-tec2',$1,'Ana Torres','1065221980'),
      ('u-cli',$1,'Luis Reyna','77221004')`, [EMP]);
    await db.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES
      ('u-coo',$1),('u-tec1',$1),('u-tec2','sede-vdp')`, [SEDE]);
    await db.query(`INSERT INTO "Cliente" (id,"empresaId",nombre,nit) VALUES ('cli-1',$1,'Transportes Reyna','800.112.334-1')`, [EMP]);
    await db.query(`INSERT INTO "SedeCliente" (id,"clienteId",nombre) VALUES ('sc-1','cli-1','Planta Fundación')`);
    await db.query(`INSERT INTO "ConfiguracionEje" (id,"empresaId",nombre,"totalPosiciones") VALUES ('cfg-1',$1,'Tractocamión',22)`, [EMP]);
    await db.query(`INSERT INTO "Vehiculo" (id,"sedeClienteId",codigo,placa) VALUES ('veh-1','sc-1','CA-12','SXK482'),('veh-2','sc-1','CV-07','TRD119')`);
  });

  /** Crea una orden lista para avanzar en el flujo. */
  async function nuevaOrden(ctx: Contexto = COORD, extra: Record<string, unknown> = {}) {
    const r = await servicio.crear(ctx, {
      ...base,
      clientRequestId: nuevoId(),
      ...extra,
    });
    if (!r.ok) throw new Error(`no se creó: ${r.veredicto.mensaje}`);
    return r.valor.orden;
  }

  /** Lleva una orden hasta en_revision con firma vigente y una medición. */
  async function hastaRevision() {
    let orden = await nuevaOrden();
    const enProceso = await servicio.cambiarEstado(TEC1, orden.id, enLinea(orden.version), "en_proceso");
    if (!enProceso.ok) throw new Error();
    orden = enProceso.valor;

    await db.query(`INSERT INTO "LlantaRegistro" (id,"ordenId",posicion) VALUES ($1,$2,1)`, [
      nuevoId(),
      orden.id,
    ]);

    const firmada = await servicio.firmar(TEC1, orden.id, enLinea(orden.version), {
        nombre: "Luis Reyna",
      cedula: "77221004",
        trazo: "[[[0,0],[10,5]]]",
        consentimiento: "2026-09-v1",
        versionContenido: orden.versionContenido,
      });
    if (!firmada.ok) throw new Error();
    orden = firmada.valor;

    const revision = await servicio.cambiarEstado(TEC1, orden.id, enLinea(orden.version), "en_revision");
    if (!revision.ok) throw new Error(revision.veredicto.mensaje);
    return revision.valor;
  }

  // ════════════════════════════════════════════════════════════════════════

  describe("folio atómico", () => {
    it("asigna folios consecutivos por sede", async () => {
      const a = await nuevaOrden();
      const b = await nuevaOrden(COORD, { vehiculoId: "veh-2", confirmarDuplicada: true });
      expect(a.folio).toBe("OS-FUN-000001");
      expect(b.folio).toBe("OS-FUN-000002");
    });

    it("el consecutivo es independiente en cada sede", async () => {
      await nuevaOrden();
      await db.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES ('u-coo','sede-vdp'),('u-tec1','sede-vdp')`);
      const vdp = await servicio.crear(COORD, {
        ...base,
        sedeId: "sede-vdp",
        vehiculoId: "veh-2",
        clientRequestId: nuevoId(),
      });
      if (!vdp.ok) throw new Error();
      expect(vdp.valor.orden.folio).toBe("OS-VDP-000001");
    });

    it("50 órdenes simultáneas no producen folios duplicados", async () => {
      // Es la prueba que justifica UPDATE ... RETURNING en vez de count()+1.
      // Cada conexión es independiente, como lo serían 50 peticiones reales.
      const conexiones = await Promise.all(
        Array.from({ length: 50 }, async () => {
          const c = await conectarAislado(import.meta.url);
          return c;
        }),
      );

      try {
        const folios = await Promise.all(
          conexiones.map(async (c) => {
            const repo = new RepositorioOrdenesPg(c);
            return repo.siguienteFolio(EMP, SEDE, "FUN");
          }),
        );

        expect(new Set(folios).size).toBe(50);

        const numeros = folios.map((f) => Number(f.split("-")[2])).sort((a, b) => a - b);
        expect(numeros[0]).toBe(1);
        expect(numeros[49]).toBe(50);
      } finally {
        await Promise.all(conexiones.map((c) => c.end()));
      }
    }, 60_000);

    it("una orden creada sin señal nace sin folio, con código de referencia", async () => {
      const orden = await nuevaOrden(TEC1, { sinConexion: true });
      expect(orden.folio).toBeNull();
      expect(orden.codigoReferencia).toMatch(/^FUN-/);
      // No se parece a un folio a propósito
      expect(orden.codigoReferencia).not.toMatch(/^OS-/);
    });

    it("al sincronizar recibe su folio definitivo", async () => {
      const orden = await nuevaOrden(TEC1, { sinConexion: true });
      const r = await servicio.asignarFolio(COORD, orden.id);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.folio).toBe("OS-FUN-000001");
      // El código de referencia se conserva para poder rastrearla
      expect(r.valor.codigoReferencia).toMatch(/^FUN-/);
    });

    it("asignar folio dos veces no lo cambia", async () => {
      const orden = await nuevaOrden(TEC1, { sinConexion: true });
      const primera = await servicio.asignarFolio(COORD, orden.id);
      const segunda = await servicio.asignarFolio(COORD, orden.id);
      if (!primera.ok || !segunda.ok) throw new Error();
      expect(segunda.valor.folio).toBe(primera.valor.folio);
    });
  });

  describe("idempotencia de la sincronización", () => {
    it("reenviar la misma operación no crea una orden duplicada", async () => {
      const clave = nuevoId();
      const a = await servicio.crear(COORD, { ...base, clientRequestId: clave });
      const b = await servicio.crear(COORD, { ...base, clientRequestId: clave });
      if (!a.ok || !b.ok) throw new Error();
      expect(b.valor.orden.id).toBe(a.valor.orden.id);

      const total = await db.query(`SELECT count(*)::int AS n FROM "OrdenServicio"`);
      expect(total.rows[0].n).toBe(1);
    });

    it("tampoco consume un folio de más", async () => {
      const clave = nuevoId();
      await servicio.crear(COORD, { ...base, clientRequestId: clave });
      await servicio.crear(COORD, { ...base, clientRequestId: clave });
      const c = await db.query(`SELECT valor FROM "Consecutivo"`);
      expect(c.rows[0].valor).toBe(1);
    });
  });

  describe("creación", () => {
    it("el coordinador crea la orden en estado programada", async () => {
      const orden = await nuevaOrden();
      expect(orden.estado).toBe("programada");
    });

    it("el técnico crea la suya directamente en proceso", async () => {
      const orden = await nuevaOrden(TEC1);
      expect(orden.estado).toBe("en_proceso");
      expect(orden.tecnicoId).toBe("u-tec1");
    });

    it("el técnico no puede asignarle la orden a otro", async () => {
      const orden = await nuevaOrden(TEC1, { tecnicoId: "u-tec2" });
      expect(orden.tecnicoId).toBe("u-tec1");
    });

    it("no asigna un técnico que no pertenece a la sede", async () => {
      // u-tec2 está en Valledupar, no en Fundación.
      const r = await servicio.crear(COORD, {
        ...base,
        tecnicoId: "u-tec2",
        clientRequestId: nuevoId(),
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("TECNICO_AJENO_A_SEDE");
    });

    it("el cliente no crea órdenes", async () => {
      const r = await servicio.crear(CLIENTE, { ...base, clientRequestId: nuevoId() });
      expect(r.ok).toBe(false);
    });

    it("avisa si el vehículo ya tiene una orden abierta", async () => {
      await nuevaOrden();
      const r = await servicio.crear(COORD, { ...base, clientRequestId: nuevoId() });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("VEHICULO_CON_ORDEN_ABIERTA");
      expect(r.veredicto.mensaje).toContain("OS-FUN-000001");
    });

    it("con confirmación sí permite la segunda orden", async () => {
      // Puede ser un correctivo urgente sobre un vehículo con preventivo.
      await nuevaOrden();
      const r = await servicio.crear(COORD, {
        ...base,
        clientRequestId: nuevoId(),
        confirmarDuplicada: true,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.avisoVehiculoOcupado).toBeTruthy();
    });

    it("registra la creación en el historial", async () => {
      const orden = await nuevaOrden();
      const h = await servicio.historial(COORD, orden.id);
      expect(h).toHaveLength(1);
      expect(h[0]?.estadoNuevo).toBe("programada");
    });
  });

  describe("flujo completo", () => {
    it("recorre programada → proceso → revisión → cliente → cerrada", async () => {
      let orden = await hastaRevision();
      expect(orden.estado).toBe("en_revision");

      const aprobada = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "pendiente_cliente");
      if (!aprobada.ok) throw new Error(aprobada.veredicto.mensaje);
      orden = aprobada.valor;
      expect(orden.estado).toBe("pendiente_cliente");

      const cerrada = await servicio.cambiarEstado(CLIENTE, orden.id, enLinea(orden.version), "cerrada");
      if (!cerrada.ok) throw new Error(cerrada.veredicto.mensaje);
      expect(cerrada.valor.estado).toBe("cerrada");
      expect(cerrada.valor.cierreTacito).toBe(false);
    });

    it("no se envía a revisión sin firma", async () => {
      const orden = await nuevaOrden();
      const enProceso = await servicio.cambiarEstado(TEC1, orden.id, enLinea(orden.version), "en_proceso");
      if (!enProceso.ok) throw new Error();

      const r = await servicio.cambiarEstado(TEC1, enProceso.valor.id, enLinea(enProceso.valor.version),
        "en_revision",
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("SIN_FIRMA");
    });

    it("no se aprueba una orden sin mediciones", async () => {
      let orden = await nuevaOrden();
      const p = await servicio.cambiarEstado(TEC1, orden.id, enLinea(orden.version), "en_proceso");
      if (!p.ok) throw new Error();
      const f = await servicio.firmar(TEC1, p.valor.id, enLinea(p.valor.version), {
        nombre: "Luis",
        cedula: "772",
        trazo: "[[[0,0],[10,5]]]",
        consentimiento: "2026-09-v1",
        versionContenido: p.valor.versionContenido,
      });
      if (!f.ok) throw new Error();
      const rev = await servicio.cambiarEstado(TEC1, f.valor.id, enLinea(f.valor.version), "en_revision");
      if (!rev.ok) throw new Error();
      orden = rev.valor;

      const r = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "pendiente_cliente");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("SIN_MEDICIONES");
    });
  });

  describe("la firma se ata a la versión", () => {
    it("editar la orden después de firmar invalida la firma", async () => {
      const orden = await hastaRevision();
      // Simula que se devolvió y el técnico corrigió una medición
      const devuelta = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "en_proceso", {
        motivo: "Falta el número de parche",
      });
      if (!devuelta.ok) throw new Error();

      const editada = await servicio.actualizarDatos(TEC1, devuelta.valor.id, enLinea(devuelta.valor.version),
        { hallazgos: "Corte en el flanco" },
      );
      if (!editada.ok) throw new Error();

      // Ahora la versión avanzó y la firma quedó atrás
      const r = await servicio.cambiarEstado(TEC1, editada.valor.id, enLinea(editada.valor.version),
        "en_revision",
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("SIN_FIRMA");
    });

    it("volver a firmar la revalida", async () => {
      const orden = await hastaRevision();
      const devuelta = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "en_proceso", {
        motivo: "Corregir",
      });
      if (!devuelta.ok) throw new Error();
      const editada = await servicio.actualizarDatos(TEC1, devuelta.valor.id, enLinea(devuelta.valor.version), {
        hallazgos: "Corregido",
      });
      if (!editada.ok) throw new Error();

      const refirmada = await servicio.firmar(TEC1, editada.valor.id, enLinea(editada.valor.version), {
        nombre: "Luis Reyna",
        cedula: "77221004",
        trazo: "[[[0,0],[10,5]]]",
        consentimiento: "2026-09-v1",
        versionContenido: editada.valor.versionContenido,
      });
      if (!refirmada.ok) throw new Error();

      const r = await servicio.cambiarEstado(TEC1, refirmada.valor.id, enLinea(refirmada.valor.version),
        "en_revision",
      );
      expect(r.ok).toBe(true);
    });
  });

  describe("el coordinador devuelve, no corrige", () => {
    it("no puede editar las mediciones del técnico", async () => {
      const orden = await nuevaOrden();
      const p = await servicio.cambiarEstado(TEC1, orden.id, enLinea(orden.version), "en_proceso");
      if (!p.ok) throw new Error();

      const r = await servicio.actualizarDatos(COORD, p.valor.id, enLinea(p.valor.version), {
        hallazgos: "Lo corrijo yo",
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("SOLO_ASIGNADO");
    });

    it("devolver exige motivo", async () => {
      const orden = await hastaRevision();
      const sinMotivo = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "en_proceso");
      expect(sinMotivo.ok).toBe(false);
      if (sinMotivo.ok) return;
      expect(sinMotivo.veredicto.codigo).toBe("SIN_MOTIVO");
    });

    it("el motivo queda visible para el técnico", async () => {
      const orden = await hastaRevision();
      const r = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "en_proceso", {
        motivo: "Falta el número de parche de la posición 6",
      });
      if (!r.ok) throw new Error();
      expect(r.valor.motivoDevolucion).toContain("posición 6");
    });

    it("el coordinador sí puede dejar instrucciones", async () => {
      const orden = await nuevaOrden();
      const r = await servicio.actualizarNota(COORD, orden.id, enLinea(orden.version),
        "Presentarse en portería con Luis",
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.notaCoordinador).toContain("portería");
    });
  });

  describe("congelado al aprobar", () => {
    it("estampa cliente, vehículo y técnico", async () => {
      const orden = await hastaRevision();
      const r = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "pendiente_cliente");
      if (!r.ok) throw new Error(r.veredicto.mensaje);

      expect(r.valor.clienteNombre).toBe("Transportes Reyna");
      expect(r.valor.vehiculoCodigo).toBe("CA-12");
      expect(r.valor.tecnicoNombre).toBe("Carlos Méndez");
      expect(r.valor.congeladoEn).not.toBeNull();
    });

    it("el documento no cambia si después cambian los datos maestros", async () => {
      // Es la razón del congelado: el cliente aprobó un documento concreto.
      const orden = await hastaRevision();
      const r = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "pendiente_cliente");
      if (!r.ok) throw new Error();

      await db.query(`UPDATE "Cliente" SET nombre = 'Reyna Logística S.A.S.' WHERE id = 'cli-1'`);
      await db.query(`UPDATE "Vehiculo" SET codigo = 'CA-99' WHERE id = 'veh-1'`);

      const recargada = await db.query(
        `SELECT "clienteNombre", "vehiculoCodigo" FROM "OrdenServicio" WHERE id = $1`,
        [orden.id],
      );
      expect(recargada.rows[0].clienteNombre).toBe("Transportes Reyna");
      expect(recargada.rows[0].vehiculoCodigo).toBe("CA-12");
    });

    it("marca la autoaprobación cuando quien aprueba ejecutó", async () => {
      const orden = await hastaRevision();
      const comoEjecutor: Contexto = { empresaId: EMP, rol: "coordinador", usuarioId: "u-tec1" };
      const r = await servicio.cambiarEstado(comoEjecutor, orden.id, enLinea(orden.version), "pendiente_cliente");
      if (!r.ok) throw new Error();
      expect(r.valor.autoAprobada).toBe(true);
    });

    it("calcula el plazo del cliente en días hábiles", async () => {
      const orden = await hastaRevision();
      const r = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "pendiente_cliente");
      if (!r.ok) throw new Error();
      // Lunes 14 + 5 hábiles = lunes 21
      expect(r.valor.enviadoClienteEn).toBe("2026-09-14");
      expect(r.valor.limiteCliente).toBe("2026-09-21");
    });
  });

  describe("aprobación del cliente", () => {
    async function esperandoCliente() {
      const orden = await hastaRevision();
      const r = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "pendiente_cliente");
      if (!r.ok) throw new Error(r.veredicto.mensaje);
      return r.valor;
    }

    it("el cliente aprueba y la orden cierra", async () => {
      const orden = await esperandoCliente();
      const r = await servicio.cambiarEstado(CLIENTE, orden.id, enLinea(orden.version), "cerrada");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.cierreTacito).toBe(false);
    });

    it("el cliente objeta con motivo y vuelve al técnico", async () => {
      const orden = await esperandoCliente();
      const r = await servicio.cambiarEstado(CLIENTE, orden.id, enLinea(orden.version), "en_proceso", {
        motivo: "La posición 7 no se tocó",
      });
      if (!r.ok) throw new Error(r.veredicto.mensaje);
      expect(r.valor.estado).toBe("en_proceso");
      expect(r.valor.motivoDevolucion).toContain("posición 7");
      // Se limpia el plazo: ya no está en manos del cliente
      expect(r.valor.limiteCliente).toBeNull();
    });

    it("no puede objetar sin decir qué está mal", async () => {
      const orden = await esperandoCliente();
      const r = await servicio.cambiarEstado(CLIENTE, orden.id, enLinea(orden.version), "en_proceso");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("SIN_MOTIVO");
    });

    it("el cierre por vencimiento queda marcado como tácito", async () => {
      // Nunca disfrazado de aprobación expresa.
      const orden = await esperandoCliente();
      reloj = new Date("2026-09-22T09:00:00.000Z"); // pasado el límite

      const r = await servicio.cerrarPorVencimiento(orden.id, "u-sistema");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.estado).toBe("cerrada");
      expect(r.valor.cierreTacito).toBe(true);
    });

    it("no cierra por vencimiento antes del plazo", async () => {
      const orden = await esperandoCliente();
      const r = await servicio.cerrarPorVencimiento(orden.id, "u-sistema");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("PLAZO_VIGENTE");
    });

    it("el coordinador puede forzar el cierre, pero justificando", async () => {
      const orden = await esperandoCliente();
      const sinMotivo = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "cerrada");
      expect(sinMotivo.ok).toBe(false);

      const conMotivo = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "cerrada", {
        motivo: "Cliente no responde hace 8 días",
      });
      expect(conMotivo.ok).toBe(true);
    });
  });

  describe("historial visible para el cliente", () => {
    it("el cliente no ve las devoluciones internas", async () => {
      // Es control de calidad interno: expone al técnico y no le aporta nada.
      const orden = await hastaRevision();
      await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "en_proceso", {
        motivo: "Falta el parche",
      });

      const delCliente = await servicio.historial(CLIENTE, orden.id);
      const motivos = delCliente.map((h) => h.motivo);
      expect(motivos).not.toContain("Falta el parche");

      const delCoordinador = await servicio.historial(COORD, orden.id);
      expect(delCoordinador.map((h) => h.motivo)).toContain("Falta el parche");
    });

    it("sí ve su propia objeción", async () => {
      const orden = await hastaRevision();
      const aprobada = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "pendiente_cliente");
      if (!aprobada.ok) throw new Error();

      await servicio.cambiarEstado(CLIENTE, aprobada.valor.id, enLinea(aprobada.valor.version), "en_proceso", {
        motivo: "La posición 7 no se tocó",
      });

      const h = await servicio.historial(CLIENTE, orden.id);
      expect(h.map((x) => x.motivo)).toContain("La posición 7 no se tocó");
    });
  });

  describe("bloqueo optimista", () => {
    it("rechaza la escritura si otra persona modificó antes", async () => {
      const orden = await nuevaOrden();
      const primera = await servicio.actualizarNota(COORD, orden.id, enLinea(orden.version), "Primera");
      expect(primera.ok).toBe(true);

      // El segundo usuario tenía la versión vieja en pantalla
      const segunda = await servicio.actualizarNota(COORD, orden.id, enLinea(orden.version), "Segunda");
      expect(segunda.ok).toBe(false);
      if (segunda.ok) return;
      expect(segunda.veredicto.codigo).toBe("CONFLICTO_VERSION");
    });

    it("no pisa el trabajo del primero", async () => {
      const orden = await nuevaOrden();
      await servicio.actualizarNota(COORD, orden.id, enLinea(orden.version), "Primera");
      await servicio.actualizarNota(COORD, orden.id, enLinea(orden.version), "Segunda");

      const r = await db.query(`SELECT "notaCoordinador" FROM "OrdenServicio" WHERE id = $1`, [
        orden.id,
      ]);
      expect(r.rows[0].notaCoordinador).toBe("Primera");
    });

    it("cada cambio de estado incrementa la versión", async () => {
      const orden = await nuevaOrden();
      const r = await servicio.cambiarEstado(TEC1, orden.id, enLinea(orden.version), "en_proceso");
      if (!r.ok) throw new Error();
      expect(r.valor.version).toBe(orden.version + 1);
    });
  });

  describe("reasignación", () => {
    it("el coordinador reasigna a un técnico de la misma sede", async () => {
      const orden = await nuevaOrden();
      await db.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES ('u-tec2',$1)`, [SEDE]);
      const r = await servicio.reasignar(COORD, orden.id, enLinea(orden.version), "u-tec2", "Incapacidad");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.tecnicoId).toBe("u-tec2");
    });

    it("no reasigna a un técnico de otra sede", async () => {
      const orden = await nuevaOrden();
      const r = await servicio.reasignar(COORD, orden.id, enLinea(orden.version), "u-tec2", "Cambio de turno");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("TECNICO_AJENO_A_SEDE");
    });

    it("el técnico no reasigna", async () => {
      const orden = await nuevaOrden();
      const r = await servicio.reasignar(TEC1, orden.id, enLinea(orden.version), "u-tec2", "Cambio de turno");
      expect(r.ok).toBe(false);
    });
  });

  describe("listados por rol", () => {
    it("el técnico solo ve las suyas", async () => {
      await nuevaOrden(); // asignada a u-tec1
      await db.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES ('u-tec2',$1)`, [SEDE]);
      await servicio.crear(COORD, {
        ...base,
        vehiculoId: "veh-2",
        tecnicoId: "u-tec2",
        clientRequestId: nuevoId(),
      });

      const deTec1 = await servicio.listar(TEC1);
      expect(deTec1).toHaveLength(1);
      expect(deTec1[0]?.tecnicoId).toBe("u-tec1");

      const deTec2 = await servicio.listar(TEC2);
      expect(deTec2.every((o) => o.tecnicoId === "u-tec2")).toBe(true);
    });

    it("el coordinador ve todas", async () => {
      await nuevaOrden();
      await nuevaOrden(COORD, { vehiculoId: "veh-2", confirmarDuplicada: true });
      expect(await servicio.listar(COORD)).toHaveLength(2);
    });
  });

  describe("anulación", () => {
    it("el coordinador anula con motivo", async () => {
      const orden = await nuevaOrden();
      const r = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "anulada", {
        motivo: "El cliente canceló la visita",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.estado).toBe("anulada");
    });

    it("no anula sin motivo", async () => {
      const orden = await nuevaOrden();
      const r = await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "anulada");
      expect(r.ok).toBe(false);
    });

    it("una orden anulada libera el vehículo", async () => {
      const orden = await nuevaOrden();
      await servicio.cambiarEstado(COORD, orden.id, enLinea(orden.version), "anulada", { motivo: "Cancelada" });

      const r = await servicio.crear(COORD, { ...base, clientRequestId: nuevoId() });
      expect(r.ok).toBe(true);
    });
  });
  describe("modo comando: la jornada sin señal no choca consigo misma", () => {
    /** Firma en modo comando, con la versión de contenido que vio el técnico. */
    async function firmarComoComando(ordenId: string, versionContenido: number) {
      return servicio.firmar(TEC1, ordenId, COMANDO, {
        nombre: "Luis Reyna", cedula: "77221004",
        trazo: "[[[0,0],[10,5]]]", consentimiento: "2026-09-v1", versionContenido,
      });
    }

    it("varias operaciones encoladas se aplican en orden sin conflictos", async () => {
      // El caso real: el técnico trabaja sin señal y al reconectar se envía
      // todo. Con la versión general, la segunda ya llevaba una versión vieja.
      const orden = await nuevaOrden(TEC1);
      const datos = await servicio.actualizarDatos(TEC1, orden.id, COMANDO, { kilometraje: 78900 });
      expect(datos.ok).toBe(true);
      const hallazgos = await servicio.actualizarDatos(TEC1, orden.id, COMANDO, { hallazgos: "Desgaste" });
      expect(hallazgos.ok).toBe(true);

      await db.query(`INSERT INTO "LlantaRegistro" (id,"ordenId",posicion) VALUES ($1,$2,1)`, [nuevoId(), orden.id]);
      if (!hallazgos.ok) return;
      const firma = await firmarComoComando(orden.id, hallazgos.valor.versionContenido);
      expect(firma.ok).toBe(true);

      const envio = await servicio.cambiarEstado(TEC1, orden.id, COMANDO, "en_revision");
      expect(envio.ok).toBe(true);
    });

    it("la misma secuencia en línea con una versión vieja SÍ choca", async () => {
      // Confirma que el modo en línea sigue protegiendo: es justo el choque
      // que el modo comando evita para el dispositivo.
      const orden = await nuevaOrden(TEC1);
      await servicio.actualizarDatos(TEC1, orden.id, enLinea(orden.version), { kilometraje: 1 });
      const r = await servicio.actualizarDatos(TEC1, orden.id, enLinea(orden.version), { kilometraje: 2 });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("CONFLICTO_VERSION");
    });

    it("sin versión, las reglas del negocio siguen mandando", async () => {
      // Comando no significa "sin control": se valida contra el estado actual.
      const orden = await nuevaOrden(TEC1);
      await db.query(`UPDATE "OrdenServicio" SET estado = 'cerrada' WHERE id = $1`, [orden.id]);
      const r = await servicio.actualizarDatos(TEC1, orden.id, COMANDO, { hallazgos: "tarde" });
      expect(r.ok).toBe(false);
    });

    it("un técnico que ya no está asignado no puede escribir", async () => {
      // El caso que importa: el coordinador reasignó mientras el técnico
      // seguía sin señal.
      const orden = await nuevaOrden(TEC1);
      await db.query(`UPDATE "OrdenServicio" SET tecnico_id = 'u-tec2' WHERE id = $1`, [orden.id]);
      const r = await servicio.actualizarDatos(TEC1, orden.id, COMANDO, { hallazgos: "x" });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("SOLO_ASIGNADO");
    });
  });

  describe("la firma se ancla al contenido que se vio", () => {
    const firmaBase = { nombre: "Luis Reyna", cedula: "77221004", trazo: "[[[0,0],[10,5]]]", consentimiento: "2026-09-v1" };

    it("se rechaza si el contenido firmado no es el que tiene el servidor", async () => {
      // Por ejemplo, una medición quedó apartada: el cliente firmó algo que
      // el servidor no tiene. Aceptarla afirmaría una aprobación que no hubo.
      const orden = await nuevaOrden(TEC1);
      const r = await servicio.firmar(TEC1, orden.id, COMANDO, {
        ...firmaBase, versionContenido: orden.versionContenido + 3,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("FIRMA_DESACTUALIZADA");
    });

    it("guarda el trazo y la constancia del consentimiento", async () => {
      // Antes el contrato no los conocía y el servidor los perdía.
      const orden = await nuevaOrden(TEC1);
      await servicio.firmar(TEC1, orden.id, COMANDO, { ...firmaBase, versionContenido: orden.versionContenido });
      const f = await db.query(
        `SELECT "firmaTrazo", "firmaConsentimiento" FROM "OrdenServicio" WHERE id = $1`, [orden.id],
      );
      expect(f.rows[0].firmaTrazo).toBe("[[[0,0],[10,5]]]");
      expect(f.rows[0].firmaConsentimiento).toBe("2026-09-v1");
    });

    it("no se firma sin consentimiento", async () => {
      const orden = await nuevaOrden(TEC1);
      const r = await servicio.firmar(TEC1, orden.id, COMANDO, {
        ...firmaBase, consentimiento: " ", versionContenido: orden.versionContenido,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("SIN_CONSENTIMIENTO");
    });
  });

  describe("reasignar no marca la orden como devuelta", () => {
    it("el motivo no va a motivoDevolucion", async () => {
      // Si fuera ahí, el celular del técnico nuevo mostraría la orden como
      // "Devuelta para corregir: Cambio de turno".
      const orden = await nuevaOrden();
      await db.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES ('u-tec2',$1)`, [SEDE]);
      const r = await servicio.reasignar(COORD, orden.id, COMANDO, "u-tec2", "Cambio de turno");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.motivoDevolucion).toBeNull();
      expect(r.valor.tecnicoId).toBe("u-tec2");
    });

    it("el motivo queda en el historial, sin mostrarse al cliente", async () => {
      const orden = await nuevaOrden();
      await db.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES ('u-tec2',$1)`, [SEDE]);
      await servicio.reasignar(COORD, orden.id, COMANDO, "u-tec2", "Cambio de turno");

      const delCoordinador = await servicio.historial(COORD, orden.id);
      expect(delCoordinador.map((h) => h.motivo)).toContain("Reasignada: Cambio de turno");
      const delCliente = await servicio.historial(CLIENTE, orden.id);
      expect(delCliente.map((h) => h.motivo)).not.toContain("Reasignada: Cambio de turno");
    });
  });
});

describe.skipIf(disponible)("órdenes de servicio", () => {
  it("omitidas: falta PostgreSQL", () => {
    expect(disponible).toBe(false);
  });
});
