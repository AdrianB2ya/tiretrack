/**
 * Doble de `react-native-svg` para las pruebas.
 *
 * La librería real trae sintaxis Flow que Vitest no transpila. Este doble
 * mantiene la forma de los componentes para poder probar el resto de la
 * pantalla; **el dibujo real se valida en el dispositivo**.
 *
 * La construcción de la ruta —que es donde podría haber un error de lógica—
 * está probada aparte en el dominio: `trazoASvg`.
 */
import type { ReactNode } from "react";

export function Svg({ children, ...props }: { children?: ReactNode; [k: string]: unknown }) {
  return <svg {...(props as object)}>{children}</svg>;
}

export function Path(props: { d?: string; [k: string]: unknown }) {
  return <path {...(props as object)} />;
}

export default Svg;
