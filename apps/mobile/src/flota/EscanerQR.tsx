import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { leerQRVehiculo } from "@tiretrack/domain";
import { Aviso, Boton, Vacio } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";

/**
 * Escanear el QR pegado en el vehículo (R15). Abre su ficha: el técnico deja
 * de buscar por placa entre veinte camiones parecidos.
 *
 * Una lectura a la vez: la cámara reporta el mismo código muchas veces por
 * segundo y abriría la ficha diez veces. Un código que no es de un vehículo
 * se dice y se puede volver a apuntar.
 */
export function EscanerQR({ onVehiculo }: { onVehiculo: (vehiculoId: string) => void }) {
  const [permiso, pedirPermiso] = useCameraPermissions();
  const ocupado = useRef(false);
  const [aviso, setAviso] = useState<string | null>(null);

  if (!permiso) return <Vacio mensaje="Preparando la cámara…" />;
  if (!permiso.granted) {
    return (
      <View style={estilos.centrado}>
        <Aviso
          tono="advertencia"
          titulo="La app no tiene permiso de cámara"
          detalle={
            permiso.canAskAgain
              ? "Se usa solo para leer el código QR del vehículo."
              : "Actívalo en Ajustes del teléfono → Aplicaciones → Asistectire → Permisos → Cámara."
          }
        />
        {permiso.canAskAgain ? (
          <Boton testID="permitir-camara" onPress={() => void pedirPermiso()}>
            Permitir la cámara
          </Boton>
        ) : null}
      </View>
    );
  }

  const leer = (data: string) => {
    if (ocupado.current) return;
    ocupado.current = true;
    const id = leerQRVehiculo(data);
    if (id) {
      setAviso(null);
      onVehiculo(id);
      return;
    }
    setAviso("Ese código no es de un vehículo de Asistectire. Apunta al QR pegado en el vehículo.");
    // Un respiro antes de volver a leer: si no, el mismo código equivocado
    // dispararía el aviso sin parar.
    setTimeout(() => {
      ocupado.current = false;
    }, 1500);
  };

  return (
    <View style={estilos.pantalla}>
      <CameraView
        style={estilos.camara}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(r: { data: string }) => leer(r.data)}
      />
      <View style={estilos.pie}>
        <Text style={estilos.instruccion}>Apunta al código QR pegado en el vehículo.</Text>
        {aviso ? <Aviso tono="advertencia" titulo="Código no reconocido" detalle={aviso} /> : null}
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  camara: { flex: 1 },
  pie: { padding: espacio.lg, gap: espacio.sm },
  centrado: { flex: 1, justifyContent: "center", padding: espacio.lg, gap: espacio.md, backgroundColor: colores.fondo },
  instruccion: { ...texto.cuerpoFuerte, color: colores.texto, textAlign: "center" },
});
