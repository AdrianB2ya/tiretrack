import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { hayBaseDeDatos, conectarAislado } from "./base";
import { ddlDePrueba } from "./generar-esquema";
import { TrabajosProgramados } from "../trabajos/programados";

/**
 * Trabajos programados contra PostgreSQL real.
 *
 * Lo que más importa aquí: que un fallo en un ítem no tumbe el lote, que no
 * se generen órdenes duplicadas al reintentar, y que toda acción automática
 * quede en auditoría.
 *
 * El esquema se GENERA desde Prisma, con las llaves foráneas de producción
 * que tocan estos trabajos. Antes se escribía a mano, sin ellas: el trabajo
 * asignaba las órdenes a un "usuario del sistema" que no existía, y nada lo
 * detectaba. En producción habría fallado en la primera vuelta.
 */

const disponible = await hayBaseDeDatos();

const EMP = "emp-job";

const TABLAS = [
  "Empresa", "Sede", "Usuario", "UsuarioSede", "Cliente", "SedeCliente",
  "ConfiguracionEje", "PosicionEje", "Vehiculo", "Consecutivo",
  "OrdenServicio", "OrdenEstadoHistorial", "LlantaRegistro",
  "ProgramacionRecurrente", "Auditoria", "SesionUsuario", "TokenRecuperacion",
];

/** Las de producción (manual.sql y Prisma) que estos trabajos pueden violar. */
const RESTRICCIONES: Record<string, string[]> = {
  Consecutivo: [`UNIQUE ("empresaId", "sedeId", tipo)`],
  OrdenServicio: [
    `UNIQUE ("empresaId", folio)`,
    `UNIQUE ("empresaId", "clientRequestId")`,
    `FOREIGN KEY ("tecnico_id", "sedeId") REFERENCES "UsuarioSede" ("usuarioId", "sedeId")`,
    `FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" (id)`,
  ],
  ProgramacionRecurrente: [
    `FOREIGN KEY ("tecnicoId", "sedeId") REFERENCES "UsuarioSede" ("usuarioId", "sedeId")`,
    `FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" (id)`,
  ],
  LlantaRegistro: [`FOREIGN KEY ("ordenId") REFERENCES "OrdenServicio"(id) ON DELETE CASCADE`],
};

let db: pg.Client;
let trabajos: TrabajosProgramados;
let reloj = new Date("2026-09-14T06:00:00.000Z");

