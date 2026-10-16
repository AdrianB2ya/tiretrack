import {
  LIMITES_POR_DEFECTO,
  esRepuesto,
  nivelDeCambio,
  posicionRepuesto,
  repuestosDeLaOrden,
  umbralesDeCambio,
  type LimitesEmpresa,
  type NivelCambio,
  type Umbrales,
} from "@tiretrack/domain";
import type { PosicionEjeLocal } from "../datos/repositorio";
import type { MedicionLocal } from "../datos/repositorio";

/**
 * Disposición del diagrama de llantas.
 *
 * El diagrama es lo primero que el técnico abre al llegar al camión y lo que
 * usa para no saltarse una posición. Tiene que corresponder con lo que ve de
 * pie frente al vehículo: ejes de adelante hacia atrás, y dentro de cada eje,
 * izquierda a la izquierda.
 *
 * La lógica va aparte de la pantalla porque una posición mal ubicada hace que
 * el técnico mida la llanta equivocada, y eso no se detecta después.
 */

export type EstadoCasilla =
  | "vacia"
  | "capturada"
  | "no_identificada"
  | "alerta_profundidad";

export interface Casilla {
  readonly numero: number;
  readonly estado: EstadoCasilla;
  readonly esInterna: boolean;
  readonly profundidad: number | null;
  readonly profundidadMinima: number | null;
  readonly psiObjetivo: number | null;
  readonly tipoEje: string;
  /**
   * Límites de cambio de esta posición (R2): el mínimo del eje si lo tiene;
   * si no, los de la empresa. Opcional para casillas armadas a mano.
   */
  readonly umbrales?: Umbrales;
  /** Cambio inmediato o programar cambio, según la última medida. */
  readonly nivelCambio?: NivelCambio | null;
}

export interface FilaEje {
  readonly numero: number;
  readonly tipoEje: string;
  readonly izquierda: readonly Casilla[];
  readonly derecha: readonly Casilla[];
}

export interface Diagrama {
  readonly ejes: readonly FilaEje[];
  readonly totalPosiciones: number;
  readonly capturadas: number;
  readonly faltantes: readonly number[];
  readonly conAlerta: readonly number[];
  /**
   * Llantas de repuesto, fuera de los ejes: las que el vehículo recuerda y
   * las que se agregaron en esta orden. No cuentan en `totalPosiciones` ni
   * en `faltantes` (no son parte de la plantilla); van aparte.
   */
  readonly repuestos: readonly Casilla[];
  readonly repuestosFaltantes: readonly number[];
  /** Los límites con que se armó: los usa un repuesto recién agregado. */
  readonly limites?: LimitesEmpresa;
}

/**
 * La casilla de un repuesto (posición 101 en adelante). Sin PSI objetivo ni
 * mínimo propio: rigen los límites de la empresa. Para el catálogo es
 * "multiuso" (un diseño creado aquí no es de ningún eje).
 */
export function casillaRepuesto(
  posicion: number,
  medicion: MedicionLocal | undefined,
  limites: LimitesEmpresa = LIMITES_POR_DEFECTO,
): Casilla {
  return armarCasilla(
    { configuracionEjeId: "", numero: posicion, eje: 0, lado: "izquierdo", esInterna: false, tipoEje: "multiuso", psiObjetivo: null, profundidadMinima: null },
    medicion,
    limites,
  );
}

/**
 * Construye el diagrama cruzando la configuración con lo capturado.
 *
 * Las posiciones sin medición **se devuelven igual**, vacías: mostrar los
 * huecos es la razón de existir del diagrama.
 */
export function construirDiagrama(
  posiciones: readonly PosicionEjeLocal[],
  mediciones: readonly MedicionLocal[],
  limites: LimitesEmpresa = LIMITES_POR_DEFECTO,
  /** Repuestos que el vehículo recuerda de la última inspección. */
  repuestosVehiculo = 0,
): Diagrama {
  const porNumero = new Map(mediciones.map((m) => [m.posicion, m]));
  const porEje = new Map<number, PosicionEjeLocal[]>();

  for (const p of posiciones) {
    const lista = porEje.get(p.eje) ?? [];
    lista.push(p);
    porEje.set(p.eje, lista);
  }

  const ejes: FilaEje[] = [...porEje.entries()]
    // De adelante hacia atrás, como se ve el camión desde el frente.
    .sort(([a], [b]) => a - b)
    .map(([numero, delEje]) => {
      const casillaDe = (p: PosicionEjeLocal): Casilla =>
        armarCasilla(p, porNumero.get(p.numero), limites);

      return {
        numero,
        tipoEje: delEje[0]?.tipoEje ?? "multiuso",
        // Por la izquierda, la externa va primero: es la que el técnico ve
        // al acercarse por ese lado.
        izquierda: delEje
          .filter((p) => p.lado === "izquierdo")
          .sort((a, b) => a.numero - b.numero)
          .map(casillaDe),
        // Por la derecha, la interna va primero para que el orden visual sea
        // simétrico: exterior · interior || interior · exterior.
        derecha: delEje
          .filter((p) => p.lado === "derecho")
          .sort((a, b) => a.numero - b.numero)
          .map(casillaDe),
      };
    });

  const todas = ejes.flatMap((e) => [...e.izquierda, ...e.derecha]);
  const cuantos = repuestosDeLaOrden(repuestosVehiculo, mediciones.map((m) => m.posicion));
  const repuestos = Array.from({ length: cuantos }, (_, i) => {
    const p = posicionRepuesto(i + 1);
    return casillaRepuesto(p, porNumero.get(p), limites);
  });

  return {
    limites,
    repuestos,
    repuestosFaltantes: repuestos.filter((c) => c.estado === "vacia").map((c) => c.numero),
    ejes,
    totalPosiciones: todas.length,
    capturadas: todas.filter((c) => c.estado !== "vacia").length,
    faltantes: todas.filter((c) => c.estado === "vacia").map((c) => c.numero),
    // Un repuesto para cambio inmediato también se avisa: es la llanta que
    // salvaría el viaje si otra se revienta.
    conAlerta: [...todas, ...repuestos].filter((c) => c.estado === "alerta_profundidad").map((c) => c.numero),
  };
}

