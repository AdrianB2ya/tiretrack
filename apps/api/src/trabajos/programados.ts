import type pg from "pg";
import {
  avanzaAlSaltar,
  avanzarProxima,
  debeCerrarsePorVencimiento,
  debeGenerarOrden,
  deduplicarAlertas,
  evaluarAlertas,
  nuevoId,
  ordenarPorSeveridad,
  type Alerta,
  type Frecuencia,
  type LlantaParaRevisar,
  fechaEnColombia,
} from "@tiretrack/domain";

/**
 * Trabajos programados.
 *
 * Corren sin que nadie los mire, así que siguen tres reglas:
 *
 *   1. **Cada ítem va en su propia transacción.** Si uno falla, los demás
 *      siguen. Un lote entero que se cae por una fila mala deja de correr
 *      durante días sin que nadie note.
 *   2. **Todo queda en auditoría.** Una orden que se cerró sola sin rastro es
 *      indistinguible de una manipulación.
 *   3. **Ante la duda, no actuar.** Saltarse una vuelta es recuperable;
 *      cerrar una orden que no debía, no.
 *
 * El contexto de empresa lo fija el llamador por cada tenant: estos trabajos
 * no se saltan RLS, recorren las empresas activas una por una
 * (`planificador.ts`).
 *
 * Las acciones quedan a nombre de **Sistema** —usuario vacío en el historial
 * y en la auditoría—, nunca de una persona (decisión del usuario,
 * 2026-10-06). Antes se atribuían a un "usuario del sistema" que no existía:
 * la columna del técnico y la del historial exigen un usuario real, así que
 * el primer cierre tácito en producción habría fallado.
 */

export interface ResultadoTrabajo {
  readonly procesados: number;
  readonly exitosos: number;
  readonly fallidos: number;
  readonly detalles: string[];
}

const vacio = (): ResultadoTrabajo => ({ procesados: 0, exitosos: 0, fallidos: 0, detalles: [] });

