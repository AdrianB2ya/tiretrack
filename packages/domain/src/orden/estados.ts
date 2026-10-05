import {
  type EstadoOrden,
  type Rol,
  type Veredicto,
  ESTADOS_ABIERTOS,
  PERMITIDO,
  negar,
} from "../tipos";

/**
 * Máquina de estados de la orden de servicio.
 *
 *   borrador → programada → en_proceso → en_revision → pendiente_cliente → cerrada
 *                                ↑______________|                     ↓
 *                          (devolución con motivo)                 anulada
 *
 * Las reglas de quién puede mover qué no son cosméticas: sostienen que la
 * firma del técnico respalde lo que él midió. Si el coordinador pudiera
 * editar mediciones en vez de devolver la orden, esa firma no ampararía nada.
 */

export interface ContextoTransicion {
  readonly rol: Rol;
  /** true si el usuario es el técnico asignado a la orden. */
  readonly esTecnicoAsignado: boolean;
  /** true si hay firma y corresponde a la versión actual de la orden. */
  readonly firmaVigente: boolean;
  /** Motivo aportado. Obligatorio en devoluciones, objeciones y anulaciones. */
  readonly motivo?: string | undefined;
  /** true cuando la transición la dispara el vencimiento del plazo. */
  readonly porVencimiento?: boolean;
}

type Regla = {
  readonly desde: EstadoOrden;
  readonly hacia: EstadoOrden;
  readonly evaluar: (c: ContextoTransicion) => Veredicto;
};

const esGestor = (rol: Rol) => rol === "coordinador" || rol === "administrador";

const conMotivo = (c: ContextoTransicion, codigo: string, mensaje: string): Veredicto =>
  c.motivo && c.motivo.trim().length > 0 ? PERMITIDO : negar(codigo, mensaje);

const REGLAS: readonly Regla[] = [
  {
    desde: "borrador",
    hacia: "programada",
    evaluar: (c) =>
      esGestor(c.rol) ? PERMITIDO : negar("SOLO_GESTOR", "Solo el coordinador puede programar"),
  },
  {
    // El técnico que crea una orden imprevista la arranca de inmediato.
    desde: "borrador",
    hacia: "en_proceso",
    evaluar: (c) =>
      c.esTecnicoAsignado
        ? PERMITIDO
        : negar("SOLO_ASIGNADO", "Solo el técnico asignado puede iniciarla"),
  },
  {
    desde: "programada",
    hacia: "en_proceso",
    evaluar: (c) =>
      c.esTecnicoAsignado || esGestor(c.rol)
        ? PERMITIDO
        : negar("SOLO_ASIGNADO", "Solo el técnico asignado puede iniciarla"),
  },
  {
    desde: "en_proceso",
    hacia: "en_revision",
    evaluar: (c) => {
      if (!c.esTecnicoAsignado) {
        return negar("SOLO_ASIGNADO", "Solo el técnico asignado puede enviarla a revisión");
      }
      // Sin firma no hay respaldo del servicio prestado.
      if (!c.firmaVigente) {
        return negar("SIN_FIRMA", "Falta la firma de quien recibe, o quedó invalidada");
      }
      return PERMITIDO;
    },
  },
  {
    // Devolución: el coordinador no corrige, devuelve con motivo.
    desde: "en_revision",
    hacia: "en_proceso",
    evaluar: (c) => {
      if (!esGestor(c.rol)) return negar("SOLO_GESTOR", "Solo el coordinador puede devolver");
      return conMotivo(c, "SIN_MOTIVO", "La devolución exige un motivo");
    },
  },
  {
    desde: "en_revision",
    hacia: "pendiente_cliente",
    evaluar: (c) => {
      if (!esGestor(c.rol)) return negar("SOLO_GESTOR", "Solo el coordinador puede aprobar");
      if (!c.firmaVigente) {
        return negar("FIRMA_INVALIDA", "La orden cambió después de firmarse: hay que refirmar");
      }
      return PERMITIDO;
    },
  },
  {
    // El cliente aprueba, el gestor cierra por vencimiento, o vence el plazo.
    desde: "pendiente_cliente",
    hacia: "cerrada",
    evaluar: (c) => {
      if (c.porVencimiento) return PERMITIDO;
      if (c.rol === "cliente") return PERMITIDO;
      if (esGestor(c.rol)) {
        return conMotivo(
          c,
          "SIN_MOTIVO",
          "Cerrar sin respuesta del cliente exige una justificación",
        );
      }
      return negar("SIN_PERMISO", "No puedes cerrar esta orden");
    },
  },
  {
    // Objeción del cliente: vuelve al técnico.
    desde: "pendiente_cliente",
    hacia: "en_proceso",
    evaluar: (c) => {
      if (c.rol !== "cliente") return negar("SOLO_CLIENTE", "Solo el cliente puede objetar");
      return conMotivo(c, "SIN_MOTIVO", "La objeción exige indicar qué no corresponde");
    },
  },
];

/** Anular está disponible desde cualquier estado abierto. */
const puedeAnular = (desde: EstadoOrden, c: ContextoTransicion): Veredicto => {
  if (!ESTADOS_ABIERTOS.includes(desde)) {
    return negar("ESTADO_FINAL", "La orden ya está cerrada o anulada");
  }
  if (!esGestor(c.rol)) return negar("SOLO_GESTOR", "Solo el coordinador puede anular");
  return conMotivo(c, "SIN_MOTIVO", "Anular exige un motivo");
};

/**
 * Evalúa si una transición es posible. Devuelve el veredicto con código de
 * error para que la interfaz explique por qué no, en vez de solo bloquear.
 */
export function evaluarTransicion(
  desde: EstadoOrden,
  hacia: EstadoOrden,
  contexto: ContextoTransicion,
): Veredicto {
  if (desde === hacia) return negar("SIN_CAMBIO", "La orden ya está en ese estado");
  if (hacia === "anulada") return puedeAnular(desde, contexto);

  const regla = REGLAS.find((r) => r.desde === desde && r.hacia === hacia);
  if (!regla) {
    return negar("TRANSICION_INVALIDA", `No se puede pasar de ${desde} a ${hacia}`);
  }
  return regla.evaluar(contexto);
}

/** Estados alcanzables desde uno dado, sin evaluar permisos. */
export function transicionesPosibles(desde: EstadoOrden): EstadoOrden[] {
  const destinos = REGLAS.filter((r) => r.desde === desde).map((r) => r.hacia);
  if (ESTADOS_ABIERTOS.includes(desde)) destinos.push("anulada");
  return [...new Set(destinos)];
}

export function esEstadoFinal(estado: EstadoOrden): boolean {
  return estado === "cerrada" || estado === "anulada";
}

export function estaAbierta(estado: EstadoOrden): boolean {
  return ESTADOS_ABIERTOS.includes(estado);
}
