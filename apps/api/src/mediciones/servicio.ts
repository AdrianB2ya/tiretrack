import { zMedicionLlanta, type MedicionLlanta } from "@tiretrack/contracts";
import {
  definicionDeServicio,
  profundidadDeReferencia,
  puedeEditarMediciones,
  type EstadoOrden,
  type Rol,
  type Veredicto,
} from "@tiretrack/domain";

/**
 * Mediciones por posición: la operación más frecuente de la app, 22 por orden.
 *
 * Siempre llega como COMANDO desde el dispositivo, así que se valida con las
 * reglas del negocio al aplicarse, no con una versión (ver `Precondicion` en
 * ordenes/servicio.ts).
 *
 * Dos invariantes gobiernan este servicio:
 *
 * 1. **Una medición por posición.** Si el mismo técnico captura la posición 7
 *    en dos celulares, la segunda se rechaza y queda apartada en el
 *    dispositivo, visible, en vez de pisar a la primera en silencio.
 *    Corregir una posición NO choca: el celular reutiliza el id.
 *
 * 2. **Cada medición aplicada sube la versión de contenido exactamente una
 *    vez**, igual que en el celular. La firma se valida comparando ambos
 *    contadores: si uno subiera y el otro no, toda firma se rechazaría.
 *    Los reintentos de la misma operación no vuelven a aplicarse: eso lo
 *    garantiza la idempotencia de la capa HTTP.
 *
 * Se asume que corre dentro de una transacción abierta por quien llama (la
 * capa HTTP abre una por petición, con el contexto de RLS).
 */

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
  readonly vistaCliente?: boolean;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; veredicto: Veredicto };

function fallo(codigo: string, mensaje: string, campo?: string): { ok: false; veredicto: Veredicto } {
  return { ok: false, veredicto: { permitido: false, codigo, mensaje, ...(campo ? { campo } : {}) } };
}

export interface OrdenParaMedir {
  readonly id: string;
  readonly estado: EstadoOrden;
  readonly tecnicoId: string;
  readonly configuracionEjeId: string;
}

export interface MedicionGuardada {
  readonly id: string;
  readonly ordenId: string;
  readonly posicion: number;
  readonly versionContenido: number;
}

export interface Consultable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

// ── Repositorio ─────────────────────────────────────────────────────────────

export interface RepositorioMediciones {
  buscarOrden(id: string): Promise<OrdenParaMedir | null>;
  posicionExiste(configuracionEjeId: string, numero: number): Promise<boolean>;
  buscarMedicion(id: string): Promise<{ ordenId: string; posicion: number } | null>;
  medicionEnPosicion(ordenId: string, posicion: number): Promise<string | null>;
  serviciosPorCodigo(codigos: readonly string[]): Promise<Map<string, string>>;
  guardar(m: {
    id: string;
    ordenId: string;
    configuracionEjeId: string;
    datos: MedicionLlanta;
    capturadoPorId: string;
    ahora: Date;
  }): Promise<void>;
  reemplazarServicios(medicionId: string, servicioIds: readonly string[]): Promise<void>;
  /** Sube versionContenido y version; devuelve la nueva versionContenido. */
  marcarContenidoCambiado(ordenId: string): Promise<number>;
}

/** Violación de índice único en PostgreSQL. */
const UNICO_VIOLADO = "23505";
/** Violación de llave foránea en PostgreSQL. */
const FORANEA_VIOLADA = "23503";

export class RepositorioMedicionesPg implements RepositorioMediciones {
  constructor(private readonly db: Consultable) {}

  async buscarOrden(id: string): Promise<OrdenParaMedir | null> {
    const r = await this.db.query<Record<string, unknown>>(
      // Las órdenes no se borran: se anulan (estado "anulada"), y esa regla
      // la aplica puedeEditarMediciones. No existe "eliminadoEn": la versión
      // anterior de esta consulta lo filtraba y habría fallado en CADA
      // medición en producción; sus pruebas pasaban porque el esquema de
      // prueba también lo inventaba.
      `SELECT id, estado, tecnico_id, "configuracionEjeId" FROM "OrdenServicio" WHERE id = $1`,
      [id],
    );
    const f = r.rows[0];
    if (!f) return null;
    return {
      id: String(f["id"]),
      estado: f["estado"] as EstadoOrden,
      tecnicoId: String(f["tecnico_id"]),
      configuracionEjeId: String(f["configuracionEjeId"]),
    };
  }

