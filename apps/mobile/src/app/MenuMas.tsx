import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { Tarjeta, Vacio } from "../diseno/componentes";
import { colores, espacio, radio, texto } from "../diseno/tokens";
import { agruparOpciones, buscarOpciones, MAX_MAS_SIN_BUSQUEDA, type OpcionMas } from "./navegacion";

/**
 * "Más": lo que no se usa a diario. Cada entrada dice para qué sirve.
 *
 * Por secciones (R17), y con búsqueda cuando son muchas: buscar escribe una
 * palabra; recorrer veinte tarjetas con guantes es lo que hace que la gente
 * no encuentre lo que ya existe.
 */
export function MenuMas({ opciones, onAbrir }: { opciones: readonly OpcionMas[]; onAbrir: (o: OpcionMas) => void }) {
  const [busqueda, setBusqueda] = useState("");
  const conBusqueda = opciones.length > MAX_MAS_SIN_BUSQUEDA;
  const grupos = agruparOpciones(buscarOpciones(opciones, busqueda));
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      {conBusqueda ? (
        <TextInput
          style={estilos.buscar}
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Buscar: llantas, informe, usuarios…"
          placeholderTextColor={colores.textoTenue}
          accessibilityLabel="Buscar en Más"
          testID="mas-buscar"
        />
      ) : null}
      {grupos.length === 0 ? <Vacio mensaje={`Nada con "${busqueda.trim()}".`} /> : null}
      {grupos.map((g) => [
        <Text key={`t-${g.grupo}`} style={estilos.seccion} accessibilityRole="header" testID={`seccion-${g.grupo}`}>
          {g.grupo}
        </Text>,
        ...g.opciones.map((o) => (
          <Tarjeta key={o.clave} testID={`mas-${o.clave}`} onPress={() => onAbrir(o)}>
            <Text style={estilos.titulo}>{o.etiqueta}</Text>
            <Text style={estilos.detalle}>{o.detalle}</Text>
          </Tarjeta>
        )),
      ])}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.sm, paddingBottom: espacio.xxl },
  buscar: {
    ...texto.cuerpo,
    color: colores.texto,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radio.md,
    paddingHorizontal: espacio.md,
    backgroundColor: colores.superficie,
  },
  seccion: { ...texto.etiqueta, color: colores.textoTenue, marginTop: espacio.md, textTransform: "uppercase" },
  titulo: { ...texto.cuerpoFuerte, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
