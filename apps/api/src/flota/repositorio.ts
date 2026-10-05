import type pg from "pg";

/**
 * Acceso a datos de la flota.
 *
 * Las consultas no llevan filtro de empresa: lo aplica RLS con el contexto
 * de la transacción. Lo que sí va explícito es la cadena de pertenencia
 * —cliente → sede → vehículo— porque eso no es aislamiento sino navegación.
 */

export interface Cliente {
  readonly id: string;
  readonly empresaId: string;
  readonly nombre: string;
  readonly nit: string;
  readonly contacto: string | null;
  readonly telefono: string | null;
  readonly email: string | null;
  readonly activo: boolean;
}

export interface SedeCliente {
  readonly id: string;
  readonly clienteId: string;
  readonly nombre: string;
  readonly direccion: string | null;
  readonly ciudad: string | null;
  readonly departamento: string | null;
  readonly activa: boolean;
}

export interface Vehiculo {
  readonly id: string;
  readonly sedeClienteId: string;
  readonly configuracionEjeId: string;
  readonly codigo: string;
  readonly placa: string | null;
  readonly nombre: string;
  readonly tipo: string;
  readonly kmActual: number;
  readonly activo: boolean;
}

export interface ConfiguracionEje {
  readonly id: string;
  readonly empresaId: string;
  readonly nombre: string;
  readonly version: number;
  readonly totalPosiciones: number;
  readonly vigente: boolean;
  readonly reemplazadaPorId: string | null;
}

export interface PosicionEje {
  readonly id: string;
  readonly configuracionEjeId: string;
  readonly numero: number;
  readonly eje: number;
  readonly lado: "izquierdo" | "derecho";
  readonly esInterna: boolean;
  readonly esDireccional: boolean;
  readonly tipoEje: string;
  readonly psiObjetivo: number | null;
  readonly profundidadMinima: number | null;
}

export interface RepositorioFlota {
  listarClientes(soloActivos: boolean): Promise<Cliente[]>;
  buscarCliente(id: string): Promise<Cliente | null>;
  clientePorNit(nit: string): Promise<Cliente | null>;
  crearCliente(c: Omit<Cliente, "activo">): Promise<Cliente>;
  actualizarCliente(id: string, datos: Partial<Cliente>): Promise<Cliente>;
  desactivarCliente(id: string, ahora: Date): Promise<void>;

  listarSedesDeCliente(clienteId: string, soloActivas: boolean): Promise<SedeCliente[]>;
  buscarSedeCliente(id: string): Promise<SedeCliente | null>;
  crearSedeCliente(s: Omit<SedeCliente, "activa">): Promise<SedeCliente>;
  desactivarSedeCliente(id: string, ahora: Date): Promise<void>;

  listarVehiculos(sedeClienteId: string, soloActivos: boolean): Promise<Vehiculo[]>;
  buscarVehiculo(id: string): Promise<Vehiculo | null>;
  crearVehiculo(v: Omit<Vehiculo, "activo">): Promise<Vehiculo>;
  actualizarVehiculo(id: string, datos: Partial<Vehiculo>): Promise<Vehiculo>;
  desactivarVehiculo(id: string, ahora: Date): Promise<void>;
  /** Cliente dueño de un vehículo, siguiendo la cadena hacia arriba. */
  clienteDeVehiculo(vehiculoId: string): Promise<string | null>;

  listarConfiguraciones(soloVigentes: boolean): Promise<ConfiguracionEje[]>;
  buscarConfiguracion(id: string): Promise<ConfiguracionEje | null>;
  versionesDeConfiguracion(nombre: string): Promise<ConfiguracionEje[]>;
  crearConfiguracion(
    c: Omit<ConfiguracionEje, "vigente" | "reemplazadaPorId">,
    posiciones: Omit<PosicionEje, "id" | "configuracionEjeId">[],
  ): Promise<ConfiguracionEje>;
  marcarReemplazada(anteriorId: string, nuevaId: string): Promise<void>;
  posicionesDe(configuracionEjeId: string): Promise<PosicionEje[]>;
  vehiculosConConfiguracion(configuracionEjeId: string): Promise<number>;
  moverVehiculosAConfiguracion(desdeId: string, haciaId: string): Promise<number>;

