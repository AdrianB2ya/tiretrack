import { SinConexion, UrlVencida, type TransporteDeFotos } from "./subidor";

/**
 * Subida de los bytes de la foto a la URL firmada.
 *
 * El SubidorFotos estaba listo desde la tarea 6.5 sin un transporte real:
 * ninguna foto salía del celular. Lo que decide —qué significa cada
 * respuesta— está separado y probado; la llamada al dispositivo es mecánica.
 */

export type ResultadoHttp = { tipo: "ok" } | { tipo: "url_vencida" } | { tipo: "error"; mensaje: string };

/**
 * Lo que significa la respuesta del almacenamiento.
 *
 * Una URL firmada vencida responde 403 en S3 y R2: se pide otra en vez de
 * reintentar con la misma, que fallaría igual.
 */
export function interpretarRespuesta(status: number): ResultadoHttp {
  if (status >= 200 && status < 300) return { tipo: "ok" };
  if (status === 403) return { tipo: "url_vencida" };
  return { tipo: "error", mensaje: `El almacenamiento respondió ${status}` };
}

/** Lo mínimo del dispositivo que hace falta: subir un archivo local por PUT. */
export type SubirArchivo = (url: string, uriLocal: string, tipoMime: string) => Promise<{ status: number }>;

export function crearTransporte(subir: SubirArchivo): TransporteDeFotos {
  return {
    async subir({ uriLocal, url, tipoMime }) {
      let status: number;
      try {
        status = (await subir(url, uriLocal, tipoMime)).status;
      } catch (e) {
        // Si no hubo respuesta, fue la red: se reintenta más tarde.
        throw new SinConexion((e as Error).message);
      }
      const r = interpretarRespuesta(status);
      if (r.tipo === "url_vencida") throw new UrlVencida();
      if (r.tipo === "error") throw new Error(r.mensaje);
    },
  };
}

/**
 * Transporte del dispositivo, con expo-file-system: sube el archivo desde el
 * disco sin cargarlo entero en memoria. Importación diferida, como la cámara:
 * así el resto corre en Node.
 */
export const transporteDelDispositivo: TransporteDeFotos = crearTransporte(async (url, uriLocal, tipoMime) => {
  const fs = (await import("expo-file-system")) as unknown as {
    uploadAsync: (
      url: string,
      uri: string,
      opciones: { httpMethod: "PUT"; uploadType: number; headers: Record<string, string> },
    ) => Promise<{ status: number }>;
    FileSystemUploadType: { BINARY_CONTENT: number };
  };
  return fs.uploadAsync(url, uriLocal, {
    httpMethod: "PUT",
    uploadType: fs.FileSystemUploadType.BINARY_CONTENT,
    headers: { "Content-Type": tipoMime },
  });
});
