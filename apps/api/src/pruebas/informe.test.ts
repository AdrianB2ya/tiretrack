import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { hayBaseDeDatos, conectarAislado } from "./base";
import { ServicioInforme, type Contexto } from "../informe/servicio";
import { encabezados } from "@tiretrack/domain";

/**
 * Informe y auditoría contra PostgreSQL real.
 *
 * Lo que se prueba aquí es la consulta —que aplane bien una orden a filas por
 * posición, que los filtros acoten y que los numeric lleguen como número— y
 * que toda exportación deje rastro.
 */

const disponible = await hayBaseDeDatos();

const EMP = "emp-inf";
const ADMIN: Contexto = {
  empresaId: EMP,
  rol: "administrador",
  usuarioId: "u-adm",
  usuarioNombre: "Marcela Ospina",
  ip: "190.0.0.1",
};

let db: pg.Client;
let servicio: ServicioInforme;

describe.skipIf(!disponible)("informe", () => {
  beforeAll(async () => {
    db = await conectarAislado(import.meta.url);

    await db.query(`
      DROP TABLE IF EXISTS "Auditoria", "LlantaServicio", "LlantaRegistro",
                           "OrdenServicio", "Servicio", "Diseno", "Marca",
                           "Vehiculo", "Usuario" CASCADE;
      DROP TYPE IF EXISTS "EstadoOrden", "AccionAuditoria" CASCADE;

      CREATE TYPE "EstadoOrden" AS ENUM
        ('borrador','programada','en_proceso','en_revision','pendiente_cliente','cerrada','anulada');
      CREATE TYPE "AccionAuditoria" AS ENUM
        ('crear','actualizar','deshabilitar','cambiar_estado','reasignar','aprobar','anular',
         'login_exitoso','login_fallido','recuperar_password','suplantar_empresa',
         'exportar_informe','exportar_listado');

      CREATE TABLE "Vehiculo" (id text PRIMARY KEY, codigo text, placa text);
      CREATE TABLE "Usuario" (id text PRIMARY KEY, nombre text NOT NULL);
      CREATE TABLE "Marca" (id text PRIMARY KEY, nombre text NOT NULL, "reemplazadaPorId" text);
      CREATE TABLE "Diseno" (id text PRIMARY KEY, nombre text NOT NULL, "reemplazadoPorId" text);
      CREATE TABLE "Servicio" (id text PRIMARY KEY, codigo text NOT NULL, nombre text NOT NULL, orden int DEFAULT 0);

      CREATE TABLE "OrdenServicio" (
        id text PRIMARY KEY,
        "empresaId" text NOT NULL,
        "clienteId" text NOT NULL,
        "vehiculoId" text,
        folio text, "codigoReferencia" text,
        estado "EstadoOrden" NOT NULL DEFAULT 'cerrada',
        fecha date NOT NULL,
        kilometraje integer,
        "vehiculoCodigo" text, "vehiculoPlaca" text
      );

      CREATE TABLE "LlantaRegistro" (
        id text PRIMARY KEY,
        "ordenId" text NOT NULL REFERENCES "OrdenServicio"(id) ON DELETE CASCADE,
        posicion integer NOT NULL,
        "marcaId" text, "disenoId" text,
        medida text, "numCalor" text, serial text, dot text, "estadoLlanta" text,
        "psiEncontrada" numeric(6,2), "psiCalibrado" numeric(6,2), profundidad numeric(5,2),
        "noIdentificada" boolean NOT NULL DEFAULT false,
        "desPosicionOrigen" integer, "desNumCalor" text, "desSerial" text, "desDot" text,
        "desMedida" text, "desProfundidad" numeric(5,2),
        "desMarcaId" text, "desDisenoId" text, "desDestino" text, "desDetalle" text,
        "profExterior" numeric(5,2), "profCentro" numeric(5,2), "profInterior" numeric(5,2),
        "desProfExterior" numeric(5,2), "desProfCentro" numeric(5,2), "desProfInterior" numeric(5,2)
      );

      CREATE TABLE "LlantaServicio" (
        "llantaRegistroId" text NOT NULL REFERENCES "LlantaRegistro"(id) ON DELETE CASCADE,
        "servicioId" text NOT NULL REFERENCES "Servicio"(id),
        PRIMARY KEY ("llantaRegistroId","servicioId")
      );

      CREATE TABLE "Auditoria" (
        id text PRIMARY KEY,
        "empresaId" text, "usuarioId" text, "usuarioNombre" text, rol text,
        accion "AccionAuditoria" NOT NULL,
        detalle jsonb, ip text, "viaSuplantacion" boolean NOT NULL DEFAULT false,
        "creadoEn" timestamptz NOT NULL DEFAULT clock_timestamp()
      );
    `);

    servicio = new ServicioInforme(db, () => new Date("2026-09-14T10:00:00.000Z"));
  }, 60_000);

  afterAll(async () => {
    if (db) await db.end();
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE "Auditoria","LlantaServicio","LlantaRegistro","OrdenServicio",
                             "Servicio","Diseno","Marca","Vehiculo" CASCADE`);

    await db.query(`INSERT INTO "Vehiculo" (id,codigo,placa) VALUES ('veh-1','CA-12','SXK482'),('veh-2','CV-07','TRD119')`);
    await db.query(`INSERT INTO "Marca" (id,nombre) VALUES ('mar-1','Michelin'),('mar-2','Bridgestone')`);
    await db.query(`INSERT INTO "Diseno" (id,nombre) VALUES ('dis-1','XZY-3'),('dis-2','R268')`);
    await db.query(`INSERT INTO "Servicio" (id,codigo,nombre,orden) VALUES
      ('srv-cal','CALI','Calibración',4),('srv-ret','RETO','Retorqueo',5),
      ('srv-mon','MONT','Montaje',1),('srv-bal','BALA','Balanceo',7)`);

    // Orden cerrada con dos posiciones
    await db.query(`INSERT INTO "OrdenServicio"
      (id,"empresaId","clienteId","vehiculoId",folio,estado,fecha,kilometraje,"vehiculoCodigo","vehiculoPlaca")
      VALUES ('ord-1',$1,'cli-1','veh-1','OS-FUN-000001','cerrada','2026-09-10',78900,'CA-12','SXK482')`, [EMP]);

    await db.query(`INSERT INTO "LlantaRegistro"
      (id,"ordenId",posicion,"marcaId","disenoId",medida,"numCalor",serial,dot,"estadoLlanta",
       "psiEncontrada","psiCalibrado",profundidad)
      VALUES ('lr-1','ord-1',1,'mar-1','dis-1','295/80R22.5','H2201','MX10023458','3624','Usada',105,110,9.5)`);
    await db.query(`INSERT INTO "LlantaServicio" VALUES ('lr-1','srv-cal'),('lr-1','srv-ret')`);

    // Posición con montaje y llanta desmontada
    await db.query(`INSERT INTO "LlantaRegistro"
      (id,"ordenId",posicion,"marcaId","disenoId",medida,serial,dot,"estadoLlanta",profundidad,
       "desPosicionOrigen","desSerial","desMarcaId","desDisenoId","desProfundidad","desDestino","desDetalle")
      VALUES ('lr-2','ord-1',5,'mar-2','dis-2','295/80R22.5','BS77440012','2126','Nueva',16,
              5,'BS66110044','mar-2','dis-2',3,'Desecho','Desgaste al límite')`);
    await db.query(`INSERT INTO "LlantaServicio" VALUES ('lr-2','srv-mon')`);

    // Orden sin cerrar, de otro vehículo
    await db.query(`INSERT INTO "OrdenServicio"
      (id,"empresaId","clienteId","vehiculoId",folio,estado,fecha,kilometraje)
      VALUES ('ord-2',$1,'cli-2','veh-2','OS-FUN-000002','en_proceso','2026-09-12',45200)`, [EMP]);
    await db.query(`INSERT INTO "LlantaRegistro"
      (id,"ordenId",posicion,serial,profundidad,"noIdentificada")
      VALUES ('lr-3','ord-2',3,NULL,7.5,true)`);
  });

  describe("una fila por posición", () => {
    it("aplana las órdenes a posiciones", async () => {
      const filas = await servicio.consultar(ADMIN);
      expect(filas).toHaveLength(3); // 2 de ord-1 + 1 de ord-2
    });

    it("trae los servicios agregados, sin consulta por posición", async () => {
      // Con 22 posiciones por orden, una consulta por cada una sería el
      // problema de las N+1 consultas.
      const filas = await servicio.consultar(ADMIN, { vehiculoId: "veh-1" });
      const pos1 = filas.find((f) => f.posicion === 1);
      expect(pos1?.servicios).toEqual(["CALI", "RETO"]);
    });

    it("resuelve los nombres de marca y diseño", async () => {
      const filas = await servicio.consultar(ADMIN, { vehiculoId: "veh-1" });
      const pos1 = filas.find((f) => f.posicion === 1);
      expect(pos1?.marca).toBe("Michelin");
      expect(pos1?.diseno).toBe("XZY-3");
    });

    it("una marca unificada en la revisión se informa con el nombre de la correcta", async () => {
      // "Michelim" creada en campo y unificada con Michelin: la medición
      // conserva su id, el informe agrupa por la correcta.
      await db.query(`INSERT INTO "Marca" (id,nombre,"reemplazadaPorId") VALUES ('mar-typo','Michelim','mar-1')`);
      await db.query(`INSERT INTO "Diseno" (id,nombre,"reemplazadoPorId") VALUES ('dis-typo','XZY3','dis-1')`);
      await db.query(`UPDATE "LlantaRegistro" SET "marcaId" = 'mar-typo', "disenoId" = 'dis-typo' WHERE id = 'lr-1'`);
      const pos1 = (await servicio.consultar(ADMIN, { vehiculoId: "veh-1" })).find((f) => f.posicion === 1);
      expect(pos1?.marca).toBe("Michelin");
      expect(pos1?.diseno).toBe("XZY-3");
    });

    it("incluye el bloque de llanta desmontada", async () => {
      const filas = await servicio.consultar(ADMIN, { vehiculoId: "veh-1" });
      const pos5 = filas.find((f) => f.posicion === 5);
      expect(pos5?.desSerial).toBe("BS66110044");
      expect(pos5?.desDestino).toBe("Desecho");
      expect(pos5?.desMarca).toBe("Bridgestone");
    });

    it("los numeric llegan como número, no como texto", async () => {
      // Sin convertir, el informe mostraría "9.50" y las comparaciones de
      // profundidad fallarían en silencio.
      const filas = await servicio.consultar(ADMIN, { vehiculoId: "veh-1" });
      const pos1 = filas.find((f) => f.posicion === 1);
      expect(typeof pos1?.profundidad).toBe("number");
      expect(pos1?.profundidad).toBe(9.5);
      expect(typeof pos1?.psiEncontrada).toBe("number");
    });

    it("usa el código de vehículo congelado si lo hay", async () => {
      await db.query(`UPDATE "Vehiculo" SET codigo = 'CA-99' WHERE id = 'veh-1'`);
      const filas = await servicio.consultar(ADMIN, { vehiculoId: "veh-1" });
      expect(filas[0]?.vehiculoCodigo).toBe("CA-12");
    });
  });

  describe("filtros", () => {
    it("filtra por vehículo", async () => {
      const filas = await servicio.consultar(ADMIN, { vehiculoId: "veh-2" });
      expect(filas).toHaveLength(1);
    });

    it("filtra por cliente", async () => {
      expect(await servicio.consultar(ADMIN, { clienteId: "cli-2" })).toHaveLength(1);
    });

    it("filtra por rango de fechas", async () => {
      const filas = await servicio.consultar(ADMIN, { desde: "2026-09-11" });
      expect(filas.every((f) => f.fecha >= "2026-09-11")).toBe(true);
    });

    it("filtra por servicio", async () => {
      const filas = await servicio.consultar(ADMIN, { servicio: "MONT" });
      expect(filas).toHaveLength(1);
      expect(filas[0]?.posicion).toBe(5);
    });

    it("filtra por estado de llanta", async () => {
      const filas = await servicio.consultar(ADMIN, { estadoLlanta: "Nueva" });
      expect(filas).toHaveLength(1);
    });

    it("permite elegir órdenes concretas", async () => {
      const filas = await servicio.consultar(ADMIN, { ordenIds: ["ord-2"] });
      expect(filas).toHaveLength(1);
    });

    it("combina varios filtros", async () => {
      const filas = await servicio.consultar(ADMIN, {
        vehiculoId: "veh-1",
        servicio: "CALI",
      });
      expect(filas).toHaveLength(1);
      expect(filas[0]?.posicion).toBe(1);
    });
  });

  describe("identidad del servicio", () => {
    it("renombrar un servicio no vacía su columna en el histórico", async () => {
      // El informe traduce por código. Si dependiera del nombre guardado,
      // cambiar "Retorqueo" por "Reapriete" dejaría esa columna en blanco en
      // todas las órdenes viejas.
      await db.query(`UPDATE "Servicio" SET nombre = 'Reapriete' WHERE codigo = 'RETO'`);
      const r = await servicio.exportar(ADMIN, { ordenIds: ["ord-1"] });
      if (!r.ok) throw new Error();
      const [cabecera, fila] = r.valor.contenido.replace("\uFEFF", "").split("\n");
      const col = (cabecera ?? "").split(";").indexOf('"RETORQUE"');
      expect(col).toBeGreaterThan(-1);
      expect((fila ?? "").split(";")[col]).toBe('"X"');
    });
  });

  describe("búsqueda por serial", () => {
    it("encuentra la llanta montada", async () => {
      const filas = await servicio.consultar(ADMIN, { serial: "MX10023458" });
      expect(filas).toHaveLength(1);
    });

    it("encuentra también la desmontada", async () => {
      // Quien rastrea una llanta no sabe si en esa visita entró o salió.
      const filas = await servicio.consultar(ADMIN, { serial: "BS66110044" });
      expect(filas).toHaveLength(1);
      expect(filas[0]?.desSerial).toBe("BS66110044");
    });

    it("busca por coincidencia parcial", async () => {
      expect(await servicio.consultar(ADMIN, { serial: "10023" })).toHaveLength(1);
    });

    it("ignora mayúsculas", async () => {
      expect(await servicio.consultar(ADMIN, { serial: "mx10023458" })).toHaveLength(1);
    });
  });

  describe("exportación", () => {
    it("genera el CSV con las columnas del formato", async () => {
      const r = await servicio.exportar(ADMIN);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const lineas = r.valor.contenido.split("\n");
      const cabecera = (lineas[0] ?? "").replace("\uFEFF", "");
      expect(cabecera.split(";")).toHaveLength(encabezados().length);
      expect(cabecera).toContain("POSICION LLANTA");
      expect(cabecera).toContain("CALIBRACION");
    });

    it("una fila por posición en el archivo", async () => {
      const r = await servicio.exportar(ADMIN);
      if (!r.ok) throw new Error();
      // encabezado + 3 filas
      expect(r.valor.contenido.split("\n")).toHaveLength(4);
      expect(r.valor.registros).toBe(3);
    });

    it("el nombre lleva el folio si es una sola orden", async () => {
      const r = await servicio.exportar(ADMIN, { ordenIds: ["ord-1"] });
      if (!r.ok) throw new Error();
      expect(r.valor.nombreArchivo).toBe("OS-FUN-000001.csv");
    });

    it("el nombre indica la cantidad si son varias", async () => {
      const r = await servicio.exportar(ADMIN);
      if (!r.ok) throw new Error();
      expect(r.valor.nombreArchivo).toBe("informe-2-ordenes-2026-09-14.csv");
    });

    it("la fecha del nombre es la de Colombia, no la de UTC", async () => {
      // 9 p. m. del 14 en Bogotá; en UTC ya es el 15.
      const noche = new ServicioInforme(db, () => new Date("2026-09-15T02:00:00.000Z"));
      const r = await noche.exportar(ADMIN);
      if (!r.ok) throw new Error();
      expect(r.valor.nombreArchivo).toBe("informe-2-ordenes-2026-09-14.csv");
    });

    it("informa cuántas órdenes iban sin cerrar", async () => {
      const r = await servicio.exportar(ADMIN);
      if (!r.ok) throw new Error();
      expect(r.valor.sinCerrar).toBe(1);
    });

    it("no exporta un archivo vacío", async () => {
      const r = await servicio.exportar(ADMIN, { vehiculoId: "no-existe" });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("SIN_REGISTROS");
    });

    it("la llanta sin identificar lo dice en el archivo", async () => {
      const r = await servicio.exportar(ADMIN, { vehiculoId: "veh-2" });
      if (!r.ok) throw new Error();
      expect(r.valor.contenido).toContain("SIN IDENTIFICAR");
    });
  });

  describe("auditoría de exportaciones", () => {
    it("toda exportación deja rastro", async () => {
      // Sin esto, una fuga de información no tiene rastro.
      await servicio.exportar(ADMIN);
      const filas = await db.query(`SELECT * FROM "Auditoria" WHERE accion = 'exportar_informe'`);
      expect(filas.rowCount).toBe(1);
    });

    it("registra quién, cuántos registros y qué folios", async () => {
      await servicio.exportar(ADMIN);
      const r = await db.query(`SELECT "usuarioNombre", rol, detalle, ip FROM "Auditoria"`);
      const fila = r.rows[0];
      expect(fila.usuarioNombre).toBe("Marcela Ospina");
      expect(fila.rol).toBe("administrador");
      expect(fila.ip).toBe("190.0.0.1");
      expect(fila.detalle.registros).toBe(3);
      expect(fila.detalle.folios).toContain("OS-FUN-000001");
    });

    it("registra cuántas iban sin cerrar", async () => {
      // Si aparece un archivo con datos que no cuadran, se puede ver que
      // salió preliminar.
      await servicio.exportar(ADMIN);
      const r = await db.query(`SELECT detalle FROM "Auditoria"`);
      expect(r.rows[0].detalle.sinCerrar).toBe(1);
    });

    it("guarda los filtros usados", async () => {
      // No es lo mismo exportar una orden propia que la cartera de un
      // cliente entero en seis meses.
      await servicio.exportar(ADMIN, { clienteId: "cli-1", desde: "2026-01-01" });
      const r = await db.query(`SELECT detalle FROM "Auditoria"`);
      expect(r.rows[0].detalle.filtros.clienteId).toBe("cli-1");
      expect(r.rows[0].detalle.filtros.desde).toBe("2026-01-01");
    });

    it("no guarda filtros vacíos como ruido", async () => {
      await servicio.exportar(ADMIN, { clienteId: "cli-1", serial: "" });
      const r = await db.query(`SELECT detalle FROM "Auditoria"`);
      expect(Object.keys(r.rows[0].detalle.filtros)).toEqual(["clienteId"]);
    });

    it("distingue desde dónde se exportó", async () => {
      await servicio.exportar(ADMIN, {}, "detalle de orden");
      const r = await db.query(`SELECT detalle FROM "Auditoria"`);
      expect(r.rows[0].detalle.origen).toBe("detalle de orden");
    });

    it("un intento sin resultados no queda registrado", async () => {
      await servicio.exportar(ADMIN, { vehiculoId: "no-existe" });
      const r = await db.query(`SELECT count(*)::int AS n FROM "Auditoria"`);
      expect(r.rows[0].n).toBe(0);
    });

    it("la bandeja de auditoría lista lo más reciente primero", async () => {
      await servicio.exportar(ADMIN, { ordenIds: ["ord-1"] });
      await servicio.exportar(ADMIN, { ordenIds: ["ord-2"] });
      const lista = await servicio.listarAuditoria(ADMIN);
      expect(lista).toHaveLength(2);
      expect((lista[0] as { detalle: { filtros: { ordenIds: string[] } } }).detalle.filtros.ordenIds)
        .toEqual(["ord-2"]);
    });

    it("se puede filtrar la auditoría por usuario", async () => {
      await servicio.exportar(ADMIN);
      await servicio.exportar({ ...ADMIN, usuarioId: "u-otro", usuarioNombre: "Otro" });
      const lista = await servicio.listarAuditoria(ADMIN, { usuarioId: "u-otro" });
      expect(lista).toHaveLength(1);
    });
  });

  describe("trazabilidad de una llanta", () => {
    beforeEach(async () => {
      // La misma llanta, medida tres veces, cambiando de posición
      await db.query(`INSERT INTO "OrdenServicio"
        (id,"empresaId","clienteId","vehiculoId",folio,estado,fecha,kilometraje)
        VALUES ('ord-3',$1,'cli-1','veh-1','OS-FUN-000003','cerrada','2026-03-10',40000),
               ('ord-4',$1,'cli-1','veh-1','OS-FUN-000004','cerrada','2026-06-05',60000)`, [EMP]);
      await db.query(`INSERT INTO "LlantaRegistro" (id,"ordenId",posicion,serial,profundidad)
        VALUES ('lr-t1','ord-3',3,'MX10023458',14),
               ('lr-t2','ord-4',3,'MX10023458',11.5)`);
    });

    it("ordena el recorrido cronológicamente", async () => {
      const r = await servicio.trazabilidad(ADMIN, "MX10023458");
      expect(r.pasos.map((p) => p.fecha)).toEqual(["2026-03-10", "2026-06-05", "2026-09-10"]);
    });

    it("muestra el cambio de posición", async () => {
      // Es lo que permite ver que la llanta se rotó.
      const r = await servicio.trazabilidad(ADMIN, "MX10023458");
      expect(r.pasos.map((p) => p.posicion)).toEqual([3, 3, 1]);
    });

    it("calcula el desgaste acumulado", async () => {
      const r = await servicio.trazabilidad(ADMIN, "MX10023458");
      expect(r.desgaste?.perdida).toBe(4.5);
      expect(r.desgaste?.servicios).toBe(3);
    });

    it("sin histórico no calcula desgaste", async () => {
      const r = await servicio.trazabilidad(ADMIN, "BS77440012");
      expect(r.pasos).toHaveLength(1);
      expect(r.desgaste).toBeNull();
    });
  });
});

// Solo existe sin base: con base, un "omitido" haría fallar la guarda del CI.
if (!disponible) describe("informe", () => {
  it("omitido: falta PostgreSQL", () => {
    expect(disponible).toBe(false);
  });
});
