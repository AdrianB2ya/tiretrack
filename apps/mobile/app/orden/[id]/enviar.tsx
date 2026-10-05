import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PantallaEnvio } from "../../../src/ordenes/PantallaEnvio";
import { useDatos, type DatosOrden } from "../../../src/app/ProveedorDatos";
import { useUsuario } from "../../../src/app/ProveedorSesion";
import { colores } from "../../../src/diseno/tokens";

/**
 * Envío de la orden a revisión.
 *
 * Al enviar se vuelve al listado, no al detalle: la orden ya salió de las
 * manos del técnico y dejarlo en una pantalla que ya no puede editar
 * confunde.
 */
export default function PantallaEnviarOrden() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { cargarOrden, cambiarEstado, pendientesDeEnviar } = useDatos();
  const usuario = useUsuario();

  const [datos, setDatos] = useState<DatosOrden | null>(null);
  const [enviando, setEnviando] = useState(false);

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

  const enviar = useCallback(async () => {
    if (!id) return;
    setEnviando(true);
    try {
      await cambiarEstado(id, "en_revision");
      router.replace("/ordenes" as never);
    } finally {
      setEnviando(false);
    }
  }, [id, cambiarEstado, router]);

  if (!datos) {
    return (
      <View style={estilos.centrado}>
        <ActivityIndicator color={colores.primario} />
      </View>
    );
  }

  return (
    <PantallaEnvio
      estado={{
        orden: datos.orden,
        diagrama: datos.diagrama,
        fotosSinSubir: 0,
        operacionesPendientes: pendientesDeEnviar,
      }}
      // Quien mira, no quien tiene asignada la orden: usar el técnico de la
      // orden como usuario haría pasar siempre la comprobación de permiso.
      rol={usuario.rol}
      usuarioId={usuario.id}
      onEnviar={() => void enviar()}
      onVolver={() => router.back()}
      enviando={enviando}
    />
  );
}

const estilos = StyleSheet.create({
  centrado: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colores.fondo,
  },
});
