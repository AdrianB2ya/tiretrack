import { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { PanelCoordinador, calcularIndicadores, type Accion } from "../src/coordinador/PanelCoordinador";
import { useDatos } from "../src/app/ProveedorDatos";
import { useUsuario } from "../src/app/ProveedorSesion";
import { BarraDeSesion } from "../src/app/BarraDeSesion";
import { colores, espacio } from "../src/diseno/tokens";
import { Boton } from "../src/diseno/componentes";
import type { OrdenLocal } from "../src/datos/repositorio";

/** Panel del coordinador: lo que requiere su decisión hoy. */
export default function PantallaPanel() {
  const router = useRouter();
  const usuario = useUsuario();
  const { ordenes, pendientesDeEnviar } = useDatos();
  const [hoy] = useState(() => new Date().toISOString().slice(0, 10));
  const [locales, setLocales] = useState<OrdenLocal[]>([]);

  useEffect(() => {
    setLocales(ordenes.map((o) => o.orden));
  }, [ordenes]);

  const destinos: Record<Accion, string> = {
    revisar: "/revision",
    devueltas: "/ordenes",
    cliente: "/ordenes",
    en_curso: "/ordenes",
  };

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <BarraDeSesion />
      <View style={{ paddingHorizontal: espacio.md, paddingTop: espacio.sm, gap: espacio.sm }}>
        <Boton ancho testID="nueva-orden" onPress={() => router.push("/nueva-orden" as never)}>
          Programar una orden
        </Boton>
        <Boton ancho tipo="secundario" testID="flota" onPress={() => router.push("/flota" as never)}>
          Clientes y vehículos
        </Boton>
      </View>
      <PanelCoordinador
        indicadores={calcularIndicadores(locales, hoy, pendientesDeEnviar)}
        nombre={usuario.nombre}
        onAbrir={(accion) => router.push(destinos[accion] as never)}
      />
    </View>
  );
}
