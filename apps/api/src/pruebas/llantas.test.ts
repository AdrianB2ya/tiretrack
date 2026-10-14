import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { nuevoId } from "@tiretrack/domain";
import { hayBaseDeDatos, poolAislado } from "./base";
import { crearEsquemaCompleto, sembrar, SEMILLA } from "./esquemas";
import { ServicioLlantas } from "../llantas/servicio";

/**
 * La llanta como activo (R8) contra PostgreSQL, con el esquema generado
 * desde Prisma.
 */

const disponible = await hayBaseDeDatos();

const OFICINA = { empresaId: SEMILLA.empresa, rol: "coordinador" as const, usuarioId: SEMILLA.coordinador };
const TECNICO = { empresaId: SEMILLA.empresa, rol: "tecnico" as const, usuarioId: SEMILLA.tecnico };

describe.skipIf(!disponible)("llantas como activo", () => {
  let pool: pg.Pool;
  let db: pg.PoolClient;
  let servicio: ServicioLlantas;

  beforeAll(async () => {
    pool = await poolAislado(import.meta.url, 3);
    await crearEsquemaCompleto(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await sembrar(pool);
    db = await pool.connect();
    servicio = new ServicioLlantas(db, () => new Date("2026-10-14T15:00:00Z"));
    return () => db.release();
  });

  const alta = (extra: Record<string, unknown> = {}) =>
    servicio.crear(OFICINA, {
      id: nuevoId(), clienteId: SEMILLA.cliente, sedeId: SEMILLA.sede,
      numeroInterno: "A-17", serial: "mx 1002-3", medida: "295/80R22.5", costo: 1_850_000, ...extra,
    });

  describe("inventario de la oficina", () => {
    it("una llanta nueva entra a bodega con su vida 0 y su ingreso", async () => {
      const r = await alta();
      expect(r.ok && r.valor).toMatchObject({ estado: "bodega", serial: "MX10023", costo: 1_850_000, vidas: 0 });
      const ficha = await servicio.ficha(r.ok ? r.valor.id : "");
      expect(ficha.ok && ficha.valor.vidas.map((v) => v["numero"])).toEqual([0]);
      expect(ficha.ok && ficha.valor.movimientos.map((m) => m["tipo"])).toEqual(["ingreso"]);
    });

    it("no se repite el serial ni el número interno dentro del cliente", async () => {
      await alta();
      const r = await alta({ id: nuevoId(), numeroInterno: "B-1", serial: "MX10023" });
      expect(r.ok ? null : r.veredicto.codigo).toBe("YA_EXISTE");
    });

    it("el técnico no maneja el inventario", async () => {
      const r = await servicio.crear(TECNICO, {
        id: nuevoId(), clienteId: SEMILLA.cliente, sedeId: SEMILLA.sede, numeroInterno: "C-1",
      });
      expect(r.ok ? null : r.veredicto.codigo).toBe("SIN_PERMISO");
    });

    it("va a reencauche y vuelve con una vida más, con su banda y su costo", async () => {
      const r = await alta();
      const id = r.ok ? r.valor.id : "";
      expect((await servicio.mover(OFICINA, id, { tipo: "envio_reencauche" })).ok).toBe(true);
      const vuelve = await servicio.mover(OFICINA, id, {
        tipo: "retorno_reencauche", banda: "XDY", reencauchadora: "Recauchadora del Norte", costo: 450_000, profundidadInicial: 18,
      });
      expect(vuelve.ok && vuelve.valor).toMatchObject({ estado: "bodega", vidas: 1 });
      const ficha = await servicio.ficha(id);
      expect(ficha.ok && ficha.valor.vidas[1]).toMatchObject({ numero: 1, banda: "XDY", costo: 450_000, profundidadInicial: 18 });
    });

    it("un paso imposible se rechaza diciendo por qué", async () => {
      const r = await alta();
      const id = r.ok ? r.valor.id : "";
      await servicio.mover(OFICINA, id, { tipo: "desecho" });
      const v = await servicio.mover(OFICINA, id, { tipo: "envio_reencauche" });
      expect(v.ok ? null : v.veredicto.codigo).toBe("MOVIMIENTO_INVALIDO");
    });

    it("el stock de bodega por sede y medida se compara con el mínimo", async () => {
      await alta();
      await servicio.fijarStockMinimo(OFICINA, { sedeId: SEMILLA.sede, medida: "295/80R22.5", cantidad: 4 });
      await servicio.fijarStockMinimo(OFICINA, { sedeId: SEMILLA.sede, medida: "11R22.5", cantidad: 2 });
      const s = await servicio.stock();
      expect(s).toContainEqual(expect.objectContaining({ medida: "295/80R22.5", cantidad: 1, minimo: 4 }));
      // Sin ninguna en bodega también sale: es lo que más urge comprar.
      expect(s).toContainEqual(expect.objectContaining({ medida: "11R22.5", cantidad: 0, minimo: 2 }));
    });
  });

  describe("desde la orden aprobada", () => {
    const ORDEN = "11111111-1111-4111-8111-0000000000ee";

    async function orden(id = ORDEN) {
      await pool.query(
        `INSERT INTO "OrdenServicio"
           (id,"empresaId","sedeId","clienteId","sedeClienteId","vehiculoId",tecnico_id,
            "configuracionEjeId",tipo,estado,fecha,"creadoPorId",kilometraje)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'preventivo','pendiente_cliente','2026-10-14',$7,81200)`,
        [id, SEMILLA.empresa, SEMILLA.sede, SEMILLA.cliente, SEMILLA.sedeCliente,
         SEMILLA.vehiculo, SEMILLA.tecnico, SEMILLA.configuracion],
      );
    }
    async function medicion(ordenId: string, posicion: number, d: Record<string, unknown>) {
      await pool.query(
        `INSERT INTO "LlantaRegistro"
           (id,"ordenId","configuracionEjeId","capturadoPorId",posicion,serial,medida,"noIdentificada","desSerial","desDestino")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [nuevoId(), ordenId, SEMILLA.configuracion, SEMILLA.tecnico, posicion, d["serial"] ?? null, d["medida"] ?? null,
         d["noIdentificada"] ?? false, d["desSerial"] ?? null, d["desDestino"] ?? null],
      );
    }

    it("lo medido queda como montado en su posición, sin que el técnico haga nada nuevo", async () => {
      await orden();
      await medicion(ORDEN, 1, { serial: "MX1", medida: "295/80R22.5" });
      await medicion(ORDEN, 2, { noIdentificada: true });
      const r = await servicio.procesarOrden(OFICINA, ORDEN);
      expect(r).toEqual({ montadas: 1, desmontadas: 0 });
      const lista = await servicio.listar({ vehiculoId: SEMILLA.vehiculo });
      expect(lista).toEqual([expect.objectContaining({ serial: "MX1", estado: "montada", posicion: 1 })]);
      // La medición queda atada a su llanta: es lo que arma su historia.
      const lr = await pool.query(`SELECT "llantaId" FROM "LlantaRegistro" WHERE "ordenId" = $1 AND posicion = 1`, [ORDEN]);
      expect(lr.rows[0].llantaId).toBe(lista[0]?.id);
    });

    it("la que salió va a donde dijo el técnico, y la que entró queda en su lugar", async () => {
      // Primera visita: MX1 en la posición 1.
      await orden();
      await medicion(ORDEN, 1, { serial: "MX1" });
      await servicio.procesarOrden(OFICINA, ORDEN);
      // Segunda visita: sale MX1 a reencauche, entra MX9.
      const segunda = nuevoId();
      await orden(segunda);
      await medicion(segunda, 1, { serial: "MX9", desSerial: "MX1", desDestino: "Reencauche" });
      expect(await servicio.procesarOrden(OFICINA, segunda)).toEqual({ montadas: 1, desmontadas: 1 });
      const todas = await servicio.listar({});
      expect(todas.find((l) => l.serial === "MX1")).toMatchObject({ estado: "reencauche", vehiculoId: null });
      expect(todas.find((l) => l.serial === "MX9")).toMatchObject({ estado: "montada", posicion: 1 });
      const ficha = await servicio.ficha(todas.find((l) => l.serial === "MX1")?.id ?? "");
      expect(ficha.ok && ficha.valor.movimientos.map((m) => m["tipo"])).toEqual(["montaje", "desmontaje"]);
      expect(ficha.ok && ficha.valor.movimientos[1]).toMatchObject({ kilometraje: 81200 });
    });

    it("procesar dos veces la misma orden no repite la historia", async () => {
      await orden();
      await medicion(ORDEN, 1, { serial: "MX1" });
      await servicio.procesarOrden(OFICINA, ORDEN);
      expect(await servicio.procesarOrden(OFICINA, ORDEN)).toEqual({ montadas: 0, desmontadas: 0 });
      const mv = await pool.query(`SELECT count(*)::int AS n FROM "LlantaMovimiento" WHERE "ordenId" = $1`, [ORDEN]);
      expect(mv.rows[0].n).toBe(1);
    });

    it("una llanta que aparece en otra posición se rotó: sale de la vieja y entra a la nueva", async () => {
      await orden();
      await medicion(ORDEN, 1, { serial: "MX1" });
      await servicio.procesarOrden(OFICINA, ORDEN);
      const segunda = nuevoId();
      await orden(segunda);
      await medicion(segunda, 3, { serial: "MX1" });
      await servicio.procesarOrden(OFICINA, segunda);
      const l = (await servicio.listar({})).find((x) => x.serial === "MX1");
      expect(l).toMatchObject({ estado: "montada", posicion: 3 });
    });
  });
});
