import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CapturaFirma } from "../../../src/ordenes/CapturaFirma";
import { useDatos } from "../../../src/app/ProveedorDatos";

/**
 * Firma de quien recibe el vehículo.
 *
 * El componente estaba construido y probado desde la tarea 3.6, pero ninguna
 * ruta lo montaba: sin firma, ninguna orden podía enviarse a revisión.
 */
export default function RutaFirma() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { firmar } = useDatos();
  const [guardando, setGuardando] = useState(false);

  return (
    <CapturaFirma
      guardando={guardando}
      onCancelar={() => router.back()}
      onFirmar={(d) => {
        if (!id) return;
        setGuardando(true);
        void (async () => {
          try {
            await firmar(id, {
              nombre: d.nombre,
              cedula: d.cedula,
              cargo: d.cargo,
              trazo: d.trazoSerializado,
              consentimiento: d.consentimiento,
            });
            router.back();
          } finally {
            setGuardando(false);
          }
        })();
      }}
    />
  );
}
