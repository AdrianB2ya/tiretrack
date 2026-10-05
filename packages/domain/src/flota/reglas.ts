import { type Veredicto, PERMITIDO, negar, type Rol } from "../tipos";
import { configuracionCoherente, type DefinicionEje } from "../llanta/medicion";

/**
 * Reglas de la flota: configuraciones de eje, clientes, sedes y vehículos.
 *
 * La regla más importante es el versionado inmutable de las plantillas de
 * eje. Si editar una plantilla modificara las órdenes viejas, una orden de
 * hace seis meses se dibujaría con un diagrama que no corresponde a lo que
 * el técnico vio ese día — y el cliente ya la firmó.
 */

// ── Configuración de ejes ───────────────────────────────────────────────────

export interface ConfiguracionExistente {
  readonly id: string;
  readonly nombre: string;
  readonly version: number;
  readonly vigente: boolean;
  readonly totalPosiciones: number;
}

/** Quién puede tocar la estructura de la flota. */
export function puedeGestionarFlota(rol: Rol): boolean {
  return rol === "administrador" || rol === "coordinador";
}

/** Solo el administrador define plantillas de eje: son estructura, no operación. */
export function puedeGestionarConfiguraciones(rol: Rol): boolean {
  return rol === "administrador";
}

export function validarConfiguracion(ejes: readonly DefinicionEje[]): Veredicto {
  if (ejes.length === 0) {
    return negar("SIN_EJES", "La configuración necesita al menos un eje");
  }
  if (!configuracionCoherente(ejes)) {
    return negar(
      "POSICIONES_INCOHERENTES",
      "Las posiciones deben numerarse de 1 en adelante, sin huecos ni repetidos",
    );
  }
  const numerosEje = ejes.map((e) => e.numero);
  if (new Set(numerosEje).size !== numerosEje.length) {
    return negar("EJES_REPETIDOS", "Hay dos ejes con el mismo número");
  }
  for (const e of ejes) {
    if (e.psiObjetivo != null && (e.psiObjetivo <= 0 || e.psiObjetivo > 400)) {
      return negar("PSI_FUERA_DE_RANGO", `El PSI objetivo del eje ${e.numero} no es posible`);
    }
    if (e.profundidadMinima != null && (e.profundidadMinima < 0 || e.profundidadMinima > 60)) {
      return negar(
        "PROFUNDIDAD_FUERA_DE_RANGO",
        `La profundidad mínima del eje ${e.numero} no es posible`,
      );
    }
  }
  return PERMITIDO;
}

/**
 * Una plantilla NO se edita: se crea una versión nueva.
 *
 * Esto no es purismo. Las órdenes guardan el id de la configuración que
 * usaron; si se editara en sitio, el diagrama de una orden cerrada cambiaría
 * retroactivamente y dejaría de corresponder con lo que el cliente firmó.
 */
export function siguienteVersion(anteriores: readonly ConfiguracionExistente[]): number {
  if (anteriores.length === 0) return 1;
  return Math.max(...anteriores.map((c) => c.version)) + 1;
}

export interface CambioConfiguracion {
  readonly anterior: ConfiguracionExistente;
  readonly ejesNuevos: readonly DefinicionEje[];
  readonly vehiculosQueLaUsan: number;
}

/**
 * Cambiar el número de posiciones de una plantilla que ya tiene vehículos es
 * un caso que hay que advertir: esos vehículos pasan a dibujarse distinto.
 * No se bloquea —puede ser una corrección legítima— pero debe ser consciente.
 */
export function evaluarNuevaVersion(c: CambioConfiguracion): {
  readonly veredicto: Veredicto;
  readonly requiereConfirmacion: boolean;
  readonly aviso?: string;
} {
  const validez = validarConfiguracion(c.ejesNuevos);
  if (!validez.permitido) return { veredicto: validez, requiereConfirmacion: false };

  const totalNuevo = c.ejesNuevos.reduce(
    (n, e) => n + e.posicionesIzquierda.length + e.posicionesDerecha.length,
    0,
  );

  if (totalNuevo !== c.anterior.totalPosiciones && c.vehiculosQueLaUsan > 0) {
    return {
      veredicto: PERMITIDO,
      requiereConfirmacion: true,
      aviso:
        `${c.vehiculosQueLaUsan} vehículo(s) usan esta configuración y pasarán de ` +
        `${c.anterior.totalPosiciones} a ${totalNuevo} posiciones. ` +
        `Las órdenes ya creadas conservan el diagrama que tenían.`,
    };
  }

  return { veredicto: PERMITIDO, requiereConfirmacion: false };
}

// ── Desactivación en cascada ────────────────────────────────────────────────

export interface EstadoUso {
  readonly ordenesAbiertas: number;
  readonly hijosActivos: number;
}

/**
 * Nada se borra: se desactiva. Pero no se puede desactivar algo con trabajo
 * en curso, porque dejaría órdenes apuntando a un cliente o vehículo que ya
 * no aparece en ningún selector y nadie podría cerrarlas.
 */
export function puedeDesactivar(
  entidad: "cliente" | "sede" | "vehiculo",
  uso: EstadoUso,
): Veredicto {
  if (uso.ordenesAbiertas > 0) {
    return negar(
      "TIENE_ORDENES_ABIERTAS",
      `No se puede deshabilitar: hay ${uso.ordenesAbiertas} orden(es) sin cerrar`,
    );
  }
  if (entidad !== "vehiculo" && uso.hijosActivos > 0) {
    const que = entidad === "cliente" ? "sedes" : "vehículos";
    return negar(
      "TIENE_HIJOS_ACTIVOS",
      `Primero deshabilita sus ${que} (${uso.hijosActivos} activos)`,
    );
  }
  return PERMITIDO;
}

// ── Coherencia de la jerarquía ──────────────────────────────────────────────

/**
 * El vehículo pertenece a la SEDE del cliente, no al cliente. Al crear una
 * orden se elige cliente → sede → vehículo, y cada eslabón debe pertenecer
 * al anterior. La base lo garantiza con llaves compuestas; esto permite dar
 * un mensaje útil antes de que el motor rechace.
 */
export interface CadenaFlota {
  readonly clienteIdDelVehiculo: string;
  readonly clienteIdElegido: string;
}

export function cadenaCoherente(c: CadenaFlota): Veredicto {
  if (c.clienteIdDelVehiculo !== c.clienteIdElegido) {
    return negar("VEHICULO_DE_OTRO_CLIENTE", "El vehículo no pertenece al cliente seleccionado");
  }
  return PERMITIDO;
}

/** El kilometraje no retrocede, salvo cambio de odómetro. */
export function evaluarKilometraje(
  nuevo: number,
  actual: number,
): { readonly veredicto: Veredicto; readonly requiereConfirmacion: boolean } {
  if (nuevo < 0) {
    return {
      veredicto: negar("KM_NEGATIVO", "El kilometraje no puede ser negativo"),
      requiereConfirmacion: false,
    };
  }
  if (nuevo < actual) {
    // Se avisa pero no se bloquea: cambiar el odómetro es real y frecuente
    // en flotas viejas.
    return { veredicto: PERMITIDO, requiereConfirmacion: true };
  }
  return { veredicto: PERMITIDO, requiereConfirmacion: false };
}
