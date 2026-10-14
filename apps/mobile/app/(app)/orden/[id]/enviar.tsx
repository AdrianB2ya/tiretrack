import { useCallback, useEffect, useState } from "react";
import { esFalla, retirosSinFoto } from "@tiretrack/domain";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PantallaEnvio } from "../../../../src/ordenes/PantallaEnvio";
import { useDatos, type DatosOrden } from "../../../../src/app/ProveedorDatos";
import { useUsuario } from "../../../../src/app/ProveedorSesion";
import { colores } from "../../../../src/diseno/tokens";
import { OrdenNoDisponible } from "../../../../src/ordenes/OrdenNoDisponible";

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
  const { cargarOrden, cambiarEstado, pendientesDeEnviar, fotosSinSubir, fotosDe } = useDatos();
  const usuario = useUsuario();

  const [datos, setDatos] = useState<DatosOrden | null | undefined>(undefined);
  const [enviando, setEnviando] = useState(false);
  const [sinSubir, setSinSubir] = useState(0);
  const [sinFoto, setSinFoto] = useState<number[]>([]);

  useEffect(() => {
    let vigente = true;
    void (async () => {
      if (!id) return;
      const d = await cargarOrden(id);
      // Antes era 0 fijo: el envío nunca advertía de fotos sin subir.
      const n = await fotosSinSubir(id);
      // R10: las llantas retiradas por falla necesitan su foto.
      const fotos = new Map<number, number>();
      for (const m of d?.mediciones ?? []) {
        if (esFalla(m.desmontada?.motivoRetiro)) fotos.set(m.posicion, (await fotosDe(id, m.id)).length);
      }
      const faltan = retirosSinFoto(
        (d?.mediciones ?? []).map((m) => ({ posicion: m.posicion, motivoRetiro: m.desmontada?.motivoRetiro ?? null })),
        fotos,
      );
      if (vigente) {
        setDatos(d);
        setSinSubir(n);
        setSinFoto(faltan);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [id, cargarOrden, fotosSinSubir, fotosDe]);

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
    <PantallaEnvio
      estado={{
        orden: datos.orden,
        diagrama: datos.diagrama,
        fotosSinSubir: sinSubir,
        operacionesPendientes: pendientesDeEnviar,
        retirosSinFoto: sinFoto,
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
