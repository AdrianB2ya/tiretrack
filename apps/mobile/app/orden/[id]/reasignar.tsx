import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ReasignarOrden } from "../../../src/coordinador/ReasignarOrden";
import { useDatos, type DatosOrden } from "../../../src/app/ProveedorDatos";
import type { TecnicoLocal } from "../../../src/datos/repositorio";
import { colores } from "../../../src/diseno/tokens";

/** Reasignación de una orden. Vuelve a la bandeja al confirmar. */
export default function PantallaReasignar() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { cargarOrden, tecnicosDeSede, reasignar } = useDatos();

  const [datos, setDatos] = useState<DatosOrden | null>(null);
  const [tecnicos, setTecnicos] = useState<TecnicoLocal[]>([]);
  const [procesando, setProcesando] = useState(false);

  useEffect(() => {
    let vigente = true;
    void (async () => {
      if (!id) return;
      const d = await cargarOrden(id);
      if (!vigente || !d) return;
      setDatos(d);
      // La sede sale de la orden: solo se ofrecen técnicos que pueden
      // trabajar donde está el vehículo.
      setTecnicos(await tecnicosDeSede(d.orden.sedeId));
    })();
    return () => {
      vigente = false;
    };
  }, [id, cargarOrden, tecnicosDeSede]);

  const confirmar = useCallback(
    async (tecnicoId: string, motivo: string) => {
      if (!id) return;
      setProcesando(true);
      try {
        await reasignar(id, tecnicoId, motivo);
        router.back();
      } finally {
        setProcesando(false);
      }
    },
    [id, reasignar, router],
  );

  if (!datos) {
    return (
      <View style={estilos.centrado}>
        <ActivityIndicator color={colores.primario} />
      </View>
    );
  }

  return (
    <ReasignarOrden
      tecnicos={tecnicos}
      tecnicoActualId={datos.orden.tecnicoId}
      posicionesCapturadas={datos.diagrama.capturadas}
      posicionesTotales={datos.diagrama.totalPosiciones}
      onReasignar={(t, m) => void confirmar(t, m)}
      onCancelar={() => router.back()}
      procesando={procesando}
    />
  );
}

const estilos = StyleSheet.create({
  centrado: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
});
