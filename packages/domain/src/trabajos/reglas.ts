import { type Veredicto, PERMITIDO, negar } from "../tipos";
import { leerDOT, ANIOS_VIDA_DOT } from "../llanta/dot";
import { ocurrencia, proximaEjecucion, siguienteHabil, type Frecuencia } from "../tiempo/habiles";

/**
 * Trabajos programados: cierre por vencimiento, órdenes recurrentes y alertas.
 *
 * Todos comparten un principio: **un trabajo que corre solo debe ser
 * conservador y dejar rastro**. Nadie lo está mirando cuando actúa, así que
 * una decisión equivocada pasa inadvertida hasta que alguien reclama.
 */

// ── Cierre por vencimiento del plazo del cliente ────────────────────────────

export interface OrdenEnEspera {
  readonly id: string;
  readonly limiteCliente: string | null;
  readonly estado: string;
}

/**
 * Vencido el plazo, la orden cierra sola. El cierre queda marcado como
 * tácito: **nunca se disfraza de aprobación expresa**, porque el cliente
 * nunca dijo que estuviera de acuerdo.
 */
export function debeCerrarsePorVencimiento(o: OrdenEnEspera, hoy: string): Veredicto {
  if (o.estado !== "pendiente_cliente") {
    return negar("ESTADO_INVALIDO", "La orden no está esperando al cliente");
  }
  if (!o.limiteCliente) {
    return negar("SIN_PLAZO", "La orden no tiene plazo definido");
  }
  if (hoy < o.limiteCliente) {
    return negar("PLAZO_VIGENTE", "El plazo todavía no vence");
  }
  return PERMITIDO;
}

// ── Órdenes recurrentes ─────────────────────────────────────────────────────

export interface Programacion {
  readonly id: string;
  readonly vehiculoId: string;
  readonly frecuencia: Frecuencia;
  readonly cada: number;
  /** Ancla de la recurrencia: todas las fechas se cuentan desde aquí. */
  readonly inicio: string;
  readonly proxima: string;
  readonly activa: boolean;
}

export interface EstadoVehiculo {
  readonly activo: boolean;
  readonly tieneOrdenAbierta: boolean;
}

/** El técnico fijo de la programación (decisión del usuario, 2026-10-06). */
export interface EstadoTecnico {
  /** Activo y con rol de técnico. */
  readonly disponible: boolean;
  /** Sigue asignado a la sede de la programación. */
  readonly enSede: boolean;
}

/**
 * Decide si toca generar la orden de una programación.
 *
 * El caso que hay que evitar: el vehículo ya tiene una orden abierta de la
 * visita anterior, nadie la cerró, y el trabajo genera otra cada mes. En
 * tres meses hay cuatro órdenes abiertas del mismo camión y la bandeja del
 * coordinador es inservible.
 */
export function debeGenerarOrden(
  p: Programacion,
  vehiculo: EstadoVehiculo,
  tecnico: EstadoTecnico,
  hoy: string,
): Veredicto {
  if (!p.activa) return negar("INACTIVA", "La programación está deshabilitada");
  if (hoy < p.proxima) return negar("AUN_NO", "Todavía no toca");
  if (!vehiculo.activo) {
    return negar("VEHICULO_INACTIVO", "El vehículo está deshabilitado");
  }
  if (vehiculo.tieneOrdenAbierta) {
    // Se salta esta vuelta, no se cancela la programación: cuando cierren la
    // anterior, la siguiente se genera normalmente.
    return negar("ORDEN_ABIERTA", "El vehículo ya tiene una orden sin cerrar");
  }
  if (!tecnico.disponible || !tecnico.enSede) {
    // No se genera a nombre de alguien que ya no trabaja ahí: la orden
    // quedaría en la lista de nadie. Tampoco se avanza la fecha: cuando
    // corrijan el técnico, la visita se genera en la siguiente vuelta.
    return negar(
      "TECNICO_NO_DISPONIBLE",
      tecnico.disponible
        ? "El técnico ya no está asignado a esta sede: elige otro"
        : "El técnico está inactivo: elige otro",
    );
  }
  return PERMITIDO;
}

/** Saltar la vuelta avanza la fecha solo cuando esperar no cambiaría nada. */
export function avanzaAlSaltar(codigo: string | undefined): boolean {
  return codigo === "ORDEN_ABIERTA" || codigo === "VEHICULO_INACTIVO";
}

/**
 * Avanza la fecha de la próxima ejecución.
 *
 * Se calcula desde la fecha PROGRAMADA, no desde hoy. Si el trabajo no corrió
 * durante tres días —el servidor estuvo caído— la recurrencia mensual no debe
 * correrse tres días hacia adelante cada vez que eso pase.
 */
