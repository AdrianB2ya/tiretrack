import type { Rol } from "@tiretrack/domain";

/**
 * Descarga: lo que el celular necesita para trabajar sin señal.
 *
 * Es **un solo viaje**. Con señal mala, cinco peticiones son cinco
 * oportunidades de fallar a la mitad y quedarse con datos incompletos: el
 * catálogo sin las medidas, o los vehículos sin su configuración de ejes.
 *
 * Qué se manda y por qué:
 *
 * - **Las órdenes, de forma incremental** (`desde`). Son lo que más cambia y
 *   lo que más pesa; traerlas todas cada vez gastaría datos del técnico.
 * - **El catálogo y las configuraciones, completos.** No tienen marca de
 *   actualización en la base, y son pocos cientos de filas. Cuando crezcan,
 *   agregar `actualizadoEn` a esas tablas permite volverlos incrementales sin
 *   cambiar este contrato.
 *
 * El aislamiento por empresa lo aplica RLS; aquí se filtra **por persona**:
 * un técnico recibe solo sus órdenes, no las de la sede.
 */

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
}

export interface Paquete {
  /** Momento del servidor. El celular lo usa como `desde` la próxima vez. */
  readonly hasta: string;
  readonly incremental: boolean;
  readonly ordenes: OrdenDescargada[];
  readonly mediciones: MedicionDescargada[];
  readonly catalogo: {
    marcas: { id: string; nombre: string; esGlobal: boolean }[];
    disenos: { id: string; marcaId: string; nombre: string; tipoEje: string }[];
    medidas: { id: string; disenoId: string; medida: string; profundidadOriginal: number | null }[];
  };
  readonly flota: {
    clientes: { id: string; nombre: string; nit: string | null }[];
    sedes: { id: string; clienteId: string; nombre: string }[];
    vehiculos: {
      id: string; sedeClienteId: string; configuracionEjeId: string;
      codigo: string; placa: string | null; nombre: string; kmActual: number;
    }[];
  };
  readonly configuraciones: {
    id: string;
    posiciones: { numero: number; eje: number; lado: string; esInterna: boolean; tipoEje: string;
      psiObjetivo: number | null; profundidadMinima: number | null }[];
  }[];
  readonly tecnicos: { id: string; nombre: string; sedeId: string; activo: boolean }[];
}

export interface OrdenDescargada {
  readonly id: string;
  readonly sedeId: string;
  readonly clienteId: string;
  readonly sedeClienteId: string;
  readonly vehiculoId: string;
  readonly tecnicoId: string;
  readonly configuracionEjeId: string;
  readonly folio: string | null;
  readonly tipo: string;
  readonly estado: string;
  readonly fecha: string;
  readonly kilometraje: number | null;
  readonly hallazgos: string | null;
  readonly motivoDevolucion: string | null;
  readonly notaCoordinador: string | null;
  readonly version: number;
  readonly versionContenido: number;
}

export interface MedicionDescargada {
  readonly id: string;
  readonly ordenId: string;
  readonly posicion: number;
  readonly marcaId: string | null;
  readonly disenoId: string | null;
  readonly medida: string | null;
  readonly serial: string | null;
  readonly profundidad: number | null;
}

export interface Consultable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Estados cuyas órdenes ya no le sirven al técnico en el celular. */
const ESTADOS_CERRADOS = ["cerrada", "anulada"];

