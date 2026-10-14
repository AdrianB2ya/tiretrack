/**
 * Elegir un CSV del teléfono y leerlo como texto (R12). Los módulos nativos
 * se importan de forma diferida, como la cámara: el resto se prueba en Node.
 *
 * Cancelar no es un error: devuelve `cancelado`.
 */
export type ArchivoElegido =
  | { ok: true; nombre: string; texto: string }
  | { ok: false; cancelado: true }
  | { ok: false; cancelado: false; mensaje: string };

export async function elegirCSV(): Promise<ArchivoElegido> {
  try {
    const selector = await import("expo-document-picker");
    const r = await selector.getDocumentAsync({
      type: ["text/csv", "text/comma-separated-values", "text/plain", "application/vnd.ms-excel"],
      copyToCacheDirectory: true,
    });
    if (r.canceled || !r.assets?.[0]) return { ok: false, cancelado: true };
    const sistema = await import("expo-file-system");
    const texto = await sistema.readAsStringAsync(r.assets[0].uri, { encoding: sistema.EncodingType.UTF8 });
    return { ok: true, nombre: r.assets[0].name, texto };
  } catch {
    return { ok: false, cancelado: false, mensaje: "No se pudo leer el archivo. Guárdalo en Excel como CSV y vuelve a intentarlo." };
  }
}
