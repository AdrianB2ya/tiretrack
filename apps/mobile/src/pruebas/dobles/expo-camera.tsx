import { View } from "react-native";

/**
 * Doble de `expo-camera` para las pruebas (R15). La librería real trae
 * módulos nativos; aquí la cámara es una caja vacía y la prueba "muestra" un
 * código con `mostrarCodigo`. El escaneo real se valida en el teléfono; lo
 * que se hace con lo leído está probado.
 */

let alLeer: ((r: { data: string }) => void) | undefined;

/** Simula que la cámara vio un código. */
export function mostrarCodigo(data: string): void {
  alLeer?.({ data });
}

let permiso: { granted: boolean; canAskAgain: boolean; status: string } | null = { granted: true, canAskAgain: true, status: "granted" };

/** Para probar el permiso negado. */
export function fijarPermiso(p: typeof permiso): void {
  permiso = p;
}

export function CameraView(props: { onBarcodeScanned?: (r: { data: string }) => void }) {
  alLeer = props.onBarcodeScanned;
  return <View testID="camara" />;
}

export function useCameraPermissions() {
  return [permiso, async () => permiso] as const;
}
