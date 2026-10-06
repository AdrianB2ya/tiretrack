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
  /** Solo para el rol cliente: de qué cliente es. */
  readonly clienteId?: string | null;
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
    nombre: string;
    version: number;
    vigente: boolean;
    posiciones: { numero: number; eje: number; lado: string; esInterna: boolean; tipoEje: string;
      psiObjetivo: number | null; profundidadMinima: number | null }[];
  }[];
  readonly tecnicos: { id: string; nombre: string; sedeId: string; activo: boolean }[];
  /** Sedes de la empresa: la orden nueva las necesita, y su código arma la referencia sin señal. */
  readonly sedes: { id: string; nombre: string; codigo: string }[];
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
  /**
   * Antes no viajaban, y el celular guarda la orden descargada reemplazando
   * la fila entera: al volver a descargar una orden firmada, la firma
   * desaparecía del celular y la app decía que faltaba. El trazo no viaja
   * —pesa y el celular que firmó ya lo tiene—; el resumen sí.
   */
  readonly codigoReferencia: string | null;
  readonly accion: string | null;
  readonly firmaNombre: string | null;
  readonly firmaCedula: string | null;
  readonly firmaCargo: string | null;
  readonly firmaVersion: number | null;
  readonly firmaFechaHora: string | null;
  /**
   * Para la bandeja y el portal. No viajaban: el plazo del cliente nunca
   * llegaba al celular (ni el aviso de "vencen pronto" del panel), y en el
   * celular de un coordinador los días de espera y el técnico salían vacíos.
   */
  readonly limiteCliente: string | null;
  readonly enviadaRevisionEn: string | null;
  readonly tecnicoNombre: string | null;
}

/**
 * La medición COMPLETA, con todo lo que el editor muestra y vuelve a enviar.
 *
 * Antes viajaban solo siete campos. Al corregir una orden devuelta, el
 * técnico abría la posición sin DOT, presiones, servicios ni estado, y al
 * guardar los reenviaba vacíos: la corrección borraba en el servidor lo que
 * no había tocado.
 */
export interface MedicionDescargada {
  readonly id: string;
  readonly ordenId: string;
  readonly posicion: number;
  readonly marcaId: string | null;
  readonly disenoId: string | null;
  readonly medida: string | null;
  readonly numCalor: string | null;
  readonly serial: string | null;
  readonly dot: string | null;
  readonly estadoLlanta: string | null;
  readonly psiEncontrada: number | null;
  readonly psiCalibrado: number | null;
  readonly profundidad: number | null;
  readonly observaciones: string | null;
  readonly noIdentificada: boolean;
  readonly motivoNoIdentificada: string | null;
  readonly capturadoPorId: string;
  /** Códigos del catálogo fijo (`CALI`), no nombres. */
  readonly servicios: string[];
  /** La llanta que salió; sin ella, corregir la orden la borraría. */
  readonly desmontada: {
    posicionOrigen: number | null; marcaId: string | null; disenoId: string | null; medida: string | null;
    numCalor: string | null; serial: string | null; dot: string | null; profundidad: number | null;
    destino: string | null; detalle: string | null;
  } | null;
}