export function avanzarProxima(p: Programacion, hoy: string): string {
  // La primera ocurrencia —contada desde el inicio— posterior a la
  // programada Y a hoy. Si el trabajo no corrió en varios ciclos, salta hasta
  // el presente en vez de generar una orden por cada ciclo perdido: nadie
  // quiere seis órdenes de golpe.
  //
  // Contar desde el inicio, y no desde `proxima`, evita que un corrimiento
  // por fin de semana se arrastre a todas las fechas siguientes.
  for (let k = 1; k <= LIMITE_OCURRENCIAS; k++) {
    const f = ocurrencia(p.inicio, p.frecuencia, p.cada, k);
    if (f > p.proxima && f > hoy) return f;
  }
  // Más de 27 años de ciclos diarios: datos corruptos. Ante la duda, un
  // periodo después de hoy, que es lo menos sorprendente.
  return siguienteHabil(proximaEjecucion(hoy, p.frecuencia, p.cada));
}

const LIMITE_OCURRENCIAS = 10_000;

// ── Alertas de llanta ───────────────────────────────────────────────────────

export const SEVERIDADES = ["critica", "alta", "media"] as const;
export type Severidad = (typeof SEVERIDADES)[number];

export const MESES_AVISO_DOT = 6;

export interface LlantaParaRevisar {
  readonly ordenId: string;
  readonly vehiculoId: string;
  readonly posicion: number;
  readonly serial: string | null;
  readonly dot: string | null;
  readonly profundidad: number | null;
  readonly profundidadMinima: number | null;
}

export interface Alerta {
  readonly vehiculoId: string;
  readonly posicion: number;
  readonly serial: string | null;
  readonly tipo: "dot_vencido" | "dot_por_vencer" | "profundidad_baja";
  readonly severidad: Severidad;
  readonly mensaje: string;
}

/**
 * Evalúa una medición y devuelve las alertas que amerite.
 *
 * Una misma llanta puede disparar varias: estar vencida por DOT y además
 * bajo el mínimo de profundidad son dos motivos distintos para sacarla.
 */
export function evaluarAlertas(l: LlantaParaRevisar, hoy: Date): Alerta[] {
  const alertas: Alerta[] = [];
  const identificacion = l.serial ? `serial ${l.serial}` : `posición ${l.posicion}`;

  const dot = leerDOT(l.dot, hoy);
  if (dot?.vencida) {
    alertas.push({
      vehiculoId: l.vehiculoId,
      posicion: l.posicion,
      serial: l.serial,
      tipo: "dot_vencido",
      severidad: "critica",
      mensaje:
        `Llanta vencida en ${identificacion}: fabricada en ${dot.fabricacionTexto}, ` +
        `lleva ${dot.aniosCumplidos} años. El límite es ${ANIOS_VIDA_DOT}`,
    });
  } else if (dot && mesesHasta(dot.vencimiento, hoy) <= MESES_AVISO_DOT) {
    // Avisar con seis meses da tiempo a comprar y programar el cambio.
    alertas.push({
      vehiculoId: l.vehiculoId,
      posicion: l.posicion,
      serial: l.serial,
      tipo: "dot_por_vencer",
      severidad: "media",
      mensaje: `Llanta en ${identificacion} vence el ${dot.vencimiento}`,
    });
  }

  if (l.profundidad != null && l.profundidadMinima != null && l.profundidad < l.profundidadMinima) {
    alertas.push({
      vehiculoId: l.vehiculoId,
      posicion: l.posicion,
      serial: l.serial,
      tipo: "profundidad_baja",
      severidad: "critica",
      mensaje:
        `Profundidad de ${l.profundidad} bajo el mínimo del eje ` +
        `(${l.profundidadMinima}) en ${identificacion}`,
    });
  }

  return alertas;
}

function mesesHasta(fechaISO: string, desde: Date): number {
  const objetivo = new Date(`${fechaISO}T00:00:00.000Z`);
  const ms = objetivo.getTime() - desde.getTime();
  return ms / (30.44 * 24 * 60 * 60 * 1000);
}

/**
 * Una misma llanta aparece en cada orden donde se midió. Alertar por cada
 * medición llenaría la bandeja de repetidos: se conserva solo la más
 * reciente por vehículo y posición.
 */
export function deduplicarAlertas(alertas: readonly Alerta[]): Alerta[] {
  const vistas = new Map<string, Alerta>();
  for (const a of alertas) {
    const clave = `${a.vehiculoId}|${a.posicion}|${a.tipo}`;
    if (!vistas.has(clave)) vistas.set(clave, a);
  }
  return [...vistas.values()];
}

export function ordenarPorSeveridad(alertas: readonly Alerta[]): Alerta[] {
  const peso: Record<Severidad, number> = { critica: 0, alta: 1, media: 2 };
  return [...alertas].sort((a, b) => peso[a.severidad] - peso[b.severidad]);
}

// ── Limpieza de sesiones y tokens ───────────────────────────────────────────

export interface Caducable {
  readonly expiraEn: Date;
}

export function yaCaduco(c: Caducable, ahora: Date): boolean {
  return c.expiraEn.getTime() <= ahora.getTime();
}
