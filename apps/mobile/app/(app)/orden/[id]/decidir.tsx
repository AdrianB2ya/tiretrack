import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { DecisionRevision } from "../../../../src/coordinador/BandejaRevision";
import type { OrdenEnBandeja } from "../../../../src/coordinador/bandeja";
import { useDatos } from "../../../../src/app/ProveedorDatos";
import { useUsuario } from "../../../../src/app/ProveedorSesion";
import { Boton } from "../../../../src/diseno/componentes";
import { colores, espacio, texto } from "../../../../src/diseno/tokens";

/**
 * Decisión del coordinador: aprobar, devolver con motivo o reasignar.
 *
 * DecisionRevision estaba construido y probado desde la tarea 4.1 y ninguna
 * ruta lo montaba: desde la bandeja, la orden se abría en el detalle del
 * técnico y no había forma de aprobarla ni de devolverla.
 */
export default function RutaDecidir() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { bandejaRevision, cambiarEstado, ordenes } = useDatos();
  const usuario = useUsuario();
  const [item, setItem] = useState<OrdenEnBandeja | null | undefined>(undefined);
  const [procesando, setProcesando] = useState(false);

  const cargar = useCallback(async () => {
    const lista = await bandejaRevision();
    setItem(lista.find((i) => i.orden.id === id) ?? null);
  }, [bandejaRevision, id]);

  useEffect(() => {
    void cargar();
  }, [cargar, ordenes]);

  const decidir = async (estado: "pendiente_cliente" | "en_proceso", motivo?: string) => {
    if (!id) return;
    setProcesando(true);
    try {
      await cambiarEstado(id, estado, motivo);
      // De vuelta a la bandeja: la orden ya salió de ella.
      router.replace("/revision" as never);
    } finally {
      setProcesando(false);
    }
  };

  if (item === undefined) {
    return (
      <View style={estilos.centrado}>
        <ActivityIndicator color={colores.primario} />
      </View>
    );
  }

  if (item === null) {
    // Ya no está en revisión: otro coordinador la decidió, o se sincronizó.
    return (
      <View style={estilos.centrado}>
        <Text style={estilos.texto}>Esta orden ya no está esperando revisión.</Text>
        <Boton tipo="secundario" onPress={() => router.replace("/revision" as never)}>
          Volver a la bandeja
        </Boton>
      </View>
    );
  }

  return (
    <View style={estilos.pantalla}>
      <DecisionRevision
        item={item}
        // Quien decide es quien mira: el rol y el id salen de la sesión.
        ctx={{ usuarioId: usuario.id, rol: usuario.rol }}
        procesando={procesando}
        onAprobar={() => void decidir("pendiente_cliente")}
        onDevolver={(motivo) => void decidir("en_proceso", motivo)}
      />
      <View style={estilos.pie}>
        <Boton tipo="fantasma" ancho onPress={() => router.push(`/orden/${item.orden.id}` as never)}>
          Ver el diagrama completo
        </Boton>
        <Boton tipo="fantasma" ancho onPress={() => router.push(`/orden/${item.orden.id}/reasignar` as never)}>
          Reasignar a otro técnico
        </Boton>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  centrado: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: espacio.md,
    padding: espacio.lg, backgroundColor: colores.fondo,
  },
  texto: { ...texto.cuerpo, color: colores.texto, textAlign: "center" },
  pie: { padding: espacio.md, gap: espacio.sm },
});
