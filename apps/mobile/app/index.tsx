import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import { useSesion, destinoInicial } from "../src/app/ProveedorSesion";
import { colores } from "../src/diseno/tokens";

/**
 * Entrada de la app: redirige según el rol.
 *
 * Reemplaza la pantalla provisional del sistema visual de la tarea 2.1.
 */
export default function Inicio() {
  const { cargando, usuario } = useSesion();

  if (cargando) {
    return (
      <View style={estilos.centrado}>
        <ActivityIndicator color={colores.primario} />
      </View>
    );
  }

  return <Redirect href={destinoInicial(usuario) as never} />;
}

const estilos = StyleSheet.create({
  centrado: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
});