export class ServicioDescarga {
  constructor(
    private readonly db: Consultable,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async paquete(ctx: Contexto, desde?: string): Promise<Paquete> {
    const hasta = this.reloj().toISOString();
    const ordenes = await this.ordenesDe(ctx, desde);
    const mediciones = ordenes.length > 0 ? await this.medicionesDe(ordenes.map((o) => o.id)) : [];

    const [catalogo, flota, configuraciones, tecnicos] = await Promise.all([
      this.catalogo(),
      this.flota(),
      this.configuraciones(),
      this.tecnicos(ctx),
    ]);

    return { hasta, incremental: Boolean(desde), ordenes, mediciones, catalogo, flota, configuraciones, tecnicos };
  }

  /**
   * Órdenes de la persona.
   *
   * El técnico recibe **las suyas**; el coordinador, las de sus sedes. Las
   * cerradas y anuladas no viajan: ocupan espacio y ya no se pueden tocar.
   * Pero si se cerraron DESPUÉS del último `desde`, sí se mandan, para que el
   * celular sepa que debe quitarlas de la lista.
   */
  private async ordenesDe(ctx: Contexto, desde?: string): Promise<OrdenDescargada[]> {
    const condiciones: string[] = [];
    const params: unknown[] = [];

    if (ctx.rol === "tecnico") {
      params.push(ctx.usuarioId);
      condiciones.push(`o.tecnico_id = $${params.length}`);
    } else {
      params.push(ctx.usuarioId);
      condiciones.push(
        `o."sedeId" IN (SELECT "sedeId" FROM "UsuarioSede" WHERE "usuarioId" = $${params.length})`,
      );
    }

    if (desde) {
      params.push(desde);
      condiciones.push(`o."actualizadoEn" > $${params.length}`);
    } else {
      // Primera descarga: solo lo que todavía se puede trabajar.
      // `estado` es un tipo enumerado: comparar contra texto sin convertir
      // falla en PostgreSQL con "operator does not exist".
      condiciones.push(`o.estado::text <> ALL($${params.push(ESTADOS_CERRADOS)}::text[])`);
    }

    const r = await this.db.query<Record<string, unknown>>(
      `SELECT o.id, o."sedeId", o."clienteId", o."sedeClienteId", o."vehiculoId",
              o.tecnico_id, o."configuracionEjeId", o.folio, o.tipo, o.estado,
              o.fecha, o.kilometraje, o.hallazgos, o."motivoDevolucion",
              o."notaCoordinador", o.version, o."versionContenido"
         FROM "OrdenServicio" o
        WHERE ${condiciones.join(" AND ")}
        ORDER BY o.fecha DESC
        LIMIT 200`,
      params,
    );

    return r.rows.map((f) => ({
      id: String(f["id"]),
      sedeId: String(f["sedeId"]),
      clienteId: String(f["clienteId"]),
      sedeClienteId: String(f["sedeClienteId"]),
      vehiculoId: String(f["vehiculoId"]),
      tecnicoId: String(f["tecnico_id"]),
      configuracionEjeId: String(f["configuracionEjeId"]),
      folio: (f["folio"] as string) ?? null,
      tipo: String(f["tipo"]),
      estado: String(f["estado"]),
      fecha: fechaISO(f["fecha"]),
      kilometraje: f["kilometraje"] === null ? null : Number(f["kilometraje"]),
      hallazgos: (f["hallazgos"] as string) ?? null,
      motivoDevolucion: (f["motivoDevolucion"] as string) ?? null,
      notaCoordinador: (f["notaCoordinador"] as string) ?? null,
      version: Number(f["version"]),
      versionContenido: Number(f["versionContenido"]),
    }));
  }

  /** Las mediciones viajan para que una orden devuelta se pueda corregir. */
  private async medicionesDe(ordenIds: string[]): Promise<MedicionDescargada[]> {
    const r = await this.db.query<Record<string, unknown>>(
      `SELECT id, "ordenId", posicion, "marcaId", "disenoId", medida, serial, profundidad
         FROM "LlantaRegistro" WHERE "ordenId" = ANY($1::text[])`,
      [ordenIds],
    );
    return r.rows.map((f) => ({
      id: String(f["id"]),
      ordenId: String(f["ordenId"]),
      posicion: Number(f["posicion"]),
      marcaId: (f["marcaId"] as string) ?? null,
      disenoId: (f["disenoId"] as string) ?? null,
      medida: (f["medida"] as string) ?? null,
      serial: (f["serial"] as string) ?? null,
      profundidad: f["profundidad"] === null ? null : Number(f["profundidad"]),
    }));
  }

  private async catalogo(): Promise<Paquete["catalogo"]> {
    const [marcas, disenos, medidas] = await Promise.all([
      this.db.query<Record<string, unknown>>(
        `SELECT id, nombre, "esGlobal" FROM "Marca" WHERE activa ORDER BY nombre`,
      ),
      this.db.query<Record<string, unknown>>(
        `SELECT id, "marcaId", nombre, "tipoEje" FROM "Diseno" WHERE activo ORDER BY nombre`,
      ),
      this.db.query<Record<string, unknown>>(
        // La tabla es "DisenoMedida", no "Medida": una medida pertenece a un
        // diseño. Esta consulta decía "Medida" y habría fallado en el primer
        // intento de descarga en producción.
        `SELECT id, "disenoId", medida, "profundidadOriginal" FROM "DisenoMedida" ORDER BY medida`,
      ),
    ]);
    return {
      marcas: marcas.rows.map((f) => ({
        id: String(f["id"]), nombre: String(f["nombre"]), esGlobal: Boolean(f["esGlobal"]),
      })),
      disenos: disenos.rows.map((f) => ({
        id: String(f["id"]), marcaId: String(f["marcaId"]),
        nombre: String(f["nombre"]), tipoEje: String(f["tipoEje"]),
      })),
      medidas: medidas.rows.map((f) => ({
        id: String(f["id"]), disenoId: String(f["disenoId"]), medida: String(f["medida"]),
        profundidadOriginal: f["profundidadOriginal"] === null ? null : Number(f["profundidadOriginal"]),
      })),
    };
  }

  private async flota(): Promise<Paquete["flota"]> {
    const [clientes, sedes, vehiculos] = await Promise.all([
      this.db.query<Record<string, unknown>>(`SELECT id, nombre, nit FROM "Cliente" ORDER BY nombre`),
      this.db.query<Record<string, unknown>>(`SELECT id, "clienteId", nombre FROM "SedeCliente"`),
      this.db.query<Record<string, unknown>>(
        `SELECT id, "sedeClienteId", "configuracionEjeId", codigo, placa, nombre, "kmActual"
           FROM "Vehiculo"`,
      ),
    ]);
    return {
      clientes: clientes.rows.map((f) => ({
        id: String(f["id"]), nombre: String(f["nombre"]), nit: (f["nit"] as string) ?? null,
      })),
      sedes: sedes.rows.map((f) => ({
        id: String(f["id"]), clienteId: String(f["clienteId"]), nombre: String(f["nombre"]),
      })),
      vehiculos: vehiculos.rows.map((f) => ({
        id: String(f["id"]), sedeClienteId: String(f["sedeClienteId"]),
        configuracionEjeId: String(f["configuracionEjeId"]), codigo: String(f["codigo"]),
        placa: (f["placa"] as string) ?? null, nombre: String(f["nombre"] ?? f["codigo"]),
        kmActual: Number(f["kmActual"] ?? 0),
      })),
    };
  }

  /**
   * Configuraciones con sus posiciones.
   *
   * Sin esto el diagrama no se puede dibujar, así que viajan siempre: un
   * vehículo con una configuración que el celular no tiene es una orden que
   * no se puede capturar.
   */
  private async configuraciones(): Promise<Paquete["configuraciones"]> {
    const r = await this.db.query<Record<string, unknown>>(
      `SELECT c.id,
              p.numero, p.eje, p.lado, p."esInterna", p."tipoEje",
              p."psiObjetivo", p."profundidadMinima"
         FROM "ConfiguracionEje" c
         JOIN "PosicionEje" p ON p."configuracionEjeId" = c.id
        ORDER BY c.id, p.numero`,
    );
    const porId = new Map<string, Paquete["configuraciones"][number]>();
    for (const f of r.rows) {
      const id = String(f["id"]);
      if (!porId.has(id)) porId.set(id, { id, posiciones: [] });
      porId.get(id)?.posiciones.push({
        numero: Number(f["numero"]),
        eje: Number(f["eje"]),
        lado: String(f["lado"]),
        esInterna: Boolean(f["esInterna"]),
        tipoEje: String(f["tipoEje"]),
        psiObjetivo: f["psiObjetivo"] === null ? null : Number(f["psiObjetivo"]),
        profundidadMinima: f["profundidadMinima"] === null ? null : Number(f["profundidadMinima"]),
      });
    }
    return [...porId.values()];
  }

  /** Técnicos de las sedes de la persona, para reasignar sin señal. */
  private async tecnicos(ctx: Contexto): Promise<Paquete["tecnicos"]> {
    const r = await this.db.query<Record<string, unknown>>(
      `SELECT DISTINCT u.id, u.nombre, us."sedeId", u.activo
         FROM "Usuario" u
         JOIN "UsuarioSede" us ON us."usuarioId" = u.id
        WHERE us."sedeId" IN (SELECT "sedeId" FROM "UsuarioSede" WHERE "usuarioId" = $1)
        ORDER BY u.nombre`,
      [ctx.usuarioId],
    );
    return r.rows.map((f) => ({
      id: String(f["id"]), nombre: String(f["nombre"]),
      sedeId: String(f["sedeId"]), activo: Boolean(f["activo"]),
    }));
  }
}

function fechaISO(valor: unknown): string {
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}
