import type pg from "pg";
import type { EstadoOrden } from "@tiretrack/domain";

/**
 * Acceso a datos de órdenes de servicio.
 *
 * Dos cosas requieren cuidado especial aquí y están comentadas donde ocurren:
 * la generación atómica del folio y el bloqueo optimista por versión.
 */

export interface Orden {
  readonly id: string;
  readonly empresaId: string;
  readonly sedeId: string;
  readonly clienteId: string;
  readonly sedeClienteId: string;
  readonly vehiculoId: string;
  readonly tecnicoId: string;
  readonly configuracionEjeId: string;
  readonly folio: string | null;
  readonly codigoReferencia: string | null;
  readonly tipo: string;
  readonly prioridad: string;
  readonly estado: EstadoOrden;
  readonly fecha: string;
  readonly kilometraje: number | null;
  readonly hallazgos: string | null;
  readonly accion: string | null;
  readonly notaCoordinador: string | null;
  readonly motivoDevolucion: string | null;
  readonly sinConductor: boolean;
  readonly conductorNombre: string | null;
  readonly firmaNombre: string | null;
  readonly firmaCedula: string | null;
  readonly firmaVersion: number | null;
  readonly clienteNombre: string | null;
  readonly vehiculoCodigo: string | null;
  readonly tecnicoNombre: string | null;
  readonly congeladoEn: Date | null;
  readonly aprobadoPorId: string | null;
  readonly autoAprobada: boolean;
  readonly enviadoClienteEn: string | null;
  readonly limiteCliente: string | null;
  readonly cierreTacito: boolean;
  readonly version: number;
  readonly versionContenido: number;
  readonly clientRequestId: string | null;
  readonly creadoPorId: string;
}

export interface DatosCongelado {
  readonly clienteNombre: string;
  readonly clienteNit: string;
  readonly sedeClienteNombre: string;
  readonly vehiculoCodigo: string;
  readonly vehiculoPlaca: string | null;
  readonly tecnicoNombre: string;
  readonly tecnicoCedula: string;
}

export interface FiltroOrdenes {
  readonly estado?: EstadoOrden;
  readonly clienteId?: string;
  readonly vehiculoId?: string;
  readonly tecnicoId?: string;
  readonly desde?: string;
  readonly hasta?: string;
}

export interface RepositorioOrdenes {
  siguienteFolio(empresaId: string, sedeId: string, codigoSede: string): Promise<string>;
  crear(o: Omit<Orden, "version" | "versionContenido" | "estado"> & { estado: EstadoOrden }): Promise<Orden>;
  buscarPorId(id: string): Promise<Orden | null>;
  buscarPorClientRequestId(clientRequestId: string): Promise<Orden | null>;
  listar(filtro: FiltroOrdenes): Promise<Orden[]>;
  /**
   * Devuelve null si la versión no coincide: alguien más escribió antes.
   * `tocaContenido` decide si además sube `versionContenido`, que es lo que
   * invalida una firma.
   */
  actualizar(
    id: string,
    version: number,
    datos: Record<string, unknown>,
    tocaContenido?: boolean,
  ): Promise<Orden | null>;
  /** La usan las mediciones de llanta, que viven en otra tabla. */
  marcarContenidoCambiado(ordenId: string): Promise<void>;
  cambiarEstado(
    id: string,
    version: number,
    nuevo: EstadoOrden,
    extra: Record<string, unknown>,
  ): Promise<Orden | null>;
  registrarHistorial(h: {
    id: string;
    ordenId: string;
    estadoAnterior: EstadoOrden | null;
    estadoNuevo: EstadoOrden;
    usuarioId: string;
    motivo: string | null;
    visibleCliente: boolean;
  }): Promise<void>;
  /** usuarioId null = Sistema (cierre tácito, orden recurrente). */
  historialDe(ordenId: string, soloVisiblesCliente: boolean): Promise<
    { estadoNuevo: EstadoOrden; usuarioId: string | null; motivo: string | null; creadoEn: Date }[]
  >;
  datosParaCongelar(ordenId: string): Promise<DatosCongelado | null>;
  contarPosiciones(ordenId: string): Promise<number>;
  ordenesAbiertasDeVehiculo(vehiculoId: string, exceptoId?: string): Promise<Orden[]>;
  codigoDeSede(sedeId: string): Promise<string | null>;
  tecnicoPerteneceASede(tecnicoId: string, sedeId: string): Promise<boolean>;
}

