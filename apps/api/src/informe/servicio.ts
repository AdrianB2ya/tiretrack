import type pg from "pg";
import {
  aCSV,
  construirTrazabilidad,
  desgasteEnElTiempo,
  nombreArchivo,
  nuevoId,
  resumirExportacion,
  type FilaCruda,
  type PasoTrazabilidad,
  type Rol,
  type Veredicto,
} from "@tiretrack/domain";

/**
 * Informe de órdenes y auditoría de exportaciones.
 *
 * La consulta no lleva filtro de empresa ni de rol: los aplica RLS con el
 * contexto de la transacción. El técnico ve solo sus órdenes y el cliente
 * solo las suyas sin que este código lo sepa.
 */

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
  readonly usuarioNombre?: string;
  readonly clienteId?: string | null;
  readonly ip?: string;
}

export interface FiltroInforme {
  readonly clienteId?: string;
  readonly vehiculoId?: string;
  /** Busca en el serial montado y en el desmontado. */
  readonly serial?: string;
  /** Código del servicio (`CALI`), no su nombre. */
  readonly servicio?: string;
  readonly estadoLlanta?: string;
  readonly desde?: string;
  readonly hasta?: string;
  /** Órdenes elegidas a mano, cuando el usuario seleccionó en la lista. */
  readonly ordenIds?: readonly string[];
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; veredicto: Veredicto };

export interface Exportacion {
  readonly contenido: string;
  readonly nombreArchivo: string;
  readonly registros: number;
  readonly ordenes: number;
  readonly sinCerrar: number;
}

export interface FilaVista {
  readonly fecha: string;
  readonly folio: string;
  readonly estado: string;
  readonly vehiculo: string;
  readonly posicion: number;
  readonly serial: string | null;
  readonly marca: string | null;
  readonly noIdentificada: boolean;
  readonly profundidad: number | null;
  readonly desSerial: string | null;
  readonly servicios: string[];
}

export interface VistaPrevia {
  readonly registros: number;
  readonly ordenes: number;
  readonly sinCerrar: number;
  /** Las primeras; el total está en `registros`. */
  readonly filas: FilaVista[];
}