  /** Cuenta órdenes sin cerrar, para decidir si algo se puede desactivar. */
  ordenesAbiertasDe(
    tipo: "cliente" | "sedeCliente" | "vehiculo",
    id: string,
  ): Promise<number>;
}

const aNumero = (v: string | number | null): number | null =>
  v === null ? null : typeof v === "number" ? v : Number(v);

export class RepositorioFlotaPg implements RepositorioFlota {
  constructor(private readonly db: pg.Client | pg.Pool) {}

  // ── Clientes ──────────────────────────────────────────────────────────────

  async listarClientes(soloActivos: boolean): Promise<Cliente[]> {
    const r = await this.db.query<Cliente>(
      `SELECT id, "empresaId", nombre, nit, contacto, telefono, email, activo
         FROM "Cliente" ${soloActivos ? "WHERE activo = true" : ""} ORDER BY nombre`,
    );
    return r.rows;
  }

  async buscarCliente(id: string): Promise<Cliente | null> {
    const r = await this.db.query<Cliente>(
      `SELECT id, "empresaId", nombre, nit, contacto, telefono, email, activo
         FROM "Cliente" WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  /** El NIT es único POR empresa: RLS acota la búsqueda al tenant en sesión. */
  async clientePorNit(nit: string): Promise<Cliente | null> {
    const r = await this.db.query<Cliente>(
      `SELECT id, "empresaId", nombre, nit, contacto, telefono, email, activo
         FROM "Cliente" WHERE nit = $1`,
      [nit],
    );
    return r.rows[0] ?? null;
  }

  async crearCliente(c: Omit<Cliente, "activo">): Promise<Cliente> {
    const r = await this.db.query<Cliente>(
      `INSERT INTO "Cliente" (id, "empresaId", nombre, nit, contacto, telefono, email)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, "empresaId", nombre, nit, contacto, telefono, email, activo`,
      [c.id, c.empresaId, c.nombre, c.nit, c.contacto, c.telefono, c.email],
    );
    return r.rows[0] as Cliente;
  }

  async actualizarCliente(id: string, d: Partial<Cliente>): Promise<Cliente> {
    const r = await this.db.query<Cliente>(
      `UPDATE "Cliente"
          SET nombre = COALESCE($2, nombre), contacto = COALESCE($3, contacto),
              telefono = COALESCE($4, telefono), email = COALESCE($5, email)
        WHERE id = $1
       RETURNING id, "empresaId", nombre, nit, contacto, telefono, email, activo`,
      [id, d.nombre ?? null, d.contacto ?? null, d.telefono ?? null, d.email ?? null],
    );
    return r.rows[0] as Cliente;
  }

  async desactivarCliente(id: string, ahora: Date): Promise<void> {
    await this.db.query(
      `UPDATE "Cliente" SET activo = false, "desactivadoEn" = $2 WHERE id = $1`,
      [id, ahora],
    );
  }

  // ── Sedes del cliente ─────────────────────────────────────────────────────

  async listarSedesDeCliente(clienteId: string, soloActivas: boolean): Promise<SedeCliente[]> {
    const r = await this.db.query<SedeCliente>(
      `SELECT id, "clienteId", nombre, direccion, ciudad, departamento, activa
         FROM "SedeCliente"
        WHERE "clienteId" = $1 ${soloActivas ? "AND activa = true" : ""}
        ORDER BY nombre`,
      [clienteId],
    );
    return r.rows;
  }

  async buscarSedeCliente(id: string): Promise<SedeCliente | null> {
    const r = await this.db.query<SedeCliente>(
      `SELECT id, "clienteId", nombre, direccion, ciudad, departamento, activa
         FROM "SedeCliente" WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async crearSedeCliente(s: Omit<SedeCliente, "activa">): Promise<SedeCliente> {
    const r = await this.db.query<SedeCliente>(
      `INSERT INTO "SedeCliente" (id, "clienteId", nombre, direccion, ciudad, departamento)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, "clienteId", nombre, direccion, ciudad, departamento, activa`,
      [s.id, s.clienteId, s.nombre, s.direccion, s.ciudad, s.departamento],
    );
    return r.rows[0] as SedeCliente;
  }

  async desactivarSedeCliente(id: string, ahora: Date): Promise<void> {
    await this.db.query(
      `UPDATE "SedeCliente" SET activa = false, "desactivadaEn" = $2 WHERE id = $1`,
      [id, ahora],
    );
  }

  // ── Vehículos ─────────────────────────────────────────────────────────────

  async listarVehiculos(sedeClienteId: string, soloActivos: boolean): Promise<Vehiculo[]> {
    const r = await this.db.query<Vehiculo>(
      `SELECT id, "sedeClienteId", "configuracionEjeId", codigo, placa, nombre, tipo,
              "kmActual", activo
         FROM "Vehiculo"
        WHERE "sedeClienteId" = $1 ${soloActivos ? "AND activo = true" : ""}
        ORDER BY codigo`,
      [sedeClienteId],
    );
    return r.rows;
  }

  async buscarVehiculo(id: string): Promise<Vehiculo | null> {
    const r = await this.db.query<Vehiculo>(
      `SELECT id, "sedeClienteId", "configuracionEjeId", codigo, placa, nombre, tipo,
              "kmActual", activo
         FROM "Vehiculo" WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async crearVehiculo(v: Omit<Vehiculo, "activo">): Promise<Vehiculo> {
    const r = await this.db.query<Vehiculo>(
      `INSERT INTO "Vehiculo" (id, "sedeClienteId", "configuracionEjeId", codigo, placa,
                               nombre, tipo, "kmActual")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, "sedeClienteId", "configuracionEjeId", codigo, placa, nombre, tipo,
                 "kmActual", activo`,
      [v.id, v.sedeClienteId, v.configuracionEjeId, v.codigo, v.placa, v.nombre, v.tipo, v.kmActual],
    );
    return r.rows[0] as Vehiculo;
  }

  async actualizarVehiculo(id: string, d: Partial<Vehiculo>): Promise<Vehiculo> {
    const r = await this.db.query<Vehiculo>(
      `UPDATE "Vehiculo"
          SET nombre = COALESCE($2, nombre), placa = COALESCE($3, placa),
              tipo = COALESCE($4, tipo), "kmActual" = COALESCE($5, "kmActual"),
              "configuracionEjeId" = COALESCE($6, "configuracionEjeId")
        WHERE id = $1
       RETURNING id, "sedeClienteId", "configuracionEjeId", codigo, placa, nombre, tipo,
                 "kmActual", activo`,
      [
        id,
        d.nombre ?? null,
        d.placa ?? null,
        d.tipo ?? null,
        d.kmActual ?? null,
        d.configuracionEjeId ?? null,
      ],
    );
    return r.rows[0] as Vehiculo;
  }

  async desactivarVehiculo(id: string, ahora: Date): Promise<void> {
    await this.db.query(
      `UPDATE "Vehiculo" SET activo = false, "desactivadoEn" = $2 WHERE id = $1`,
      [id, ahora],
    );
  }

  async clienteDeVehiculo(vehiculoId: string): Promise<string | null> {
    const r = await this.db.query<{ clienteId: string }>(
      `SELECT sc."clienteId"
         FROM "Vehiculo" v JOIN "SedeCliente" sc ON sc.id = v."sedeClienteId"
        WHERE v.id = $1`,
      [vehiculoId],
    );
    return r.rows[0]?.clienteId ?? null;
  }

  // ── Configuraciones de eje ────────────────────────────────────────────────

  async listarConfiguraciones(soloVigentes: boolean): Promise<ConfiguracionEje[]> {
    const r = await this.db.query<ConfiguracionEje>(
      `SELECT id, "empresaId", nombre, version, "totalPosiciones", vigente, "reemplazadaPorId"
         FROM "ConfiguracionEje" ${soloVigentes ? "WHERE vigente = true" : ""}
        ORDER BY nombre, version DESC`,
    );
    return r.rows;
  }

  async buscarConfiguracion(id: string): Promise<ConfiguracionEje | null> {
    const r = await this.db.query<ConfiguracionEje>(
      `SELECT id, "empresaId", nombre, version, "totalPosiciones", vigente, "reemplazadaPorId"
         FROM "ConfiguracionEje" WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async versionesDeConfiguracion(nombre: string): Promise<ConfiguracionEje[]> {
    const r = await this.db.query<ConfiguracionEje>(
      `SELECT id, "empresaId", nombre, version, "totalPosiciones", vigente, "reemplazadaPorId"
         FROM "ConfiguracionEje" WHERE nombre = $1 ORDER BY version`,
      [nombre],
    );
    return r.rows;
  }

  /**
   * La configuración y sus posiciones entran en una sola transacción: una
   * plantilla a medias dibujaría un diagrama incompleto.
   */
  async crearConfiguracion(
    c: Omit<ConfiguracionEje, "vigente" | "reemplazadaPorId">,
    posiciones: Omit<PosicionEje, "id" | "configuracionEjeId">[],
  ): Promise<ConfiguracionEje> {
    const r = await this.db.query<ConfiguracionEje>(
      `INSERT INTO "ConfiguracionEje" (id, "empresaId", nombre, version, "totalPosiciones")
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, "empresaId", nombre, version, "totalPosiciones", vigente, "reemplazadaPorId"`,
      [c.id, c.empresaId, c.nombre, c.version, c.totalPosiciones],
    );

    for (const p of posiciones) {
      await this.db.query(
        `INSERT INTO "PosicionEje" (id, "configuracionEjeId", numero, eje, lado, "esInterna",
                                    "esDireccional", "tipoEje", "psiObjetivo", "profundidadMinima")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          `${c.id}-p${p.numero}`,
          c.id,
          p.numero,
          p.eje,
          p.lado,
          p.esInterna,
          p.esDireccional,
          p.tipoEje,
          p.psiObjetivo,
          p.profundidadMinima,
        ],
      );
    }

    return r.rows[0] as ConfiguracionEje;
  }

  /**
   * La versión anterior NO se borra ni se oculta del todo: deja de estar
   * vigente para nuevos vehículos, pero las órdenes que la congelaron la
   * siguen necesitando para dibujar su diagrama.
   */
  async marcarReemplazada(anteriorId: string, nuevaId: string): Promise<void> {
    await this.db.query(
      `UPDATE "ConfiguracionEje" SET vigente = false, "reemplazadaPorId" = $2 WHERE id = $1`,
      [anteriorId, nuevaId],
    );
  }

  async posicionesDe(configuracionEjeId: string): Promise<PosicionEje[]> {
    const r = await this.db.query<
      Omit<PosicionEje, "psiObjetivo" | "profundidadMinima"> & {
        psiObjetivo: string | null;
        profundidadMinima: string | null;
      }
    >(
      `SELECT id, "configuracionEjeId", numero, eje, lado, "esInterna", "esDireccional",
              "tipoEje", "psiObjetivo", "profundidadMinima"
         FROM "PosicionEje" WHERE "configuracionEjeId" = $1 ORDER BY numero`,
      [configuracionEjeId],
    );
    // numeric llega como texto desde pg: sin convertir, los umbrales se
    // comparan como cadenas y "9" > "10" resulta verdadero.
    return r.rows.map((p) => ({
      ...p,
      psiObjetivo: aNumero(p.psiObjetivo),
      profundidadMinima: aNumero(p.profundidadMinima),
    }));
  }

  async vehiculosConConfiguracion(configuracionEjeId: string): Promise<number> {
    const r = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "Vehiculo"
        WHERE "configuracionEjeId" = $1 AND activo = true`,
      [configuracionEjeId],
    );
    return r.rows[0]?.n ?? 0;
  }

  async moverVehiculosAConfiguracion(desdeId: string, haciaId: string): Promise<number> {
    const r = await this.db.query(
      `UPDATE "Vehiculo" SET "configuracionEjeId" = $2
        WHERE "configuracionEjeId" = $1 AND activo = true`,
      [desdeId, haciaId],
    );
    return r.rowCount ?? 0;
  }

  // ── Uso ───────────────────────────────────────────────────────────────────

  async ordenesAbiertasDe(
    tipo: "cliente" | "sedeCliente" | "vehiculo",
    id: string,
  ): Promise<number> {
    const columna = {
      cliente: '"clienteId"',
      sedeCliente: '"sedeClienteId"',
      vehiculo: '"vehiculoId"',
    }[tipo];

    const r = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "OrdenServicio"
        WHERE ${columna} = $1
          AND estado NOT IN ('cerrada', 'anulada')`,
      [id],
    );
    return r.rows[0]?.n ?? 0;
  }
}
