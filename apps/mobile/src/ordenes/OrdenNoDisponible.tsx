import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Boton } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import { destinoInicial, useSesion } from "../app/ProveedorSesion";

/**
 * La orden (o la posición) que se intentó abrir no está en el teléfono.
 *
 * Antes estas pantallas mostraban la rueda de carga para siempre: la orden se
 * cerró y salió del celular mientras estaba abierta, o se llegó por un enlace
 * viejo. Sin salida, la persona queda atrapada. Lo encontró el recorrido de
 * pantallas de la auditoría.
 */
export function OrdenNoDisponible({ mensaje = "Esta orden ya no está en el teléfono." }: { mensaje?: string }) {
  const router = useRouter();
  const { usuario } = useSesion();
  return (
    <View style={estilos.centrado}>
      <Text style={estilos.titulo}>{mensaje}</Text>
      <Text style={estilos.detalle}>
        Puede que se haya cerrado o reasignado. Tira hacia abajo en la lista para actualizar.
      </Text>
      <Boton tipo="secundario" testID="volver-al-inicio" onPress={() => router.replace(destinoInicial(usuario) as never)}>
        Volver al inicio
      </Boton>
    </View>
  );
}

const estilos = StyleSheet.create({
  centrado: { flex: 1, alignItems: "center", justifyContent: "center", gap: espacio.md, padding: espacio.xl, backgroundColor: colores.fondo },
  titulo: { ...texto.subtitulo, color: colores.texto, textAlign: "center" },
  detalle: { ...texto.ayuda, color: colores.textoTenue, textAlign: "center" },
});
