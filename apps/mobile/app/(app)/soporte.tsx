import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { useServicios } from "../../src/app/Arranque";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { Vacio } from "../../src/diseno/componentes";
import { VistaSoporte } from "../../src/plataforma/VistaSoporte";
import { enLineaConToken, sesionSoporte } from "../../src/plataforma/soporte";

/** Vista de una sesión de soporte del superadmin (R16). Solo en memoria. */
export default function RutaSoporte() {
  const usuario = useUsuario();
  const router = useRouter();
  const { apiUrl } = useServicios();
  const [sesion] = useState(() => sesionSoporte.actual());
  const enLinea = useMemo(() => (sesion ? enLineaConToken(apiUrl, sesion.token) : null), [apiUrl, sesion]);
  if (usuario.rol !== "superadmin" || !sesion || !enLinea) {
    return <Vacio mensaje="No hay una sesión de soporte abierta. Se abre desde la pantalla de plataforma." />;
  }
  return (
    <VistaSoporte
      sesion={sesion}
      enLinea={enLinea}
      onTerminada={() => {
        sesionSoporte.limpiar();
        router.replace("/plataforma" as never);
      }}
    />
  );
}