  async posicionExiste(configuracionEjeId: string, numero: number): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM "PosicionEje" WHERE "configuracionEjeId" = $1 AND numero = $2`,
      [configuracionEjeId, numero],
    );
    return r.rows.length > 0;
  }

  async buscarMedicion(id: string): Promise<{ ordenId: string; posicion: number } | null> {
    const r = await this.db.query<{ ordenId: string; posicion: number }>(
      `SELECT "ordenId", posicion FROM "LlantaRegistro" WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async medicionEnPosicion(ordenId: string, posicion: number): Promise<string | null> {
    const r = await this.db.query<{ id: string }>(
      `SELECT id FROM "LlantaRegistro" WHERE "ordenId" = $1 AND posicion = $2`,
      [ordenId, posicion],
    );
    return r.rows[0]?.id ?? null;
  }

  async serviciosPorCodigo(codigos: readonly string[]): Promise<Map<string, string>> {
    if (codigos.length === 0) return new Map();
    // RLS limita a los servicios de la empresa del contexto.
    const r = await this.db.query<{ codigo: string; id: string }>(
      `SELECT codigo, id FROM "Servicio" WHERE codigo = ANY($1::text[]) AND activo`,
      [[...codigos]],
    );
    return new Map(r.rows.map((f) => [f.codigo, f.id]));
  }

