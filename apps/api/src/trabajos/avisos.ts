import { avisoCambios, avisoPorAprobar, correoValido, fechaEnColombia, nuevoId, type LlantaParaAviso } from "@tiretrack/domain";
import type { Correo } from "../correo/correo";
import { TrabajosProgramados } from "./programados";

/**
 * Avisos automáticos por correo (R13). Corren con los trabajos programados,
 * empresa por empresa y con su contexto de RLS, por tres razones:
 *
 * - **Después de confirmar, por construcción.** Si el aviso saliera en la
 *   petición que aprueba la orden, un fallo posterior dejaría avisada una
 *   aprobación que no ocurrió.
 * - **Nadie espera al proveedor de correo**: el coordinador aprueba y sigue.
 * - **Reintento natural**: si el proveedor falla, la orden queda sin marcar y
 *   la siguiente vuelta lo intenta otra vez.
 *
 * Cada aviso en su propia transacción, como el resto de los trabajos.
 */

interface Conexion {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface ResultadoAvisos {
  readonly enviados: number;
  readonly fallidos: number;
  readonly detalles: string[];
}

/** El resumen diario sale desde esta hora de Colombia, no de madrugada. */
export const HORA_RESUMEN = 6;

export class AvisosPorCorreo {
  constructor(
    private readonly db: Conexion,
    private readonly correo: Correo,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  private async empresa(empresaId: string) {
    const r = await this.db.query<{ nombre: string; ultimo: string | null }>(
      `SELECT nombre, "ultimoAvisoCambios" AS ultimo FROM "Empresa" WHERE id = $1`,
      [empresaId],
    );
    return r.rows[0] ?? null;
  }

  /** Órdenes que esperan al cliente y todavía no se le avisaron. */
  async avisarClientes(empresaId: string): Promise<ResultadoAvisos> {
    const res = { enviados: 0, fallidos: 0, detalles: [] as string[] };
    if (!this.correo.configurado) return res;
    const empresa = await this.empresa(empresaId);
    if (!empresa) return res;
    const ordenes = await this.db.query<{
      id: string; folio: string; vehiculo: string; limite: string | null; clienteId: string; clienteEmail: string | null;
    }>(
      `SELECT o.id, coalesce(o.folio, o."codigoReferencia", '') AS folio,
              coalesce(o."vehiculoCodigo", v.codigo) AS vehiculo,
              to_char(o."limiteCliente", 'YYYY-MM-DD') AS limite,
              o."clienteId", c.email AS "clienteEmail"
         FROM "OrdenServicio" o
         JOIN "Vehiculo" v ON v.id = o."vehiculoId"
         JOIN "Cliente" c ON c.id = o."clienteId"
        WHERE o.estado = 'pendiente_cliente' AND o."avisoClienteEn" IS NULL
        ORDER BY o."limiteCliente" NULLS LAST
        LIMIT 200`,
    );
    for (const o of ordenes.rows) {
      const usuarios = await this.db.query<{ email: string }>(
        `SELECT email FROM "Usuario" WHERE rol = 'cliente' AND activo AND "clienteId" = $1`,
        [o.clienteId],
      );
      const para = [...new Set([o.clienteEmail, ...usuarios.rows.map((u) => u.email)]
        .filter((x): x is string => Boolean(x) && correoValido(x as string))
        .map((x) => x.trim().toLowerCase()))];
      if (para.length > 0) {
        const r = await this.correo.enviar({ para, ...avisoPorAprobar({ empresa: empresa.nombre, folio: o.folio, vehiculo: o.vehiculo, limite: o.limite }) });
        if (!r.ok) {
          // Sin marcar: la siguiente vuelta lo intenta otra vez.
          res.fallidos++;
          res.detalles.push(`${o.folio}: ${r.mensaje}`);
          continue;
        }
        res.enviados++;
      } else {
        // Sin a quién avisar se marca igual: el cliente la ve en su portal, y
        // revisarla en cada vuelta para siempre no cambia nada.
        res.detalles.push(`${o.folio}: el cliente no tiene correo registrado`);
      }
      await this.db.query("BEGIN");
      try {
        await this.db.query(`UPDATE "OrdenServicio" SET "avisoClienteEn" = now() WHERE id = $1`, [o.id]);
        await this.db.query(
          `INSERT INTO "Auditoria" (id,"empresaId","usuarioId","usuarioNombre",rol,accion,entidad,"entidadId",detalle)
           VALUES ($1,$2,NULL,'Sistema','sistema','crear'::"AccionAuditoria",'aviso_cliente',$3,$4)`,
          [nuevoId(), empresaId, o.id, JSON.stringify({ folio: o.folio, enviadoA: para })],
        );
        await this.db.query("COMMIT");
      } catch (e) {
        await this.db.query("ROLLBACK");
        res.detalles.push(`${o.folio}: ${(e as Error).message}`);
      }
    }
    return res;
  }

  /**
   * Una vez al día, a cada coordinador y administrador, las llantas de SUS
   * sedes para cambio inmediato (por profundidad o DOT vencido). Lo
   * preventivo no se manda: un correo diario con todo lo que falta por
   * programar se deja de leer a la semana.
   */
  async resumenDeCambios(empresaId: string): Promise<ResultadoAvisos> {
    const res = { enviados: 0, fallidos: 0, detalles: [] as string[] };
    if (!this.correo.configurado) return res;
    const ahora = this.reloj();
    const horaColombia = (ahora.getUTCHours() + 19) % 24;
    if (horaColombia < HORA_RESUMEN) return res;
    const hoy = fechaEnColombia(ahora);
    const empresa = await this.empresa(empresaId);
    if (!empresa || empresa.ultimo === hoy) return res;

    const oficina = await this.db.query<{ id: string; email: string }>(
      `SELECT id, email FROM "Usuario" WHERE rol IN ('administrador', 'coordinador') AND activo`,
    );
    const trabajos = new TrabajosProgramados(this.db as never, () => ahora);
    for (const u of oficina.rows) {
      if (!correoValido(u.email)) continue;
      const alertas = (await trabajos.revisarAlertas(empresaId, { soloSedesDe: u.id }))
        .filter((a) => a.tipo === "profundidad_baja" || a.tipo === "dot_vencido");
      if (alertas.length === 0) continue;
      const ids = [...new Set(alertas.map((a) => a.vehiculoId))];
      const vehiculos = await this.db.query<{ id: string; codigo: string; cliente: string }>(
        `SELECT v.id, v.codigo, c.nombre AS cliente
           FROM "Vehiculo" v JOIN "SedeCliente" s ON s.id = v."sedeClienteId" JOIN "Cliente" c ON c.id = s."clienteId"
          WHERE v.id = ANY($1)`,
        [ids],
      );
      const porId = new Map(vehiculos.rows.map((v) => [v.id, v]));
      const llantas: LlantaParaAviso[] = alertas.map((a) => ({
        vehiculo: porId.get(a.vehiculoId)?.codigo ?? a.vehiculoId,
        cliente: porId.get(a.vehiculoId)?.cliente ?? "",
        posicion: a.posicion,
        motivo: a.mensaje,
      }));
      const r = await this.correo.enviar({ para: [u.email], ...avisoCambios({ empresa: empresa.nombre, fecha: hoy, llantas }) });
      if (r.ok) res.enviados++;
      else {
        res.fallidos++;
        res.detalles.push(`resumen a ${u.email}: ${r.mensaje}`);
      }
    }
    // Se marca el día aunque alguno falle: reintentar reenviaría a los que sí
    // lo recibieron. El fallo queda en el registro.
    await this.db.query(`UPDATE "Empresa" SET "ultimoAvisoCambios" = $2 WHERE id = $1`, [empresaId, hoy]);
    return res;
  }
}
