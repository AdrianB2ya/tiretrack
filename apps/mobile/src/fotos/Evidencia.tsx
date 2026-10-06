import { useCallback, useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Aviso, Boton, Vacio } from "../diseno/componentes";
import { colores, espacio, radio, texto } from "../diseno/tokens";

/**
 * La evidencia de una orden tal como está en el servidor: la ve cualquiera
 * que pueda ver la orden, desde cualquier teléfono.
 *
 * Antes cada celular veía solo las fotos que él tomó: el coordinador aprobaba
 * sin ver la evidencia y el cliente no la veía nunca. Es en línea —las fotos
 * viven en el almacenamiento, no en el celular— y cada URL vence: al volver a
 * la pantalla se piden de nuevo.
 */

export interface FotoServidor {
  readonly id: string;
  readonly nombre: string;
  /** null: foto de la orden en general (placa, odómetro…). */
  readonly posicion: number | null;
  readonly url: string;
}

type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string };

/** Agrupa por posición, con las generales primero. */
export function agruparEvidencia(fotos: readonly FotoServidor[]): { titulo: string; fotos: FotoServidor[] }[] {
  const grupos = new Map<number | null, FotoServidor[]>();
  for (const f of fotos) grupos.set(f.posicion, [...(grupos.get(f.posicion) ?? []), f]);
  return [...grupos.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a - b))
    .map(([posicion, fs]) => ({ titulo: posicion === null ? "De la orden" : `Posición ${posicion}`, fotos: fs }));
}

export function Evidencia({ cargar }: { cargar: () => Promise<R<FotoServidor[]>> }) {
  const [fotos, setFotos] = useState<FotoServidor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<FotoServidor | null>(null);

  const recargar = useCallback(async () => {
    setError(null);
    const r = await cargar();
    if (r.ok) setFotos(r.datos);
    else setError(r.status === 0 ? "Sin señal: la evidencia se ve con conexión." : r.mensaje);
  }, [cargar]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (error) {
    return (
      <View style={estilos.centrado}>
        <Aviso tono="advertencia" titulo="No se pudo cargar la evidencia" detalle={error} />
        <Boton tipo="secundario" testID="reintentar-evidencia" onPress={() => void recargar()}>
          Reintentar
        </Boton>
      </View>
    );
  }
  if (!fotos) return <Vacio mensaje="Cargando la evidencia…" />;
  if (fotos.length === 0) {
    return <Vacio mensaje="Todavía no hay fotos en el servidor. Las que se tomaron sin señal aparecen al sincronizar." />;
  }

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.resumen}>
        {fotos.length} {fotos.length === 1 ? "foto" : "fotos"} en el servidor
      </Text>
      {agruparEvidencia(fotos).map((g) => (
        <View key={g.titulo} style={estilos.grupo}>
          <Text style={estilos.titulo}>{g.titulo}</Text>
          <View style={estilos.rejilla}>
            {g.fotos.map((f) => (
              <Pressable
                key={f.id}
                role="button"
                accessibilityLabel={`Ver ${f.nombre}`}
                onPress={() => setAbierta(f)}
                style={({ pressed }) => [estilos.miniatura, pressed && { opacity: 0.7 }]}
              >
                <Image source={{ uri: f.url }} style={estilos.imagen} resizeMode="cover" />
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      <Modal visible={abierta !== null} transparent animationType="fade" onRequestClose={() => setAbierta(null)}>
        <View style={estilos.velo}>
          {abierta ? <Image source={{ uri: abierta.url }} style={estilos.grande} resizeMode="contain" /> : null}
          <Text style={estilos.pie}>{abierta?.nombre}</Text>
          <Boton ancho tipo="secundario" testID="cerrar-foto" onPress={() => setAbierta(null)}>
            Cerrar
          </Boton>
        </View>
      </Modal>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md },
  centrado: { flex: 1, justifyContent: "center", padding: espacio.lg, gap: espacio.md, backgroundColor: colores.fondo },
  resumen: { ...texto.cuerpoFuerte, color: colores.texto },
  grupo: { gap: espacio.sm },
  titulo: { ...texto.etiqueta, color: colores.texto },
  rejilla: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  miniatura: { width: 104, height: 104, borderRadius: radio.md, overflow: "hidden", backgroundColor: colores.superficie },
  imagen: { width: "100%", height: "100%" },
  velo: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center", padding: espacio.lg, gap: espacio.md },
  grande: { width: "100%", height: "70%" },
  pie: { ...texto.ayuda, color: colores.texto, textAlign: "center" },
});
