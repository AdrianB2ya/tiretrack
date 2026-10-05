import { StyleSheet, Text, View } from "react-native";
import type { Rol } from "@tiretrack/domain";
import { BotonCuenta } from "./BotonCuenta";
import { ETIQUETA_ROL } from "./PantallaCuenta";
import { colores, espacio, texto } from "../diseno/tokens";

/**
 * Quién está dentro, y la entrada a la cuenta.
 *
 * Va dentro de la pantalla, no en la cabecera nativa: en Android con la
 * arquitectura nueva, `react-native-screens` 4.4 —la del SDK 52— no siempre
 * entrega los toques a los botones de la cabecera. Puesto ahí, "Cuenta" se
 * veía pero no respondía.
 *
 * Ver el nombre también sirve por sí solo: en un carro taller la tablet se
 * comparte, y lo que se capture queda a nombre de quien esté dentro.
 */
export function BarraSesion({
  nombre,
  rol,
  onCuenta,
}: {
  nombre: string;
  rol: Rol;
  onCuenta: () => void;
}) {
  return (
    <View style={estilos.barra}>
      <View style={estilos.quien}>
        <Text style={estilos.nombre} numberOfLines={1}>
          {nombre}
        </Text>
        <Text style={estilos.rol}>{ETIQUETA_ROL[rol] ?? rol}</Text>
      </View>
      <BotonCuenta onPress={onCuenta} />
    </View>
  );
}

const estilos = StyleSheet.create({
  barra: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: espacio.md,
    backgroundColor: colores.superficie,
    borderBottomWidth: 1,
    borderBottomColor: colores.borde,
  },
  quien: { flex: 1 },
  nombre: { ...texto.cuerpoFuerte, color: colores.texto },
  rol: { ...texto.ayuda, color: colores.textoTenue },
});
