import { calcularDesgaste, leerDOT, presionFueraDeRango, type Veredicto } from "@tiretrack/domain";
import type { Casilla } from "./diagrama";
import type { MedicionLocal } from "../datos/repositorio";

/**
 * Editor de una posición de llanta.
 *
 * Es la pantalla donde el técnico pasa el noventa por ciento del tiempo y la
 * que decide si el sistema se usa o se finge usar. Dos principios la
 * gobiernan:
 *
 * 1. **Nada obligatorio que el técnico no pueda saber.** Si una llanta está
 *    montada del revés y no se ve el serial, exigirlo lo empuja a inventarlo,
 *    y un dato inventado es peor que uno ausente.
 * 2. **Se avisa, no se bloquea.** Una profundidad de 25 mm probablemente sea
 *    un error de dedo, pero también puede ser una llanta de cargador. El
 *    técnico está frente a la llanta; la app no.
 */

export interface BorradorMedicion {
  posicion: number;
  marcaId: string | null;
  disenoId: string | null;
  medida: string | null;
  numCalor: string | null;
  serial: string | null;
  dot: string | null;
  estadoLlanta: string | null;
  numParche: string | null;
  tipoParcheId: string | null;
  psiEncontrada: number | null;
  psiCalibrado: number | null;
  profundidad: number | null;
  observaciones: string | null;
  noIdentificada: boolean;
  motivoNoId: string | null;
  servicios: string[];
  /** La llanta que SALE de la posición, si se cambió. null: no se cambió. */
  desmontada: DesmontadaBorrador | null;
}

/**
 * La llanta que sale. Su identidad se trae de la última orden que midió esta
 * posición —regla del negocio: "se autocompleta, no se escribe a mano"—; lo
 * que solo se sabe al retirarla (profundidad, destino) lo anota el técnico.
 */
export interface DesmontadaBorrador {
  posicionOrigen: number | null;
  marcaId: string | null;
  disenoId: string | null;
  medida: string | null;
  numCalor: string | null;
  serial: string | null;
  dot: string | null;
  profundidad: number | null;
  destino: string | null;
  detalle: string | null;
  /** Fecha de la orden de donde se trajo la identidad, para decirlo en pantalla. */
  traidaDe: string | null;
}

/**
 * La desmontada a partir de la llanta que estaba (última orden de esa
 * posición). La profundidad NO se copia: la de entonces no es la de hoy, y
 * copiarla sería fabricar el dato del retiro.
 */
export function desmontadaDesde(anterior: MedicionLocal | null, posicion: number, fechaAnterior: string | null = null): DesmontadaBorrador {
  return {
    posicionOrigen: posicion,
    marcaId: anterior?.marcaId ?? null,
    disenoId: anterior?.disenoId ?? null,
    medida: anterior?.medida ?? null,
    numCalor: anterior?.numCalor ?? null,
    serial: anterior?.serial ?? null,
    dot: anterior?.dot ?? null,
    profundidad: null,
    destino: null,
    detalle: null,
    traidaDe: anterior ? fechaAnterior : null,
  };
}

/** Marcar "Montaje" significa que entró una llanta: la anterior salió. */
export const SERVICIO_MONTAJE = "MONT";

/**
 * Los vocabularios se IMPORTAN del contrato y del dominio, no se redeclaran.
 *
 * Esta pantalla tenía su propia lista de motivos ("Llanta interna sin
 * acceso"…) mientras el servidor esperaba códigos ("interna"…). Toda llanta
 * no identificada habría sido rechazada al sincronizar. Aquí solo vive la
 * etiqueta que se MUESTRA; el valor que viaja es el código del contrato.
 */
export { MOTIVOS_NO_IDENTIFICADA } from "@tiretrack/contracts";
export { ESTADOS_LLANTA } from "@tiretrack/domain";

import type { MOTIVOS_NO_IDENTIFICADA as Motivos } from "@tiretrack/contracts";

export const ETIQUETA_MOTIVO: Record<(typeof Motivos)[number], string> = {
  flanco_borrado: "Marcación borrada",
  interna: "Llanta interna sin acceso",
  sucia: "Demasiado sucia para leerla",
  danada: "Flanco dañado",
  reencauche_sin_marcacion: "Reencauche sin marcación",
  otro: "Otro motivo",
};

