import { create } from "qrcode/lib/core/qrcode";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colores } from "./tokens";

/**
 * Matriz de un código QR: true = módulo oscuro. Corrección media (M), que
 * aguanta una pantalla con reflejo o rayada.
 */
export function matrizQR(texto: string): boolean[][] {
  const { modules } = create(texto, { errorCorrectionLevel: "M" });
  return Array.from({ length: modules.size }, (_, f) =>
    Array.from({ length: modules.size }, (_, c) => modules.get(f, c) === 1),
  );
}

/** Una sola ruta con un cuadrito por módulo oscuro: liviana de dibujar. */
export function rutaQR(matriz: readonly (readonly boolean[])[]): string {
  const partes: string[] = [];
  matriz.forEach((fila, f) => fila.forEach((oscuro, c) => {
    if (oscuro) partes.push(`M${c} ${f}h1v1h-1z`);
  }));
  return partes.join("");
}

/**
 * Código QR para leer con otra cámara. Siempre negro sobre blanco y con
 * margen (zona de silencio): invertido o pegado al borde, muchos lectores no
 * lo reconocen, aunque la app sea oscura.
 */
export function CodigoQR({ texto, tamano = 220, testID }: { texto: string; tamano?: number; testID?: string }) {
  const matriz = matrizQR(texto);
  const margen = 4;
  const lado = matriz.length + margen * 2;
  return (
    <View testID={testID} style={{ alignSelf: "center", backgroundColor: colores.blanco, padding: 0, borderRadius: 8 }}>
      <Svg width={tamano} height={tamano} viewBox={`${-margen} ${-margen} ${lado} ${lado}`}>
        <Path d={rutaQR(matriz)} fill="#000000" />
      </Svg>
    </View>
  );
}
