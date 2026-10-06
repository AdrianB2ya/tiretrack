import { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { PanelCoordinador, calcularIndicadores, type Accion } from "../../src/coordinador/PanelCoordinador";
import { useDatos } from "../../src/app/ProveedorDatos";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { BarraDeSesion } from "../../src/app/BarraDeSesion";
import { NavegacionInferior } from "../../src/app/NavegacionInferior";
import { colores, espacio } from "../../src/diseno/tokens";
import { Boton } from "../../src/diseno/componentes";
import { fechaEnColombia } from "@tiretrack/domain";
import type { OrdenLocal } from "../../src/datos/repositorio";

/**
 * Panel del coordinador: lo que requiere su decisión hoy.
 *
 * Solo decisiones y la acción más frecuente (programar una orden). Lo demás
 * —flota, informe, usuarios, plantillas— está en "Más": con ocho botones
 * encima, las tarjetas de lo urgente quedaban fuera de la pantalla.
 */
export default function PantallaPanel() {
  const router = useRouter();
  const usuario = useUsuario();
  const { ordenes, pendientesDeEnviar } = useDatos();
  const [hoy] = useState(() => fechaEnColombia());
  const [locales, setLocales] = useState<OrdenLocal[]>([]);

  useEffect(() => {
    setLocales(ordenes.map((o) => o.orden));
  }, [ordenes]);

  // Cada tarjeta abre la lista YA filtrada por lo que cuenta: antes llevaban
  // todas a la lista general y había que buscar.
  const destinos: Record<Accion, string> = {
    revisar: "/revision",
    devueltas: "/ordenes?filtro=devueltas",
    cliente: "/ordenes?filtro=cliente",
    en_curso: "/ordenes?filtro=en_curso",
  };

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondo }}>
      <BarraDeSesion />
      <View style={{ paddingHorizontal: espacio.md, paddingTop: espacio.sm }}>
        <Boton ancho testID="nueva-orden" onPress={() => router.push("/nueva-orden" as never)}>
          Programar una orden
        </Boton>
      </View>
      <View style={{ flex: 1 }}>
        <PanelCoordinador
          indicadores={calcularIndicadores(locales, hoy, pendientesDeEnviar)}
          nombre={usuario.nombre}
          onAbrir={(accion) => router.push(destinos[accion] as never)}
        />
      </View>
      <NavegacionInferior activa="panel" />
    </View>
  );
}
