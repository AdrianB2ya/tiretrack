import { ScrollView, StyleSheet, Text } from "react-native";
import { Tarjeta } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import type { OpcionMas } from "./navegacion";

/** "Más": lo que no se usa a diario. Cada entrada dice para qué sirve. */
export function MenuMas({ opciones, onAbrir }: { opciones: readonly OpcionMas[]; onAbrir: (o: OpcionMas) => void }) {
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      {opciones.map((o) => (
        <Tarjeta key={o.clave} testID={`mas-${o.clave}`} onPress={() => onAbrir(o)}>
          <Text style={estilos.titulo}>{o.etiqueta}</Text>
          <Text style={estilos.detalle}>{o.detalle}</Text>
        </Tarjeta>
      ))}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.sm },
  titulo: { ...texto.cuerpoFuerte, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
