import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { nuevoId } from "@tiretrack/domain";
import { hayBaseDeDatos, conectarAislado } from "./base";
import { ddlDePrueba } from "./generar-esquema";

const TABLAS = ["OrdenServicio", "PosicionEje", "Servicio", "LlantaRegistro", "LlantaServicio"];
import {
  RepositorioMedicionesPg,
  ServicioMediciones,
  type Contexto,
} from "../mediciones/servicio";

/**
 * Servicio de mediciones contra PostgreSQL real.
 *
 * El esquema reproduce las restricciones reales —índice único por posición y
 * llave foránea a la configuración de ejes— porque son las que detienen la
 * carrera entre dos celulares, que ninguna comprobación previa cubre.
 */

const disponible = await hayBaseDeDatos();

const EMP = "emp-med";
const TEC1: Contexto = { empresaId: EMP, rol: "tecnico", usuarioId: "u-tec1" };
const TEC2: Contexto = { empresaId: EMP, rol: "tecnico", usuarioId: "u-tec2" };
const COORD: Contexto = { empresaId: EMP, rol: "coordinador", usuarioId: "u-coo" };
const CLIENTE: Contexto = { empresaId: EMP, rol: "cliente", usuarioId: "u-cli", vistaCliente: true };

const ORDEN = "ord-1";
const CFG = "cfg-4";

let db: pg.Client;
let servicio: ServicioMediciones;

function medicion(posicion: number, extra: Record<string, unknown> = {}) {
  return { id: nuevoId(), posicion, noIdentificada: false, servicios: [], ...extra };
}

async function versionContenido(): Promise<number> {
  const r = await db.query(`SELECT "versionContenido" FROM "OrdenServicio" WHERE id = $1`, [ORDEN]);
  return r.rows[0].versionContenido;
}

