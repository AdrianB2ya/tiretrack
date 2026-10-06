/**
 * Guarda el CSV en el celular y abre la hoja de compartir del sistema
 * (correo, WhatsApp, Drive…). Los módulos nativos se importan de forma
 * diferida, como los de la cámara: así el resto corre en Node para probarse.
 *
 * El archivo va a la caché, no a documentos: es una copia para enviar; el
 * original está en el servidor y se puede volver a exportar.
 */
export async function compartirArchivo(nombre: string, contenido: string): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  try {
    const sistema = await import("expo-file-system");
    const compartir = await import("expo-sharing");
    if (!(await compartir.isAvailableAsync())) {
      return { ok: false, mensaje: "Este teléfono no permite compartir archivos" };
    }
    // El nombre lo arma el servidor; aun así no se le deja salir de la carpeta.
    const ruta = `${sistema.cacheDirectory ?? ""}${nombre.replace(/[^\w.-]/g, "_")}`;
    await sistema.writeAsStringAsync(ruta, contenido, { encoding: sistema.EncodingType.UTF8 });
    await compartir.shareAsync(ruta, { mimeType: "text/csv", dialogTitle: "Enviar informe", UTI: "public.comma-separated-values-text" });
    return { ok: true };
  } catch {
    return { ok: false, mensaje: "No se pudo guardar el archivo en el teléfono" };
  }
}

/**
 * Baja un archivo directo al disco del teléfono (caché), para `descargarArchivo`
 * del cliente HTTP. Importación diferida, como el resto del hardware.
 */
export function bajarACache(nombre: string) {
  return async (url: string, cabeceras: Record<string, string>): Promise<{ status: number; uri: string }> => {
    const sistema = await import("expo-file-system");
    const destino = `${sistema.cacheDirectory ?? ""}${nombre.replace(/[^\w.-]/g, "_")}`;
    const r = await sistema.downloadAsync(url, destino, { headers: cabeceras });
    return { status: r.status, uri: r.uri };
  };
}

/** Abre la hoja de compartir con un archivo que ya está en el teléfono. */
export async function compartirUri(uri: string, tipo: string): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  try {
    const compartir = await import("expo-sharing");
    if (!(await compartir.isAvailableAsync())) return { ok: false, mensaje: "Este teléfono no permite compartir archivos" };
    await compartir.shareAsync(uri, { mimeType: tipo, dialogTitle: "Enviar orden" });
    return { ok: true };
  } catch {
    return { ok: false, mensaje: "No se pudo abrir el archivo" };
  }
}
