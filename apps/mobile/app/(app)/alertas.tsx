import { useCallback } from "react";
import { useRouter } from "expo-router";
import { puedeAprobar } from "@tiretrack/domain";
import { AlertasLlantas, type AlertaLlanta } from "../../src/coordinador/AlertasLlantas";
import { useServicios } from "../../src/app/Arranque";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { Vacio } from "../../src/diseno/componentes";

/** Llantas para cambiar, de las sedes de quien consulta. En línea. */
export default function RutaAlertas() {
  const router = useRouter();
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const cargar = useCallback(() => enLinea<AlertaLlanta[]>("GET", "/alertas"), [enLinea]);
  if (!puedeAprobar(usuario.rol)) return <Vacio mensaje="Las alertas de llantas son de la oficina." />;
  return <AlertasLlantas cargar={cargar} onProgramar={() => router.push("/nueva-orden" as never)} />;
}
