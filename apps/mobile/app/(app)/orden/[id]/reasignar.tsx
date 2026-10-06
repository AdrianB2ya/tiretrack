import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ReasignarOrden } from "../../../../src/coordinador/ReasignarOrden";
import { useDatos, type DatosOrden } from "../../../../src/app/ProveedorDatos";
import type { TecnicoLocal } from "../../../../src/datos/repositorio";
import { colores } from "../../../../src/diseno/tokens";
import { OrdenNoDisponible } from "../../../../src/ordenes/OrdenNoDisponible";

/** Reasignación de una orden. Vuelve a la bandeja al confirmar. */
export default function PantallaReasignar() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { cargarOrden, tecnicosDeSede, reasignar } = useDatos();

  const [datos, setDatos] = useState<DatosOrden | null | undefined>(undefined);
  const [tecnicos, setTecnicos] = useState<TecnicoLocal[]>([]);
  const [procesando, setProcesando] = useState(false);

  useEffect(() => {
    let vigente = true;
    void (async () => {
      if (!id) return;
      const d = await cargarOrden(id);
      if (!vigente) return;
      setDatos(d);
      if (!d) return;
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

  // null: no está en el teléfono. Antes la rueda giraba para siempre.
  if (datos === null) return <OrdenNoDisponible />;
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
