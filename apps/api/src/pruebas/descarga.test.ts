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

  it("los técnicos son solo técnicos, y las sedes viajan con su código", async () => {
    // Venían todos los usuarios de la sede: el coordinador aparecía como
    // técnico al reasignar.
    await pool.query(`INSERT INTO "UsuarioSede" ("usuarioId","sedeId") VALUES ($1,$2)`, [SEMILLA.coordinador, SEMILLA.sede]);
    const cliente = await pool.connect();
    try {
      const p = await new ServicioDescarga(cliente, () => new Date()).paquete(ctx as never);
      const ids = p.tecnicos.map((t) => t.id);
      expect(ids).toContain(SEMILLA.tecnico);
      expect(ids).not.toContain(SEMILLA.coordinador);
      expect(p.sedes.find((s) => s.id === SEMILLA.sede)?.codigo).toBeTruthy();
    } finally {
      cliente.release();
    }
  });

  it("el cliente recibe solo lo suyo que le toca, sin las notas internas", async () => {
    // Antes se le buscaban sedes de empresa —no tiene— y recibía cero
    // órdenes; y el motivo de devolución viajaba sin filtrar.
    const orden = (id: string, estado: string) =>
      pool.query(
        `INSERT INTO "OrdenServicio"
           (id,"empresaId","sedeId","clienteId","sedeClienteId","vehiculoId",tecnico_id,
            "configuracionEjeId",tipo,estado,fecha,"creadoPorId","motivoDevolucion","notaCoordinador")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'preventivo',$9::"EstadoOrden",'2026-09-21',$7,'Mide de nuevo la 3','Llevar compresor')`,
        [id, SEMILLA.empresa, SEMILLA.sede, SEMILLA.cliente, SEMILLA.sedeCliente,
         SEMILLA.vehiculo, SEMILLA.tecnico, SEMILLA.configuracion, estado],
      );
    await orden("11111111-1111-4111-8111-0000000000d1", "pendiente_cliente");
    await orden("11111111-1111-4111-8111-0000000000d2", "cerrada");
    await orden("11111111-1111-4111-8111-0000000000d3", "en_proceso");
    const cliente = await pool.connect();
    try {
      const p = await new ServicioDescarga(cliente, () => new Date()).paquete({
        empresaId: SEMILLA.empresa, rol: "cliente", usuarioId: "u-cli", clienteId: SEMILLA.cliente,
      });
      expect(p.ordenes.map((o) => o.estado).sort()).toEqual(["cerrada", "pendiente_cliente"]);
      expect(p.ordenes.every((o) => o.motivoDevolucion === null && o.notaCoordinador === null)).toBe(true);
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