/** Columnas des* → objeto; null si no se cambió la llanta. */
function desmontadaDe(
  f: Record<string, unknown>,
  num: (v: unknown) => number | null,
  txt: (v: unknown) => string | null,
): MedicionDescargada["desmontada"] {
  const d = {
    posicionOrigen: num(f["desPosicionOrigen"]), marcaId: txt(f["desMarcaId"]), disenoId: txt(f["desDisenoId"]),
    medida: txt(f["desMedida"]), numCalor: txt(f["desNumCalor"]), serial: txt(f["desSerial"]), dot: txt(f["desDot"]),
    profundidad: num(f["desProfundidad"]), destino: txt(f["desDestino"]), detalle: txt(f["desDetalle"]),
  };
  return Object.values(d).some((v) => v !== null) ? d : null;
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

    // De a una, no en paralelo: todas van por la MISMA conexión de la
    // transacción. pg las encolaba igual —sin ganar nada— y avisa que dejará
    // de hacerlo; y si una fallaba, las demás seguían sobre una transacción
    // ya abortada.
    const catalogo = await this.catalogo();
    const flota = await this.flota();
    const configuraciones = await this.configuraciones();
    const tecnicos = await this.tecnicos(ctx);
    const sedes = await this.sedes();

    return { hasta, incremental: Boolean(desde), ordenes, mediciones, catalogo, flota, configuraciones, tecnicos, sedes };
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

    const esCliente = ctx.rol === "cliente";
    if (esCliente) {
      // El cliente ve sus órdenes —RLS ya lo limita a su clienteId— y solo lo
      // que le toca: lo que espera su aprobación y lo cerrado. Antes se le
      // buscaban sedes de empresa, que no tiene, y recibía cero órdenes.
      params.push(ctx.clienteId);
      condiciones.push(`o."clienteId" = $${params.length}`);
      condiciones.push(`o.estado::text = ANY($${params.push(["pendiente_cliente", "cerrada"])}::text[])`);
    } else if (ctx.rol === "tecnico") {
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
    } else if (!esCliente) {
      // Primera descarga: solo lo que todavía se puede trabajar. El cliente
      // sí recibe sus cerradas: son su historial.
      // `estado` es un tipo enumerado: comparar contra texto sin convertir
      // falla en PostgreSQL con "operator does not exist".
      condiciones.push(`o.estado::text <> ALL($${params.push(ESTADOS_CERRADOS)}::text[])`);
    }

    const r = await this.db.query<Record<string, unknown>>(
      `SELECT o.id, o."sedeId", o."clienteId", o."sedeClienteId", o."vehiculoId",
              o.tecnico_id, o."configuracionEjeId", o.folio, o.tipo, o.estado,
              o.fecha, o.kilometraje, o.hallazgos, o."motivoDevolucion",
              o."notaCoordinador", o.version, o."versionContenido",
              o."codigoReferencia", o.accion, o."firmaNombre", o."firmaCedula", o."firmaCargo",
              o."firmaVersion", o."firmaFechaHora",
              to_char(o."limiteCliente", 'YYYY-MM-DD') AS "limiteCliente",
              -- El servidor no guarda cuándo entró a revisión: sale del historial.
              (SELECT max(h."creadoEn") FROM "OrdenEstadoHistorial" h
                WHERE h."ordenId" = o.id AND h."estadoNuevo"::text = 'en_revision') AS "enviadaRevisionEn",
              coalesce(o."tecnicoNombre", (SELECT u.nombre FROM "Usuario" u WHERE u.id = o.tecnico_id)) AS "tecnicoNombre"
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
      // Internos entre coordinador y técnico: el cliente no los ve (CLAUDE.md,
      // aislamiento). Viajaban en la descarga sin filtrar.
      motivoDevolucion: esCliente ? null : ((f["motivoDevolucion"] as string) ?? null),
      notaCoordinador: esCliente ? null : ((f["notaCoordinador"] as string) ?? null),
      version: Number(f["version"]),
      versionContenido: Number(f["versionContenido"]),
      codigoReferencia: (f["codigoReferencia"] as string) ?? null,
      accion: (f["accion"] as string) ?? null,
      firmaNombre: (f["firmaNombre"] as string) ?? null,
      firmaCedula: (f["firmaCedula"] as string) ?? null,
      firmaCargo: (f["firmaCargo"] as string) ?? null,
      firmaVersion: f["firmaVersion"] === null ? null : Number(f["firmaVersion"]),
      firmaFechaHora: f["firmaFechaHora"] instanceof Date ? f["firmaFechaHora"].toISOString() : null,
      limiteCliente: (f["limiteCliente"] as string) ?? null,
      enviadaRevisionEn: f["enviadaRevisionEn"] instanceof Date ? f["enviadaRevisionEn"].toISOString() : null,
      tecnicoNombre: (f["tecnicoNombre"] as string) ?? null,
    }));
  }

  /** Las mediciones viajan para que una orden devuelta se pueda corregir. */
  private async medicionesDe(ordenIds: string[]): Promise<MedicionDescargada[]> {
    const r = await this.db.query<Record<string, unknown>>(
      `SELECT lr.id, lr."ordenId", lr.posicion, lr."marcaId", lr."disenoId", lr.medida, lr."numCalor",
              lr.serial, lr.dot, lr."estadoLlanta", lr."psiEncontrada", lr."psiCalibrado", lr.profundidad,
              lr.observaciones, lr."noIdentificada", lr."motivoNoIdentificada", lr."capturadoPorId",
              lr."desPosicionOrigen", lr."desMarcaId", lr."desDisenoId", lr."desMedida", lr."desNumCalor",
              lr."desSerial", lr."desDot", lr."desProfundidad", lr."desDestino", lr."desDetalle",
              coalesce((SELECT array_agg(s.codigo ORDER BY s.codigo)
                          FROM "LlantaServicio" ls JOIN "Servicio" s ON s.id = ls."servicioId"
                         WHERE ls."llantaRegistroId" = lr.id), ARRAY[]::text[]) AS servicios
         FROM "LlantaRegistro" lr WHERE lr."ordenId" = ANY($1::text[])`,
      [ordenIds],
    );
    // pg devuelve numeric como texto: sin convertir, "9.00" no es un número.
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
    return r.rows.map((f) => ({
      id: String(f["id"]),
      ordenId: String(f["ordenId"]),
      posicion: Number(f["posicion"]),
      marcaId: txt(f["marcaId"]),
      disenoId: txt(f["disenoId"]),
      medida: txt(f["medida"]),
      numCalor: txt(f["numCalor"]),
      serial: txt(f["serial"]),
      dot: txt(f["dot"]),
      estadoLlanta: txt(f["estadoLlanta"]),
      psiEncontrada: num(f["psiEncontrada"]),
      psiCalibrado: num(f["psiCalibrado"]),
      profundidad: num(f["profundidad"]),
      observaciones: txt(f["observaciones"]),
      noIdentificada: Boolean(f["noIdentificada"]),
      motivoNoIdentificada: txt(f["motivoNoIdentificada"]),
      capturadoPorId: String(f["capturadoPorId"]),
      servicios: (f["servicios"] as string[]) ?? [],
      desmontada: desmontadaDe(f, num, txt),
    }));
  }

  private async catalogo(): Promise<Paquete["catalogo"]> {
    const marcas = await this.db.query<Record<string, unknown>>(
      `SELECT id, nombre, "esGlobal" FROM "Marca" WHERE activa ORDER BY nombre`,
    );
    const disenos = await this.db.query<Record<string, unknown>>(
      `SELECT id, "marcaId", nombre, "tipoEje" FROM "Diseno" WHERE activo ORDER BY nombre`,
    );
    const medidas = await this.db.query<Record<string, unknown>>(
        // La tabla es "DisenoMedida", no "Medida": una medida pertenece a un
        // diseño. Esta consulta decía "Medida" y habría fallado en el primer
        // intento de descarga en producción.
        `SELECT id, "disenoId", medida, "profundidadOriginal" FROM "DisenoMedida" ORDER BY medida`,
    );
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
    const clientes = await this.db.query<Record<string, unknown>>(`SELECT id, nombre, nit FROM "Cliente" ORDER BY nombre`);
    const sedes = await this.db.query<Record<string, unknown>>(`SELECT id, "clienteId", nombre FROM "SedeCliente"`);
    const vehiculos = await this.db.query<Record<string, unknown>>(
      `SELECT id, "sedeClienteId", "configuracionEjeId", codigo, placa, nombre, "kmActual"
         FROM "Vehiculo"`,
    );
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
      `SELECT c.id, c.nombre, c.version, c.vigente,
              p.numero, p.eje, p.lado, p."esInterna", p."tipoEje",
              p."psiObjetivo", p."profundidadMinima"
         FROM "ConfiguracionEje" c
         JOIN "PosicionEje" p ON p."configuracionEjeId" = c.id
        ORDER BY c.id, p.numero`,
    );
    const porId = new Map<string, Paquete["configuraciones"][number]>();
    for (const f of r.rows) {
      const id = String(f["id"]);
      // El nombre hace falta para elegir la plantilla al registrar un vehículo.
      if (!porId.has(id)) {
        porId.set(id, {
          id, nombre: String(f["nombre"]), version: Number(f["version"]), vigente: Boolean(f["vigente"]), posiciones: [],
        });
      }
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
          -- Solo técnicos: antes venían todos los usuarios de la sede, y el
          -- coordinador o el administrador aparecían como opción al reasignar.
          AND u.rol::text = 'tecnico'
        ORDER BY u.nombre`,
      [ctx.usuarioId],
    );
    return r.rows.map((f) => ({
      id: String(f["id"]), nombre: String(f["nombre"]),
      sedeId: String(f["sedeId"]), activo: Boolean(f["activo"]),
    }));
  }

  private async sedes(): Promise<Paquete["sedes"]> {
    const r = await this.db.query<Record<string, unknown>>(
      `SELECT id, nombre, codigo FROM "Sede" WHERE activa ORDER BY nombre`,
    );
    return r.rows.map((f) => ({ id: String(f["id"]), nombre: String(f["nombre"]), codigo: String(f["codigo"]) }));
  }
}

function fechaISO(valor: unknown): string {
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}
