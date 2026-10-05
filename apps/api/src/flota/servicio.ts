import {
  cadenaCoherente,
  clave,
  evaluarKilometraje,
  evaluarNuevaVersion,
  nuevoId,
  puedeDesactivar,
  puedeGestionarConfiguraciones,
  puedeGestionarFlota,
  siguienteVersion,
  validarConfiguracion,
  type DefinicionEje,
  type Rol,
  type Veredicto,
} from "@tiretrack/domain";
import type {
  Cliente,
  ConfiguracionEje,
  PosicionEje,
  RepositorioFlota,
  SedeCliente,
  Vehiculo,
} from "./repositorio";

/**
 * Clientes, sedes, vehículos y configuraciones de eje.
 *
 * La jerarquía es: Cliente → SedeCliente → Vehículo. El vehículo pertenece a
 * la SEDE, no al cliente: por eso al crear una orden se elige en cascada.
 */

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; veredicto: Veredicto };

const fallo = (codigo: string, mensaje: string): Resultado<never> => ({
  ok: false,
  veredicto: { permitido: false, codigo, mensaje },
});

const sinPermiso = fallo("SIN_PERMISO", "No tienes permiso para esta acción");

export class ServicioFlota {
  constructor(
    private readonly repo: RepositorioFlota,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  // ── Clientes ──────────────────────────────────────────────────────────────

  async listarClientes(_ctx: Contexto, incluirInactivos = false): Promise<Cliente[]> {
    return this.repo.listarClientes(!incluirInactivos);
  }

  /**
   * El técnico SÍ puede crear clientes —decisión tomada— pero no
   * deshabilitarlos. Crear es operativo: llega a una sede que no estaba
   * registrada y necesita poder trabajar.
   */
  async crearCliente(
    ctx: Contexto,
    entrada: { id?: string; nombre: string; nit: string; contacto?: string; telefono?: string; email?: string },
  ): Promise<Resultado<Cliente>> {
    if (!puedeGestionarFlota(ctx.rol) && ctx.rol !== "tecnico") return sinPermiso;

    const nombre = entrada.nombre.trim();
    const nit = entrada.nit.trim();
    if (nombre.length < 2) return fallo("NOMBRE_INVALIDO", "El nombre es demasiado corto");
    if (nit.length < 5) return fallo("NIT_INVALIDO", "El NIT es demasiado corto");

    // El NIT es único POR empresa: el mismo cliente atendido por dos empresas
    // suscritas tiene un registro en cada una.
    const existente = await this.repo.clientePorNit(nit);
    if (existente) {
      return fallo("NIT_DUPLICADO", `${existente.nombre} ya está registrado con ese NIT`);
    }

    const cliente = await this.repo.crearCliente({
      id: entrada.id ?? nuevoId(),
      empresaId: ctx.empresaId,
      nombre,
      nit,
      contacto: entrada.contacto?.trim() || null,
      telefono: entrada.telefono?.trim() || null,
      email: entrada.email?.trim().toLowerCase() || null,
    });
    return { ok: true, valor: cliente };
  }

  async desactivarCliente(ctx: Contexto, clienteId: string): Promise<Resultado<void>> {
    if (!puedeGestionarFlota(ctx.rol)) return sinPermiso;

    const cliente = await this.repo.buscarCliente(clienteId);
    if (!cliente) return fallo("NO_EXISTE", "El cliente no existe");

    const sedes = await this.repo.listarSedesDeCliente(clienteId, true);
    const abiertas = await this.repo.ordenesAbiertasDe("cliente", clienteId);

    const v = puedeDesactivar("cliente", {
      ordenesAbiertas: abiertas,
      hijosActivos: sedes.length,
    });
    if (!v.permitido) return { ok: false, veredicto: v };

    await this.repo.desactivarCliente(clienteId, this.reloj());
    return { ok: true, valor: undefined };
  }

  // ── Sedes del cliente ─────────────────────────────────────────────────────

  async sedesDeCliente(_ctx: Contexto, clienteId: string): Promise<SedeCliente[]> {
    return this.repo.listarSedesDeCliente(clienteId, true);
  }

  async crearSedeCliente(
    ctx: Contexto,
    entrada: { id?: string; clienteId: string; nombre: string; ciudad?: string; direccion?: string; departamento?: string },
  ): Promise<Resultado<SedeCliente>> {
    if (!puedeGestionarFlota(ctx.rol) && ctx.rol !== "tecnico") return sinPermiso;

    const cliente = await this.repo.buscarCliente(entrada.clienteId);
    // RLS ya impide ver clientes ajenos: si no aparece, no existe para esta
    // sesión. Se responde igual que si no existiera.
    if (!cliente) return fallo("NO_EXISTE", "El cliente no existe");
    if (!cliente.activo) return fallo("CLIENTE_INACTIVO", "El cliente está deshabilitado");

    const sede = await this.repo.crearSedeCliente({
      id: entrada.id ?? nuevoId(),
      clienteId: entrada.clienteId,
      nombre: entrada.nombre.trim(),
      direccion: entrada.direccion?.trim() || null,
      ciudad: entrada.ciudad?.trim() || null,
      departamento: entrada.departamento?.trim() || null,
    });
    return { ok: true, valor: sede };
  }

  async desactivarSedeCliente(ctx: Contexto, sedeId: string): Promise<Resultado<void>> {
    if (!puedeGestionarFlota(ctx.rol)) return sinPermiso;

    const sede = await this.repo.buscarSedeCliente(sedeId);
    if (!sede) return fallo("NO_EXISTE", "La sede no existe");

    const vehiculos = await this.repo.listarVehiculos(sedeId, true);
    const abiertas = await this.repo.ordenesAbiertasDe("sedeCliente", sedeId);

    const v = puedeDesactivar("sede", {
      ordenesAbiertas: abiertas,
      hijosActivos: vehiculos.length,
    });
    if (!v.permitido) return { ok: false, veredicto: v };

    await this.repo.desactivarSedeCliente(sedeId, this.reloj());
    return { ok: true, valor: undefined };
  }

  // ── Vehículos ─────────────────────────────────────────────────────────────

  async vehiculosDeSede(_ctx: Contexto, sedeClienteId: string): Promise<Vehiculo[]> {
    return this.repo.listarVehiculos(sedeClienteId, true);
  }

  async crearVehiculo(
    ctx: Contexto,
    entrada: {
      id?: string;
      sedeClienteId: string;
      configuracionEjeId: string;
      codigo: string;
      nombre: string;
      tipo: string;
      placa?: string;
      kmActual?: number;
    },
  ): Promise<Resultado<Vehiculo>> {
    if (!puedeGestionarFlota(ctx.rol)) return sinPermiso;

    const sede = await this.repo.buscarSedeCliente(entrada.sedeClienteId);
    if (!sede) return fallo("NO_EXISTE", "La sede del cliente no existe");
    if (!sede.activa) return fallo("SEDE_INACTIVA", "La sede está deshabilitada");

    const cfg = await this.repo.buscarConfiguracion(entrada.configuracionEjeId);
    if (!cfg) return fallo("CONFIGURACION_NO_EXISTE", "La configuración de ejes no existe");
    if (!cfg.vigente) {
      // Un vehículo nuevo debe nacer con la plantilla vigente; las anteriores
      // solo existen para que las órdenes viejas se dibujen bien.
      return fallo("CONFIGURACION_NO_VIGENTE", "Esa versión de configuración ya fue reemplazada");
    }

    const vehiculo = await this.repo.crearVehiculo({
      id: entrada.id ?? nuevoId(),
      sedeClienteId: entrada.sedeClienteId,
      configuracionEjeId: entrada.configuracionEjeId,
      codigo: entrada.codigo.trim().toUpperCase(),
      placa: entrada.placa?.trim().toUpperCase() || null,
      nombre: entrada.nombre.trim(),
      tipo: entrada.tipo.trim(),
      kmActual: entrada.kmActual ?? 0,
    });
    return { ok: true, valor: vehiculo };
  }

  /**
   * El kilometraje que retrocede se avisa pero no se bloquea: cambiar el
   * odómetro es real y frecuente en flotas viejas.
   */
  async actualizarKilometraje(
    ctx: Contexto,
    vehiculoId: string,
    km: number,
    confirmado = false,
  ): Promise<Resultado<{ vehiculo: Vehiculo; retrocedio: boolean }>> {
    if (!puedeGestionarFlota(ctx.rol) && ctx.rol !== "tecnico") return sinPermiso;

    const vehiculo = await this.repo.buscarVehiculo(vehiculoId);
    if (!vehiculo) return fallo("NO_EXISTE", "El vehículo no existe");

    const e = evaluarKilometraje(km, vehiculo.kmActual);
    if (!e.veredicto.permitido) return { ok: false, veredicto: e.veredicto };
    if (e.requiereConfirmacion && !confirmado) {
      return fallo(
        "KM_RETROCEDE",
        `El kilometraje baja de ${vehiculo.kmActual.toLocaleString("es-CO")} a ${km.toLocaleString("es-CO")}. ¿Cambió el odómetro?`,
      );
    }

    const actualizado = await this.repo.actualizarVehiculo(vehiculoId, { kmActual: km });
    return { ok: true, valor: { vehiculo: actualizado, retrocedio: e.requiereConfirmacion } };
  }

  async desactivarVehiculo(ctx: Contexto, vehiculoId: string): Promise<Resultado<void>> {
    if (!puedeGestionarFlota(ctx.rol)) return sinPermiso;

    const vehiculo = await this.repo.buscarVehiculo(vehiculoId);
    if (!vehiculo) return fallo("NO_EXISTE", "El vehículo no existe");

    const abiertas = await this.repo.ordenesAbiertasDe("vehiculo", vehiculoId);
    const v = puedeDesactivar("vehiculo", { ordenesAbiertas: abiertas, hijosActivos: 0 });
    if (!v.permitido) return { ok: false, veredicto: v };

    await this.repo.desactivarVehiculo(vehiculoId, this.reloj());
    return { ok: true, valor: undefined };
  }

  /** Verifica que el vehículo pertenezca al cliente elegido. */
  async verificarCadena(
    _ctx: Contexto,
    clienteId: string,
    vehiculoId: string,
  ): Promise<Veredicto> {
    const duenoReal = await this.repo.clienteDeVehiculo(vehiculoId);
    if (!duenoReal) {
      return { permitido: false, codigo: "NO_EXISTE", mensaje: "El vehículo no existe" };
    }
    return cadenaCoherente({
      clienteIdDelVehiculo: duenoReal,
      clienteIdElegido: clienteId,
    });
  }

  // ── Configuraciones de eje ────────────────────────────────────────────────

  async listarConfiguraciones(_ctx: Contexto, incluirReemplazadas = false): Promise<ConfiguracionEje[]> {
    return this.repo.listarConfiguraciones(!incluirReemplazadas);
  }

  async posicionesDe(_ctx: Contexto, configuracionId: string): Promise<PosicionEje[]> {
    return this.repo.posicionesDe(configuracionId);
  }

  async crearConfiguracion(
    ctx: Contexto,
    entrada: { id?: string; nombre: string; ejes: readonly DefinicionEje[] },
  ): Promise<Resultado<ConfiguracionEje>> {
    if (!puedeGestionarConfiguraciones(ctx.rol)) return sinPermiso;

    const validez = validarConfiguracion(entrada.ejes);
    if (!validez.permitido) return { ok: false, veredicto: validez };

    const nombre = entrada.nombre.trim();
    const anteriores = await this.repo.versionesDeConfiguracion(nombre);
    if (anteriores.length > 0) {
      return fallo(
        "NOMBRE_EN_USO",
        `Ya existe "${nombre}". Para cambiarla, crea una versión nueva`,
      );
    }

    const creada = await this.repo.crearConfiguracion(
      {
        id: entrada.id ?? nuevoId(),
        empresaId: ctx.empresaId,
        nombre,
        version: 1,
        totalPosiciones: contarPosiciones(entrada.ejes),
      },
      aPosiciones(entrada.ejes),
    );
    return { ok: true, valor: creada };
  }

  /**
   * Una plantilla NUNCA se edita en sitio: se crea una versión nueva y los
   * vehículos activos se mueven a ella. Las órdenes ya creadas conservan el
   * id de la versión que congelaron, así que su diagrama no cambia.
   */
  async nuevaVersion(
    ctx: Contexto,
    entrada: {
      configuracionAnteriorId: string;
      ejes: readonly DefinicionEje[];
      confirmado?: boolean;
    },
  ): Promise<Resultado<{ configuracion: ConfiguracionEje; vehiculosMovidos: number }>> {
    if (!puedeGestionarConfiguraciones(ctx.rol)) return sinPermiso;

    const anterior = await this.repo.buscarConfiguracion(entrada.configuracionAnteriorId);
    if (!anterior) return fallo("NO_EXISTE", "La configuración no existe");
    if (!anterior.vigente) {
      return fallo("YA_REEMPLAZADA", "Esa versión ya fue reemplazada por otra");
    }

    const enUso = await this.repo.vehiculosConConfiguracion(anterior.id);
    const evaluacion = evaluarNuevaVersion({
      anterior,
      ejesNuevos: entrada.ejes,
      vehiculosQueLaUsan: enUso,
    });

    if (!evaluacion.veredicto.permitido) {
      return { ok: false, veredicto: evaluacion.veredicto };
    }
    if (evaluacion.requiereConfirmacion && !entrada.confirmado) {
      return fallo("REQUIERE_CONFIRMACION", evaluacion.aviso ?? "Confirma el cambio");
    }

    const versiones = await this.repo.versionesDeConfiguracion(anterior.nombre);
    const nueva = await this.repo.crearConfiguracion(
      {
        id: nuevoId(),
        empresaId: ctx.empresaId,
        nombre: anterior.nombre,
        version: siguienteVersion(versiones),
        totalPosiciones: contarPosiciones(entrada.ejes),
      },
      aPosiciones(entrada.ejes),
    );

    await this.repo.marcarReemplazada(anterior.id, nueva.id);
    const movidos = await this.repo.moverVehiculosAConfiguracion(anterior.id, nueva.id);

    return { ok: true, valor: { configuracion: nueva, vehiculosMovidos: movidos } };
  }
}

function contarPosiciones(ejes: readonly DefinicionEje[]): number {
  return ejes.reduce((n, e) => n + e.posicionesIzquierda.length + e.posicionesDerecha.length, 0);
}

/** Aplana los ejes a filas de posición, marcando cuál es la rueda interna. */
function aPosiciones(
  ejes: readonly DefinicionEje[],
): Omit<PosicionEje, "id" | "configuracionEjeId">[] {
  const filas: Omit<PosicionEje, "id" | "configuracionEjeId">[] = [];
  for (const e of ejes) {
    const agregar = (numero: number, lado: "izquierdo" | "derecho", esInterna: boolean) => {
      filas.push({
        numero,
        eje: e.numero,
        lado,
        esInterna,
        esDireccional: e.tipoEje === "direccional",
        tipoEje: e.tipoEje,
        psiObjetivo: e.psiObjetivo ?? null,
        profundidadMinima: e.profundidadMinima ?? null,
      });
    };
    // En ruedas duales, la interna de cada lado es la que mira al centro:
    // la segunda por la izquierda y la primera por la derecha.
    e.posicionesIzquierda.forEach((n, i) =>
      agregar(n, "izquierdo", e.posicionesIzquierda.length > 1 && i === 1),
    );
    e.posicionesDerecha.forEach((n, i) =>
      agregar(n, "derecho", e.posicionesDerecha.length > 1 && i === 0),
    );
  }
  return filas;
}

export { clave };