describe.skipIf(!disponible)("mediciones", () => {
  beforeAll(async () => {
    db = await conectarAislado(import.meta.url);
    // Esquema GENERADO desde Prisma, no escrito a mano: la tabla escrita a
    // mano no tenía las columnas de la llanta desmontada, y el servidor no las
    // guardaba sin que ninguna prueba lo notara.
    await db.query(ddlDePrueba(TABLAS, {
      extras: {
        PosicionEje: [`UNIQUE ("configuracionEjeId", numero)`],
        LlantaRegistro: [
          `FOREIGN KEY ("ordenId") REFERENCES "OrdenServicio"(id)`,
          // Las dos restricciones reales que estas pruebas ejercitan:
          `FOREIGN KEY ("configuracionEjeId", posicion) REFERENCES "PosicionEje" ("configuracionEjeId", numero)`,
        ],
        LlantaServicio: [
          `FOREIGN KEY ("llantaRegistroId") REFERENCES "LlantaRegistro"(id) ON DELETE CASCADE`,
          `FOREIGN KEY ("servicioId") REFERENCES "Servicio"(id)`,
        ],
      },
    }));
  });

  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE ${TABLAS.map((t) => `"${t}"`).join(", ")} CASCADE`);
    await db.query(
      `INSERT INTO "OrdenServicio"
         (id, "empresaId", "sedeId", "clienteId", "sedeClienteId", "vehiculoId", tecnico_id,
          "configuracionEjeId", tipo, estado, fecha, "creadoPorId")
       VALUES ($1,'emp-1','sede-fun','cli-1','sc-1','veh-1','u-tec1',$2,'preventivo','en_proceso','2026-09-21','u-tec1')`,
      [ORDEN, CFG],
    );
    for (const n of [1, 2, 3, 4]) {
      await db.query(
        `INSERT INTO "PosicionEje" (id,"configuracionEjeId",numero,eje,lado,"tipoEje") VALUES ($1,$2,$3,$4,'izquierdo','traccion')`,
        [`pe-${n}`, CFG, n, n <= 2 ? 1 : 2],
      );
    }
    await db.query(
      `INSERT INTO "Servicio" (id, "empresaId", codigo, nombre) VALUES
         ('srv-cali','emp-1','CALI','Calibración'), ('srv-rota','emp-1','ROTA','Rotación'), ('srv-engr','emp-1','ENGR','Engrase')`,
    );
    servicio = new ServicioMediciones(new RepositorioMedicionesPg(db), () => new Date("2026-09-21T10:00:00Z"));
  });

  describe("guardar", () => {
    it("registra una medición del técnico asignado", async () => {
      const r = await servicio.guardar(TEC1, ORDEN, medicion(1, { profundidad: 9.5, serial: "MX1" }));
      expect(r.ok).toBe(true);
      const f = await db.query(`SELECT profundidad, serial FROM "LlantaRegistro"`);
      expect(Number(f.rows[0].profundidad)).toBe(9.5);
      expect(f.rows[0].serial).toBe("MX1");
    });

    it("con las tres medidas, la profundidad es la mínima y la calcula el servidor", async () => {
      // Aunque el cuerpo traiga otra "profundidad", manda la de las tres medidas.
      const r = await servicio.guardar(TEC1, ORDEN, medicion(1, {
        profundidad: 50, profundidades: { exterior: 9.5, centro: 9, interior: 8.5 },
        desmontada: { serial: "VIEJA", profundidades: { exterior: 3, interior: 2.5 } },
      }));
      expect(r.ok).toBe(true);
      const f = await db.query(
        `SELECT profundidad, "profExterior", "profCentro", "profInterior",
                "desProfundidad", "desProfExterior", "desProfCentro", "desProfInterior" FROM "LlantaRegistro"`,
      );
      const x = f.rows[0];
      expect([x.profundidad, x.profExterior, x.profCentro, x.profInterior].map(Number)).toEqual([8.5, 9.5, 9, 8.5]);
      expect(Number(x.desProfundidad)).toBe(2.5);
      expect(x.desProfCentro).toBeNull();
    });

    it("una versión anterior de la app, con una sola profundidad, sigue funcionando", async () => {
      await servicio.guardar(TEC1, ORDEN, medicion(1, { profundidad: 7 }));
      const f = await db.query(`SELECT profundidad, "profCentro" FROM "LlantaRegistro"`);
      expect(Number(f.rows[0].profundidad)).toBe(7);
      expect(f.rows[0].profCentro).toBeNull();
    });

    it("el autor sale de la sesión, no del cuerpo", async () => {
      // Aunque el cuerpo intente decir otra cosa, el contrato no lo acepta
      // y el servicio usa la sesión.
      await servicio.guardar(TEC1, ORDEN, { ...medicion(1), capturadoPorId: "u-impostor" });
      const f = await db.query(`SELECT "capturadoPorId" FROM "LlantaRegistro"`);
      expect(f.rows[0].capturadoPorId).toBe("u-tec1");
    });

    it("rechaza lo que no cumple el contrato", async () => {
      const r = await servicio.guardar(TEC1, ORDEN, { ...medicion(1), marcaId: null });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("DATOS_INVALIDOS");
    });

    it("rechaza una posición que el vehículo no tiene", async () => {
      const r = await servicio.guardar(TEC1, ORDEN, medicion(9));
      if (r.ok) throw new Error();
      expect(r.veredicto.codigo).toBe("POSICION_INEXISTENTE");
    });

    it("una orden inexistente se rechaza", async () => {
      const r = await servicio.guardar(TEC1, "no-existe", medicion(1));
      if (r.ok) throw new Error();
      expect(r.veredicto.codigo).toBe("NO_EXISTE");
    });
  });

  describe("permisos: las reglas mandan, no una versión", () => {
    it("otro técnico no mide una orden ajena", async () => {
      const r = await servicio.guardar(TEC2, ORDEN, medicion(1));
      expect(r.ok).toBe(false);
    });

    it("tampoco el técnico al que ya le reasignaron la orden", async () => {
      // El caso real: el coordinador reasignó mientras Carlos seguía sin señal.
      await db.query(`UPDATE "OrdenServicio" SET tecnico_id = 'u-tec2' WHERE id = $1`, [ORDEN]);
      const r = await servicio.guardar(TEC1, ORDEN, medicion(1));
      expect(r.ok).toBe(false);
    });

    it("no se mide una orden en revisión", async () => {
      await db.query(`UPDATE "OrdenServicio" SET estado = 'en_revision' WHERE id = $1`, [ORDEN]);
      const r = await servicio.guardar(TEC1, ORDEN, medicion(1));
      if (r.ok) throw new Error();
      expect(r.veredicto.codigo).toBe("EN_REVISION");
    });

    it("el coordinador no corrige mediciones: devuelve", async () => {
      const r = await servicio.guardar(COORD, ORDEN, medicion(1));
      expect(r.ok).toBe(false);
    });

    it("el portal del cliente es de solo lectura", async () => {
      const r = await servicio.guardar(CLIENTE, ORDEN, medicion(1));
      expect(r.ok).toBe(false);
    });
  });

  describe("una medición por posición", () => {
    it("corregir con el mismo id actualiza, no choca", async () => {
      const m = medicion(1, { profundidad: 9 });
      await servicio.guardar(TEC1, ORDEN, m);
      const r = await servicio.guardar(TEC1, ORDEN, { ...m, profundidad: 8 });
      expect(r.ok).toBe(true);
      const f = await db.query(`SELECT count(*)::int AS n, max(profundidad) AS p FROM "LlantaRegistro"`);
      expect(f.rows[0].n).toBe(1);
      expect(Number(f.rows[0].p)).toBe(8);
    });

    it("otra medición para la misma posición se rechaza, no pisa", async () => {
      // El mismo técnico con dos celulares. La segunda queda apartada y
      // visible en el dispositivo en vez de reemplazar a la primera.
      await servicio.guardar(TEC1, ORDEN, medicion(1, { profundidad: 9 }));
      const r = await servicio.guardar(TEC1, ORDEN, medicion(1, { profundidad: 3 }));
      if (r.ok) throw new Error();
      expect(r.veredicto.codigo).toBe("POSICION_OCUPADA");
      const f = await db.query(`SELECT profundidad FROM "LlantaRegistro"`);
      expect(Number(f.rows[0].profundidad)).toBe(9);
    });

    it("la base detiene la carrera entre dos celulares", async () => {
      // Dos escrituras simultáneas pasan ambas la comprobación previa; la
      // base de datos es lo único que puede detener a la segunda.
      const otraConexion = await conectarAislado(import.meta.url);
      try {
        const s1 = new ServicioMediciones(new RepositorioMedicionesPg(db));
        const s2 = new ServicioMediciones(new RepositorioMedicionesPg(otraConexion));
        const resultados = await Promise.all([
          s1.guardar(TEC1, ORDEN, medicion(2)),
          s2.guardar(TEC1, ORDEN, medicion(2)),
        ]);
        expect(resultados.filter((r) => r.ok)).toHaveLength(1);
        const rechazada = resultados.find((r) => !r.ok);
        if (rechazada && !rechazada.ok) expect(rechazada.veredicto.codigo).toBe("POSICION_OCUPADA");
        const f = await db.query(`SELECT count(*)::int AS n FROM "LlantaRegistro" WHERE posicion = 2`);
        expect(f.rows[0].n).toBe(1);
      } finally {
        await otraConexion.end();
      }
    });

    it("un id no puede mudarse de posición", async () => {
      const m = medicion(1);
      await servicio.guardar(TEC1, ORDEN, m);
      const r = await servicio.guardar(TEC1, ORDEN, { ...m, posicion: 2 });
      if (r.ok) throw new Error();
      expect(r.veredicto.codigo).toBe("MEDICION_REUBICADA");
    });
  });

  describe("servicios por código", () => {
    it("guarda los servicios de la llanta", async () => {
      const m = medicion(1, { servicios: ["CALI", "ROTA"] });
      await servicio.guardar(TEC1, ORDEN, m);
      const f = await db.query(`SELECT "servicioId" FROM "LlantaServicio" ORDER BY 1`);
      expect(f.rows.map((x) => x.servicioId)).toEqual(["srv-cali", "srv-rota"]);
    });

    it("corregir reemplaza los servicios, no los acumula", async () => {
      const m = medicion(1, { servicios: ["CALI", "ROTA"] });
      await servicio.guardar(TEC1, ORDEN, m);
      await servicio.guardar(TEC1, ORDEN, { ...m, servicios: ["CALI"] });
      const f = await db.query(`SELECT "servicioId" FROM "LlantaServicio"`);
      expect(f.rows.map((x) => x.servicioId)).toEqual(["srv-cali"]);
    });

    it("un servicio del vehículo no se acepta en una llanta", async () => {
      // El contrato ya lo rechaza; el servicio lo explica si llegara.
      const r = await servicio.guardar(TEC1, ORDEN, medicion(1, { servicios: ["ENGR"] }));
      expect(r.ok).toBe(false);
    });

    it("un servicio desactivado en la empresa se rechaza, no se descarta", async () => {
      // Descartarlo borraría en silencio un servicio que el técnico sí hizo.
      await db.query(`UPDATE "Servicio" SET activo = false WHERE codigo = 'ROTA'`);
      const r = await servicio.guardar(TEC1, ORDEN, medicion(1, { servicios: ["ROTA"] }));
      if (r.ok) throw new Error();
      expect(r.veredicto.codigo).toBe("SERVICIO_NO_CONFIGURADO");
      const f = await db.query(`SELECT count(*)::int AS n FROM "LlantaRegistro"`);
      expect(f.rows[0].n).toBe(0);
    });
  });

  describe("versión de contenido: igual que en el celular", () => {
    it("cada medición aplicada la sube exactamente una vez", async () => {
      // El celular la sube una vez por medición. Si el servidor la subiera
      // distinto, toda firma se rechazaría.
      const antes = await versionContenido();
      await servicio.guardar(TEC1, ORDEN, medicion(1));
      await servicio.guardar(TEC1, ORDEN, medicion(2));
      expect(await versionContenido()).toBe(antes + 2);
    });

    it("corregir también la sube, como en el celular", async () => {
      const m = medicion(1);
      await servicio.guardar(TEC1, ORDEN, m);
      const antes = await versionContenido();
      await servicio.guardar(TEC1, ORDEN, { ...m, profundidad: 7 });
      expect(await versionContenido()).toBe(antes + 1);
    });

    it("una medición rechazada NO la sube", async () => {
      // El celular sí la subió: la diferencia es justo lo que hace que la
      // firma se rechace, porque el cliente firmó algo que el servidor no
      // tiene.
      const antes = await versionContenido();
      await servicio.guardar(TEC1, ORDEN, medicion(9));
      expect(await versionContenido()).toBe(antes);
    });

    it("devuelve la versión nueva", async () => {
      const r = await servicio.guardar(TEC1, ORDEN, medicion(1));
      if (!r.ok) throw new Error();
      expect(r.valor.versionContenido).toBe(await versionContenido());
    });
  });
});
