import { CATALOGO_SERVICIOS, nuevoId } from "@tiretrack/domain";
import type { Conexion } from "./base";
import { firmaAContrato, fotoAContrato, medicionAContrato, ordenAContrato } from "./contrato";

/**
 * Repositorio local.
 *
 * Toda escritura hace dos cosas en la misma transacción: guarda el dato y
 * encola la operación para el servidor. Si se separaran, un corte de luz
 * entre las dos dejaría una medición que el servidor nunca va a ver — o una
 * operación que apunta a algo que no existe.
 */

export interface OrdenLocal {
  readonly id: string;
  readonly folio: string | null;
  readonly codigoReferencia: string | null;
  readonly sedeId: string;
  readonly vehiculoId: string;
  readonly clienteId: string;
  readonly tecnicoId: string;
  /** Congelado al enviar: si se reasigna, la bandeja sigue mostrando quién
   * la ejecutó. */
  readonly tecnicoNombre: string | null;
  readonly enviadaRevisionEn: string | null;
  /** Fecha límite para que el cliente apruebe; la fija el servidor. */
  readonly limiteCliente: string | null;
  readonly estado: string;
  /** Presente cuando el coordinador o el cliente la devolvieron. */
  readonly motivoDevolucion: string | null;
  readonly notaCoordinador: string | null;
  readonly fecha: string;
  readonly configuracionEjeId: string;
  readonly kilometraje: number | null;
  readonly hallazgos: string | null;
  /** Acción realizada. Se guardaba en SQLite y nada la leía. */
  readonly accion: string | null;
  readonly firmaNombre: string | null;
  readonly firmaCedula: string | null;
  /** Versión de contenido que la firma ampara. */
  readonly firmaVersion: number | null;
  readonly firmaTrazo: string | null;
  readonly firmaCargo: string | null;
  readonly firmaFechaHora: string | null;
  readonly version: number;
  readonly versionContenido: number;
  readonly sincronizada: boolean;
}

export interface MedicionLocal {
  readonly id: string;
  readonly ordenId: string;
  readonly posicion: number;
  readonly marcaId: string | null;
  readonly disenoId: string | null;
  readonly medida: string | null;
  readonly serial: string | null;
  readonly dot: string | null;
  readonly psiEncontrada: number | null;
  readonly psiCalibrado: number | null;
  readonly profundidad: number | null;
  readonly noIdentificada: boolean;
  readonly servicios: readonly string[];
}

export interface PosicionEjeLocal {
  readonly configuracionEjeId: string;
  readonly numero: number;
  readonly eje: number;
  readonly lado: "izquierdo" | "derecho";
  readonly esInterna: boolean;
  readonly tipoEje: string;
  readonly psiObjetivo: number | null;
  readonly profundidadMinima: number | null;
}

export interface MarcaLocal {
  readonly id: string;
  readonly nombre: string;
  readonly esGlobal: boolean;
  readonly creadaLocal: boolean;
}

export interface DisenoLocal {
  readonly id: string;
  readonly marcaId: string;
  readonly nombre: string;
  readonly tipoEje: string;
  readonly creadaLocal: boolean;
}

export interface MedidaLocal {
  readonly id: string;
  readonly disenoId: string;
  readonly medida: string;
  readonly profundidadOriginal: number | null;
}

export interface ServicioLocal {
  readonly id: string;
  readonly nombre: string;
  readonly porLlanta: boolean;
  readonly orden: number;
}

export interface TipoParcheLocal {
  readonly id: string;
  readonly nombre: string;
}

export interface ClienteLocal {
  readonly id: string;
  readonly nombre: string;
  readonly nit: string | null;
}

export interface VehiculoLocal {
  readonly id: string;
  readonly sedeClienteId: string;
  readonly configuracionEjeId: string;
  readonly codigo: string;
  readonly placa: string | null;
  readonly nombre: string;
  readonly kmActual: number;
}

/** Cliente, sede y vehículo resueltos de una orden, para mostrarlos juntos. */
export interface FotoLocal {
  readonly id: string;
  readonly ordenId: string;
  readonly medicionId: string | null;
  readonly uriLocal: string;
  readonly nombre: string;
  readonly tipoMime: string;
  readonly tamanoBytes: number;
  readonly urlSubida: string | null;
  readonly urlExpiraEn: string | null;
  readonly intentos: number;
  readonly ultimoError: string | null;
}

export interface SedeLocal {
  readonly id: string;
  readonly nombre: string;
  readonly codigo: string;
}

/** Foto como la muestra la galería. */
export interface FotoEnGaleria {
  readonly id: string;
  readonly uriLocal: string;
  readonly estado: "esperando" | "subida" | "fallida";
}

export interface TecnicoLocal {
  readonly id: string;
  readonly nombre: string;
  readonly sedeId: string;
  readonly activo: boolean;
}

export interface ContextoOrden {
  readonly clienteNombre: string;
  readonly sedeClienteNombre: string;
  readonly vehiculoCodigo: string;
  readonly vehiculoPlaca: string | null;
  readonly vehiculoNombre: string;
  /** Kilometraje conocido del vehículo: para avisar si el nuevo retrocede. */
  readonly vehiculoKm: number | null;
}

/** Orden tal como la entrega el servidor en la descarga. */
export interface OrdenDescargada {
  id: string; sedeId: string; clienteId: string; sedeClienteId: string;
  vehiculoId: string; tecnicoId: string; configuracionEjeId: string;
  folio: string | null; tipo: string; estado: string; fecha: string;
  kilometraje: number | null; hallazgos: string | null;
  motivoDevolucion: string | null; notaCoordinador: string | null;
  version: number; versionContenido: number;
  codigoReferencia: string | null; accion: string | null;
  firmaNombre: string | null; firmaCedula: string | null; firmaCargo: string | null;
  firmaVersion: number | null; firmaFechaHora: string | null;
}

export type TipoOperacion =
  | "crear_orden"
  | "actualizar_orden"
  | "guardar_medicion"
  | "cambiar_estado"
  | "crear_marca"
  | "crear_diseno"
  | "reasignar"
  | "adjuntar_foto"
  | "firmar"
  | "subir_foto";

export interface OperacionPendiente {
  readonly id: string;
  readonly tipo: TipoOperacion;
  readonly recursoId: string;
  readonly ordenId: string | null;
  readonly datos: unknown;
  readonly intentos: number;
  readonly ultimoError: string | null;
  readonly creadaEn: string;
}

const aBool = (v: unknown): boolean => v === 1 || v === true;
const aInt = (v: boolean): number => (v ? 1 : 0);