export class TrabajosProgramados {
  constructor(
    /**
     * Una conexión dedicada, nunca el pool: cada ítem abre y cierra su propia
     * transacción, y en un pool el BEGIN y el COMMIT podrían caer en
     * conexiones distintas.
     */
    private readonly db: pg.Client | pg.PoolClient,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  private hoy(): string {
    // El día en Colombia: en UTC, después de las 7 p. m. ya es mañana.
    return fechaEnColombia(this.reloj());
  }

  // ── Cierre por vencimiento del plazo del cliente ──────────────────────────

  /**
   * Cierra las órdenes cuyo plazo de aprobación venció.
   *
   * El cierre queda marcado como tácito y con motivo explícito: el documento
   * debe decir que se cerró por vencimiento, nunca aparentar que el cliente
   * lo aprobó.
   */
  async cerrarPlazosVencidos(): Promise<ResultadoTrabajo> {
    const hoy = this.hoy();
    const r = vacio() as {
      procesados: number;
      exitosos: number;
      fallidos: number;
      detalles: string[];
    };

    const candidatas = await this.db.query<{
      id: string;
      folio: string | null;
      estado: string;
      limiteCliente: string | null;
      empresaId: string;
      version: number;
    }>(
      `SELECT id, folio, estado::text AS estado,
              to_char("limiteCliente",'YYYY-MM-DD') AS "limiteCliente",
              "empresaId", version
         FROM "OrdenServicio"
        WHERE estado = 'pendiente_cliente' AND "limiteCliente" <= $1::date`,
      [hoy],
    );

    for (const orden of candidatas.rows) {
      r.procesados++;
      const veredicto = debeCerrarsePorVencimiento(orden, hoy);
      if (!veredicto.permitido) {
        r.detalles.push(`${orden.folio}: ${veredicto.mensaje}`);
        continue;
      }

      try {
        // Cada orden en su propia transacción: una fila mala no debe
        // impedir que las demás se cierren.
        await this.db.query("BEGIN");

        const actualizada = await this.db.query(
          `UPDATE "OrdenServicio"
              SET estado = 'cerrada', version = version + 1,
                  "cierreTacito" = true,
                  "motivoCierre" = 'Cerrada por vencimiento del plazo de aprobación'
            WHERE id = $1 AND version = $2 AND estado = 'pendiente_cliente'`,
          [orden.id, orden.version],
        );

        if (actualizada.rowCount === 0) {
          // El cliente la aprobó mientras corría el trabajo: no se toca.
          await this.db.query("ROLLBACK");
          r.detalles.push(`${orden.folio}: cambió mientras se procesaba`);
          continue;
        }

        await this.db.query(
          `INSERT INTO "OrdenEstadoHistorial"
             (id,"ordenId","estadoAnterior","estadoNuevo","usuarioId",motivo,"visibleCliente")
           VALUES ($1,$2,'pendiente_cliente','cerrada',NULL,
                   'Cerrada por vencimiento del plazo de aprobación', true)`,
          [nuevoId(), orden.id],
        );

        // Una orden cerrada sola sin rastro es indistinguible de una
        // manipulación.
        await this.auditar(orden.empresaId, "cambiar_estado", {
          ordenId: orden.id,
          folio: orden.folio,
          motivo: "cierre_tacito",
          limiteVencido: orden.limiteCliente,
        });

        await this.db.query("COMMIT");
        r.exitosos++;
      } catch (e) {
        await this.db.query("ROLLBACK").catch(() => undefined);
        r.fallidos++;
        r.detalles.push(`${orden.folio}: ${(e as Error).message}`);
      }
    }

    return r;
  }

  // ── Órdenes recurrentes ───────────────────────────────────────────────────

  /**
   * Genera las órdenes de las programaciones vencidas.
   *
   * La orden nace en `programada`, no en `en_proceso`: la genera el sistema,
   * pero la ejecuta una persona que todavía no la ha visto.
   */
  async generarOrdenesRecurrentes(): Promise<ResultadoTrabajo> {
    const hoy = this.hoy();
    const r = vacio() as {
      procesados: number;
      exitosos: number;
      fallidos: number;
      detalles: string[];
    };

    const pendientes = await this.db.query<{
      id: string;
      empresaId: string;
      sedeId: string;
      clienteId: string;
      sedeClienteId: string;
      vehiculoId: string;
      tecnicoId: string;
      creadoPorId: string;
      tipo: string;
      frecuencia: Frecuencia;
      cada: number;
      inicio: string;
      proxima: string;
      activa: boolean;
      vehiculoActivo: boolean;
      configuracionEjeId: string;
      codigoSede: string;
      ordenesAbiertas: number;
      tecnicoDisponible: boolean;
      tecnicoEnSede: boolean;
    }>(
      `SELECT p.id, p."empresaId", p."sedeId", p."clienteId", p."sedeClienteId",
              p."vehiculoId", p."tecnicoId", p."creadoPorId",
              p.tipo::text AS tipo, p.frecuencia::text AS frecuencia, p.cada,
              to_char(p.inicio,'YYYY-MM-DD') AS inicio,
              to_char(p.proxima,'YYYY-MM-DD') AS proxima, p.activa,
              v.activo AS "vehiculoActivo", v."configuracionEjeId",
              s.codigo AS "codigoSede",
              (SELECT count(*)::int FROM "OrdenServicio" o
                WHERE o."vehiculoId" = p."vehiculoId"
                  AND o.estado NOT IN ('cerrada','anulada')) AS "ordenesAbiertas",
              coalesce(u.activo AND u.rol = 'tecnico', false) AS "tecnicoDisponible",
              EXISTS (SELECT 1 FROM "UsuarioSede" us
                       WHERE us."usuarioId" = p."tecnicoId" AND us."sedeId" = p."sedeId"
                         AND us.activa) AS "tecnicoEnSede"
         FROM "ProgramacionRecurrente" p
         JOIN "Vehiculo" v ON v.id = p."vehiculoId"
         JOIN "Sede" s ON s.id = p."sedeId"
         LEFT JOIN "Usuario" u ON u.id = p."tecnicoId"
        WHERE p.activa = true AND p.proxima <= $1::date`,
      [hoy],
    );

    for (const p of pendientes.rows) {
      r.procesados++;

      const veredicto = debeGenerarOrden(
        p,
        { activo: p.vehiculoActivo, tieneOrdenAbierta: p.ordenesAbiertas > 0 },
        { disponible: p.tecnicoDisponible, enSede: p.tecnicoEnSede },
        hoy,
      );

      if (!veredicto.permitido) {
        // Se guarda el motivo en la programación: una que no produce nada
        // parece que funciona si nadie dice por qué. Se avanza la fecha solo
        // cuando esperar no cambiaría nada; si falta el técnico, se espera a
        // que lo corrijan y la visita se genera en la siguiente vuelta.
        await this.db.query(
          `UPDATE "ProgramacionRecurrente"
              SET "ultimoAviso" = $2, proxima = coalesce($3::date, proxima)
            WHERE id = $1`,
          [
            p.id,
            `${hoy}: ${veredicto.mensaje}`,
            avanzaAlSaltar(veredicto.codigo) ? avanzarProxima(p, hoy) : null,
          ],
        );
        r.detalles.push(`${p.id}: ${veredicto.mensaje}`);
        continue;
      }

      try {
        await this.db.query("BEGIN");

        const folio = await this.siguienteFolio(p.empresaId, p.sedeId, p.codigoSede);
        const ordenId = nuevoId();

        // Asignada al técnico fijo de la programación y creada a nombre de
        // quien la programó: es quien decidió que esa visita se hiciera.
        await this.db.query(
          `INSERT INTO "OrdenServicio"
             (id,"empresaId","sedeId","clienteId","sedeClienteId","vehiculoId",
              tecnico_id,"configuracionEjeId",folio,tipo,estado,fecha,"creadoPorId",
              "clientRequestId")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::"TipoServicio",'programada',$11::date,$12,$13)`,
          [
            ordenId, p.empresaId, p.sedeId, p.clienteId, p.sedeClienteId, p.vehiculoId,
            p.tecnicoId, p.configuracionEjeId, folio, p.tipo, hoy, p.creadoPorId,
            // Clave determinista: si el trabajo corre dos veces el mismo día
            // por un reinicio, la restricción única evita la orden duplicada.
            `recurrente-${p.id}-${p.proxima}`,
          ],
        );

        await this.db.query(
          `INSERT INTO "OrdenEstadoHistorial"
             (id,"ordenId","estadoAnterior","estadoNuevo","usuarioId",motivo,"visibleCliente")
           VALUES ($1,$2,NULL,'programada',NULL,'Generada por programación recurrente',true)`,
          [nuevoId(), ordenId],
        );

        await this.db.query(
          `UPDATE "ProgramacionRecurrente" SET proxima = $2::date, "ultimoAviso" = NULL WHERE id = $1`,
          [p.id, avanzarProxima(p, hoy)],
        );

        await this.auditar(p.empresaId, "crear", {
          ordenId,
          folio,
          origen: "programacion_recurrente",
          programacionId: p.id,
        });

        await this.db.query("COMMIT");
        r.exitosos++;
      } catch (e) {
        await this.db.query("ROLLBACK").catch(() => undefined);
        r.fallidos++;
        r.detalles.push(`${p.id}: ${(e as Error).message}`);
      }
    }

    return r;
  }

  // ── Alertas ───────────────────────────────────────────────────────────────

  /**
   * Revisa la última medición de cada posición y genera alertas.
   *
   * Solo la ÚLTIMA: una llanta aparece en cada orden donde se midió, y
   * alertar por todas llenaría la bandeja de repetidos de hace meses que ya
   * se resolvieron.
   */
  async revisarAlertas(empresaId: string, opciones: { soloSedesDe?: string } = {}): Promise<Alerta[]> {
    const ahora = this.reloj();

    const r = await this.db.query<LlantaParaRevisar & { fecha: string }>(
      `SELECT DISTINCT ON (o."vehiculoId", lr.posicion)
              o.id AS "ordenId", o."vehiculoId", lr.posicion, lr.serial, lr.dot,
              lr.profundidad, pe."profundidadMinima",
              to_char(o.fecha,'YYYY-MM-DD') AS fecha
         FROM "LlantaRegistro" lr
         JOIN "OrdenServicio" o ON o.id = lr."ordenId"
         LEFT JOIN "PosicionEje" pe
                ON pe."configuracionEjeId" = o."configuracionEjeId"
               AND pe.numero = lr.posicion
        WHERE o."empresaId" = $1 AND o.estado = 'cerrada'
          -- El coordinador ve solo sus sedes (decisión del usuario).
          AND ($2::text IS NULL OR o."sedeId" IN (
                SELECT "sedeId" FROM "UsuarioSede" WHERE "usuarioId" = $2 AND activa))
        ORDER BY o."vehiculoId", lr.posicion, o.fecha DESC`,
      [empresaId, opciones.soloSedesDe ?? null],
    );

    const alertas = r.rows.flatMap((fila) =>
      evaluarAlertas(
        {
          ...fila,
          profundidad: aNumero(fila.profundidad),
          profundidadMinima: aNumero(fila.profundidadMinima),
        },
        ahora,
      ),
    );

    return ordenarPorSeveridad(deduplicarAlertas(alertas));
  }

  // ── Limpieza ──────────────────────────────────────────────────────────────

  /** Sesiones y tokens caducados: no aportan nada y engordan las tablas. */
  async limpiarCaducados(): Promise<{ sesiones: number; tokens: number }> {
    const ahora = this.reloj();
    const sesiones = await this.db.query(
      `DELETE FROM "SesionUsuario" WHERE "expiraEn" < $1 OR "revocadaEn" IS NOT NULL`,
      [ahora],
    );
    const tokens = await this.db.query(
      `DELETE FROM "TokenRecuperacion" WHERE "expiraEn" < $1 OR "usadoEn" IS NOT NULL`,
      [ahora],
    );
    return { sesiones: sesiones.rowCount ?? 0, tokens: tokens.rowCount ?? 0 };
  }

  // ── Auxiliares ────────────────────────────────────────────────────────────

  private async siguienteFolio(
    empresaId: string,
    sedeId: string,
    codigoSede: string,
  ): Promise<string> {
    const r = await this.db.query<{ valor: number }>(
      `INSERT INTO "Consecutivo" (id,"empresaId","sedeId",tipo,prefijo,valor)
       VALUES (gen_random_uuid()::text,$1,$2,'OS','OS',1)
       ON CONFLICT ("empresaId","sedeId",tipo)
       DO UPDATE SET valor = "Consecutivo".valor + 1
       RETURNING valor`,
      [empresaId, sedeId],
    );
    const valor = r.rows[0]?.valor ?? 1;
    return `OS-${codigoSede.toUpperCase()}-${String(valor).padStart(6, "0")}`;
  }

  private async auditar(
    empresaId: string,
    accion: string,
    detalle: Record<string, unknown>,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO "Auditoria" (id,"empresaId","usuarioId","usuarioNombre",rol,accion,detalle)
       VALUES ($1,$2,NULL,'Sistema','sistema',$3::"AccionAuditoria",$4)`,
      [nuevoId(), empresaId, accion, JSON.stringify(detalle)],
    );
  }
}

const aNumero = (v: unknown): number | null =>
  v === null || v === undefined ? null : typeof v === "number" ? v : Number(v);