export class ServicioInforme {
  constructor(
    private readonly db: pg.Client | pg.Pool,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  private hoy(): string {
    return this.reloj().toISOString().split("T")[0] as string;
  }

  /**
   * Una fila por POSICIÓN de llanta, que es la unidad del informe operativo
   * y la que permite seguir una llanta concreta en el tiempo.
   *
   * Los servicios llegan agregados en un arreglo: hacer una consulta por
   * posición para traerlos sería el problema de las N+1 consultas con 22
   * posiciones por orden.
   */
  async consultar(_ctx: Contexto, f: FiltroInforme = {}): Promise<FilaCruda[]> {
    const cond: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, valor: unknown) => {
      params.push(valor);
      cond.push(sql.replace("?", `$${params.length}`));
    };

    if (f.clienteId) add('o."clienteId" = ?', f.clienteId);
    if (f.vehiculoId) add('o."vehiculoId" = ?', f.vehiculoId);
    if (f.desde) add("o.fecha >= ?::date", f.desde);
    if (f.hasta) add("o.fecha <= ?::date", f.hasta);
    if (f.estadoLlanta) add('lr."estadoLlanta" = ?', f.estadoLlanta);
    if (f.ordenIds && f.ordenIds.length > 0) add("o.id = ANY(?)", [...f.ordenIds]);

    // El serial se busca en la montada Y en la desmontada: quien rastrea una
    // llanta no sabe de antemano si en esa visita entró o salió.
    if (f.serial) {
      params.push(`%${f.serial.toLowerCase()}%`);
      cond.push(
        `(lower(coalesce(lr.serial,'')) LIKE $${params.length}
          OR lower(coalesce(lr."desSerial",'')) LIKE $${params.length})`,
      );
    }

    if (f.servicio) {
      params.push(f.servicio);
      cond.push(`EXISTS (
        SELECT 1 FROM "LlantaServicio" ls
        JOIN "Servicio" s ON s.id = ls."servicioId"
        WHERE ls."llantaRegistroId" = lr.id AND s.codigo = $${params.length}
      )`);
    }

    const where = cond.length > 0 ? `WHERE ${cond.join(" AND ")}` : "";

    const r = await this.db.query<FilaCruda>(
      `SELECT
         to_char(o.fecha,'YYYY-MM-DD') AS fecha,
         coalesce(o."vehiculoCodigo", v.codigo) AS "vehiculoCodigo",
         coalesce(o."vehiculoPlaca", v.placa)   AS "vehiculoPlaca",
         o.folio, o."codigoReferencia", o.estado::text AS estado, o.kilometraje,
         lr.posicion,
         coalesce(
           -- Códigos, no nombres: el informe los traduce a columnas con el
           -- catálogo del dominio. Si dependiera del nombre guardado en la
           -- base, renombrar un servicio vaciaría esa columna del histórico.
           (SELECT array_agg(s.codigo ORDER BY s.orden)
              FROM "LlantaServicio" ls
              JOIN "Servicio" s ON s.id = ls."servicioId"
             WHERE ls."llantaRegistroId" = lr.id),
           ARRAY[]::text[]
         ) AS servicios,
         lr."numCalor", lr.serial, lr.dot,
         m.nombre AS marca, d.nombre AS diseno,
         lr.medida, lr."estadoLlanta",
         lr."psiEncontrada", lr."psiCalibrado", lr.profundidad, lr."noIdentificada",
         lr."desPosicionOrigen" AS "desPosicion", lr."desNumCalor", lr."desSerial", lr."desDot",
         lr."desMedida", lr."desProfundidad",
         dm.nombre AS "desMarca", dd.nombre AS "desDiseno",
         lr."desDestino", lr."desDetalle"
       FROM "OrdenServicio" o
       JOIN "LlantaRegistro" lr ON lr."ordenId" = o.id
       LEFT JOIN "Vehiculo" v ON v.id = o."vehiculoId"
       LEFT JOIN "Marca" m   ON m.id = lr."marcaId"
       LEFT JOIN "Diseno" d  ON d.id = lr."disenoId"
       LEFT JOIN "Marca" dm  ON dm.id = lr."desMarcaId"
       LEFT JOIN "Diseno" dd ON dd.id = lr."desDisenoId"
       ${where}
       ORDER BY o.fecha DESC, o.folio DESC NULLS LAST, lr.posicion`,
      params,
    );

    // pg devuelve numeric como texto: sin convertir, el informe mostraría
    // "9.00" y las comparaciones de profundidad fallarían en silencio.
    return r.rows.map((fila) => ({
      ...fila,
      psiEncontrada: aNumero(fila.psiEncontrada),
      psiCalibrado: aNumero(fila.psiCalibrado),
      profundidad: aNumero(fila.profundidad),
      desProfundidad: aNumero(fila.desProfundidad),
    }));
  }

  /**
   * Exporta y **deja constancia**. La auditoría se registra aunque la
   * descarga falle después: la intención de sacar los datos ocurrió igual.
   */
  async exportar(ctx: Contexto, f: FiltroInforme = {}, origen = "informe"): Promise<Resultado<Exportacion>> {
    const filas = await this.consultar(ctx, f);
    if (filas.length === 0) {
      return {
        ok: false,
        veredicto: {
          permitido: false,
          codigo: "SIN_REGISTROS",
          mensaje: "No hay registros con esos filtros",
        },
      };
    }

    const resumen = resumirExportacion(filas);
    const nombre = nombreArchivo(resumen.folios, this.hoy());

    await this.registrarAuditoria(ctx, "exportar_informe", {
      archivo: nombre,
      registros: resumen.registros,
      ordenes: resumen.ordenes,
      folios: resumen.folios,
      // Si aparece un archivo con datos que no cuadran, se puede ver que
      // salió preliminar.
      sinCerrar: resumen.sinCerrar,
      origen,
      filtros: limpiarFiltros(f),
    });

    return {
      ok: true,
      valor: {
        contenido: aCSV(filas),
        nombreArchivo: nombre,
        registros: resumen.registros,
        ordenes: resumen.ordenes,
        sinCerrar: resumen.sinCerrar,
      },
    };
  }

