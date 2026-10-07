import { evaluarTransicion, firmaVigente, type Rol, type Veredicto } from "@tiretrack/domain";
import type { OrdenLocal } from "../datos/repositorio";
import type { Diagrama } from "./diagrama";

/**
 * Envío de la orden a revisión.
 *
 * Es la acción menos reversible que hace el técnico: a partir de aquí no
 * puede editar y alguien más queda esperando. Por eso la pantalla muestra
 * **todo lo que falta y todo lo que va a pasar** antes de que toque el botón,
 * en vez de descubrirlo al volver al camión.
 */

export interface EstadoEnvio {
  readonly orden: OrdenLocal;
  readonly diagrama: Diagrama;
  readonly fotosSinSubir: number;
  readonly operacionesPendientes: number;
}

export type ClaseBloqueo = "impide" | "advierte";

export interface PuntoRevision {
  readonly clave: string;
  readonly cumplido: boolean;
  readonly clase: ClaseBloqueo;
  readonly texto: string;
  /** Qué hacer para resolverlo, cuando no es obvio. */
  readonly comoResolver?: string;
}

/**
 * Revisión previa al envío.
 *
 * Distingue lo que **impide** enviar de lo que solo **advierte**. Las
 * posiciones sin capturar advierten, no impiden: un camión puede llegar con
 * dos llantas desmontadas en el taller, y obligar a inventar mediciones para
 * poder cerrar sería peor que dejar constancia de que faltaron.
 */
export function revisarEnvio(e: EstadoEnvio): PuntoRevision[] {
  const puntos: PuntoRevision[] = [];
  const { orden, diagrama } = e;

  // ── Impiden ──
  const hayMediciones = diagrama.capturadas > 0;
  puntos.push({
    clave: "mediciones",
    cumplido: hayMediciones,
    clase: "impide",
    texto: hayMediciones
      ? `${diagrama.capturadas} de ${diagrama.totalPosiciones} posiciones capturadas`
      : "No hay ninguna posición capturada",
    ...(hayMediciones ? {} : { comoResolver: "Toca una posición en el diagrama para capturarla" }),
  });

  const conKilometraje = orden.kilometraje !== null;
  puntos.push({
    clave: "kilometraje",
    cumplido: conKilometraje,
    clase: "impide",
    texto: conKilometraje
      ? `Kilometraje: ${orden.kilometraje?.toLocaleString("es-CO")} km`
      : "Falta el kilometraje del vehículo",
  });

  const firmaOk = tieneFirmaVigente(orden);
  puntos.push({
    clave: "firma",
    cumplido: firmaOk,
    clase: "impide",
    texto: firmaOk
      ? `Firmada por ${orden.firmaNombre}`
      : orden.firmaNombre
        ? "La firma quedó invalidada porque la orden cambió"
        : "Falta la firma de quien recibe",
    ...(orden.firmaNombre && !firmaOk
      ? { comoResolver: "Vuelve a capturar la firma antes de enviar" }
      : {}),
  });

  // ── Advierten ──
  if (diagrama.faltantes.length > 0) {
    puntos.push({
      clave: "posiciones_faltantes",
      cumplido: false,
      clase: "advierte",
      texto: `Faltan ${diagrama.faltantes.length} posiciones: ${diagrama.faltantes.join(", ")}`,
      // Se ofrece registrar el motivo en vez de bloquear: un camión puede
      // llegar con llantas desmontadas y eso es información, no un olvido.
      comoResolver: "Si no se pudieron revisar, anótalo en los hallazgos",
    });
  }

  if (diagrama.conAlerta.length > 0) {
    puntos.push({
      clave: "alertas",
      cumplido: false,
      clase: "advierte",
      texto: `${diagrama.conAlerta.length} llanta(s) bajo el mínimo: ${diagrama.conAlerta.join(", ")}`,
      comoResolver: "Verifica que quedó registrado en los hallazgos",
    });
  }

  if (e.fotosSinSubir > 0) {
    puntos.push({
      clave: "fotos",
      cumplido: false,
      clase: "advierte",
      texto: `${e.fotosSinSubir} foto(s) sin subir`,
      comoResolver: "Se subirán solas cuando haya señal",
    });
  }

  if (!orden.hallazgos?.trim()) {
    puntos.push({
      clave: "hallazgos",
      cumplido: false,
      clase: "advierte",
      texto: "Sin hallazgos escritos",
      comoResolver: "Es lo primero que lee el cliente si objeta la orden",
    });
  }

  return puntos;
}

function tieneFirmaVigente(orden: OrdenLocal): boolean {
  if (!orden.firmaNombre) return false;
  return firmaVigente({
    versionContenido: orden.versionContenido,
    firma: {
      nombre: orden.firmaNombre,
      cedula: orden.firmaCedula ?? "",
      fecha: orden.firmaFechaHora ?? "",
      version: orden.firmaVersion ?? -1,
    },
  });
}

/**
 * Solo lo marcado como `impide` bloquea el envío.
 *
 * `usuarioId` no es decorativo: sin él habría que suponer que quien mira es
 * el técnico asignado, y esa suposición deja pasar a cualquiera.
 */
export function puedeEnviar(e: EstadoEnvio, rol: Rol, usuarioId: string): Veredicto {
  const bloqueos = revisarEnvio(e).filter((p) => p.clase === "impide" && !p.cumplido);
  if (bloqueos.length > 0) {
    return {
      permitido: false,
      codigo: "REQUISITOS_PENDIENTES",
      mensaje: bloqueos.map((b) => b.texto).join(" · "),
    };
  }

  // La máquina de estados tiene la última palabra: es la misma que valida el
  // servidor, y descubrir allí un rechazo ya sin señal sería peor.
  const contexto = {
    rol,
    esTecnicoAsignado: e.orden.tecnicoId === usuarioId,
    firmaVigente: tieneFirmaVigente(e.orden),
  };
  // Una orden que quedó programada se inicia al enviarla (el repositorio
  // encola los dos pasos): se validan los dos, en orden.
  if (e.orden.estado === "programada") {
    const iniciar = evaluarTransicion("programada", "en_proceso", contexto);
    if (!iniciar.permitido) return iniciar;
    return evaluarTransicion("en_proceso", "en_revision", contexto);
  }
  return evaluarTransicion(e.orden.estado as never, "en_revision", contexto);
}

export function advertenciasDe(e: EstadoEnvio): PuntoRevision[] {
  return revisarEnvio(e).filter((p) => p.clase === "advierte");
}

/**
 * Lo que va a pasar al enviar.
 *
 * Se muestra antes, no después: el técnico tiene que saber que pierde la
 * edición, porque si se da cuenta al volver al camión ya no puede corregir.
 */
export function consecuenciasDeEnviar(e: EstadoEnvio): string[] {
  const lista = [
    "Ya no podrás editar las mediciones",
    "El coordinador la revisará y puede devolvértela",
  ];

  if (e.operacionesPendientes > 0 || e.fotosSinSubir > 0) {
    // Sin esto, el técnico cree que envió y la orden sigue en el celular.
    lista.push("Se enviará cuando haya señal: por ahora queda en el dispositivo");
  }

  return lista;
}

/** Resumen corto para la cabecera de la pantalla de envío. */
export function resumenEnvio(e: EstadoEnvio): {
  capturadas: number;
  totales: number;
  completa: boolean;
  conAlerta: number;
} {
  return {
    capturadas: e.diagrama.capturadas,
    totales: e.diagrama.totalPosiciones,
    completa: e.diagrama.faltantes.length === 0,
    conAlerta: e.diagrama.conAlerta.length,
  };
}