  async guardar(m: {
    id: string;
    ordenId: string;
    configuracionEjeId: string;
    datos: MedicionLlanta;
    capturadoPorId: string;
    ahora: Date;
  }): Promise<void> {
    const d = m.datos;
    // Con las tres medidas, la profundidad de la llanta es la mínima y la
    // calcula el servidor. Sin ellas (versión anterior de la app), la única
    // que mandó.
    const prof = d.profundidades ? profundidadDeReferencia(d.profundidades) : d.profundidad ?? null;
    const des = d.desmontada;
    const desProf = des?.profundidades ? profundidadDeReferencia(des.profundidades) : des?.profundidad ?? null;
    await this.db.query(
      `INSERT INTO "LlantaRegistro" (
         id, "ordenId", "configuracionEjeId", posicion,
         "marcaId", "disenoId", medida, "numCalor", serial, dot, "estadoLlanta",
         "psiEncontrada", "psiCalibrado", profundidad, observaciones,
         "noIdentificada", "motivoNoIdentificada",
         "capturadoPorId", "capturadoEn", "actualizadoEn",
         "desPosicionOrigen", "desMarcaId", "desDisenoId", "desMedida", "desNumCalor",
         "desSerial", "desDot", "desProfundidad", "desDestino", "desDetalle",
         "profExterior", "profCentro", "profInterior",
         "desProfExterior", "desProfCentro", "desProfInterior")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19,
               $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
       ON CONFLICT (id) DO UPDATE SET
         "marcaId" = EXCLUDED."marcaId", "disenoId" = EXCLUDED."disenoId",
         medida = EXCLUDED.medida, "numCalor" = EXCLUDED."numCalor",
         serial = EXCLUDED.serial, dot = EXCLUDED.dot,
         "estadoLlanta" = EXCLUDED."estadoLlanta",
         "psiEncontrada" = EXCLUDED."psiEncontrada", "psiCalibrado" = EXCLUDED."psiCalibrado",
         profundidad = EXCLUDED.profundidad, observaciones = EXCLUDED.observaciones,
         "noIdentificada" = EXCLUDED."noIdentificada",
         "motivoNoIdentificada" = EXCLUDED."motivoNoIdentificada",
         "desPosicionOrigen" = EXCLUDED."desPosicionOrigen", "desMarcaId" = EXCLUDED."desMarcaId",
         "desDisenoId" = EXCLUDED."desDisenoId", "desMedida" = EXCLUDED."desMedida",
         "desNumCalor" = EXCLUDED."desNumCalor", "desSerial" = EXCLUDED."desSerial",
         "desDot" = EXCLUDED."desDot", "desProfundidad" = EXCLUDED."desProfundidad",
         "desDestino" = EXCLUDED."desDestino", "desDetalle" = EXCLUDED."desDetalle",
         "profExterior" = EXCLUDED."profExterior", "profCentro" = EXCLUDED."profCentro",
         "profInterior" = EXCLUDED."profInterior",
         "desProfExterior" = EXCLUDED."desProfExterior", "desProfCentro" = EXCLUDED."desProfCentro",
         "desProfInterior" = EXCLUDED."desProfInterior",
         "actualizadoEn" = EXCLUDED."actualizadoEn",
         version = "LlantaRegistro".version + 1`,
      [
        m.id, m.ordenId, m.configuracionEjeId, d.posicion,
        d.marcaId ?? null, d.disenoId ?? null, d.medida ?? null, d.numCalor ?? null,
        d.serial ?? null, d.dot ?? null, d.estadoLlanta ?? null,
        d.psiEncontrada ?? null, d.psiCalibrado ?? null, prof,
        d.observaciones ?? null, d.noIdentificada ?? false, d.motivoNoIdentificada ?? null,
        m.capturadoPorId, m.ahora,
        // La llanta que SALE. El contrato la aceptaba desde la 0.3, pero aquí
        // no se guardaba: si el celular la hubiera enviado, se perdía sin
        // aviso y el informe quedaba con esas columnas vacías.
        d.desmontada?.posicionOrigen ?? null, d.desmontada?.marcaId ?? null,
        d.desmontada?.disenoId ?? null, d.desmontada?.medida ?? null,
        d.desmontada?.numCalor ?? null, d.desmontada?.serial ?? null,
        d.desmontada?.dot ?? null, desProf,
        d.desmontada?.destino ?? null, d.desmontada?.detalle ?? null,
        d.profundidades?.exterior ?? null, d.profundidades?.centro ?? null, d.profundidades?.interior ?? null,
        des?.profundidades?.exterior ?? null, des?.profundidades?.centro ?? null, des?.profundidades?.interior ?? null,
      ],
    );
  }

  async reemplazarServicios(medicionId: string, servicioIds: readonly string[]): Promise<void> {
    await this.db.query(`DELETE FROM "LlantaServicio" WHERE "llantaRegistroId" = $1`, [medicionId]);
    for (const servicioId of servicioIds) {
      await this.db.query(
        `INSERT INTO "LlantaServicio" ("llantaRegistroId", "servicioId") VALUES ($1, $2)`,
        [medicionId, servicioId],
      );
    }
  }

  async marcarContenidoCambiado(ordenId: string): Promise<number> {
    const r = await this.db.query<{ versionContenido: number }>(
      `UPDATE "OrdenServicio"
          SET "versionContenido" = "versionContenido" + 1,
              version = version + 1,
              "actualizadoEn" = now()
        WHERE id = $1
        RETURNING "versionContenido"`,
      [ordenId],
    );
    return r.rows[0]?.versionContenido ?? 0;
  }
}

// ── Servicio ────────────────────────────────────────────────────────────────

