import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { puedeAprobar } from "@tiretrack/domain";
import { FichaVehiculo } from "../../../src/flota/FichaVehiculo";
import type { FichaVehiculoLocal } from "../../../src/datos/repositorio";
import { bajarACache, compartirUri } from "../../../src/informe/compartirArchivo";
import { useServicios } from "../../../src/app/Arranque";
import { useDatos } from "../../../src/app/ProveedorDatos";
import { useUsuario } from "../../../src/app/ProveedorSesion";

/**
 * Ficha del vehículo (R15). La abre el QR, desde la cámara de la app o como
 * enlace `asistectire://vehiculo/<id>`.
 */
export default function RutaVehiculo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const usuario = useUsuario();
  const { fichaVehiculo, ordenes } = useDatos();
  const { descargarArchivo } = useServicios();
  const [ficha, setFicha] = useState<FichaVehiculoLocal | null | undefined>(undefined);

  useEffect(() => {
    let vivo = true;
    void fichaVehiculo(String(id ?? ""))
      .then((f) => vivo && setFicha(f))
      .catch(() => vivo && setFicha(null));
    return () => {
      vivo = false;
    };
  }, [id, fichaVehiculo]);

  const suyas = useMemo(() => ordenes.filter((o) => o.orden.vehiculoId === id), [ordenes, id]);
  const oficina = puedeAprobar(usuario.rol);
  const creaOrdenes = oficina || usuario.rol === "tecnico";

  return (
    <FichaVehiculo
      ficha={ficha}
      ordenes={suyas}
      onAbrirOrden={(ordenId) => router.push(`/orden/${ordenId}` as never)}
      {...(creaOrdenes ? { onNuevaOrden: () => router.push("/nueva-orden" as never) } : {})}
      {...(oficina && ficha
        ? {
            onImprimirQR: () =>
              void (async () => {
                const r = await descargarArchivo(`/flota/qr?vehiculoId=${encodeURIComponent(ficha.id)}`, bajarACache(`qr-${ficha.codigo}.pdf`));
                if (r.ok) await compartirUri(r.uri, "application/pdf");
              })(),
          }
        : {})}
    />
  );
}