export class RepositorioOrdenesPg implements RepositorioOrdenes {
  constructor(private readonly db: pg.Client | pg.Pool) {}

  private readonly campos = `
    id, "empresaId", "sedeId", "clienteId", "sedeClienteId", "vehiculoId",
    tecnico_id AS "tecnicoId", "configuracionEjeId", folio, "codigoReferencia",
    tipo::text AS tipo, prioridad::text AS prioridad, estado::text AS estado,
    to_char(fecha, 'YYYY-MM-DD') AS fecha,
    kilometraje, hallazgos, accion, "notaCoordinador", "motivoDevolucion",
    "sinConductor", "conductorNombre",
    "firmaNombre", "firmaCedula", "firmaVersion",
    "clienteNombre", "vehiculoCodigo", "tecnicoNombre", "congeladoEn",
    "aprobadoPorId", "autoAprobada",
    to_char("enviadoClienteEn", 'YYYY-MM-DD') AS "enviadoClienteEn",
    to_char("limiteCliente", 'YYYY-MM-DD') AS "limiteCliente",
    "cierreTacito", version, "versionContenido", "clientRequestId", "creadoPorId"
  `;

  /**
   * Folio atómico.
   *
   * `UPDATE ... RETURNING` es una sola operación: PostgreSQL bloquea la fila
   * del contador hasta que la transacción termina, así que dos técnicos
   * creando una orden en el mismo instante reciben números distintos.
   *
   * Lo que NO se puede hacer: `SELECT count(*) + 1`. Ambos leerían el mismo
   * número y generarían el mismo folio. Es el error que traía el prototipo.
   */
  async siguienteFolio(empresaId: string, sedeId: string, codigoSede: string): Promise<string> {
    const r = await this.db.query<{ valor: number }>(
      `UPDATE "Consecutivo"
          SET valor = valor + 1
        WHERE "empresaId" = $1 AND "sedeId" = $2 AND tipo = 'OS'
      RETURNING valor`,
      [empresaId, sedeId],
    );

    if (r.rowCount === 0) {
      // Primera orden de esta sede: se crea el contador en 1. Si dos
      // peticiones llegan a la vez, la restricción única hace fallar a una
      // y el ON CONFLICT la resuelve incrementando.
      const creado = await this.db.query<{ valor: number }>(
        `INSERT INTO "Consecutivo" (id, "empresaId", "sedeId", tipo, prefijo, valor)
         VALUES (gen_random_uuid()::text, $1, $2, 'OS', 'OS', 1)
         ON CONFLICT ("empresaId", "sedeId", tipo)
         DO UPDATE SET valor = "Consecutivo".valor + 1
         RETURNING valor`,
        [empresaId, sedeId],
      );
      return formatear(codigoSede, creado.rows[0]?.valor ?? 1);
    }

    return formatear(codigoSede, r.rows[0]?.valor ?? 1);
  }

  async crear(o: Omit<Orden, "version" | "versionContenido" | "estado"> & { estado: EstadoOrden }): Promise<Orden> {
    const r = await this.db.query<Orden>(
      `INSERT INTO "OrdenServicio"
         (id, "empresaId", "sedeId", "clienteId", "sedeClienteId", "vehiculoId",
          tecnico_id, "configuracionEjeId", folio, "codigoReferencia", tipo, prioridad,
          estado, fecha, kilometraje, "notaCoordinador", "sinConductor", "conductorNombre",
          "clientRequestId", "creadoPorId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING ${this.campos}`,
      [
        o.id, o.empresaId, o.sedeId, o.clienteId, o.sedeClienteId, o.vehiculoId,
        o.tecnicoId, o.configuracionEjeId, o.folio, o.codigoReferencia, o.tipo, o.prioridad,
        o.estado, o.fecha, o.kilometraje, o.notaCoordinador, o.sinConductor, o.conductorNombre,
        o.clientRequestId, o.creadoPorId,
      ],
    );
    return r.rows[0] as Orden;
  }

