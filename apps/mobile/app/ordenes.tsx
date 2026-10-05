import { useCallback } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ListaOrdenes } from "../src/ordenes/ListaOrdenes";
import { useDatos } from "../src/app/ProveedorDatos";
import { BarraDeSesion } from "../src/app/BarraDeSesion";
import { colores, espacio, texto } from "../src/diseno/tokens";

/**
 * "Mis órdenes".
 *
 * Los datos salen de la base local: la pantalla no espera a la red. El
 * indicador de pendientes le dice al técnico cuánto le falta por enviar, que
 * es lo que decide si busca señal ahora o al terminar el turno.
 */
export default function PantallaOrdenes() {
  const router = useRouter();
  const { cargando, ordenes, pendientesDeEnviar, sincronizando, sincronizar } = useDatos();

  const abrir = useCallback(
    (ordenId: string) => router.push(`/orden/${ordenId}` as never),
    [router],
  );

  if (cargando) {
    return (
      <View style={estilos.centrado}>
        <ActivityIndicator color={colores.primario} />
      </View>
    );
  }

  return (
    <View style={estilos.pantalla}>
      <BarraDeSesion />
      {pendientesDeEnviar > 0 ? (
        <View style={estilos.barraPendientes}>
          <Text style={estilos.textoPendientes}>
            {pendientesDeEnviar} cambio{pendientesDeEnviar > 1 ? "s" : ""} sin enviar
          </Text>
          {sincronizando ? <ActivityIndicator size="small" color={colores.advertencia} /> : null}
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={
          // Tirar para sincronizar: el técnico decide cuándo gastar datos.
          <RefreshControl
            refreshing={sincronizando}
            onRefresh={() => void sincronizar()}
            tintColor={colores.primario}
          />
        }
      >
        <ListaOrdenes ordenes={ordenes} onAbrir={abrir} />
      </ScrollView>
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  centrado: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
  barraPendientes: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: espacio.sm,
    paddingVertical: espacio.sm,
    backgroundColor: colores.superficie,
  },
  textoPendientes: { ...texto.ayuda, color: colores.advertencia, fontWeight: "600" },
});
