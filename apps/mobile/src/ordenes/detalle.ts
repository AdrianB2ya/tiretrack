import {
  firmaVigente,
  puedeEditarMediciones,
  type EstadoOrden,
  type Rol,
  type Veredicto,
} from "@tiretrack/domain";
import type { MedicionLocal, OrdenLocal } from "../datos/repositorio";

/**
 * Detalle de la orden.
 *
 * Decide qué puede hacer el técnico en cada momento y, cuando no puede,
 * **por qué**. Un botón deshabilitado sin explicación en campo termina en una
 * llamada al coordinador; la app debe decir qué falta.
 *
 * Las reglas de fondo vienen de @tiretrack/domain y ya están probadas: aquí
 * se traducen a lo que la pantalla necesita mostrar.
 */

export interface DetalleOrden {
  readonly orden: OrdenLocal;
  readonly vehiculoCodigo: string;
  readonly vehiculoPlaca: string | null;
  readonly clienteNombre: string;
  readonly sedeClienteNombre: string;
  readonly mediciones: readonly MedicionLocal[];
  readonly posicionesTotales: number;
  readonly fotosSinSubir: number;
}

export interface ContextoUsuario {
  readonly usuarioId: string;
  readonly rol: Rol;
}

// ── Estado de la firma ──────────────────────────────────────────────────────

export type EstadoFirma = "sin_firmar" | "vigente" | "invalidada";

export interface FirmaResumen {
  readonly estado: EstadoFirma;
  readonly nombre: string | null;
  readonly mensaje: string | null;
}

/**
 * La firma se ata a `versionContenido`. Cambiar de estado no la invalida;
 * editar una medición sí.
 */
export function resumirFirma(orden: OrdenLocal): FirmaResumen {
  if (!orden.firmaNombre) {
    return { estado: "sin_firmar", nombre: null, mensaje: null };
  }

  const vigente = firmaVigente({
    versionContenido: orden.versionContenido,
    firma: {
      nombre: orden.firmaNombre,
      cedula: orden.firmaCedula ?? "",
      fecha: "",
      version: orden.firmaVersion ?? -1,
    },
  });

  if (vigente) {
    return { estado: "vigente", nombre: orden.firmaNombre, mensaje: null };
  }

  return {
    estado: "invalidada",
    nombre: orden.firmaNombre,
    // El técnico necesita entender que no es un error suyo: la firma dejó de
    // amparar lo que quedó porque el contenido cambió después.
    mensaje:
      "La orden cambió después de firmarse. Hay que volver a capturar la firma antes de enviarla",
  };
}

// ── Qué falta para poder enviar ─────────────────────────────────────────────

export interface Requisito {
  readonly clave: string;
  readonly cumplido: boolean;
  readonly texto: string;
}

/**
 * Lista de requisitos para enviar a revisión.
 *
 * Se muestran todos, cumplidos y pendientes, no solo el primero que falla. El
 * técnico está en el patio y necesita saber **todo** lo que le falta antes de
 * guardar el celular, no descubrirlo de a uno.
 */
export function requisitosParaEnviar(d: DetalleOrden): Requisito[] {
  const firma = resumirFirma(d.orden);
  const capturadas = d.mediciones.length;

  return [
    {
      clave: "mediciones",
      cumplido: capturadas > 0,
      texto:
        capturadas === 0
          ? "Captura al menos una posición"
          : `${capturadas} de ${d.posicionesTotales} posiciones capturadas`,
    },
    {
      clave: "kilometraje",
      cumplido: d.orden.kilometraje !== null,
      texto: d.orden.kilometraje !== null ? "Kilometraje registrado" : "Falta el kilometraje",
    },
    {
      clave: "firma",
      cumplido: firma.estado === "vigente",
      texto:
        firma.estado === "vigente"
          ? `Firmada por ${firma.nombre}`
          : firma.estado === "invalidada"
            ? "La firma quedó invalidada: hay que recapturarla"
            : "Falta la firma de quien recibe",
    },
  ];
}

export function puedeEnviarARevision(d: DetalleOrden): Veredicto {
  const pendientes = requisitosParaEnviar(d).filter((r) => !r.cumplido);
  if (pendientes.length === 0) return { permitido: true };

  return {
    permitido: false,
    codigo: "REQUISITOS_PENDIENTES",
    mensaje: pendientes.map((r) => r.texto).join(" · "),
  };
}