export class ServicioMediciones {
  constructor(
    private readonly repo: RepositorioMediciones,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async guardar(
    ctx: Contexto,
    ordenId: string,
    entrada: unknown,
  ): Promise<Resultado<MedicionGuardada>> {
    // El contrato compartido es la única definición de la forma válida: la
    // app valida con el mismo esquema antes de encolar.
    const parseo = zMedicionLlanta.safeParse(entrada);
    if (!parseo.success) {
      const problema = parseo.error.issues[0];
      return fallo("DATOS_INVALIDOS", problema?.message ?? "Medición inválida", problema?.path.join("."));
    }
    const datos = parseo.data;

    const orden = await this.repo.buscarOrden(ordenId);
    if (!orden) return fallo("NO_EXISTE", "La orden no existe");

    const permiso = puedeEditarMediciones({
      estado: orden.estado,
      rol: ctx.rol,
      esTecnicoAsignado: orden.tecnicoId === ctx.usuarioId,
      vistaCliente: ctx.vistaCliente ?? false,
    });
    if (!permiso.permitido) return { ok: false, veredicto: permiso };

    if (!(await this.repo.posicionExiste(orden.configuracionEjeId, datos.posicion))) {
      return fallo(
        "POSICION_INEXISTENTE",
        `El vehículo no tiene posición ${datos.posicion} en su configuración de ejes`,
        "posicion",
      );
    }

    // El id identifica LA medición: puede actualizarse, pero no mudarse de
    // orden ni de posición. Si llegara a pasar, es un error del cliente, no
    // una corrección.
    const previa = await this.repo.buscarMedicion(datos.id);
    if (previa && (previa.ordenId !== ordenId || previa.posicion !== datos.posicion)) {
      return fallo(
        "MEDICION_REUBICADA",
        "Esa medición pertenece a otra orden o posición",
      );
    }

    // Una medición por posición. Corregir no choca porque trae el mismo id;
    // lo que choca es otra medición, típicamente de un segundo celular.
    const ocupante = await this.repo.medicionEnPosicion(ordenId, datos.posicion);
    if (ocupante && ocupante !== datos.id) {
      return fallo(
        "POSICION_OCUPADA",
        `La posición ${datos.posicion} ya tiene una medición registrada desde otro dispositivo`,
        "posicion",
      );
    }

    // Los servicios llegan por código del catálogo fijo. Uno por vehículo no
    // tiene sentido en una llanta, y uno desconocido no se descarta: se
    // rechaza, para que quede apartado en el celular y no se pierda.
    const codigos = datos.servicios ?? [];
    for (const codigo of codigos) {
      const def = definicionDeServicio(codigo);
      if (!def) return fallo("SERVICIO_DESCONOCIDO", `Servicio desconocido: ${codigo}`, "servicios");
      if (!def.porLlanta) {
        return fallo("SERVICIO_DE_VEHICULO", `${def.nombre} se registra por vehículo, no por llanta`, "servicios");
      }
    }
    const ids = await this.repo.serviciosPorCodigo(codigos);
    const faltante = codigos.find((c) => !ids.has(c));
    if (faltante) {
      return fallo(
        "SERVICIO_NO_CONFIGURADO",
        `El servicio ${faltante} no está activo en esta empresa`,
        "servicios",
      );
    }

    try {
      await this.repo.guardar({
        id: datos.id,
        ordenId,
        configuracionEjeId: orden.configuracionEjeId,
        datos,
        // Quien mide sale de la sesión. Nunca del cuerpo de la petición.
        capturadoPorId: ctx.usuarioId,
        ahora: this.reloj(),
      });
    } catch (e) {
      // Las comprobaciones previas no cubren la carrera: dos celulares
      // escribiendo la misma posición en el mismo instante. La base la
      // detiene; aquí se traduce a algo que la persona entienda.
      const codigo = (e as { code?: string }).code;
      if (codigo === UNICO_VIOLADO) {
        return fallo("POSICION_OCUPADA", `La posición ${datos.posicion} acaba de registrarse desde otro dispositivo`, "posicion");
      }
      if (codigo === FORANEA_VIOLADA) {
        return fallo("REFERENCIA_INVALIDA", "La marca, el diseño o la posición no existen");
      }
      throw e;
    }

    await this.repo.reemplazarServicios(datos.id, codigos.map((c) => ids.get(c) as string));

    // Exactamente una vez por medición aplicada, igual que en el celular.
    const versionContenido = await this.repo.marcarContenidoCambiado(ordenId);

    return {
      ok: true,
      valor: { id: datos.id, ordenId, posicion: datos.posicion, versionContenido },
    };
  }
}
