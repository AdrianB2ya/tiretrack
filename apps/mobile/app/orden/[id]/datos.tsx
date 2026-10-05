import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { puedeEditarMediciones, type EstadoOrden } from "@tiretrack/domain";
import { FormularioDatosOrden } from "../../../src/ordenes/FormularioDatosOrden";
import { useDatos, type DatosOrden } from "../../../src/app/ProveedorDatos";
import { useUsuario } from "../../../src/app/ProveedorSesion";
import { colores } from "../../../src/diseno/tokens";

/** Kilometraje, hallazgos y acción realizada. */
export default function RutaDatosOrden() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { cargarOrden, actualizarDatosOrden } = useDatos();
  const usuario = useUsuario();
  const [datos, setDatos] = useState<DatosOrden | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vigente = true;
    void (async () => {
      if (!id) return;
      const d = await cargarOrden(id);
      if (vigente) setDatos(d);
    })();
    return () => {
      vigente = false;
    };
  }, [id, cargarOrden]);

  if (!datos) {
    return (
      <View style={estilos.centrado}>
        <ActivityIndicator color={colores.primario} />
      </View>
    );
  }

  const { orden } = datos;
  // Mismas reglas que las mediciones: estos datos son contenido que la firma
  // ampara, y solo el técnico asignado los registra.
  const edicion = puedeEditarMediciones({
    estado: orden.estado as EstadoOrden,
    rol: usuario.rol,
    esTecnicoAsignado: orden.tecnicoId === usuario.id,
    vistaCliente: usuario.rol === "cliente",
  });

  return (
    <FormularioDatosOrden
      inicial={{ kilometraje: orden.kilometraje, hallazgos: orden.hallazgos, accion: orden.accion }}
      kmVehiculo={datos.contexto?.vehiculoKm ?? null}
      soloLectura={edicion.permitido ? null : (edicion.mensaje ?? "No se puede editar")}
      guardando={guardando}
      onGuardar={async (d) => {
        setGuardando(true);
        try {
          await actualizarDatosOrden(orden.id, d);
          router.back();
        } finally {
          setGuardando(false);
        }
      }}
    />
  );
}

const estilos = StyleSheet.create({
  centrado: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
});
