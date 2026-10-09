import { Pressable, StyleSheet, Text, View } from "react-native";
import { colores, conOpacidad, espacio, tactil, texto } from "../diseno/tokens";
import type { DestinoPestana, Pestana } from "./navegacion";

/**
 * Barra de navegación de abajo (todos los roles, con lo que pueden hacer).
 *
 * Presentación pura: qué pestañas hay lo decide `pestanasPara`, y la unión
 * con el enrutador vive en `NavegacionInferior`. La activa se marca con texto
 * y con `aria-current`, no solo con color: bajo el sol los tonos se confunden.
 */
export interface BarraNavegacionProps {
  pestanas: readonly DestinoPestana[];
  activa: Pestana;
  onIr: (p: DestinoPestana) => void;
  /** Cuántas esperan revisión: se ve sin entrar. */
  porRevisar?: number;
}

export function BarraNavegacion({ pestanas, activa, onIr, porRevisar = 0 }: BarraNavegacionProps) {
  if (pestanas.length === 0) return null;
  return (
    <View style={estilos.barra} role="tablist">
      {pestanas.map((p) => {
        const es = p.clave === activa;
        const etiqueta = p.clave === "revision" && porRevisar > 0 ? `${p.etiqueta} (${porRevisar})` : p.etiqueta;
        return (
          <Pressable
            key={p.clave}
            role="tab"
            aria-selected={es}
            accessibilityLabel={etiqueta}
            testID={`pestana-${p.clave}`}
            // Tocar la pestaña en la que ya se está no hace nada: volver a
            // montar la pantalla perdería el desplazamiento de la lista.
            onPress={() => (es ? undefined : onIr(p))}
            style={({ pressed }) => [estilos.pestana, es && estilos.activa, pressed && { opacity: 0.7 }]}
          >
            <Text style={[estilos.texto, es && estilos.textoActivo]} numberOfLines={1}>
              {etiqueta}
            </Text>
            {es ? <View style={estilos.marca} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  barra: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colores.borde,
    backgroundColor: colores.superficie,
    paddingBottom: espacio.xs,
  },
  pestana: { flex: 1, minHeight: tactil.comodo, alignItems: "center", justifyContent: "center", paddingHorizontal: espacio.xs },
  activa: { backgroundColor: conOpacidad(colores.primario, 0.1) },
  texto: { ...texto.etiqueta, color: colores.textoTenue },
  textoActivo: { color: colores.primario, fontWeight: "700" },
  marca: { position: "absolute", top: 0, left: espacio.md, right: espacio.md, height: 3, backgroundColor: colores.marca },
});
