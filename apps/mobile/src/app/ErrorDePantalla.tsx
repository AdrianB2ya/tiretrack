import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Boton } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";

/**
 * Red de seguridad: si una pantalla revienta al dibujarse, en vez de la
 * pantalla roja de React Native (o una app cerrada en producción) se ve qué
 * pasó y cómo seguir.
 *
 * No reemplaza a corregir el error —el recorrido de pantallas de la auditoría
 * existe para que no llegue a pasar—, pero en campo nadie puede depurar: el
 * técnico necesita volver a sus órdenes, y soporte necesita el mensaje.
 *
 * Se exporta como `ErrorBoundary` desde las disposiciones: es el mecanismo de
 * Expo Router para atrapar los errores de las rutas que contienen.
 */
export function ErrorDePantalla({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const router = useRouter();
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.titulo}>Algo falló en esta pantalla</Text>
      <Text style={estilos.cuerpo}>
        Lo que tenías guardado en el teléfono sigue ahí. Puedes reintentar o volver al inicio.
      </Text>
      <View style={estilos.acciones}>
        <Boton ancho testID="reintentar" onPress={() => void retry()}>
          Reintentar
        </Boton>
        <Boton ancho tipo="secundario" testID="volver-inicio" onPress={() => router.replace("/" as never)}>
          Volver al inicio
        </Boton>
      </View>
      {/* El detalle, para dictárselo a soporte. */}
      <Text style={estilos.detalle} selectable>
        Detalle: {error.message}
      </Text>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { flexGrow: 1, justifyContent: "center", padding: espacio.xl, gap: espacio.md },
  titulo: { ...texto.subtitulo, color: colores.texto, textAlign: "center" },
  cuerpo: { ...texto.cuerpo, color: colores.texto, textAlign: "center" },
  acciones: { gap: espacio.sm },
  detalle: { ...texto.ayuda, color: colores.textoTenue, textAlign: "center" },
});
