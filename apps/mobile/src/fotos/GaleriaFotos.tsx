import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Boton } from "../diseno/componentes";
import { colores, conOpacidad, espacio, radio, tactil, texto } from "../diseno/tokens";

/**
 * Fotos de una posición.
 *
 * Cada foto muestra **en qué estado está**: el técnico necesita saber si su
 * evidencia ya llegó al servidor o sigue en el celular esperando señal. Sin
 * eso, entrega el vehículo creyendo que subió y nadie se entera hasta que el
 * cliente reclama.
 */

export type EstadoFoto = "esperando" | "subiendo" | "subida" | "fallida";

export interface FotoEnPantalla {
  readonly id: string;
  readonly uriLocal: string;
  readonly estado: EstadoFoto;
  readonly intentos?: number;
}

const ETIQUETA: Record<EstadoFoto, string> = {
  esperando: "Sin enviar",
  subiendo: "Enviando…",
  subida: "Enviada",
  fallida: "No se pudo enviar",
};

const COLOR: Record<EstadoFoto, string> = {
  esperando: colores.advertencia,
  subiendo: colores.secundario,
  subida: colores.exito,
  fallida: colores.peligro,
};

export interface GaleriaFotosProps {
  fotos: readonly FotoEnPantalla[];
  onTomarFoto: () => void;
  onQuitar?: (id: string) => void;
  /** Bloquea la cámara cuando la orden ya no se puede editar. */
  deshabilitada?: boolean;
  /** Tope por posición; más fotos no aportan y llenan el almacenamiento. */
  maximo?: number;
}

export const MAXIMO_POR_POSICION = 6;

export function GaleriaFotos({
  fotos,
  onTomarFoto,
  onQuitar,
  deshabilitada = false,
  maximo = MAXIMO_POR_POSICION,
}: GaleriaFotosProps) {
  const lleno = fotos.length >= maximo;
  const sinEnviar = fotos.filter((f) => f.estado !== "subida").length;

  return (
    <View style={estilos.contenedor}>
      <View style={estilos.encabezado}>
        <Text style={estilos.titulo}>Fotos ({fotos.length})</Text>
        {sinEnviar > 0 ? (
          // Lo que importa antes de irse del vehículo.
          <Text style={estilos.pendientes} testID="fotos-sin-enviar">
            {sinEnviar} sin enviar
          </Text>
        ) : null}
      </View>

      {fotos.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={estilos.tira}>
          {fotos.map((f) => (
            <View key={f.id} style={estilos.miniatura} testID={`foto-${f.id}`}>
              <Image source={{ uri: f.uriLocal }} style={estilos.imagen} accessibilityIgnoresInvertColors />
              {/* El estado va en TEXTO además de color: bajo el sol los
                  tonos se confunden, y aquí distinguirlos es el punto. */}
              <View style={[estilos.estado, { backgroundColor: conOpacidad(COLOR[f.estado], 0.9) }]}>
                <Text style={estilos.textoEstado} numberOfLines={1}>
                  {ETIQUETA[f.estado]}
                </Text>
              </View>
              {onQuitar && f.estado !== "subida" && !deshabilitada ? (
                <Pressable
                  onPress={() => onQuitar(f.id)}
                  testID={`quitar-${f.id}`}
                  aria-label="Quitar foto"
                  style={estilos.quitar}
                >
                  <Text style={estilos.equis}>×</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : (
        <Text style={estilos.vacio}>Sin fotos en esta posición</Text>
      )}

      <Boton
        tipo="secundario"
        ancho
        testID="tomar-foto"
        onPress={onTomarFoto}
        deshabilitado={deshabilitada || lleno}
      >
        {lleno ? `Máximo ${maximo} fotos` : "Tomar foto"}
      </Boton>
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { gap: espacio.md },
  encabezado: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titulo: { ...texto.etiqueta, color: colores.textoTenue },
  pendientes: { ...texto.ayuda, color: colores.advertencia, fontWeight: "600" },
  tira: { gap: espacio.md, paddingVertical: espacio.xs },
  miniatura: { width: 96, height: 96, borderRadius: radio.md, overflow: "hidden", backgroundColor: colores.tarjeta },
  imagen: { width: "100%", height: "100%" },
  estado: { position: "absolute", left: 0, right: 0, bottom: 0, paddingVertical: 3, paddingHorizontal: 4 },
  textoEstado: { fontSize: 11, fontWeight: "700", color: colores.blanco, textAlign: "center" },
  quitar: {
    position: "absolute",
    top: 0,
    right: 0,
    width: tactil.minimo,
    height: tactil.minimo,
    alignItems: "center",
    justifyContent: "center",
  },
  equis: { fontSize: 22, color: colores.blanco, fontWeight: "700" },
  vacio: { ...texto.ayuda, color: colores.textoTenue },
});
