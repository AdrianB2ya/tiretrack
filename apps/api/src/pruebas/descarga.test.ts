import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { hayBaseDeDatos, poolAislado } from "./base";
import { crearEsquemaCompleto, sembrar, SEMILLA } from "./esquemas";
import { ServicioDescarga } from "../descarga/servicio";

/**
 * Descarga para el celular.
 *
 * Todo el paquete se arma sobre UNA conexión: la de la transacción con el
 * contexto de RLS. Lanzar consultas en paralelo sobre ella no gana nada —pg
 * las encola—, pg avisa que dejará de aceptarlo, y si una falla las demás
 * siguen sobre una transacción ya abortada.
 */

const disponible = await hayBaseDeDatos();

/** Conexión que falla si una consulta empieza antes de que termine otra. */
function sinSolapes(cliente: pg.PoolClient): { db: pg.PoolClient; solapes: string[] } {
  const solapes: string[] = [];
  let enCurso = 0;
  const db = new Proxy(cliente, {
    get(objetivo, prop, receptor) {
      if (prop !== "query") return Reflect.get(objetivo, prop, receptor);
      return async (...args: unknown[]) => {
        if (enCurso > 0) solapes.push(String(args[0]).replace(/\s+/g, " ").slice(0, 60));
        enCurso++;
        try {
          return await (objetivo.query as (...a: unknown[]) => Promise<unknown>).apply(objetivo, args);
        } finally {
          enCurso--;
        }
      };
    },
  });
  return { db, solapes };
}

describe.skipIf(!disponible)("descarga", () => {
  let pool: pg.Pool;
  const ctx = {
    empresaId: SEMILLA.empresa, rol: "tecnico" as const, usuarioId: SEMILLA.tecnico,
    clienteId: null, vistaCliente: false,
  };

  beforeAll(async () => {
    pool = await poolAislado(import.meta.url, 3);
    await crearEsquemaCompleto(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await sembrar(pool);
  });

  it("una orden que cambia DESPUÉS de la última descarga llega en la siguiente", async () => {
    // Las escrituras son SQL directo y nadie tocaba "actualizadoEn": la
    // descarga incremental filtra por esa columna, así que una orden devuelta
    // por el coordinador nunca llegaba al celular del técnico.
    const orden = "11111111-1111-4111-8111-0000000000cc";
    await pool.query(
      `INSERT INTO "OrdenServicio"
         (id,"empresaId","sedeId","clienteId","sedeClienteId","vehiculoId",tecnico_id,
          "configuracionEjeId",tipo,estado,fecha,"creadoPorId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'preventivo','en_revision','2026-09-21',$7)`,
      [orden, SEMILLA.empresa, SEMILLA.sede, SEMILLA.cliente, SEMILLA.sedeCliente,
       SEMILLA.vehiculo, SEMILLA.tecnico, SEMILLA.configuracion],
    );
    // Margen amplio entre escrituras y descargas: con pocos milisegundos la
    // prueba pasaba por casualidad aunque el UPDATE no tocara la columna.
    const pausa = () => new Promise((r) => setTimeout(r, 300));
    await pausa();
    const servicio = (db: pg.PoolClient) => new ServicioDescarga(db, () => new Date());
    const cliente = await pool.connect();
    try {
      const primera = await servicio(cliente).paquete(ctx as never);
      expect(primera.ordenes.map((o) => o.id)).toContain(orden);

      await pausa();
      // Como lo hace el servicio de órdenes al devolver: SQL directo.
      await pool.query(
        `UPDATE "OrdenServicio" SET estado = 'en_proceso', "motivoDevolucion" = 'Revisa la posición 3' WHERE id = $1`,
        [orden],
      );

      const siguiente = await servicio(cliente).paquete(ctx as never, primera.hasta);
      expect(siguiente.incremental).toBe(true);
      expect(siguiente.ordenes.map((o) => o.id)).toContain(orden);
    } finally {
      cliente.release();
    }
  });

  it("arma el paquete sin consultas simultáneas sobre la misma conexión", async () => {
    const cliente = await pool.connect();
    try {
      const { db, solapes } = sinSolapes(cliente);
      const paquete = await new ServicioDescarga(db, () => new Date("2026-09-21T10:00:00Z")).paquete(ctx as never);
      expect(solapes).toEqual([]);
      // Y que siga trayendo lo que el celular necesita.
      expect(paquete.flota.vehiculos.length).toBeGreaterThan(0);
      expect(paquete.configuraciones.length).toBeGreaterThan(0);
    } finally {
      cliente.release();
    }
  });
});
