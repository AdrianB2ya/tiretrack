/**
 * Solo el núcleo de qrcode (arma la matriz), sin sus dibujantes para Node o
 * navegador: en el teléfono se dibuja con react-native-svg.
 */
declare module "qrcode/lib/core/qrcode" {
  export function create(
    texto: string,
    opciones?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" },
  ): { modules: { size: number; data: Uint8Array; get(fila: number, columna: number): number } };
}