  async buscarPorId(id: string): Promise<Orden | null> {
    const r = await this.db.query<Orden>(
      `SELECT ${this.campos} FROM "OrdenServicio" WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  /** Clave de idempotencia: reintentar el envío no crea una orden duplicada. */
  async buscarPorClientRequestId(clientRequestId: string): Promise<Orden | null> {
    const r = await this.db.query<Orden>(
      `SELECT ${this.campos} FROM "OrdenServicio" WHERE "clientRequestId" = $1`,
      [clientRequestId],
    );
    return r.rows[0] ?? null;
  }

  async listar(f: FiltroOrdenes): Promise<Orden[]> {
    const cond: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, valor: unknown) => {
      params.push(valor);
      cond.push(sql.replace("?", `$${params.length}`));
    };

    if (f.estado) add("estado = ?::\"EstadoOrden\"", f.estado);
    if (f.clienteId) add('"clienteId" = ?', f.clienteId);
    if (f.vehiculoId) add('"vehiculoId" = ?', f.vehiculoId);
    if (f.tecnicoId) add("tecnico_id = ?", f.tecnicoId);
    if (f.desde) add("fecha >= ?::date", f.desde);
    if (f.hasta) add("fecha <= ?::date", f.hasta);

    const where = cond.length > 0 ? `WHERE ${cond.join(" AND ")}` : "";
    const r = await this.db.query<Orden>(
      `SELECT ${this.campos} FROM "OrdenServicio" ${where} ORDER BY fecha DESC, folio DESC`,
      params,
    );
    return r.rows;
  }

  /**
   * Bloqueo optimista: la actualización solo aplica si la versión coincide.
   * Si dos usuarios editan la misma orden, el segundo recibe null y puede
   * avisarle en vez de pisar el trabajo del primero en silencio.
   */
  async actualizar(
    id: string,
    version: number,
    datos: Record<string, unknown>,
    tocaContenido = false,
  ): Promise<Orden | null> {
    const claves = Object.keys(datos);
    if (claves.length === 0) return this.buscarPorId(id);

    const sets = claves.map((k, i) => `"${k}" = $${i + 3}`).join(", ");
    // Solo las escrituras de contenido suben versionContenido: lo demás
    // —notas, estado, folio— no invalida la firma del cliente.
    const contenido = tocaContenido ? ', "versionContenido" = "versionContenido" + 1' : "";
    const r = await this.db.query<Orden>(
      `UPDATE "OrdenServicio"
          SET ${sets}, version = version + 1${contenido}
        WHERE id = $1 AND version = $2
       RETURNING ${this.campos}`,
      [id, version, ...claves.map((k) => datos[k])],
    );
    return r.rows[0] ?? null;
  }

  /**
   * Las mediciones viven en LlantaRegistro, no en la orden. Al guardarlas hay
   * que avisar aquí, o la firma seguiría pareciendo vigente después de que
   * el técnico cambió una profundidad.
   */
  async marcarContenidoCambiado(ordenId: string): Promise<void> {
    await this.db.query(
      `UPDATE "OrdenServicio"
          SET version = version + 1, "versionContenido" = "versionContenido" + 1
        WHERE id = $1`,
      [ordenId],
    );
  }

  async cambiarEstado(
    id: string,
    version: number,
    nuevo: EstadoOrden,
    extra: Record<string, unknown>,
  ): Promise<Orden | null> {
    const claves = Object.keys(extra);
    const sets = claves.map((k, i) => `, "${k}" = $${i + 4}`).join("");
    const r = await this.db.query<Orden>(
      `UPDATE "OrdenServicio"
          SET estado = $3::"EstadoOrden", version = version + 1${sets}
        WHERE id = $1 AND version = $2
       RETURNING ${this.campos}`,
      [id, version, nuevo, ...claves.map((k) => extra[k])],
    );
    return r.rows[0] ?? null;
  }

  async registrarHistorial(h: {
    id: string;
    ordenId: string;
    estadoAnterior: EstadoOrden | null;
    estadoNuevo: EstadoOrden;
    usuarioId: string;
    motivo: string | null;
    visibleCliente: boolean;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO "OrdenEstadoHistorial"
         (id, "ordenId", "estadoAnterior", "estadoNuevo", "usuarioId", motivo, "visibleCliente")
       VALUES ($1,$2,$3::"EstadoOrden",$4::"EstadoOrden",$5,$6,$7)`,
      [h.id, h.ordenId, h.estadoAnterior, h.estadoNuevo, h.usuarioId, h.motivo, h.visibleCliente],
    );
  }

