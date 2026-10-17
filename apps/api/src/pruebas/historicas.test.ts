import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { nuevoId } from "@tiretrack/domain";
import { hayBaseDeDatos, poolAislado } from "./base";
import { crearEsquemaCompleto, sembrar, SEMILLA } from "./esquemas";

/**
 * Órdenes anteriores cargadas desde Excel (2026-10-17): las reglas de la base
 * se ejecutan desde la MIGRACIÓN real, no copiadas aquí, para que una prueba
 * no pase mientras producción queda distinta.
 */
const disponible = await hayBaseDeDatos();
const MIGRACION = readFileSync(
  join(__dirname, "..", "..", "prisma", "migrations", "20261017120000_ordenes_historicas", "migration.sql"),
  "utf8",
);

let pool: pg.Pool;

async function orden(extra: { estado: string; historica: boolean; firma?: boolean }) {
  await pool.query(
    `INSERT INTO "OrdenServicio"
       (id,"empresaId","sedeId","clienteId","sedeClienteId","vehiculoId",tecnico_id,"configuracionEjeId",tipo,estado,fecha,
        "creadoPorId",historica,"firmaNombre","firmaCedula")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'preventivo',$9::"EstadoOrden",'2025-03-14',$7,$10,$11,$12)`,
    [nuevoId(), SEMILLA.empresa, SEMILLA.sede, SEMILLA.cliente, SEMILLA.sedeCliente, SEMILLA.vehiculo, SEMILLA.tecnico,
     SEMILLA.configuracion, extra.estado, extra.historica, extra.firma ? "Luis" : null, extra.firma ? "77" : null],
  );
}

describe.skipIf(!disponible)("reglas de la orden histórica en la base", () => {
  beforeAll(async () => {
    pool = await poolAislado(import.meta.url, 2);
    await crearEsquemaCompleto(pool);
    // La regla de la firma tal como estaba, para que el DROP de la migración tenga qué quitar.
    await pool.query(`ALTER TABLE "OrdenServicio" ADD CONSTRAINT orden_cerrada_requiere_firma
      CHECK (estado <> 'cerrada' OR ("firmaNombre" IS NOT NULL AND "firmaCedula" IS NOT NULL))`);
    // Las columnas ya vienen del esquema generado; el resto se ejecuta tal cual.
    await pool.query(MIGRACION.replace(/ALTER TABLE "OrdenServicio" ADD COLUMN[^;]+;/g, ""));
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await sembrar(pool);
  });

  it("una orden normal sigue sin poder cerrarse sin firma", async () => {
    await expect(orden({ estado: "cerrada", historica: false })).rejects.toThrow(/orden_cerrada_requiere_firma/);
    await orden({ estado: "cerrada", historica: false, firma: true });
  });

  it("una histórica sí entra cerrada sin firma", async () => {
    await orden({ estado: "cerrada", historica: true });
  });

  it("una histórica no puede quedar abierta: la excepción no sirve para cerrar una orden normal", async () => {
    await expect(orden({ estado: "en_proceso", historica: true })).rejects.toThrow(/orden_historica_cerrada/);
    await orden({ estado: "anulada", historica: true });
  });
});
