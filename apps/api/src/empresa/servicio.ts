import { LIMITES_POR_DEFECTO, validarLimites, type LimitesEmpresa, type Rol, type Veredicto } from "@tiretrack/domain";

/**
 * Parámetros de la empresa (R2): por ahora, los límites de cambio de llanta.
 *
 * Todos los de la empresa los leen —el técnico los necesita sin señal para
 * ver en la posición si la llanta pide cambio— y solo el administrador los
 * cambia, porque mueven las alertas y los informes de toda la flota.
 */

/** Basta con poder consultar: lo usan las rutas y la descarga. */
export interface Consultable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; veredicto: Veredicto };

export class ServicioEmpresa {
  constructor(private readonly db: Consultable) {}

  async limites(empresaId: string): Promise<LimitesEmpresa> {
    const r = await this.db.query<{ cambioInmediato: string; programarCambio: string }>(
      `SELECT "limiteCambioInmediato" AS "cambioInmediato", "limiteProgramarCambio" AS "programarCambio"
         FROM "Empresa" WHERE id = $1`,
      [empresaId],
    );
    const f = r.rows[0];
    // numeric llega como texto: comparado como texto, "10" < "9".
    return f ? { cambioInmediato: Number(f.cambioInmediato), programarCambio: Number(f.programarCambio) } : LIMITES_POR_DEFECTO;
  }

  async guardarLimites(ctx: Contexto, l: LimitesEmpresa): Promise<Resultado<LimitesEmpresa>> {
    if (ctx.rol !== "administrador") {
      return { ok: false, veredicto: { permitido: false, codigo: "SIN_PERMISO", mensaje: "Los límites de la empresa los fija el administrador" } };
    }
    const v = validarLimites(l);
    if (!v.permitido) return { ok: false, veredicto: v };
    await this.db.query(
      `UPDATE "Empresa" SET "limiteCambioInmediato" = $2, "limiteProgramarCambio" = $3 WHERE id = $1`,
      [ctx.empresaId, l.cambioInmediato, l.programarCambio],
    );
    return { ok: true, valor: l };
  }
}
