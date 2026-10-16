import Svg, { Path } from "react-native-svg";

/**
 * Íconos de la barra de abajo: trazos simples de 24×24, todos con el mismo
 * grosor. Se reconocen de reojo y con guantes mejor que el texto solo
 * (revisión de diseño). Se dibujan con react-native-svg, que ya está en la
 * app: una librería de íconos traería fuentes que cargar.
 */
export const ICONOS = {
  panel: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
  ordenes: "M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01",
  revision: "M9 3.5h6v3H9z M7 5H5v16h14V5h-2 M8.5 13.5l2.5 2.5 4.5-5",
  mas: "M5 12h.01 M12 12h.01 M19 12h.01",
  cliente: "M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7",
  plataforma: "M4 21V6l8-3 8 3v15 M9 21v-5h6v5 M8 9h.01 M12 9h.01 M16 9h.01 M8 12.5h.01 M12 12.5h.01 M16 12.5h.01",
} as const;

export type NombreIcono = keyof typeof ICONOS;

export function Icono({ nombre, color, tamano = 22 }: { nombre: NombreIcono; color: string; tamano?: number }) {
  // Los puntos (.01) se ven gracias al extremo redondo y un trazo más grueso.
  const grueso = nombre === "mas" ? 3.2 : 2;
  return (
    <Svg width={tamano} height={tamano} viewBox="0 0 24 24" fill="none">
      <Path d={ICONOS[nombre]} stroke={color} strokeWidth={grueso} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
