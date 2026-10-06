import { View } from "react-native";
import { useRouter } from "expo-router";
import { MenuMas } from "../src/app/MenuMas";
import { NavegacionInferior } from "../src/app/NavegacionInferior";
import { BarraDeSesion } from "../src/app/BarraDeSesion";
import { opcionesMas } from "../src/app/navegacion";
import { useUsuario } from "../src/app/ProveedorSesion";
import { colores } from "../src/diseno/tokens";

/** Pestaña "Más": las pantallas de gestión que no son del día a día. */
export default function RutaMas() {
  const router = useRouter();
  const usuario = useUsuario();
  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <BarraDeSesion />
      <MenuMas opciones={opcionesMas(usuario.rol)} onAbrir={(o) => router.push(o.ruta as never)} />
      <NavegacionInferior activa="mas" />
    </View>
  );
}
