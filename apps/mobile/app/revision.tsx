import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { BandejaRevision } from "../src/coordinador/BandejaRevision";
import type { OrdenEnBandeja } from "../src/coordinador/bandeja";
import { useDatos } from "../src/app/ProveedorDatos";
import { useUsuario } from "../src/app/ProveedorSesion";
import { BarraDeSesion } from "../src/app/BarraDeSesion";
import { NavegacionInferior } from "../src/app/NavegacionInferior";
import { colores } from "../src/diseno/tokens";

/**
 * Bandeja de revisión del coordinador.
 *
 * Se recarga cuando cambian las órdenes: aprobar o devolver una debe sacarla
 * de la lista sin que haya que volver atrás y entrar de nuevo.
 */
export default function PantallaRevision() {
  const router = useRouter();
  const { bandejaRevision, ordenes } = useDatos();
  const usuario = useUsuario();
  const [items, setItems] = useState<OrdenEnBandeja[] | null>(null);

  const recargar = useCallback(async () => {
    setItems(await bandejaRevision());
  }, [bandejaRevision]);

  useEffect(() => {
    void recargar();
  }, [recargar, ordenes]);

  if (!items) {
    return (
      <View style={estilos.centrado}>
        <ActivityIndicator color={colores.primario} />
      </View>
    );
  }

  return (
    <View style={estilos.pantalla}>
      <BarraDeSesion />
      <BandejaRevision
        items={items}
        // El rol viene de la sesión: un rol fijo aquí mostraría las mismas
        // acciones a un técnico que a un coordinador.
        ctx={{ usuarioId: usuario.id, rol: usuario.rol }}
        // A la decisión, no al detalle del técnico: desde ahí no se podía
        // aprobar ni devolver.
        onAbrir={(ordenId) => router.push(`/orden/${ordenId}/decidir` as never)}
      />
      <NavegacionInferior activa="revision" />
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  centrado: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
});