  async historialDe(
    ordenId: string,
    soloVisiblesCliente: boolean,
  ): Promise<{ estadoNuevo: EstadoOrden; usuarioId: string | null; motivo: string | null; creadoEn: Date }[]> {
    const r = await this.db.query<{
      estadoNuevo: EstadoOrden;
      usuarioId: string | null;
      motivo: string | null;
      creadoEn: Date;
    }>(
      `SELECT "estadoNuevo"::text AS "estadoNuevo", "usuarioId", motivo, "creadoEn"
         FROM "OrdenEstadoHistorial"
        WHERE "ordenId" = $1 ${soloVisiblesCliente ? 'AND "visibleCliente" = true' : ""}
        ORDER BY "creadoEn"`,
      [ordenId],
    );
    return r.rows;
  }

  /** Lee los datos maestros VIVOS para estamparlos en la orden al cerrar. */
  async datosParaCongelar(ordenId: string): Promise<DatosCongelado | null> {
    const r = await this.db.query<DatosCongelado>(
      `SELECT c.nombre AS "clienteNombre", c.nit AS "clienteNit",
              sc.nombre AS "sedeClienteNombre",
              v.codigo AS "vehiculoCodigo", v.placa AS "vehiculoPlaca",
              u.nombre AS "tecnicoNombre", u.cedula AS "tecnicoCedula"
         FROM "OrdenServicio" o
         JOIN "Cliente" c ON c.id = o."clienteId"
         JOIN "SedeCliente" sc ON sc.id = o."sedeClienteId"
         JOIN "Vehiculo" v ON v.id = o."vehiculoId"
         JOIN "Usuario" u ON u.id = o.tecnico_id
        WHERE o.id = $1`,
      [ordenId],
    );
    return r.rows[0] ?? null;
  }

  async contarPosiciones(ordenId: string): Promise<number> {
    const r = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "LlantaRegistro" WHERE "ordenId" = $1`,
      [ordenId],
    );
    return r.rows[0]?.n ?? 0;
  }

  async ordenesAbiertasDeVehiculo(vehiculoId: string, exceptoId?: string): Promise<Orden[]> {
    const r = await this.db.query<Orden>(
      `SELECT ${this.campos} FROM "OrdenServicio"
        WHERE "vehiculoId" = $1
          AND estado NOT IN ('cerrada','anulada')
          ${exceptoId ? "AND id <> $2" : ""}`,
      exceptoId ? [vehiculoId, exceptoId] : [vehiculoId],
    );
    return r.rows;
  }

  async codigoDeSede(sedeId: string): Promise<string | null> {
    const r = await this.db.query<{ codigo: string }>(
      `SELECT codigo FROM "Sede" WHERE id = $1`,
      [sedeId],
    );
    return r.rows[0]?.codigo ?? null;
  }

  async tecnicoPerteneceASede(tecnicoId: string, sedeId: string): Promise<boolean> {
    const r = await this.db.query<{ existe: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM "UsuarioSede" WHERE "usuarioId" = $1 AND "sedeId" = $2
       ) AS existe`,
      [tecnicoId, sedeId],
    );
    return r.rows[0]?.existe ?? false;
  }
}

function formatear(codigoSede: string, consecutivo: number): string {
  return `OS-${codigoSede.toUpperCase()}-${String(consecutivo).padStart(6, "0")}`;
}
