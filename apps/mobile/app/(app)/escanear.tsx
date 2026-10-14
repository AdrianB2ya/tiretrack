import { useRouter } from "expo-router";
import { EscanerQR } from "../../src/flota/EscanerQR";

/** Escanear el QR del vehículo (R15): abre su ficha. */
export default function RutaEscanear() {
  const router = useRouter();
  // replace: "atrás" desde la ficha vuelve a donde se estaba, no a la cámara.
  return <EscanerQR onVehiculo={(id) => router.replace(`/vehiculo/${id}` as never)} />;
}
