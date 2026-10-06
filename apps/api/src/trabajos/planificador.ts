import type pg from "pg";
import { TrabajosProgramados, type ResultadoTrabajo } from "./programados";

/**
 * Pone a correr los trabajos programados: cierre tácito y órdenes
 * recurrentes.
 *
 * Existían desde la tarea 1.9, probados, y **nada los arrancaba**: en
 * producción ninguna orden se habría cerrado por vencimiento ni se habría
 * generado una sola recurrente. Mismo patrón que la descarga (6.7): piezas
 * probadas que ningún código de la aplicación llamaba.
 *
 * Cómo corre:
 *
 *   - **Empresa por empresa, con su contexto de RLS.** Los trabajos no se
 *     saltan el aislamiento; la lista de empresas sale de
 *     `empresas_para_trabajos()`, que devuelve solo ids (ver rls.sql).
 *   - **Una conexión propia por empresa, que se descarta al terminar.** El
 *     contexto se fija para toda la sesión —cada ítem abre su transacción— y
 *     una conexión devuelta al pool con la empresa puesta la heredaría la
 *     siguiente petición. Descartarla es más simple que limpiar y no deja
 *     ninguna posibilidad de fuga.
 *   - **Un candado por empresa** (`pg_try_advisory_lock`): con dos
 *     instancias de la API, la segunda se salta la empresa en vez de esperar.
 *     Correr dos veces sería seguro igual —el cierre compara versión y la
 *     orden recurrente tiene clave determinista—, pero no hay por qué.
 *   - **Un fallo en una empresa no detiene a las demás**, ni tumba el proceso.
 */

export interface ResultadoRonda {
  readonly empresas: number;
  readonly saltadas: number;
  readonly cierres: ResultadoTrabajo;
  readonly recurrentes: ResultadoTrabajo;
  readonly errores: string[];
}

const sumar = (a: ResultadoTrabajo, b: ResultadoTrabajo): ResultadoTrabajo => ({
  procesados: a.procesados + b.procesados,
  exitosos: a.exitosos + b.exitosos,
  fallidos: a.fallidos + b.fallidos,
  detalles: [...a.detalles, ...b.detalles],
});

const CERO: ResultadoTrabajo = { procesados: 0, exitosos: 0, fallidos: 0, detalles: [] };

/** Una vuelta completa por todas las empresas activas. */
export async function correrTrabajos(pool: pg.Pool, reloj: () => Date = () => new Date()): Promise<ResultadoRonda> {
  const empresas = (await pool.query<{ id: string }>(`SELECT id FROM empresas_para_trabajos() AS id`)).rows;
  let cierres = CERO;
  let recurrentes = CERO;
  let saltadas = 0;
  const errores: string[] = [];

  for (const { id } of empresas) {
    const cliente = await pool.connect();
    try {
      const candado = await cliente.query<{ ok: boolean }>(
        `SELECT pg_try_advisory_lock(hashtext('trabajos-programados'), hashtext($1)) AS ok`,
        [id],
      );
      if (!candado.rows[0]?.ok) {
        saltadas++;
        continue;
      }
      // Contexto de sesión (false = no LOCAL): cada ítem abre su propia
      // transacción y debe verlo. La conexión se descarta al final.
      await cliente.query(
        `SELECT set_config('app.empresa_id', $1, false),
                set_config('app.rol', 'sistema', false),
                set_config('app.usuario_id', '', false),
                set_config('app.cliente_id', '', false)`,
        [id],
      );
      const trabajos = new TrabajosProgramados(cliente, reloj);
      cierres = sumar(cierres, await trabajos.cerrarPlazosVencidos());
      recurrentes = sumar(recurrentes, await trabajos.generarOrdenesRecurrentes());
    } catch (e) {
      errores.push(`${id}: ${(e as Error).message}`);
    } finally {
      // true = destruir la conexión: el contexto y el candado mueren con ella.
      cliente.release(true);
    }
  }

  return { empresas: empresas.length, saltadas, cierres, recurrentes, errores };
}

export interface Registro {
  info(datos: object, mensaje: string): void;
  error(datos: object, mensaje: string): void;
}

/**
 * Corre los trabajos al arrancar (con un respiro, para no competir con el
 * arranque) y luego cada `intervaloMs`. Devuelve la función que los detiene,
 * para el cierre ordenado.
 *
 * Nunca deja escapar un error: un trabajo que tumba el servidor se lleva
 * consigo a todos los técnicos que están sincronizando.
 */
export function iniciarTrabajos(opciones: {
  pool: pg.Pool;
  intervaloMs: number;
  registro: Registro;
  retrasoInicialMs?: number;
  reloj?: () => Date;
}): () => Promise<void> {
  let enCurso: Promise<void> | null = null;
  let detenido = false;

  const ronda = () => {
    // Una ronda lenta no se encima con la siguiente.
    if (enCurso || detenido) return;
    enCurso = (async () => {
      try {
        const r = await correrTrabajos(opciones.pool, opciones.reloj);
        const hubo = r.cierres.procesados + r.recurrentes.procesados + r.errores.length > 0;
        if (hubo) {
          opciones.registro.info(
            {
              empresas: r.empresas,
              cierresTacitos: r.cierres.exitosos,
              ordenesRecurrentes: r.recurrentes.exitosos,
              fallidos: r.cierres.fallidos + r.recurrentes.fallidos,
              detalles: [...r.cierres.detalles, ...r.recurrentes.detalles].slice(0, 20),
            },
            "trabajos programados",
          );
        }
        if (r.errores.length > 0) opciones.registro.error({ errores: r.errores }, "trabajos programados con errores");
      } catch (e) {
        opciones.registro.error({ error: (e as Error).message }, "no corrieron los trabajos programados");
      } finally {
        enCurso = null;
      }
    })();
  };

  const inicial = setTimeout(ronda, opciones.retrasoInicialMs ?? 30_000);
  const periodico = setInterval(ronda, opciones.intervaloMs);
  // No mantienen vivo el proceso: el cierre ordenado no debe esperarlos.
  inicial.unref?.();
  periodico.unref?.();

  return async () => {
    detenido = true;
    clearTimeout(inicial);
    clearInterval(periodico);
    // Se deja terminar la ronda en curso: cortarla a mitad deshace su
    // transacción, pero no hay motivo para provocar el reintento.
    if (enCurso) await enCurso;
  };
}
