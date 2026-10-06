import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { PortalCliente } from "../src/cliente/PortalCliente";
import { BarraDeSesion } from "../src/app/BarraDeSesion";
import { useDatos } from "../src/app/ProveedorDatos";
import { colores } from "../src/diseno/tokens";

/** Portal del cliente: aprobar servicios y consultar su historial. */
export default function RutaCliente() {
  const router = useRouter();
  const { ordenes, sincronizando, sincronizar } = useDatos();
  const [hoy] = useState(() => new Date().toISOString().slice(0, 10));
  return (
    <View style={estilos.pantalla}>
      <BarraDeSesion />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={sincronizando} onRefresh={() => void sincronizar()} tintColor={colores.primario} />
        }
      >
        <PortalCliente ordenes={ordenes} hoy={hoy} onAbrir={(id) => router.push(`/orden/${id}` as never)} />
      </ScrollView>
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
});