export class RepositorioLocal {
  constructor(
    private readonly db: Conexion,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  private ahora(): string {
    return this.reloj().toISOString();
  }

  /**
   * Guarda y encola en una sola transacción.
   *
   * Es la garantía central del trabajo sin conexión: o queda el dato con su
   * operación, o no queda nada. Nunca un dato que el servidor nunca verá.
   */
  private async enTransaccion<T>(fn: () => Promise<T>): Promise<T> {
    await this.db.ejecutar("BEGIN");
    try {
      const r = await fn();
      await this.db.ejecutar("COMMIT");
      return r;
    } catch (e) {
      await this.db.ejecutar("ROLLBACK").catch(() => undefined);
      throw e;
    }
  }

  private async encolar(
    tipo: TipoOperacion,
    recursoId: string,
    ordenId: string | null,
    datos: unknown,
  ): Promise<void> {
    await this.db.ejecutar(
      `INSERT INTO operacion (id, tipo, recurso_id, orden_id, datos, creada_en)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nuevoId(), tipo, recursoId, ordenId, JSON.stringify(datos), this.ahora()],
    );
  }

  // ── Órdenes ───────────────────────────────────────────────────────────────

  async guardarOrden(o: {
    id: string;
    folio?: string | null;
    codigoReferencia?: string | null;
    sedeId: string;
    clienteId: string;
    sedeClienteId: string;
    vehiculoId: string;
    tecnicoId: string;
    configuracionEjeId: string;
    tipo: string;
    prioridad?: string;
    estado: string;
    fecha: string;
    clientRequestId?: string;
    kilometraje?: number | null;
    sinConductor?: boolean;
    conductorNombre?: string | null;
    /** false cuando viene del servidor y no hay nada que enviar. */
    encolar?: boolean;
  }): Promise<void> {
    await this.enTransaccion(async () => {
      await this.db.ejecutar(
        `INSERT OR REPLACE INTO orden
           (id, folio, codigo_referencia, sede_id, cliente_id, sede_cliente_id, vehiculo_id,
            tecnico_id, configuracion_eje_id, tipo, prioridad, estado, fecha,
            client_request_id, kilometraje, sin_conductor, conductor_nombre,
            sincronizada, actualizada_en)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          o.id, o.folio ?? null, o.codigoReferencia ?? null, o.sedeId, o.clienteId,
          o.sedeClienteId, o.vehiculoId, o.tecnicoId, o.configuracionEjeId, o.tipo,
          o.prioridad ?? "normal", o.estado, o.fecha,
          o.clientRequestId ?? o.id, o.kilometraje ?? null, aInt(o.sinConductor ?? false),
          o.conductorNombre ?? null, aInt(o.encolar === false), this.ahora(),
        ],
      );

      if (o.encolar !== false) {
        // La forma del contrato, no la local: estado y folio los decide el
        // servidor, y el clientRequestId evita duplicar la orden al reintentar.
        await this.encolar("crear_orden", o.id, o.id, ordenAContrato(o));
      }
    });
  }

  async ordenesAsignadas(): Promise<OrdenLocal[]> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT ${COLUMNAS_ORDEN} FROM orden ORDER BY fecha DESC`,
    );
    return filas.map(aOrden);
  }

  async buscarOrden(id: string): Promise<OrdenLocal | null> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT ${COLUMNAS_ORDEN} FROM orden WHERE id = ?`,
      [id],
    );
    return filas[0] ? aOrden(filas[0]) : null;
  }

  /**
   * Datos de cabecera. Sube `version_contenido` porque esto es contenido del
   * servicio: si había firma, queda invalidada.
   */
  async actualizarDatosOrden(
    ordenId: string,
    datos: { kilometraje?: number; hallazgos?: string; accion?: string },
  ): Promise<void> {
    await this.enTransaccion(async () => {
      await this.db.ejecutar(
        `UPDATE orden
            SET kilometraje = coalesce(?, kilometraje),
                hallazgos = coalesce(?, hallazgos),
                accion = coalesce(?, accion),
                version_contenido = version_contenido + 1,
                sincronizada = 0,
                actualizada_en = ?
          WHERE id = ?`,
        [datos.kilometraje ?? null, datos.hallazgos ?? null, datos.accion ?? null, this.ahora(), ordenId],
      );
      await this.encolar("actualizar_orden", ordenId, ordenId, datos);
    });
  }

  // ── Mediciones ────────────────────────────────────────────────────────────

  /**
   * Guarda una posición.
   *
   * Cada posición es su propia operación: si se cae la señal a mitad de
   * captura, lo anterior ya está encolado y no se pierde.
   */
  async guardarMedicion(m: {
    id?: string;
    ordenId: string;
    posicion: number;
    marcaId?: string | null;
    disenoId?: string | null;
    medida?: string | null;
    numCalor?: string | null;
    serial?: string | null;
    dot?: string | null;
    estadoLlanta?: string | null;
    psiEncontrada?: number | null;
    psiCalibrado?: number | null;
    profundidad?: number | null;
    observaciones?: string | null;
    noIdentificada?: boolean;
    motivoNoId?: string | null;
    capturadoPorId: string;
    servicios?: readonly string[];
  }): Promise<string> {
    // Corregir una posición es actualizar LA MISMA medición, no crear otra.
    // Antes se generaba un id nuevo en cada guardado: el servidor habría
    // visto dos mediciones para una posición y rechazado la corrección. Se
    // resuelve aquí y no en la pantalla, para que ningún llamador lo repita.
    const existente = m.id
      ? null
      : await this.db.consultar<{ id: string }>(
          `SELECT id FROM medicion WHERE orden_id = ? AND posicion = ?`,
          [m.ordenId, m.posicion],
        );
    const id = m.id ?? existente?.[0]?.id ?? nuevoId();

    return this.enTransaccion(async () => {
      await this.db.ejecutar(
        `INSERT OR REPLACE INTO medicion
           (id, orden_id, posicion, marca_id, diseno_id, medida, num_calor, serial, dot,
            estado_llanta, psi_encontrada, psi_calibrado, profundidad, observaciones,
            no_identificada, motivo_no_id, capturado_por_id, actualizada_en)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id, m.ordenId, m.posicion, m.marcaId ?? null, m.disenoId ?? null, m.medida ?? null,
          m.numCalor ?? null, m.serial ?? null, m.dot ?? null, m.estadoLlanta ?? null,
          m.psiEncontrada ?? null, m.psiCalibrado ?? null, m.profundidad ?? null,
          m.observaciones ?? null, aInt(m.noIdentificada ?? false), m.motivoNoId ?? null,
          m.capturadoPorId, this.ahora(),
        ],
      );

      await this.db.ejecutar(`DELETE FROM medicion_servicio WHERE medicion_id = ?`, [id]);
      for (const codigo of m.servicios ?? []) {
        await this.db.ejecutar(
          `INSERT INTO medicion_servicio (medicion_id, servicio_codigo) VALUES (?, ?)`,
          [id, codigo],
        );
      }

      // La medición es contenido: invalida la firma anterior.
      await this.db.ejecutar(
        `UPDATE orden SET version_contenido = version_contenido + 1,
                          sincronizada = 0, actualizada_en = ?
          WHERE id = ?`,
        [this.ahora(), m.ordenId],
      );

      // Lo que viaja es la forma del CONTRATO, no la local. Antes se
      // encolaba el objeto tal cual: nulls, nombres locales y un autor que el
      // servidor no debe creer. El servidor habría rechazado casi todo.
      await this.encolar("guardar_medicion", id, m.ordenId, medicionAContrato({ ...m, id }));
      return id;
    });
  }

  async medicionesDe(ordenId: string): Promise<MedicionLocal[]> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT id, orden_id, posicion, marca_id, diseno_id, medida, serial, dot,
              psi_encontrada, psi_calibrado, profundidad, no_identificada
         FROM medicion WHERE orden_id = ? ORDER BY posicion`,
      [ordenId],
    );

    const servicios = await this.db.consultar<{ medicion_id: string; servicio_codigo: string }>(
      `SELECT ms.medicion_id, ms.servicio_codigo
         FROM medicion_servicio ms
         JOIN medicion m ON m.id = ms.medicion_id
        WHERE m.orden_id = ?`,
      [ordenId],
    );

    const porMedicion = new Map<string, string[]>();
    for (const s of servicios) {
      const lista = porMedicion.get(s.medicion_id) ?? [];
      lista.push(s.servicio_codigo);
      porMedicion.set(s.medicion_id, lista);
    }

    return filas.map((f) => ({
      id: String(f["id"]),
      ordenId: String(f["orden_id"]),
      posicion: Number(f["posicion"]),
      marcaId: (f["marca_id"] as string) ?? null,
      disenoId: (f["diseno_id"] as string) ?? null,
      medida: (f["medida"] as string) ?? null,
      serial: (f["serial"] as string) ?? null,
      dot: (f["dot"] as string) ?? null,
      psiEncontrada: f["psi_encontrada"] === null ? null : Number(f["psi_encontrada"]),
      psiCalibrado: f["psi_calibrado"] === null ? null : Number(f["psi_calibrado"]),
      profundidad: f["profundidad"] === null ? null : Number(f["profundidad"]),
      noIdentificada: aBool(f["no_identificada"]),
      servicios: porMedicion.get(String(f["id"])) ?? [],
    }));
  }

  async contarMediciones(ordenId: string): Promise<number> {
    const r = await this.db.consultar<{ n: number }>(
      `SELECT count(*) AS n FROM medicion WHERE orden_id = ?`,
      [ordenId],
    );
    return r[0]?.n ?? 0;
  }

  // ── Flota ─────────────────────────────────────────────────────────────────

  /**
   * Resuelve los nombres de una orden en una sola consulta.
   *
   * Pedirlos por separado desde la pantalla haría tres consultas por fila del
   * listado: con veinte órdenes son sesenta viajes a SQLite cada vez que la
   * lista se refresca.
   *
   * Devuelve null si la flota aún no se ha descargado. La pantalla muestra
   * entonces el código en vez de un vacío: un identificador feo es más útil
   * que una línea en blanco.
   */
  async contextoDeOrden(ordenId: string): Promise<ContextoOrden | null> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT c.nombre AS cliente_nombre, sc.nombre AS sede_nombre,
              v.codigo, v.placa, v.nombre AS vehiculo_nombre, v.km_actual
         FROM orden o
         JOIN vehiculo v ON v.id = o.vehiculo_id
         JOIN sede_cliente sc ON sc.id = v.sede_cliente_id
         JOIN cliente c ON c.id = sc.cliente_id
        WHERE o.id = ?`,
      [ordenId],
    );
    const f = filas[0];
    if (!f) return null;
    return {
      clienteNombre: String(f["cliente_nombre"]),
      sedeClienteNombre: String(f["sede_nombre"]),
      vehiculoCodigo: String(f["codigo"]),
      vehiculoPlaca: (f["placa"] as string) ?? null,
      vehiculoNombre: String(f["vehiculo_nombre"]),
      vehiculoKm: f["km_actual"] === null || f["km_actual"] === undefined ? null : Number(f["km_actual"]),
    };
  }

  /** Contextos de varias órdenes de un golpe, para el listado. */
  async contextosDeOrdenes(ordenIds: readonly string[]): Promise<Map<string, ContextoOrden>> {
    if (ordenIds.length === 0) return new Map();

    const marcadores = ordenIds.map(() => "?").join(",");
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT o.id AS orden_id, c.nombre AS cliente_nombre, sc.nombre AS sede_nombre,
              v.codigo, v.placa, v.nombre AS vehiculo_nombre, v.km_actual
         FROM orden o
         JOIN vehiculo v ON v.id = o.vehiculo_id
         JOIN sede_cliente sc ON sc.id = v.sede_cliente_id
         JOIN cliente c ON c.id = sc.cliente_id
        WHERE o.id IN (${marcadores})`,
      [...ordenIds],
    );

    return new Map(
      filas.map((f) => [
        String(f["orden_id"]),
        {
          clienteNombre: String(f["cliente_nombre"]),
          sedeClienteNombre: String(f["sede_nombre"]),
          vehiculoCodigo: String(f["codigo"]),
          vehiculoPlaca: (f["placa"] as string) ?? null,
          vehiculoNombre: String(f["vehiculo_nombre"]),
          vehiculoKm: f["km_actual"] === null || f["km_actual"] === undefined ? null : Number(f["km_actual"]),
        },
      ]),
    );
  }

  async buscarVehiculo(id: string): Promise<VehiculoLocal | null> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT id, sede_cliente_id, configuracion_eje_id, codigo, placa, nombre, km_actual
         FROM vehiculo WHERE id = ?`,
      [id],
    );
    const f = filas[0];
    if (!f) return null;
    return {
      id: String(f["id"]),
      sedeClienteId: String(f["sede_cliente_id"]),
      configuracionEjeId: String(f["configuracion_eje_id"]),
      codigo: String(f["codigo"]),
      placa: (f["placa"] as string) ?? null,
      nombre: String(f["nombre"]),
      kmActual: Number(f["km_actual"]),
    };
  }

  /** Reemplaza la flota descargada. Se guarda entera al sincronizar. */
  async guardarFlota(datos: {
    clientes?: readonly ClienteLocal[];
    sedes?: readonly { id: string; clienteId: string; nombre: string }[];
    vehiculos?: readonly VehiculoLocal[];
  }): Promise<void> {
    await this.enTransaccion(async () => {
      if (datos.clientes) {
        await this.db.ejecutar(`DELETE FROM cliente`);
        for (const c of datos.clientes) {
          await this.db.ejecutar(`INSERT INTO cliente (id, nombre, nit) VALUES (?,?,?)`, [
            c.id, c.nombre, c.nit,
          ]);
        }
      }
      if (datos.sedes) {
        await this.db.ejecutar(`DELETE FROM sede_cliente`);
        for (const s of datos.sedes) {
          await this.db.ejecutar(
            `INSERT INTO sede_cliente (id, cliente_id, nombre) VALUES (?,?,?)`,
            [s.id, s.clienteId, s.nombre],
          );
        }
      }
      if (datos.vehiculos) {
        await this.db.ejecutar(`DELETE FROM vehiculo`);
        for (const v of datos.vehiculos) {
          await this.db.ejecutar(
            `INSERT INTO vehiculo
               (id, sede_cliente_id, configuracion_eje_id, codigo, placa, nombre, km_actual)
             VALUES (?,?,?,?,?,?,?)`,
            [v.id, v.sedeClienteId, v.configuracionEjeId, v.codigo, v.placa, v.nombre, v.kmActual],
          );
        }
      }
    });
  }

  // ── Técnicos ──────────────────────────────────────────────────────────────

  /**
   * Técnicos de una sede, para reasignar sin señal.
   *
   * Los inactivos se excluyen: reasignar a alguien que ya no trabaja deja la
   * orden en un limbo que nadie nota hasta que el cliente reclama.
   */
  async tecnicosDeSede(sedeId: string): Promise<TecnicoLocal[]> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT id, nombre, sede_id, activo
         FROM tecnico WHERE sede_id = ? AND activo = 1 ORDER BY nombre`,
      [sedeId],
    );
    return filas.map((f) => ({
      id: String(f["id"]),
      nombre: String(f["nombre"]),
      sedeId: String(f["sede_id"]),
      activo: aBool(f["activo"]),
    }));
  }

  /** Sedes de la empresa. Catálogo: se reemplaza entero al descargar. */
  async sedes(): Promise<SedeLocal[]> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT id, nombre, codigo FROM sede ORDER BY nombre`,
    );
    return filas.map((f) => ({ id: String(f["id"]), nombre: String(f["nombre"]), codigo: String(f["codigo"]) }));
  }

  async guardarSedes(sedes: readonly SedeLocal[]): Promise<void> {
    await this.enTransaccion(async () => {
      await this.db.ejecutar(`DELETE FROM sede`);
      for (const s of sedes) {
        await this.db.ejecutar(`INSERT INTO sede (id, nombre, codigo) VALUES (?,?,?)`, [s.id, s.nombre, s.codigo]);
      }
    });
  }

  async guardarTecnicos(tecnicos: readonly TecnicoLocal[]): Promise<void> {
    await this.enTransaccion(async () => {
      await this.db.ejecutar(`DELETE FROM tecnico`);
      for (const t of tecnicos) {
        await this.db.ejecutar(
          `INSERT INTO tecnico (id, nombre, sede_id, activo) VALUES (?,?,?,?)`,
          [t.id, t.nombre, t.sedeId, aInt(t.activo)],
        );
      }
    });
  }

  /** Reasigna la orden a otro técnico de la misma sede. */
  async reasignar(ordenId: string, tecnicoId: string, motivo: string): Promise<void> {
    await this.enTransaccion(async () => {
      await this.db.ejecutar(
        `UPDATE orden SET tecnico_id = ?, sincronizada = 0, actualizada_en = ? WHERE id = ?`,
        [tecnicoId, this.ahora(), ordenId],
      );
      await this.encolar("reasignar", ordenId, ordenId, { tecnicoId, motivo });
    });
  }

  /**
   * Órdenes que esperan revisión, con lo que la bandeja necesita mostrar.
   *
   * No filtra por sede aquí: la base local del coordinador solo contiene las
   * suyas, igual que la del técnico solo tiene las de él.
   */
  async ordenesEnRevision(): Promise<OrdenLocal[]> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT id, folio, codigo_referencia, sede_id, vehiculo_id, cliente_id, tecnico_id,
              tecnico_nombre, enviada_revision_en, limite_cliente, estado,
              motivo_devolucion, nota_coordinador, fecha,
              configuracion_eje_id, kilometraje, hallazgos,
              firma_nombre, firma_cedula, firma_version,
              firma_trazo, firma_cargo, firma_fecha_hora,
              version, version_contenido, sincronizada
         FROM orden WHERE estado = 'en_revision'
        ORDER BY coalesce(enviada_revision_en, actualizada_en)`,
    );
    return filas.map(aOrden);
  }

  // ── Catálogo ──────────────────────────────────────────────────────────────

  /**
   * El catálogo se lee del dispositivo, nunca del servidor: el técnico elige
   * marca y diseño estando bajo un camión sin señal, y una lista que tarda en
   * cargar es una lista que se salta escribiendo a mano.
   */
  async marcas(): Promise<MarcaLocal[]> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT id, nombre, es_global, creada_local FROM marca ORDER BY nombre`,
    );
    return filas.map((f) => ({
      id: String(f["id"]),
      nombre: String(f["nombre"]),
      esGlobal: aBool(f["es_global"]),
      creadaLocal: aBool(f["creada_local"]),
    }));
  }

  /**
   * Diseños de una marca. Con `tipoEje` se ordenan primero los que
   * corresponden a esa posición: al técnico se le ofrecen los de tracción
   * cuando está en un eje de tracción, no los cincuenta de la marca.
   */
  async disenosDe(marcaId: string, tipoEje?: string): Promise<DisenoLocal[]> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT id, marca_id, nombre, tipo_eje, creada_local
         FROM diseno WHERE marca_id = ? ORDER BY nombre`,
      [marcaId],
    );
    const todos = filas.map((f) => ({
      id: String(f["id"]),
      marcaId: String(f["marca_id"]),
      nombre: String(f["nombre"]),
      tipoEje: String(f["tipo_eje"]),
      creadaLocal: aBool(f["creada_local"]),
    }));

    if (!tipoEje) return todos;
    const corresponden = (d: DisenoLocal) => d.tipoEje === tipoEje || d.tipoEje === "multiuso";
    return [...todos.filter(corresponden), ...todos.filter((d) => !corresponden(d))];
  }

  async medidasDe(disenoId: string): Promise<MedidaLocal[]> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT id, diseno_id, medida, profundidad_original
         FROM medida WHERE diseno_id = ? ORDER BY medida`,
      [disenoId],
    );
    return filas.map((f) => ({
      id: String(f["id"]),
      disenoId: String(f["diseno_id"]),
      medida: String(f["medida"]),
      profundidadOriginal:
        f["profundidad_original"] === null ? null : Number(f["profundidad_original"]),
    }));
  }

  /**
   * Catálogo de servicios.
   *
   * Sale del DOMINIO, no de una tabla descargada: son constantes. Antes, un
   * teléfono recién instalado y sin señal mostraba "Sin opciones descargadas"
   * para nueve servicios fijos, y el técnico no podía marcar lo que hizo.
   * El `id` es el código del catálogo.
   */
  async servicios(): Promise<ServicioLocal[]> {
    return CATALOGO_SERVICIOS.map((s, i) => ({
      id: s.codigo,
      nombre: s.nombre,
      porLlanta: s.porLlanta,
      orden: i,
    }));
  }

  async tiposParche(): Promise<TipoParcheLocal[]> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT id, nombre FROM tipo_parche ORDER BY nombre`,
    );
    return filas.map((f) => ({ id: String(f["id"]), nombre: String(f["nombre"]) }));
  }

  /**
   * Crea una marca en campo.
   *
   * Queda marcada como local para que el administrador la revise: sin esa
   * bandeja, el catálogo se llena de variantes y los reportes dejan de
   * cuadrar sin que nadie se entere.
   */
  async crearMarcaLocal(nombre: string): Promise<MarcaLocal> {
    const id = nuevoId();
    await this.enTransaccion(async () => {
      await this.db.ejecutar(
        `INSERT INTO marca (id, nombre, es_global, creada_local) VALUES (?, ?, 0, 1)`,
        [id, nombre.trim()],
      );
      await this.encolar("crear_marca", id, null, { id, nombre: nombre.trim() });
    });
    return { id, nombre: nombre.trim(), esGlobal: false, creadaLocal: true };
  }

  async crearDisenoLocal(
    marcaId: string,
    nombre: string,
    tipoEje = "multiuso",
  ): Promise<DisenoLocal> {
    const id = nuevoId();
    await this.enTransaccion(async () => {
      await this.db.ejecutar(
        `INSERT INTO diseno (id, marca_id, nombre, tipo_eje, creada_local)
         VALUES (?, ?, ?, ?, 1)`,
        [id, marcaId, nombre.trim(), tipoEje],
      );
      await this.encolar("crear_diseno", id, null, { id, marcaId, nombre: nombre.trim(), tipoEje });
    });
    return { id, marcaId, nombre: nombre.trim(), tipoEje, creadaLocal: true };
  }

  /** Reemplaza el catálogo con lo que llegó del servidor. */
  async guardarCatalogo(datos: {
    marcas?: readonly MarcaLocal[];
    disenos?: readonly DisenoLocal[];
    medidas?: readonly MedidaLocal[];
    tiposParche?: readonly TipoParcheLocal[];
  }): Promise<void> {
    await this.enTransaccion(async () => {
      if (datos.marcas) {
        // Las creadas en campo no se borran: todavía no llegaron al servidor
        // y borrarlas perdería el trabajo del técnico.
        await this.db.ejecutar(`DELETE FROM marca WHERE creada_local = 0`);
        for (const m of datos.marcas) {
          await this.db.ejecutar(
            `INSERT OR REPLACE INTO marca (id, nombre, es_global, creada_local)
             VALUES (?, ?, ?, 0)`,
            [m.id, m.nombre, aInt(m.esGlobal)],
          );
        }
      }
      if (datos.disenos) {
        await this.db.ejecutar(`DELETE FROM diseno WHERE creada_local = 0`);
        for (const d of datos.disenos) {
          await this.db.ejecutar(
            `INSERT OR REPLACE INTO diseno (id, marca_id, nombre, tipo_eje, creada_local)
             VALUES (?, ?, ?, ?, 0)`,
            [d.id, d.marcaId, d.nombre, d.tipoEje],
          );
        }
      }
      if (datos.medidas) {
        await this.db.ejecutar(`DELETE FROM medida`);
        for (const m of datos.medidas) {
          await this.db.ejecutar(
            `INSERT INTO medida (id, diseno_id, medida, profundidad_original)
             VALUES (?, ?, ?, ?)`,
            [m.id, m.disenoId, m.medida, m.profundidadOriginal],
          );
        }
      }
      if (datos.tiposParche) {
        await this.db.ejecutar(`DELETE FROM tipo_parche`);
        for (const t of datos.tiposParche) {
          await this.db.ejecutar(`INSERT INTO tipo_parche (id, nombre) VALUES (?, ?)`, [
            t.id,
            t.nombre,
          ]);
        }
      }
    });
  }

  /** Última medición registrada en esa posición del vehículo, para el
   * bloque de llanta desmontada: la que sale es la que estaba antes. */
  async ultimaMedicionDePosicion(
    vehiculoId: string,
    posicion: number,
    exceptoOrdenId: string,
  ): Promise<MedicionLocal | null> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT m.id, m.orden_id, m.posicion, m.marca_id, m.diseno_id, m.medida,
              m.num_calor, m.serial, m.dot, m.psi_encontrada, m.psi_calibrado,
              m.profundidad, m.no_identificada
         FROM medicion m
         JOIN orden o ON o.id = m.orden_id
        WHERE o.vehiculo_id = ? AND m.posicion = ? AND m.orden_id <> ?
        ORDER BY o.fecha DESC
        LIMIT 1`,
      [vehiculoId, posicion, exceptoOrdenId],
    );
    const f = filas[0];
    if (!f) return null;
    return {
      id: String(f["id"]),
      ordenId: String(f["orden_id"]),
      posicion: Number(f["posicion"]),
      marcaId: (f["marca_id"] as string) ?? null,
      disenoId: (f["diseno_id"] as string) ?? null,
      medida: (f["medida"] as string) ?? null,
      serial: (f["serial"] as string) ?? null,
      dot: (f["dot"] as string) ?? null,
      psiEncontrada: f["psi_encontrada"] === null ? null : Number(f["psi_encontrada"]),
      psiCalibrado: f["psi_calibrado"] === null ? null : Number(f["psi_calibrado"]),
      profundidad: f["profundidad"] === null ? null : Number(f["profundidad"]),
      noIdentificada: aBool(f["no_identificada"]),
      servicios: [],
    };
  }

  // ── Configuración de ejes ─────────────────────────────────────────────────

  /**
   * Posiciones de una configuración.
   *
   * La configuración se guarda completa en el dispositivo porque el diagrama
   * debe poder dibujarse sin señal: es lo primero que el técnico abre al
   * llegar al camión.
   */
  async posicionesDe(configuracionEjeId: string): Promise<PosicionEjeLocal[]> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT configuracion_eje_id, numero, eje, lado, es_interna, tipo_eje,
              psi_objetivo, profundidad_minima
         FROM posicion_eje WHERE configuracion_eje_id = ? ORDER BY numero`,
      [configuracionEjeId],
    );
    return filas.map((f) => ({
      configuracionEjeId: String(f["configuracion_eje_id"]),
      numero: Number(f["numero"]),
      eje: Number(f["eje"]),
      lado: String(f["lado"]) as "izquierdo" | "derecho",
      esInterna: aBool(f["es_interna"]),
      tipoEje: String(f["tipo_eje"]),
      psiObjetivo: f["psi_objetivo"] === null ? null : Number(f["psi_objetivo"]),
      profundidadMinima:
        f["profundidad_minima"] === null ? null : Number(f["profundidad_minima"]),
    }));
  }

  /** Guarda la configuración traída del servidor. Se reemplaza entera. */
  async guardarPosicionesEje(
    configuracionEjeId: string,
    posiciones: readonly Omit<PosicionEjeLocal, "configuracionEjeId">[],
  ): Promise<void> {
    await this.enTransaccion(async () => {
      await this.db.ejecutar(`DELETE FROM posicion_eje WHERE configuracion_eje_id = ?`, [
        configuracionEjeId,
      ]);
      for (const p of posiciones) {
        await this.db.ejecutar(
          `INSERT INTO posicion_eje
             (configuracion_eje_id, numero, eje, lado, es_interna, tipo_eje,
              psi_objetivo, profundidad_minima)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            configuracionEjeId, p.numero, p.eje, p.lado, aInt(p.esInterna),
            p.tipoEje, p.psiObjetivo, p.profundidadMinima,
          ],
        );
      }
    });
  }

  /**
   * Captura la firma de quien recibe.
   *
   * Se ancla a `version_contenido`, no a `version`: mover la orden de estado
   * no debe invalidar una firma, porque el documento que el cliente firmó no
   * cambió. Editar una medición sí la invalida.
   */
  async firmar(
    ordenId: string,
    firma: {
      nombre: string;
      cedula: string;
      cargo?: string | null;
      /** Obligatorios: el contrato los exige, y el consentimiento es ley. */
      trazo: string;
      /** Versión del texto de consentimiento que aceptó quien firma. */
      consentimiento: string;
    },
  ): Promise<void> {
    const ahora = this.ahora();
    await this.enTransaccion(async () => {
      // La versión del contenido que se firma se lee DENTRO de la
      // transacción, junto con la escritura: es lo que el servidor comparará
      // con la suya para saber si la persona firmó lo que él tiene.
      const [actual] = await this.db.consultar<{ version_contenido: number }>(
        `SELECT version_contenido FROM orden WHERE id = ?`,
        [ordenId],
      );
      const versionContenido = actual?.version_contenido ?? 0;

      await this.db.ejecutar(
        `UPDATE orden
            SET firma_nombre = ?, firma_cedula = ?, firma_cargo = ?,
                firma_trazo = ?, firma_fecha_hora = ?, firma_consentimiento = ?,
                firma_version = version_contenido,
                sincronizada = 0, actualizada_en = ?
          WHERE id = ?`,
        [
          firma.nombre.trim(), firma.cedula.trim(), firma.cargo ?? null,
          firma.trazo ?? null, ahora, firma.consentimiento ?? null, ahora, ordenId,
        ],
      );
      await this.encolar("firmar", ordenId, ordenId, firmaAContrato(firma, versionContenido));
    });
  }

  /**
   * Adjunta una foto a la orden.
   *
   * Es una operación de la cola ORDENADA y cambia el contenido en ese mismo
   * momento, igual que en el servidor. Así, una foto tomada antes de firmar
   * queda dentro de lo firmado sin importar cuándo terminen de subir los
   * bytes, que van aparte por lo pesados.
   */
  async adjuntarFoto(f: {
    id?: string;
    ordenId: string;
    medicionId?: string | null;
    uriLocal: string;
    nombre: string;
    tipoMime: "image/jpeg" | "image/png" | "image/webp";
    tamanoBytes: number;
  }): Promise<string> {
    const id = f.id ?? nuevoId();
    const ahora = this.ahora();
    await this.enTransaccion(async () => {
      await this.db.ejecutar(
        `INSERT INTO foto (id, orden_id, medicion_id, uri_local, nombre, tamano_bytes, tipo_mime, creada_en)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id, f.ordenId, f.medicionId ?? null, f.uriLocal, f.nombre, f.tamanoBytes, f.tipoMime, ahora],
      );
      await this.db.ejecutar(
        `UPDATE orden SET version_contenido = version_contenido + 1,
                          sincronizada = 0, actualizada_en = ?
          WHERE id = ?`,
        [ahora, f.ordenId],
      );
      await this.encolar("adjuntar_foto", id, f.ordenId, fotoAContrato({ ...f, id }));
    });
    return id;
  }

  // ── Descarga ──────────────────────────────────────────────────────────────

  /** Hasta dónde llegó la última descarga; null si nunca se descargó. */
  async marcaDeDescarga(): Promise<string | null> {
    const filas = await this.db.consultar<{ valor: string }>(
      `SELECT valor FROM ajuste WHERE clave = 'ultima_descarga'`,
    );
    return filas[0]?.valor ?? null;
  }

  async guardarMarcaDeDescarga(hasta: string): Promise<void> {
    await this.db.ejecutar(
      `INSERT INTO ajuste (clave, valor) VALUES ('ultima_descarga', ?)
       ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor`,
      [hasta],
    );
  }

  /**
   * Guarda una orden que vino del servidor.
   *
   * No encola nada: ya está en el servidor, es de donde viene. Y marca
   * `sincronizada`, que es lo que protege del pisado en la próxima descarga.
   */
  async guardarOrdenDescargada(o: OrdenDescargada): Promise<void> {
    // ON CONFLICT ... DO UPDATE, no INSERT OR REPLACE. REPLACE reescribe la
    // fila entera: lo que el servidor no manda volvía a NULL. Al descargar de
    // nuevo una orden firmada, la firma desaparecía del celular y la app decía
    // que faltaba. Ahora solo se tocan las columnas que vienen del servidor;
    // el trazo de la firma —que no viaja— se conserva mientras la firma siga
    // siendo la misma.
    await this.db.ejecutar(
      `INSERT INTO orden
         (id, folio, codigo_referencia, sede_id, cliente_id, sede_cliente_id, vehiculo_id,
          tecnico_id, configuracion_eje_id, tipo, prioridad, estado, fecha,
          kilometraje, hallazgos, accion, motivo_devolucion, nota_coordinador,
          firma_nombre, firma_cedula, firma_cargo, firma_version, firma_fecha_hora,
          version, version_contenido, sincronizada, actualizada_en)
       VALUES (?,?,?,?,?,?,?,?,?,?,'normal',?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)
       ON CONFLICT (id) DO UPDATE SET
         folio = excluded.folio,
         codigo_referencia = coalesce(excluded.codigo_referencia, orden.codigo_referencia),
         sede_id = excluded.sede_id, cliente_id = excluded.cliente_id,
         sede_cliente_id = excluded.sede_cliente_id, vehiculo_id = excluded.vehiculo_id,
         tecnico_id = excluded.tecnico_id, configuracion_eje_id = excluded.configuracion_eje_id,
         tipo = excluded.tipo, estado = excluded.estado, fecha = excluded.fecha,
         kilometraje = excluded.kilometraje, hallazgos = excluded.hallazgos, accion = excluded.accion,
         motivo_devolucion = excluded.motivo_devolucion, nota_coordinador = excluded.nota_coordinador,
         firma_trazo = CASE WHEN excluded.firma_version IS orden.firma_version
                             AND excluded.firma_nombre IS orden.firma_nombre
                            THEN orden.firma_trazo ELSE NULL END,
         firma_nombre = excluded.firma_nombre, firma_cedula = excluded.firma_cedula,
         firma_cargo = excluded.firma_cargo, firma_version = excluded.firma_version,
         firma_fecha_hora = excluded.firma_fecha_hora,
         version = excluded.version, version_contenido = excluded.version_contenido,
         sincronizada = 1, actualizada_en = excluded.actualizada_en`,
      [
        o.id, o.folio, o.codigoReferencia, o.sedeId, o.clienteId, o.sedeClienteId, o.vehiculoId,
        o.tecnicoId, o.configuracionEjeId, o.tipo, o.estado, o.fecha,
        o.kilometraje, o.hallazgos, o.accion, o.motivoDevolucion, o.notaCoordinador,
        o.firmaNombre, o.firmaCedula, o.firmaCargo, o.firmaVersion, o.firmaFechaHora,
        o.version, o.versionContenido, this.ahora(),
      ],
    );
  }

  /** Quita una orden cerrada. Solo se llama sobre órdenes sincronizadas. */
  async olvidarOrden(ordenId: string): Promise<void> {
    await this.enTransaccion(async () => {
      await this.db.ejecutar(
        `DELETE FROM medicion_servicio WHERE medicion_id IN
           (SELECT id FROM medicion WHERE orden_id = ?)`,
        [ordenId],
      );
      await this.db.ejecutar(`DELETE FROM medicion WHERE orden_id = ?`, [ordenId]);
      await this.db.ejecutar(`DELETE FROM orden WHERE id = ?`, [ordenId]);
    });
  }

  /**
   * Mediciones que vienen del servidor.
   *
   * Se respeta lo local sin enviar: si el técnico ya corrigió esa posición y
   * su cambio sigue en la cola, la copia del servidor es la vieja.
   */
  async guardarMedicionesDescargadas(
    mediciones: readonly {
      id: string; ordenId: string; posicion: number;
      marcaId: string | null; disenoId: string | null; medida: string | null;
      serial: string | null; profundidad: number | null;
    }[],
  ): Promise<void> {
    if (mediciones.length === 0) return;
    await this.enTransaccion(async () => {
      for (const m of mediciones) {
        const pendiente = await this.db.consultar<{ n: number }>(
          `SELECT count(*) AS n FROM operacion
            WHERE tipo = 'guardar_medicion' AND recurso_id = ? AND rechazada_en IS NULL`,
          [m.id],
        );
        if ((pendiente[0]?.n ?? 0) > 0) continue;

        await this.db.ejecutar(
          `INSERT OR REPLACE INTO medicion
             (id, orden_id, posicion, marca_id, diseno_id, medida, serial, profundidad,
              no_identificada, capturado_por_id, capturada_en)
           VALUES (?,?,?,?,?,?,?,?,0,'',?)`,
          [m.id, m.ordenId, m.posicion, m.marcaId, m.disenoId, m.medida, m.serial,
           m.profundidad, this.ahora()],
        );
      }
    });
  }

  // ── Subida de fotos ───────────────────────────────────────────────────────

  /** Guarda dónde subir los bytes, tal como lo devolvió el servidor. */
  async guardarDestinoDeFoto(
    fotoId: string,
    destino: { url?: string | undefined; expiraEn?: number | undefined },
  ): Promise<void> {
    if (!destino.url) return;
    // `expiraEn` llega en segundos de validez, no como fecha: se convierte
    // aquí para no tener que recordarlo en cada uso.
    const vence = destino.expiraEn
      ? new Date(new Date(this.ahora()).getTime() + destino.expiraEn * 1000).toISOString()
      : null;
    await this.db.ejecutar(
      `UPDATE foto SET url_subida = ?, url_expira_en = ? WHERE id = ?`,
      [destino.url, vence, fotoId],
    );
  }

  /**
   * Fotos listas para subir: con destino, sin subir y sin espera pendiente.
   *
   * Las que no tienen destino todavía esperan a que su operación de adjuntar
   * llegue al servidor.
   */
  /**
   * Fotos de una orden o de una de sus posiciones, con su estado para la
   * galería. El estado va en texto en pantalla: el técnico necesita saber si
   * su evidencia llegó antes de entregar el vehículo.
   */
  async fotosDe(ordenId: string, medicionId: string | null): Promise<FotoEnGaleria[]> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT id, uri_local, subida, ultimo_error_subida
         FROM foto
        WHERE orden_id = ? AND medicion_id IS ?
        ORDER BY creada_en`,
      [ordenId, medicionId],
    );
    return filas.map((f) => ({
      id: String(f["id"]),
      uriLocal: String(f["uri_local"]),
      estado: aBool(f["subida"]) ? "subida" : f["ultimo_error_subida"] ? "fallida" : "esperando",
    }));
  }

  /** Fotos de la orden que todavía no llegaron al servidor. */
  async contarFotosSinSubir(ordenId: string): Promise<number> {
    const r = await this.db.consultar<{ n: number }>(
      `SELECT count(*) AS n FROM foto WHERE orden_id = ? AND subida = 0`,
      [ordenId],
    );
    return Number(r[0]?.n ?? 0);
  }

  async fotosPorSubir(): Promise<FotoLocal[]> {
    const ahora = this.ahora();
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT id, orden_id, medicion_id, uri_local, nombre, tipo_mime, tamano_bytes,
              url_subida, url_expira_en, intentos_subida, ultimo_error_subida
         FROM foto
        WHERE subida = 0 AND url_subida IS NOT NULL
          AND (reintentar_en IS NULL OR reintentar_en <= ?)
        ORDER BY creada_en`,
      [ahora],
    );
    return filas.map((f) => ({
      id: String(f["id"]),
      ordenId: String(f["orden_id"]),
      medicionId: (f["medicion_id"] as string) ?? null,
      uriLocal: String(f["uri_local"]),
      nombre: String(f["nombre"]),
      tipoMime: String(f["tipo_mime"]),
      tamanoBytes: Number(f["tamano_bytes"] ?? 0),
      urlSubida: (f["url_subida"] as string) ?? null,
      urlExpiraEn: (f["url_expira_en"] as string) ?? null,
      intentos: Number(f["intentos_subida"] ?? 0),
      ultimoError: (f["ultimo_error_subida"] as string) ?? null,
    }));
  }

  async marcarFotoSubida(fotoId: string): Promise<void> {
    await this.db.ejecutar(
      `UPDATE foto SET subida = 1, ultimo_error_subida = NULL, reintentar_en = NULL WHERE id = ?`,
      [fotoId],
    );
  }

  /** Un fallo de subida no borra la foto: el archivo es evidencia. */
  async marcarFalloDeSubida(fotoId: string, error: string, reintentarEn: Date): Promise<void> {
    await this.db.ejecutar(
      `UPDATE foto
          SET intentos_subida = intentos_subida + 1,
              ultimo_error_subida = ?,
              reintentar_en = ?
        WHERE id = ?`,
      [error.slice(0, 300), reintentarEn.toISOString(), fotoId],
    );
  }

  /**
   * Pide una URL nueva reenviando la operación de adjuntar.
   *
   * La URL firmada vence en minutos; sin señal, eso pasa a menudo. El
   * servidor identifica la foto por su id y devuelve la reserva existente
   * con una URL nueva, sin contarla dos veces en el contenido.
   */
  async pedirNuevaUrlDeSubida(fotoId: string): Promise<void> {
    const [f] = await this.db.consultar<Record<string, unknown>>(
      `SELECT id, orden_id, medicion_id, nombre, tipo_mime, tamano_bytes FROM foto WHERE id = ?`,
      [fotoId],
    );
    if (!f) return;
    await this.enTransaccion(async () => {
      await this.db.ejecutar(`UPDATE foto SET url_subida = NULL, url_expira_en = NULL WHERE id = ?`, [fotoId]);
      await this.encolar("adjuntar_foto", fotoId, String(f["orden_id"]), {
        id: fotoId,
        ...(f["medicion_id"] ? { medicionId: String(f["medicion_id"]) } : {}),
        nombre: String(f["nombre"]),
        tipoMime: String(f["tipo_mime"]),
        tamanoBytes: Number(f["tamano_bytes"] ?? 0),
      });
    });
  }

  /** Confirma al servidor que los bytes llegaron. */
  async encolarConfirmacionDeFoto(fotoId: string, ordenId: string): Promise<void> {
    await this.encolar("subir_foto", fotoId, ordenId, {});
  }

  /** Cambio de estado: no toca `version_contenido`, así la firma sobrevive. */
  async cambiarEstado(ordenId: string, estado: string, motivo?: string): Promise<void> {
    const ahora = this.ahora();
    await this.enTransaccion(async () => {
      await this.db.ejecutar(
        `UPDATE orden
            SET estado = ?,
                -- Se estampa al entrar a revisión, para contar los días que
                -- la orden lleva esperando al coordinador.
                enviada_revision_en = CASE WHEN ? = 'en_revision' THEN ? ELSE enviada_revision_en END,
                -- Y el nombre de quien la ejecutó: si después se reasigna o
                -- se da de baja al técnico, la bandeja debe seguir mostrando
                -- quién hizo el trabajo.
                tecnico_nombre = CASE
                  WHEN ? = 'en_revision'
                    THEN coalesce(
                      (SELECT nombre FROM tecnico WHERE id = orden.tecnico_id),
                      tecnico_nombre)
                  ELSE tecnico_nombre END,
                -- Devolver limpia el motivo anterior y pone el nuevo.
                motivo_devolucion = CASE WHEN ? = 'en_proceso' THEN ? ELSE motivo_devolucion END,
                sincronizada = 0, actualizada_en = ?
          WHERE id = ?`,
        [estado, estado, ahora, estado, estado, motivo ?? null, ahora, ordenId],
      );
      await this.encolar("cambiar_estado", ordenId, ordenId, { estado, motivo });
    });
  }

  // ── Cola de sincronización ────────────────────────────────────────────────

  /**
   * Operaciones listas para enviar, en orden de creación.
   *
   * El orden importa: `guardar_medicion` no puede llegar antes que
   * `crear_orden` de esa misma orden, o el servidor la rechaza.
   */
  async operacionesPendientes(limite = 100): Promise<OperacionPendiente[]> {
    const ahora = this.ahora();
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT id, tipo, recurso_id, orden_id, datos, intentos, ultimo_error, creada_en
         FROM operacion
        WHERE rechazada_en IS NULL
          AND (reintentar_en IS NULL OR reintentar_en <= ?)
        ORDER BY creada_en
        LIMIT ?`,
      [ahora, limite],
    );
    return filas.map((f) => ({
      id: String(f["id"]),
      tipo: String(f["tipo"]) as TipoOperacion,
      recursoId: String(f["recurso_id"]),
      ordenId: (f["orden_id"] as string) ?? null,
      datos: JSON.parse(String(f["datos"])),
      intentos: Number(f["intentos"]),
      ultimoError: (f["ultimo_error"] as string) ?? null,
      creadaEn: String(f["creada_en"]),
    }));
  }

  async marcarOperacionAplicada(id: string): Promise<void> {
    await this.db.ejecutar(`DELETE FROM operacion WHERE id = ?`, [id]);
  }

  /**
   * Registra el fallo y espera antes de reintentar.
   *
   * La espera crece con los intentos: si el servidor está caído, martillarlo
   * cada segundo desde cincuenta dispositivos no ayuda a que se levante.
   */
  async marcarOperacionFallida(id: string, error: string): Promise<void> {
    const actual = await this.db.consultar<{ intentos: number }>(
      `SELECT intentos FROM operacion WHERE id = ?`,
      [id],
    );
    const intentos = (actual[0]?.intentos ?? 0) + 1;
    const esperaMinutos = Math.min(2 ** intentos, 60);
    const reintentarEn = new Date(this.reloj().getTime() + esperaMinutos * 60_000).toISOString();

    await this.db.ejecutar(
      `UPDATE operacion SET intentos = ?, ultimo_error = ?, reintentar_en = ? WHERE id = ?`,
      [intentos, error.slice(0, 500), reintentarEn, id],
    );
  }

  /**
   * Aparta una operación que el servidor rechazó.
   *
   * No se borra: es trabajo del técnico. Queda con su motivo para que una
   * persona decida, y se puede reintentar después de corregir la causa.
   */
  async apartarOperacion(id: string, motivo: string): Promise<void> {
    await this.db.ejecutar(
      `UPDATE operacion SET rechazada_en = ?, motivo_rechazo = ? WHERE id = ?`,
      [this.ahora(), motivo.slice(0, 500), id],
    );
  }

  async operacionesRechazadas(): Promise<(OperacionPendiente & { motivoRechazo: string })[]> {
    const filas = await this.db.consultar<Record<string, unknown>>(
      `SELECT id, tipo, recurso_id, orden_id, datos, intentos, ultimo_error, creada_en,
              motivo_rechazo
         FROM operacion WHERE rechazada_en IS NOT NULL ORDER BY creada_en`,
    );
    return filas.map((f) => ({
      id: String(f["id"]),
      tipo: String(f["tipo"]) as TipoOperacion,
      recursoId: String(f["recurso_id"]),
      ordenId: (f["orden_id"] as string) ?? null,
      datos: JSON.parse(String(f["datos"])),
      intentos: Number(f["intentos"]),
      ultimoError: (f["ultimo_error"] as string) ?? null,
      creadaEn: String(f["creada_en"]),
      motivoRechazo: String(f["motivo_rechazo"]),
    }));
  }

  /** Devuelve una rechazada a la cola, tras corregir lo que la hacía fallar. */
  async reintentarRechazada(id: string): Promise<void> {
    await this.db.ejecutar(
      `UPDATE operacion SET rechazada_en = NULL, motivo_rechazo = NULL,
                            reintentar_en = NULL, intentos = 0
        WHERE id = ?`,
      [id],
    );
  }

  async contarPendientes(): Promise<number> {
    const r = await this.db.consultar<{ n: number }>(
      `SELECT count(*) AS n FROM operacion WHERE rechazada_en IS NULL`,
    );
    return r[0]?.n ?? 0;
  }

  /** Confirma que el servidor aceptó la orden y le asignó folio. */
  async confirmarSincronizacion(ordenId: string, folio: string | null): Promise<void> {
    await this.db.ejecutar(
      `UPDATE orden SET sincronizada = 1, folio = coalesce(?, folio) WHERE id = ?`,
      [folio, ordenId],
    );
  }
}

/**
 * Columnas que lee `aOrden`, en un solo sitio.
 *
 * Las dos consultas de órdenes tenían su lista escrita a mano y le faltaban
 * accion, firma_trazo, firma_cargo y firma_fecha_hora: esos campos de
 * OrdenLocal llegaban SIEMPRE nulos aunque estuvieran guardados. Una prueba
 * exige que cada campo que lee `aOrden` esté aquí.
 */
export const COLUMNAS_ORDEN = [
  "id", "folio", "codigo_referencia", "sede_id", "vehiculo_id", "cliente_id", "tecnico_id",
  "tecnico_nombre", "enviada_revision_en", "limite_cliente", "estado",
  "motivo_devolucion", "nota_coordinador", "fecha", "configuracion_eje_id",
  "kilometraje", "hallazgos", "accion",
  "firma_nombre", "firma_cedula", "firma_version", "firma_trazo", "firma_cargo", "firma_fecha_hora",
  "version", "version_contenido", "sincronizada",
].join(", ");

function aOrden(f: Record<string, unknown>): OrdenLocal {
  return {
    id: String(f["id"]),
    folio: (f["folio"] as string) ?? null,
    codigoReferencia: (f["codigo_referencia"] as string) ?? null,
    sedeId: String(f["sede_id"]),
    vehiculoId: String(f["vehiculo_id"]),
    clienteId: String(f["cliente_id"]),
    tecnicoId: String(f["tecnico_id"]),
    tecnicoNombre: (f["tecnico_nombre"] as string) ?? null,
    enviadaRevisionEn: (f["enviada_revision_en"] as string) ?? null,
    limiteCliente: (f["limite_cliente"] as string) ?? null,
    estado: String(f["estado"]),
    motivoDevolucion: (f["motivo_devolucion"] as string) ?? null,
    notaCoordinador: (f["nota_coordinador"] as string) ?? null,
    fecha: String(f["fecha"]),
    configuracionEjeId: String(f["configuracion_eje_id"]),
    kilometraje: f["kilometraje"] === null ? null : Number(f["kilometraje"]),
    hallazgos: (f["hallazgos"] as string) ?? null,
    accion: (f["accion"] as string) ?? null,
    firmaNombre: (f["firma_nombre"] as string) ?? null,
    firmaCedula: (f["firma_cedula"] as string) ?? null,
    firmaVersion: f["firma_version"] === null ? null : Number(f["firma_version"]),
    firmaTrazo: (f["firma_trazo"] as string) ?? null,
    firmaCargo: (f["firma_cargo"] as string) ?? null,
    firmaFechaHora: (f["firma_fecha_hora"] as string) ?? null,
    version: Number(f["version"]),
    versionContenido: Number(f["version_contenido"]),
    sincronizada: aBool(f["sincronizada"]),
  };
}