/** Borrador vacío, con lo que se puede precargar de la posición. */
export function borradorNuevo(casilla: Casilla): BorradorMedicion {
  return {
    posicion: casilla.numero,
    marcaId: null,
    disenoId: null,
    medida: null,
    numCalor: null,
    serial: null,
    dot: null,
    estadoLlanta: null,
    numParche: null,
    tipoParcheId: null,
    psiEncontrada: null,
    // El PSI objetivo del eje se precarga como calibrado: es el valor al que
    // el técnico va a dejar la llanta en la gran mayoría de los casos.
    psiCalibrado: casilla.psiObjetivo,
    profundidad: null,
    observaciones: null,
    noIdentificada: false,
    motivoNoId: null,
    servicios: [],
    desmontada: null,
  };
}

export function borradorDesde(m: MedicionLocal): BorradorMedicion {
  return {
    posicion: m.posicion,
    marcaId: m.marcaId,
    disenoId: m.disenoId,
    medida: m.medida,
    numCalor: m.numCalor,
    serial: m.serial,
    dot: m.dot,
    estadoLlanta: m.estadoLlanta,
    numParche: null,
    tipoParcheId: null,
    psiEncontrada: m.psiEncontrada,
    psiCalibrado: m.psiCalibrado,
    profundidad: m.profundidad,
    observaciones: m.observaciones,
    noIdentificada: m.noIdentificada,
    motivoNoId: m.motivoNoId as BorradorMedicion["motivoNoId"],
    servicios: [...m.servicios],
    desmontada: m.desmontada ? { ...m.desmontada, traidaDe: null } : null,
  };
}

/**
 * Copia los datos de identificación de una hermana del mismo eje.
 *
 * Se copia la llanta —marca, diseño, medida— pero **nunca las mediciones**:
 * profundidad, presión y serial son propias de cada llanta. Copiarlas sería
 * fabricar datos.
 */
export function copiarDeHermana(
  destino: BorradorMedicion,
  origen: MedicionLocal,
): BorradorMedicion {
  return {
    ...destino,
    marcaId: origen.marcaId,
    disenoId: origen.disenoId,
    medida: origen.medida,
  };
}

// ── Avisos ──────────────────────────────────────────────────────────────────

export type Severidad = "error" | "advertencia" | "informacion";

export interface AvisoCampo {
  readonly campo: string;
  readonly severidad: Severidad;
  readonly mensaje: string;
}

/**
 * Revisa el borrador y devuelve avisos.
 *
 * Solo las cosas imposibles son `error`; lo raro pero posible es
 * `advertencia`. La diferencia decide si el técnico puede guardar o no.
 */
