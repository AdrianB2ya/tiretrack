import { Pressable, StyleSheet, Text } from "react-native";
import { colores, espacio, tactil, texto } from "../diseno/tokens";

/**
 * Acceso a la cuenta desde la cabecera.
 *
 * Dice "Cuenta" con texto, no con un ícono: un ícono de persona no le dice
 * al técnico que ahí se cierra la sesión.
 */
export function BotonCuenta({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      role="button"
      accessibilityLabel="Cuenta y cerrar sesión"
      hitSlop={espacio.sm}
      style={({ pressed }) => [estilos.boton, pressed && estilos.presionado]}
    >
      <Text style={estilos.texto}>Cuenta</Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  boton: {
    minHeight: tactil.minimo,
    minWidth: tactil.minimo,
    paddingHorizontal: espacio.md,
    alignItems: "center",
    justifyContent: "center",
  },
  presionado: { opacity: 0.6 },
  texto: { ...texto.etiqueta, color: colores.primario },
});