function armarCasilla(p: PosicionEjeLocal, m: MedicionLocal | undefined, limites: LimitesEmpresa): Casilla {
  const umbrales = umbralesDeCambio(p.profundidadMinima, limites);
  const base = {
    numero: p.numero,
    esInterna: p.esInterna,
    profundidadMinima: p.profundidadMinima,
    psiObjetivo: p.psiObjetivo,
    tipoEje: p.tipoEje,
    umbrales,
  };

  if (!m) return { ...base, estado: "vacia", profundidad: null, nivelCambio: null };

  // Una llanta para cambio inmediato se marca aunque esté capturada: el
  // técnico tiene que verla al mirar el diagrama, no al abrir la posición.
  // El límite es el del eje, o el de la empresa si el eje no lo tiene (R2).
  const nivelCambio = nivelDeCambio(m.profundidad, umbrales);

  if (nivelCambio === "cambio_inmediato") {
    return { ...base, estado: "alerta_profundidad", profundidad: m.profundidad, nivelCambio };
  }
  if (m.noIdentificada) {
    return { ...base, estado: "no_identificada", profundidad: m.profundidad, nivelCambio };
  }
  return { ...base, estado: "capturada", profundidad: m.profundidad, nivelCambio };
}

/**
 * Siguiente posición sin capturar.
 *
 * El técnico captura de corrido: al guardar una posición la app debe llevarlo
 * a la siguiente sin obligarlo a volver al diagrama y buscarla. Con 22
 * posiciones eso son 22 vueltas evitadas.
 */
export function siguienteSinCapturar(
  diagrama: Diagrama,
  desde: number,
): number | null {
  // Los repuestos van al final, después de los ejes.
  const todos = [...diagrama.faltantes, ...diagrama.repuestosFaltantes];
  const posteriores = todos.filter((n) => n > desde);
  if (posteriores.length > 0) return posteriores[0] ?? null;
  // Al llegar al final, se vuelve al principio por si dejó huecos atrás.
  return todos[0] ?? null;
}

/** Posiciones del mismo eje, para copiar lo capturado en una hermana. */
export function hermanasDe(diagrama: Diagrama, numero: number): number[] {
  const eje = diagrama.ejes.find((e) =>
    [...e.izquierda, ...e.derecha].some((c) => c.numero === numero),
  );
  if (!eje) return [];
  return [...eje.izquierda, ...eje.derecha]
    .map((c) => c.numero)
    .filter((n) => n !== numero);
}

/**
 * Hermana ya capturada más cercana, para ofrecer "copiar de la anterior".
 * Las llantas de un mismo eje suelen ser idénticas.
 */
export function hermanaCapturada(diagrama: Diagrama, numero: number): number | null {
  const eje = diagrama.ejes.find((e) =>
    [...e.izquierda, ...e.derecha].some((c) => c.numero === numero),
  );
  if (!eje) return null;

  const candidata = [...eje.izquierda, ...eje.derecha]
    .filter((c) => c.numero !== numero && c.estado !== "vacia" && c.estado !== "no_identificada")
    .sort((a, b) => Math.abs(a.numero - numero) - Math.abs(b.numero - numero))[0];

  return candidata?.numero ?? null;
}

/**
 * La casilla de una posición: de un eje, un repuesto ya en la orden, o el
 * repuesto siguiente que el técnico está agregando. Otro número no existe.
 */
export function buscarCasilla(diagrama: Diagrama, posicion: number): Casilla | null {
  const deEje = diagrama.ejes.flatMap((e) => [...e.izquierda, ...e.derecha]).find((c) => c.numero === posicion);
  if (deEje) return deEje;
  const repuesto = diagrama.repuestos.find((c) => c.numero === posicion);
  if (repuesto) return repuesto;
  if (posicion === posicionRepuesto(diagrama.repuestos.length + 1) && esRepuesto(posicion)) {
    return casillaRepuesto(posicion, undefined, diagrama.limites);
  }
  return null;
}

export function estaCompleto(diagrama: Diagrama): boolean {
  return diagrama.totalPosiciones > 0 && diagrama.faltantes.length === 0;
}
