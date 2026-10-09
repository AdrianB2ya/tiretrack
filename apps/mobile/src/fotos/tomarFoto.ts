import { capturarFoto, type Camara, type Manipulador } from "./captura";

/**
 * Tomar una foto y dejarla adjunta a la orden o a una posición.
 *
 * Separado de la pantalla para probar las decisiones sin cámara: qué se le
 * dice al técnico en cada caso, y con qué nombre y tamaño se adjunta.
 */

export interface DestinoFoto {
  readonly ordenId: string;
  /** null: foto de la orden en general; con id: de esa posición. */
  readonly medicionId: string | null;
  readonly posicion: number | null;
}

export type ResultadoTomarFoto =
  | { tipo: "adjuntada"; id: string }
  | { tipo: "cancelada" }
  | { tipo: "aviso"; mensaje: string };

export interface DependenciasFoto {
  readonly camara: Camara;
  readonly manipulador: Manipulador;
  readonly adjuntar: (f: {
    ordenId: string;
    medicionId: string | null;
    uriLocal: string;
    nombre: string;
    tipoMime: "image/jpeg";
    tamanoBytes: number;
  }) => Promise<string>;
  readonly ahora?: () => Date;
}

export async function tomarYAdjuntar(
  deps: DependenciasFoto,
  destino: DestinoFoto,
): Promise<ResultadoTomarFoto> {
  const r = await capturarFoto(deps.camara, deps.manipulador);
  // Cancelar no es un error: el técnico decidió no tomarla.
  if (r.tipo === "cancelada") return { tipo: "cancelada" };
  if (r.tipo === "sin_permiso") {
    return {
      tipo: "aviso",
      mensaje: "Asistectire no tiene permiso para usar la cámara. Actívalo en Ajustes > Aplicaciones > Asistectire > Permisos.",
    };
  }
  if (r.tipo === "error") return { tipo: "aviso", mensaje: `No se pudo tomar la foto: ${r.mensaje}` };

  const marca = (deps.ahora ?? (() => new Date()))().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const nombre = destino.posicion !== null ? `posicion-${destino.posicion}-${marca}.jpg` : `orden-${marca}.jpg`;
  try {
    const id = await deps.adjuntar({
      ordenId: destino.ordenId,
      medicionId: destino.medicionId,
      uriLocal: r.imagen.uri,
      nombre,
      // La compresión entrega JPEG; si falló, la original de la cámara también lo es.
      tipoMime: "image/jpeg",
      tamanoBytes: r.imagen.tamanoBytes,
    });
    return { tipo: "adjuntada", id };
  } catch (e) {
    // La foto se tomó pero no se pudo guardar en el teléfono (tope de fotos,
    // disco lleno): se dice, para que no crea que quedó.
    return { tipo: "aviso", mensaje: `La foto no se guardó: ${(e as Error).message}` };
  }
}