describe.skipIf(!disponible)("trabajos programados", () => {
  beforeAll(async () => {
    db = await conectarAislado(import.meta.url);
    await db.query(ddlDePrueba(TABLAS, { extras: RESTRICCIONES }));
    trabajos = new TrabajosProgramados(db, () => reloj);
  }, 60_000);

  afterAll(async () => {
    if (db) await db.end();
  });

  beforeEach(async () => {
    reloj = new Date("2026-09-14T06:00:00.000Z");
    await db.query(`TRUNCATE ${TABLAS.map((t) => `"${t}"`).join(",")} CASCADE`);
    await db.query(`INSERT INTO "Empresa" (id,nombre,nit) VALUES ($1,'Asistectire','900')`, [EMP]);
    await db.query(`INSERT INTO "Sede" (id,"empresaId",nombre,codigo) VALUES ('sede-fun',$1,'Fundación','FUN')`, [EMP]);
    await db.query(
      `INSERT INTO "Usuario" (id,"empresaId",nombre,cedula,email,"passwordHash",rol) VALUES
         ('u-tec1',$1,'Carlos Méndez','1001','carlos@x.co','x','tecnico'),
         ('u-coo',$1,'Jorge Ramírez','1003','jorge@x.co','x','coordinador')`,
      [EMP],
    );
    await db.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES ('u-tec1','sede-fun'),('u-coo','sede-fun')`);
    await db.query(`INSERT INTO "Cliente" (id,"empresaId",nombre,nit) VALUES ('cli-1',$1,'Transportes Reyna','800')`, [EMP]);
    await db.query(`INSERT INTO "SedeCliente" (id,"clienteId",nombre) VALUES ('sc-1','cli-1','Planta')`);
    await db.query(
      `INSERT INTO "ConfiguracionEje" (id,"empresaId",nombre,"totalPosiciones") VALUES ('cfg-1',$1,'Camión',8)`,
      [EMP],
    );
    await db.query(
      `INSERT INTO "Vehiculo" (id,"sedeClienteId","configuracionEjeId",codigo,placa,nombre,tipo)
       VALUES ('veh-1','sc-1','cfg-1','CA-12','SXK482','Tractocamión 12','tractocamion')`,
    );
    await db.query(
      `INSERT INTO "PosicionEje" (id,"configuracionEjeId",numero,eje,lado,"tipoEje","profundidadMinima") VALUES
         ('pe-1','cfg-1',1,1,'izquierdo','direccional',3.0),
         ('pe-7','cfg-1',7,4,'izquierdo','arrastre',2.5)`,
    );
  });

  async function orden(id: string, extra: Record<string, string | null> = {}) {
    const limite = extra["limiteCliente"] ?? null;
    const estado = extra["estado"] ?? "pendiente_cliente";
    await db.query(
      `INSERT INTO "OrdenServicio"
         (id,"empresaId","sedeId","clienteId","sedeClienteId","vehiculoId",tecnico_id,
          "configuracionEjeId",folio,tipo,estado,fecha,"limiteCliente","creadoPorId")
       VALUES ($1,$2,'sede-fun','cli-1','sc-1','veh-1','u-tec1','cfg-1',$3,'preventivo',
               $4::"EstadoOrden",'2026-09-01',$5::date,'u-coo')`,
      [id, EMP, `OS-FUN-${id}`, estado, limite],
    );
  }

  // ════════════════════════════════════════════════════════════════════════

  describe("cierre por vencimiento del plazo", () => {
    it("cierra las órdenes con plazo vencido", async () => {
      await orden("o1", { limiteCliente: "2026-09-11" });
      const r = await trabajos.cerrarPlazosVencidos();
      expect(r.exitosos).toBe(1);

      const f = await db.query(`SELECT estado::text AS estado, "cierreTacito" FROM "OrdenServicio"`);
      expect(f.rows[0].estado).toBe("cerrada");
      expect(f.rows[0].cierreTacito).toBe(true);
    });

    it("el motivo dice que fue por vencimiento", async () => {
      // Nunca debe aparentar que el cliente aprobó.
      await orden("o1", { limiteCliente: "2026-09-11" });
      await trabajos.cerrarPlazosVencidos();
      const f = await db.query(`SELECT "motivoCierre" FROM "OrdenServicio"`);
      expect(f.rows[0].motivoCierre).toContain("vencimiento");
    });

    it("no toca las que aún tienen plazo", async () => {
      await orden("o1", { limiteCliente: "2026-09-20" });
      const r = await trabajos.cerrarPlazosVencidos();
      expect(r.procesados).toBe(0);
      const f = await db.query(`SELECT estado::text AS estado FROM "OrdenServicio"`);
      expect(f.rows[0].estado).toBe("pendiente_cliente");
    });

    it("el plazo vence con el día de Colombia, no con el de UTC", async () => {
      // 10 p. m. del 13 en Bogotá: en UTC ya es el 14, pero el cliente
      // todavía tiene hasta el final de su día 13.
      reloj = new Date("2026-09-14T03:00:00.000Z");
      await orden("o1", { limiteCliente: "2026-09-14" });
      expect((await trabajos.cerrarPlazosVencidos()).procesados).toBe(0);
      reloj = new Date("2026-09-14T05:00:00.000Z");
      expect((await trabajos.cerrarPlazosVencidos()).exitosos).toBe(1);
    });

    it("no toca órdenes en otro estado", async () => {
      await orden("o1", { estado: "en_proceso", limiteCliente: "2026-01-01" });
      const r = await trabajos.cerrarPlazosVencidos();
      expect(r.procesados).toBe(0);
    });

    it("registra la transición en el historial", async () => {
      await orden("o1", { limiteCliente: "2026-09-11" });
      await trabajos.cerrarPlazosVencidos();
      const h = await db.query(`SELECT motivo, "visibleCliente", "usuarioId" FROM "OrdenEstadoHistorial"`);
      expect(h.rows[0].motivo).toContain("vencimiento");
      // El cliente sí ve que su orden se cerró
      expect(h.rows[0].visibleCliente).toBe(true);
      // Y no aparece nadie como autor: el cierre tácito nunca se atribuye a
      // una persona.
      expect(h.rows[0].usuarioId).toBeNull();
    });

    it("deja rastro en auditoría", async () => {
      // Una orden cerrada sola sin rastro es indistinguible de una
      // manipulación.
      await orden("o1", { limiteCliente: "2026-09-11" });
      await trabajos.cerrarPlazosVencidos();
      const a = await db.query(`SELECT accion::text AS accion, detalle FROM "Auditoria"`);
      expect(a.rows[0].accion).toBe("cambiar_estado");
      expect(a.rows[0].detalle.motivo).toBe("cierre_tacito");
    });

    it("un fallo en una orden no tumba el resto del lote", async () => {
      // Se fuerza el fallo con un disparador que rechaza una orden concreta.
      // Fijar la versión a mano no serviría: el trabajo lee ese mismo valor
      // en el SELECT y la condición del UPDATE coincidiría igual.
      await orden("o1", { limiteCliente: "2026-09-11" });
      await orden("o2", { limiteCliente: "2026-09-12" });
      await orden("o3", { limiteCliente: "2026-09-13" });

      await db.query(`
        CREATE OR REPLACE FUNCTION fallar_o2() RETURNS trigger AS $$
        BEGIN
          IF NEW.id = 'o2' THEN RAISE EXCEPTION 'fallo simulado'; END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql;

        CREATE TRIGGER t_fallar_o2 BEFORE UPDATE ON "OrdenServicio"
          FOR EACH ROW EXECUTE FUNCTION fallar_o2();
      `);

      try {
        const r = await trabajos.cerrarPlazosVencidos();
        expect(r.procesados).toBe(3);
        expect(r.exitosos).toBe(2);
        expect(r.fallidos).toBe(1);

        const cerradas = await db.query(
          `SELECT count(*)::int AS n FROM "OrdenServicio" WHERE estado = 'cerrada'`,
        );
        expect(cerradas.rows[0].n).toBe(2);
      } finally {
        await db.query(`DROP TRIGGER IF EXISTS t_fallar_o2 ON "OrdenServicio"`);
      }
    });

    it("el fallo de una orden no deja a medias su historial", async () => {
      // Cada orden va en su propia transacción: si el UPDATE falla, tampoco
      // debe quedar la fila de historial ni el registro de auditoría.
      await orden("o2", { limiteCliente: "2026-09-11" });
      await db.query(`
        CREATE OR REPLACE FUNCTION fallar_hist() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'fallo en historial'; END $$ LANGUAGE plpgsql;

        CREATE TRIGGER t_fallar_hist BEFORE INSERT ON "OrdenEstadoHistorial"
          FOR EACH ROW EXECUTE FUNCTION fallar_hist();
      `);

      try {
        const r = await trabajos.cerrarPlazosVencidos();
        expect(r.fallidos).toBe(1);

        // El cierre se revirtió entero
        const o = await db.query(`SELECT estado::text AS estado FROM "OrdenServicio"`);
        expect(o.rows[0].estado).toBe("pendiente_cliente");
        const a = await db.query(`SELECT count(*)::int AS n FROM "Auditoria"`);
        expect(a.rows[0].n).toBe(0);
      } finally {
        await db.query(`DROP TRIGGER IF EXISTS t_fallar_hist ON "OrdenEstadoHistorial"`);
      }
    });

    it("dos ejecuciones simultáneas no cierran la orden dos veces", async () => {
      // Carrera real, no simulada: dos instancias del trabajo compitiendo,
      // como pasaría si el planificador lo dispara dos veces.
      await orden("o1", { limiteCliente: "2026-09-11" });

      const otra = await conectarAislado(import.meta.url);
      try {
        const segundo = new TrabajosProgramados(otra, () => reloj);
        const [a, b] = await Promise.all([
          trabajos.cerrarPlazosVencidos(),
          segundo.cerrarPlazosVencidos(),
        ]);

        // Exactamente una la cerró
        expect(a.exitosos + b.exitosos).toBe(1);

        const h = await db.query(`SELECT count(*)::int AS n FROM "OrdenEstadoHistorial"`);
        expect(h.rows[0].n).toBe(1);
      } finally {
        await otra.end();
      }
    });
  });

  describe("órdenes recurrentes", () => {
    async function programacion(extra: Record<string, unknown> = {}) {
      await db.query(
        `INSERT INTO "ProgramacionRecurrente"
           (id,"empresaId","sedeId","clienteId","sedeClienteId","vehiculoId","tecnicoId","creadoPorId",
            tipo,frecuencia,cada,inicio,proxima,activa)
         VALUES ('p-1',$1,'sede-fun','cli-1','sc-1','veh-1','u-tec1','u-coo','preventivo',
                 $2::"Frecuencia",$3,$6::date,$4::date,$5)`,
        [
          EMP,
          extra["frecuencia"] ?? "mensual",
          extra["cada"] ?? 1,
          extra["proxima"] ?? "2026-09-14",
          extra["activa"] ?? true,
          extra["inicio"] ?? "2026-08-14",
        ],
      );
    }

    it("genera la orden cuando toca", async () => {
      await programacion();
      const r = await trabajos.generarOrdenesRecurrentes();
      expect(r.exitosos).toBe(1);

      const o = await db.query(`SELECT estado::text AS estado, folio FROM "OrdenServicio"`);
      expect(o.rowCount).toBe(1);
      // La genera el sistema, pero la ejecuta alguien que aún no la ha visto
      expect(o.rows[0].estado).toBe("programada");
      expect(o.rows[0].folio).toBe("OS-FUN-000001");
    });

    it("avanza la próxima fecha", async () => {
      await programacion();
      await trabajos.generarOrdenesRecurrentes();
      const p = await db.query(`SELECT to_char(proxima,'YYYY-MM-DD') AS proxima FROM "ProgramacionRecurrente"`);
      expect(p.rows[0].proxima.startsWith("2026-10")).toBe(true);
    });

    it("no genera antes de tiempo", async () => {
      await programacion({ proxima: "2026-10-14" });
      const r = await trabajos.generarOrdenesRecurrentes();
      expect(r.procesados).toBe(0);
    });

    it("la recurrencia se genera el día que toca en Colombia", async () => {
      // 9 p. m. del 13 en Bogotá: la del 14 todavía no toca.
      reloj = new Date("2026-09-14T02:00:00.000Z");
      await programacion({ proxima: "2026-09-14" });
      expect((await trabajos.generarOrdenesRecurrentes()).procesados).toBe(0);
      reloj = new Date("2026-09-14T11:00:00.000Z");
      expect((await trabajos.generarOrdenesRecurrentes()).exitosos).toBe(1);
    });

    it("no genera si el vehículo ya tiene una orden abierta", async () => {
      // Sin esto, en tres meses hay cuatro órdenes abiertas del mismo camión.
      await orden("abierta", { estado: "en_proceso" });
      await programacion();
      const r = await trabajos.generarOrdenesRecurrentes();
      expect(r.exitosos).toBe(0);
      expect(r.detalles[0]).toContain("sin cerrar");
    });

    it("pero sí avanza la fecha para no reintentar a diario", async () => {
      await orden("abierta", { estado: "en_proceso" });
      await programacion();
      await trabajos.generarOrdenesRecurrentes();
      const p = await db.query(`SELECT to_char(proxima,'YYYY-MM-DD') AS proxima FROM "ProgramacionRecurrente"`);
      expect(p.rows[0].proxima > "2026-09-14").toBe(true);
    });

    it("no genera para un vehículo dado de baja", async () => {
      await db.query(`UPDATE "Vehiculo" SET activo = false WHERE id = 'veh-1'`);
      await programacion();
      const r = await trabajos.generarOrdenesRecurrentes();
      expect(r.exitosos).toBe(0);
    });

    it("correr dos veces el mismo día no duplica la orden", async () => {
      // Un reinicio del servidor no debe generar dos órdenes idénticas.
      await programacion();
      await trabajos.generarOrdenesRecurrentes();
      await db.query(`UPDATE "ProgramacionRecurrente" SET proxima = '2026-09-14'`);
      await db.query(`DELETE FROM "OrdenServicio"`); // libera el vehículo
      await db.query(`INSERT INTO "OrdenServicio"
         (id,"empresaId","sedeId","clienteId","sedeClienteId","vehiculoId",tecnico_id,
          "configuracionEjeId",folio,tipo,estado,fecha,"creadoPorId","clientRequestId")
         VALUES ('previa',$1,'sede-fun','cli-1','sc-1','veh-1','u-tec1','cfg-1','OS-FUN-000001',
                 'preventivo','cerrada','2026-09-14','u-coo','recurrente-p-1-2026-09-14')`, [EMP]);

      const r = await trabajos.generarOrdenesRecurrentes();
      expect(r.fallidos).toBe(1);
      const total = await db.query(`SELECT count(*)::int AS n FROM "OrdenServicio"`);
      expect(total.rows[0].n).toBe(1);
    });

    it("deja rastro en auditoría", async () => {
      await programacion();
      await trabajos.generarOrdenesRecurrentes();
      const a = await db.query(`SELECT detalle FROM "Auditoria"`);
      expect(a.rows[0].detalle.origen).toBe("programacion_recurrente");
    });

    it("la orden va al técnico fijo, creada por quien la programó, y la acción es del Sistema", async () => {
      await programacion();
      await trabajos.generarOrdenesRecurrentes();
      const o = await db.query(`SELECT tecnico_id, "creadoPorId" FROM "OrdenServicio"`);
      expect(o.rows[0]).toEqual({ tecnico_id: "u-tec1", creadoPorId: "u-coo" });
      const h = await db.query(`SELECT "usuarioId" FROM "OrdenEstadoHistorial"`);
      expect(h.rows[0].usuarioId).toBeNull();
      const a = await db.query(`SELECT "usuarioId", "usuarioNombre" FROM "Auditoria"`);
      expect(a.rows[0]).toEqual({ usuarioId: null, usuarioNombre: "Sistema" });
    });

    it("con el técnico inactivo no la genera, dice por qué y espera a que lo corrijan", async () => {
      await db.query(`UPDATE "Usuario" SET activo = false WHERE id = 'u-tec1'`);
      await programacion();
      const r = await trabajos.generarOrdenesRecurrentes();
      expect(r.exitosos).toBe(0);
      const p = await db.query(
        `SELECT to_char(proxima,'YYYY-MM-DD') AS proxima, "ultimoAviso" FROM "ProgramacionRecurrente"`,
      );
      expect(p.rows[0].ultimoAviso).toMatch(/inactivo/);
      // No avanza: la visita no se pierde.
      expect(p.rows[0].proxima).toBe("2026-09-14");

      await db.query(`UPDATE "Usuario" SET activo = true WHERE id = 'u-tec1'`);
      expect((await trabajos.generarOrdenesRecurrentes()).exitosos).toBe(1);
      const despues = await db.query(`SELECT "ultimoAviso" FROM "ProgramacionRecurrente"`);
      expect(despues.rows[0].ultimoAviso).toBeNull();
    });

    it("un técnico que dejó la sede tampoco recibe la orden", async () => {
      await programacion();
      await db.query(`UPDATE "UsuarioSede" SET activa = false WHERE "usuarioId" = 'u-tec1'`);
      const r = await trabajos.generarOrdenesRecurrentes();
      expect(r.exitosos).toBe(0);
      const p = await db.query(`SELECT "ultimoAviso" FROM "ProgramacionRecurrente"`);
      expect(p.rows[0].ultimoAviso).toMatch(/sede/);
    });

    it("saltar por una orden abierta también queda dicho en la programación", async () => {
      await orden("abierta", { estado: "en_proceso" });
      await programacion();
      await trabajos.generarOrdenesRecurrentes();
      const p = await db.query(`SELECT "ultimoAviso" FROM "ProgramacionRecurrente"`);
      expect(p.rows[0].ultimoAviso).toMatch(/2026-09-14: .*sin cerrar/);
    });

    it("no acumula ciclos perdidos si el servidor estuvo caído", async () => {
      // Nadie quiere seis órdenes de golpe al volver.
      await programacion({ proxima: "2026-03-10" });
      const r = await trabajos.generarOrdenesRecurrentes();
      expect(r.exitosos).toBe(1);
      const total = await db.query(`SELECT count(*)::int AS n FROM "OrdenServicio"`);
      expect(total.rows[0].n).toBe(1);

      const p = await db.query(`SELECT to_char(proxima,'YYYY-MM-DD') AS proxima FROM "ProgramacionRecurrente"`);
      expect(p.rows[0].proxima > "2026-09-14").toBe(true);
    });
  });

  describe("alertas", () => {
    async function medicion(ordenId: string, posicion: number, datos: Record<string, unknown>) {
      await db.query(
        `INSERT INTO "LlantaRegistro"
           (id,"ordenId","configuracionEjeId","capturadoPorId",posicion,serial,dot,profundidad)
         VALUES ($1,$2,'cfg-1','u-tec1',$3,$4,$5,$6)`,
        [
          `lr-${ordenId}-${posicion}`,
          ordenId,
          posicion,
          datos["serial"] ?? null,
          datos["dot"] ?? null,
          datos["profundidad"] ?? null,
        ],
      );
    }

    it("alerta por DOT vencido", async () => {
      await orden("o1", { estado: "cerrada" });
      await medicion("o1", 1, { serial: "MX1", dot: "0819", profundidad: 9 });

      const alertas = await trabajos.revisarAlertas(EMP);
      expect(alertas).toHaveLength(1);
      expect(alertas[0]?.tipo).toBe("dot_vencido");
      expect(alertas[0]?.severidad).toBe("critica");
    });

    it("alerta por profundidad bajo el mínimo del eje", async () => {
      await orden("o1", { estado: "cerrada" });
      await medicion("o1", 7, { serial: "MX2", dot: "3624", profundidad: 2 });

      const alertas = await trabajos.revisarAlertas(EMP);
      expect(alertas.map((a) => a.tipo)).toContain("profundidad_baja");
    });

    it("usa el umbral de la posición, no uno global", async () => {
      // El eje 1 exige 3.0 y el 7 exige 2.5: 2.8 alerta en uno y no en otro.
      await orden("o1", { estado: "cerrada" });
      await medicion("o1", 1, { serial: "MX1", dot: "3624", profundidad: 2.8 });
      await medicion("o1", 7, { serial: "MX2", dot: "3624", profundidad: 2.8 });

      const alertas = await trabajos.revisarAlertas(EMP);
      const posiciones = alertas.filter((a) => a.tipo === "profundidad_baja").map((a) => a.posicion);
      expect(posiciones).toEqual([1]);
    });

    it("solo mira la última medición de cada posición", async () => {
      // Alertar por cada medición llenaría la bandeja de repetidos de hace
      // meses que ya se resolvieron.
      await db.query(
        `INSERT INTO "OrdenServicio"
           (id,"empresaId","sedeId","clienteId","sedeClienteId","vehiculoId",tecnico_id,
            "configuracionEjeId",folio,tipo,estado,fecha,"creadoPorId")
         VALUES ('vieja',$1,'sede-fun','cli-1','sc-1','veh-1','u-tec1','cfg-1','OS-V','preventivo',
                 'cerrada','2026-01-10','u-coo'),
                ('nueva',$1,'sede-fun','cli-1','sc-1','veh-1','u-tec1','cfg-1','OS-N','preventivo',
                 'cerrada','2026-09-10','u-coo')`,
        [EMP],
      );
      await medicion("vieja", 1, { serial: "MX1", dot: "3624", profundidad: 1 }); // gastada
      await medicion("nueva", 1, { serial: "MX9", dot: "3624", profundidad: 15 }); // ya se cambió

      const alertas = await trabajos.revisarAlertas(EMP);
      expect(alertas).toHaveLength(0);
    });

    it("no considera órdenes sin cerrar", async () => {
      await orden("o1", { estado: "en_proceso" });
      await medicion("o1", 1, { serial: "MX1", dot: "0819", profundidad: 1 });
      expect(await trabajos.revisarAlertas(EMP)).toHaveLength(0);
    });

    it("una llanta puede generar dos alertas", async () => {
      await orden("o1", { estado: "cerrada" });
      await medicion("o1", 1, { serial: "MX1", dot: "0819", profundidad: 1 });
      const alertas = await trabajos.revisarAlertas(EMP);
      expect(alertas).toHaveLength(2);
    });

    it("ordena lo crítico primero", async () => {
      await orden("o1", { estado: "cerrada" });
      await medicion("o1", 1, { serial: "MX1", dot: "4520", profundidad: 9 }); // por vencer
      await medicion("o1", 7, { serial: "MX2", dot: "0819", profundidad: 9 }); // vencida

      const alertas = await trabajos.revisarAlertas(EMP);
      expect(alertas[0]?.severidad).toBe("critica");
    });

    it("no inventa alertas sin DOT ni umbral", async () => {
      await orden("o1", { estado: "cerrada" });
      await medicion("o1", 1, { serial: "MX1", dot: null, profundidad: null });
      expect(await trabajos.revisarAlertas(EMP)).toHaveLength(0);
    });
  });

  describe("limpieza de caducados", () => {
    it("borra sesiones vencidas y revocadas", async () => {
      await db.query(`INSERT INTO "SesionUsuario" (id,"usuarioId","refreshHash","expiraEn","revocadaEn")
        VALUES ('s1','u1','h1','2026-09-01',NULL),
               ('s2','u1','h2','2026-12-01','2026-09-10'),
               ('s3','u1','h3','2026-12-01',NULL)`);

      const r = await trabajos.limpiarCaducados();
      expect(r.sesiones).toBe(2);
      const quedan = await db.query(`SELECT id FROM "SesionUsuario"`);
      expect(quedan.rows.map((x) => x.id)).toEqual(["s3"]);
    });

    it("borra tokens vencidos y usados", async () => {
      await db.query(`INSERT INTO "TokenRecuperacion" (id,"usuarioId","tokenHash","expiraEn","usadoEn")
        VALUES ('t1','u1','h1','2026-09-01',NULL),
               ('t2','u1','h2','2026-12-01','2026-09-10'),
               ('t3','u1','h3','2026-12-01',NULL)`);

      const r = await trabajos.limpiarCaducados();
      expect(r.tokens).toBe(2);
    });
  });
});

// Solo existe sin base: con base, un "omitido" haría fallar la guarda del CI.
if (!disponible) describe("trabajos programados", () => {
  it("omitidos: falta PostgreSQL", () => {
    expect(disponible).toBe(false);
  });
});
