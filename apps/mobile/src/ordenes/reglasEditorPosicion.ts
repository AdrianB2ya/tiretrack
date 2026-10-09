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
  /**
   * Una sola profundidad: la de una medición anterior a las tres medidas. Se
   * conserva si no se mide nada nuevo, para no borrarla al corregir.
   */
  profundidad: number | null;
  /** Exterior, centro, interior. */
  profundidades: TresMedidas;
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
  profundidades: TresMedidas;
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
    profundidades: sinMedidas(),
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
import {
  ETIQUETA_PUNTO_PROFUNDIDAD,
  PUNTOS_PROFUNDIDAD,
  profundidadDeReferencia,
  puntosSinMedir,
  type PuntoProfundidad,
} from "@tiretrack/domain";

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
    profundidades: sinMedidas(),
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
    profundidades: { ...sinMedidas(), ...(m.profundidades ?? {}) },
    observaciones: m.observaciones,
    noIdentificada: m.noIdentificada,
    motivoNoId: m.motivoNoId as BorradorMedicion["motivoNoId"],
    servicios: [...m.servicios],
    desmontada: m.desmontada
      ? { ...m.desmontada, profundidades: { ...sinMedidas(), ...(m.desmontada.profundidades ?? {}) }, traidaDe: null }
      : null,
  };
}

export type TresMedidas = Record<PuntoProfundidad, number | null>;

export function sinMedidas(): TresMedidas {
  return { exterior: null, centro: null, interior: null };
}

/**
 * La profundidad de la llanta: la mínima de las tres medidas. Sin ninguna,
 * la única de una medición anterior (si la había).
 */
export function profundidadDelBorrador(b: { profundidad: number | null; profundidades: TresMedidas }): number | null {
  return profundidadDeReferencia(b.profundidades) ?? b.profundidad;
}

/** Nombre del campo de aviso de cada medida: `profExterior`, `desProfCentro`… */
export function campoMedida(punto: PuntoProfundidad, desmontada = false): string {
  const p = punto.charAt(0).toUpperCase() + punto.slice(1);
  return desmontada ? `desProf${p}` : `prof${p}`;
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

  // ── Profundidad: tres puntos de la banda ──
  for (const punto of PUNTOS_PROFUNDIDAD) {
    const v = b.profundidades[punto];
    if (v === null) continue;
    if (v < 0) {
      avisos.push({ campo: campoMedida(punto), severidad: "error", mensaje: "No puede ser negativa" });
    } else if (v > 30) {
      // Rara, pero una llanta de cargador puede tenerla. Se avisa.
      avisos.push({ campo: campoMedida(punto), severidad: "advertencia", mensaje: `${v} mm es inusual. ¿Seguro?` });
    }
  }
  // La llanta se juzga por su punto más gastado: la mínima contra el mínimo del eje.
  const minima = profundidadDelBorrador(b);
  if (minima !== null && minima >= 0 && casilla.profundidadMinima !== null && minima < casilla.profundidadMinima) {
    avisos.push({
      campo: "profundidad",
      severidad: "advertencia",
      mensaje: `Bajo el mínimo del eje (${casilla.profundidadMinima} mm)`,
    });
  }
  // Basta una medida (decisión del usuario): lo que falta se dice, no bloquea.
  const faltan = puntosSinMedir(b.profundidades);
  if (faltan.length > 0 && faltan.length < PUNTOS_PROFUNDIDAD.length) {
    avisos.push({
      campo: "profundidad",
      severidad: "informacion",
      mensaje: `Sin medir: ${faltan.map((p) => ETIQUETA_PUNTO_PROFUNDIDAD[p].toLowerCase()).join(" y ")}`,
    });
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
    for (const punto of PUNTOS_PROFUNDIDAD) {
      const v = d.profundidades[punto];
      if (v !== null && v < 0) {
        avisos.push({ campo: campoMedida(punto, true), severidad: "error", mensaje: "La profundidad de la desmontada no puede ser negativa" });
      }
    }
    // Se avisa, no se bloquea: a veces el destino se decide después.
    if (!d.destino) {
      avisos.push({ campo: "desDestino", severidad: "advertencia", mensaje: "Indica a dónde va la llanta desmontada" });
    }
    if (profundidadDelBorrador(d) === null) {
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
    profundidadDelBorrador(b) !== null ||
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