// ── Acciones disponibles ────────────────────────────────────────────────────

export type AccionDetalle = "capturar" | "firmar" | "enviar" | "ver_informe";

export interface AccionDisponible {
  readonly accion: AccionDetalle;
  readonly habilitada: boolean;
  /** Por qué no se puede. Un botón gris sin explicación genera una llamada. */
  readonly motivo?: string;
}

export function accionesDisponibles(
  d: DetalleOrden,
  ctx: ContextoUsuario,
): AccionDisponible[] {
  const edicion = puedeEditarMediciones({
    estado: d.orden.estado as EstadoOrden,
    rol: ctx.rol,
    // De la orden y la sesión, nunca fijo: con "true" el coordinador veía
    // habilitado capturar en la orden de otro, y solo el técnico asignado
    // captura (si pudiera corregir, la firma dejaría de respaldar lo medido).
    // Es la misma clase de error de las tareas 3.7 y 4.4.
    esTecnicoAsignado: d.orden.tecnicoId === ctx.usuarioId,
    vistaCliente: false,
  });

  const firma = resumirFirma(d.orden);
  const envio = puedeEnviarARevision(d);

  return [
    {
      accion: "capturar",
      habilitada: edicion.permitido,
      ...(edicion.permitido ? {} : { motivo: edicion.mensaje ?? "" }),
    },
    {
      accion: "firmar",
      // Firmar con cero posiciones capturadas no ampara nada.
      habilitada: edicion.permitido && d.mediciones.length > 0,
      ...(edicion.permitido
        ? d.mediciones.length === 0
          ? { motivo: "Captura al menos una posición antes de firmar" }
          : firma.estado === "invalidada"
            ? { motivo: "Vuelve a firmar: la orden cambió" }
            : {}
        : { motivo: edicion.mensaje ?? "" }),
    },
    {
      accion: "enviar",
      habilitada: edicion.permitido && envio.permitido,
      ...(envio.permitido ? {} : { motivo: envio.mensaje ?? "" }),
    },
    {
      // El informe se puede ver siempre: es lectura.
      accion: "ver_informe",
      habilitada: d.mediciones.length > 0,
      ...(d.mediciones.length === 0 ? { motivo: "Todavía no hay mediciones" } : {}),
    },
  ];
}

// ── Aviso de trabajo sin enviar ─────────────────────────────────────────────

export interface EstadoSincronizacion {
  readonly alDia: boolean;
  readonly mensaje: string | null;
}

export function estadoSincronizacion(d: DetalleOrden): EstadoSincronizacion {
  if (d.orden.sincronizada && d.fotosSinSubir === 0) {
    return { alDia: true, mensaje: null };
  }

  const partes: string[] = [];
  if (!d.orden.sincronizada) partes.push("cambios");
  if (d.fotosSinSubir > 0) {
    partes.push(`${d.fotosSinSubir} foto${d.fotosSinSubir > 1 ? "s" : ""}`);
  }

  return {
    alDia: false,
    // Se dice qué falta por enviar, no solo que "hay algo": el técnico decide
    // si vale la pena buscar señal ahora o al terminar el turno.
    mensaje: `Sin enviar: ${partes.join(" y ")}`,
  };
}

// ── Posiciones del diagrama ─────────────────────────────────────────────────

export interface PosicionResumen {
  readonly numero: number;
  readonly capturada: boolean;
  readonly noIdentificada: boolean;
  readonly profundidad: number | null;
}

/**
 * Cruza las posiciones de la configuración con lo capturado.
 *
 * Las que faltan se devuelven igual, marcadas como no capturadas: el diagrama
 * tiene que mostrar los huecos, que es su razón de existir.
 */
export function resumirPosiciones(
  posicionesTotales: number,
  mediciones: readonly MedicionLocal[],
): PosicionResumen[] {
  const porNumero = new Map(mediciones.map((m) => [m.posicion, m]));

  return Array.from({ length: posicionesTotales }, (_, i) => {
    const numero = i + 1;
    const m = porNumero.get(numero);
    return {
      numero,
      capturada: m !== undefined,
      noIdentificada: m?.noIdentificada ?? false,
      profundidad: m?.profundidad ?? null,
    };
  });
}

export function posicionesFaltantes(posiciones: readonly PosicionResumen[]): number[] {
  return posiciones.filter((p) => !p.capturada).map((p) => p.numero);
}
