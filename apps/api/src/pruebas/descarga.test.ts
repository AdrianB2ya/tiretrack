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