export function revisar(
  b: BorradorMedicion,
  casilla: Casilla,
  hoy = new Date(),
): AvisoCampo[] {
  const avisos: AvisoCampo[] = [];

  // ── Identificación ──
  if (!b.noIdentificada && !b.serial?.trim()) {
    avisos.push({
      campo: "serial",
      severidad: "advertencia",
      mensaje: "Sin serial. Si no se puede leer, márcala como no identificada",
    });
  }
  if (b.noIdentificada && !b.motivoNoId) {
    // El motivo importa: "llanta interna sin acceso" es información de flota,
    // no un descuido.
    avisos.push({
      campo: "motivoNoId",
      severidad: "error",
      mensaje: "Indica por qué no se pudo identificar",
    });
  }

  // ── DOT ──
  if (b.dot?.trim()) {
    const leido = leerDOT(b.dot, hoy);
    if (!leido) {
      avisos.push({
        campo: "dot",
        severidad: "error",
        mensaje: "El DOT son 4 dígitos: semana y año. Ejemplo: 3624",
      });
    } else if (leido.vencida) {
      avisos.push({
        campo: "dot",
        severidad: "advertencia",
        mensaje: `Llanta vencida: fabricada en ${leido.fabricacionTexto}`,
      });
    }
  }

  // ── Profundidad ──
  if (b.profundidad !== null) {
    if (b.profundidad < 0) {
      avisos.push({ campo: "profundidad", severidad: "error", mensaje: "No puede ser negativa" });
    } else if (b.profundidad > 30) {
      // Rara, pero una llanta de cargador puede tenerla. Se avisa.
      avisos.push({
        campo: "profundidad",
        severidad: "advertencia",
        mensaje: `${b.profundidad} mm es inusual. ¿Seguro?`,
      });
    } else if (casilla.profundidadMinima !== null && b.profundidad < casilla.profundidadMinima) {
      avisos.push({
        campo: "profundidad",
        severidad: "advertencia",
        mensaje: `Bajo el mínimo del eje (${casilla.profundidadMinima} mm)`,
      });
    }
  }

  // ── Presión ──
  for (const [campo, valor] of [
    ["psiEncontrada", b.psiEncontrada],
    ["psiCalibrado", b.psiCalibrado],
  ] as const) {
    if (valor === null) continue;
    if (valor < 0 || valor > 400) {
      avisos.push({ campo, severidad: "error", mensaje: "Presión fuera de rango posible" });
    }
  }

  if (b.psiEncontrada !== null && casilla.psiObjetivo !== null) {
    // La tolerancia la define el dominio, no esta pantalla: es la misma
    // regla con la que el informe marca las presiones fuera de rango.
    if (presionFueraDeRango(b.psiEncontrada, casilla.psiObjetivo)) {
      const signo = b.psiEncontrada < casilla.psiObjetivo ? "baja" : "alta";
      avisos.push({
        campo: "psiEncontrada",
        severidad: "informacion",
        mensaje: `Presión ${signo} respecto al objetivo (${casilla.psiObjetivo} PSI)`,
      });
    }
  }

  // ── Parche ──
  if (b.numParche?.trim() && !b.tipoParcheId) {
    avisos.push({ campo: "tipoParcheId", severidad: "advertencia", mensaje: "Falta el tipo de parche" });
  }

  // ── Llanta desmontada ──
  const d = b.desmontada;
  if (d) {
    if (d.dot?.trim() && !leerDOT(d.dot, hoy)) {
      avisos.push({ campo: "desDot", severidad: "error", mensaje: "DOT de la desmontada inválido: son 4 dígitos, semana y año" });
    }
    if (d.profundidad !== null && d.profundidad < 0) {
      avisos.push({ campo: "desProfundidad", severidad: "error", mensaje: "La profundidad de la desmontada no puede ser negativa" });
    }
    // Se avisa, no se bloquea: a veces el destino se decide después.
    if (!d.destino) {
      avisos.push({ campo: "desDestino", severidad: "advertencia", mensaje: "Indica a dónde va la llanta desmontada" });
    }
    if (d.profundidad === null) {
      avisos.push({ campo: "desProfundidad", severidad: "advertencia", mensaje: "Sin profundidad de la desmontada: es la que dice cuánto duró" });
    }
  }

  return avisos;
}

/**
 * Si se puede guardar.
 *
 * Solo los errores bloquean. El técnico está frente a la llanta y la app no:
 * bloquear por algo raro pero posible lo obliga a falsear el dato para poder
 * continuar.
 */
export function puedeGuardar(avisos: readonly AvisoCampo[]): Veredicto {
  const errores = avisos.filter((a) => a.severidad === "error");
  if (errores.length === 0) return { permitido: true };
  return {
    permitido: false,
    codigo: "DATOS_INVALIDOS",
    mensaje: errores.map((e) => e.mensaje).join(" · "),
  };
}

/** Un borrador sin nada capturado no se guarda: sería una fila vacía. */
export function tieneContenido(b: BorradorMedicion): boolean {
  return (
    b.noIdentificada ||
    b.serial !== null ||
    b.profundidad !== null ||
    b.psiEncontrada !== null ||
    b.marcaId !== null ||
    b.servicios.length > 0
  );
}

/**
 * Avisos que conviene confirmar antes de guardar.
 *
 * Las advertencias no bloquean, pero mostrarlas una vez antes de guardar
 * atrapa el error de dedo sin estorbar cuando el dato es correcto.
 */
export function advertenciasParaConfirmar(avisos: readonly AvisoCampo[]): AvisoCampo[] {
  return avisos.filter((a) => a.severidad === "advertencia");
}

/** Desgaste respecto a la profundidad de fábrica de esa medida. */
export function desgasteRespectoAFabrica(
  profundidad: number | null,
  profundidadOriginal: number | null,
): { porcentaje: number; restante: number } | null {
  if (profundidad === null || profundidadOriginal === null || profundidadOriginal <= 0) {
    return null;
  }
  // El cálculo vive en el dominio: el informe y la app deben coincidir.
  const porcentaje = calcularDesgaste(profundidad, profundidadOriginal);
  if (porcentaje === null) return null;
  return { porcentaje, restante: Number(profundidad.toFixed(1)) };
}
