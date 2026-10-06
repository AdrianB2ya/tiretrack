import { useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import { Evidencia, type FotoServidor } from "../../../../src/fotos/Evidencia";
import { useServicios } from "../../../../src/app/Arranque";

/** La evidencia de la orden en el servidor, vista desde cualquier teléfono. */
export default function RutaEvidencia() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { enLinea } = useServicios();
  const cargar = useCallback(
    () => enLinea<FotoServidor[]>("GET", `/ordenes/${id ?? ""}/fotos`),
    [enLinea, id],
  );
  return <Evidencia cargar={cargar} />;
}