  /**
   * Lo que se ve en pantalla antes de exportar: cuántos registros y órdenes
   * salen con esos filtros, cuántas van sin cerrar y las primeras filas. Sin
   * esto el coordinador descubre que el filtro estaba mal después de abrir
   * el archivo en otra parte.
   *
   * No se audita: no sale ningún archivo, y ver en pantalla lo que el rol ya
   * puede consultar no es una salida de datos.
   */
  async vistaPrevia(ctx: Contexto, f: FiltroInforme = {}, limite = 100): Promise<VistaPrevia> {
    const filas = await this.consultar(ctx, f);
    const r = resumirExportacion(filas);
    return {
      registros: r.registros,
      ordenes: r.ordenes,
      sinCerrar: r.sinCerrar,
      filas: filas.slice(0, limite).map((x) => ({
        fecha: x.fecha,
        folio: x.folio ?? x.codigoReferencia ?? "",
        estado: x.estado,
        vehiculo: x.vehiculoCodigo ?? x.vehiculoPlaca ?? "",
        posicion: x.posicion,
        serial: x.serial,
        marca: x.marca,
        noIdentificada: x.noIdentificada,
        profundidad: x.profundidad,
        desSerial: x.desSerial,
        servicios: [...x.servicios],
      })),
    };
  }

  /** Recorrido de una llanta concreta por serial. */
  async trazabilidad(
    ctx: Contexto,
    serial: string,
  ): Promise<{ pasos: PasoTrazabilidad[]; desgaste: { perdida: number; servicios: number } | null }> {
    const filas = await this.consultar(ctx, { serial });
    const pasos = construirTrazabilidad(filas);
    return { pasos, desgaste: desgasteEnElTiempo(pasos) };
  }

  /**
   * Toda salida de datos queda registrada: sin esto, una fuga de información
   * no tiene rastro. Guardar los filtros importa tanto como el conteo — no es
   * lo mismo exportar una orden propia que la cartera de un cliente entero.
   */
  async registrarAuditoria(
    ctx: Contexto,
    accion: string,
    detalle: Record<string, unknown>,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO "Auditoria" (id, "empresaId", "usuarioId", "usuarioNombre", rol, accion, detalle, ip)
       VALUES ($1,$2,$3,$4,$5,$6::"AccionAuditoria",$7,$8)`,
      [
        nuevoId(),
        ctx.empresaId,
        ctx.usuarioId,
        ctx.usuarioNombre ?? null,
        ctx.rol,
        accion,
        JSON.stringify(detalle),
        ctx.ip ?? null,
      ],
    );
  }

  async listarAuditoria(
    _ctx: Contexto,
    filtro: { usuarioId?: string; accion?: string; desde?: string } = {},
  ) {
    const cond: string[] = [];
    const params: unknown[] = [];
    if (filtro.usuarioId) {
      params.push(filtro.usuarioId);
      cond.push(`"usuarioId" = $${params.length}`);
    }
    if (filtro.accion) {
      params.push(filtro.accion);
      cond.push(`accion = $${params.length}::"AccionAuditoria"`);
    }
    if (filtro.desde) {
      params.push(filtro.desde);
      cond.push(`"creadoEn" >= $${params.length}::date`);
    }
    const where = cond.length > 0 ? `WHERE ${cond.join(" AND ")}` : "";

    const r = await this.db.query(
      `SELECT id, "usuarioId", "usuarioNombre", rol, accion::text AS accion, detalle, ip, "creadoEn"
         FROM "Auditoria" ${where} ORDER BY "creadoEn" DESC LIMIT 200`,
      params,
    );
    return r.rows;
  }
}

const aNumero = (v: unknown): number | null =>
  v === null || v === undefined ? null : typeof v === "number" ? v : Number(v);

/** Quita los filtros vacíos para que la auditoría no guarde ruido. */
function limpiarFiltros(f: FiltroInforme): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(f).filter(([, v]) => v !== undefined && v !== "" && v !== null),
  );
}
