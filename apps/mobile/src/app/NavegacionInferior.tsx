import { useRouter } from "expo-router";
import { BarraNavegacion } from "./BarraNavegacion";
import { pestanasPara, type Pestana } from "./navegacion";
import { useUsuario } from "./ProveedorSesion";
import { useDatos } from "./ProveedorDatos";

/**
 * La barra unida a la sesión y al enrutador.
 *
 * Se cambia de pestaña con `replace`, no con `push`: pasar entre pestañas no
 * debe ir apilando pantallas, o "atrás" recorrería todo el historial de
 * toques en vez de salir.
 */
export function NavegacionInferior({ activa }: { activa: Pestana }) {
  const router = useRouter();
  const usuario = useUsuario();
  const { ordenes } = useDatos();
  const porRevisar = ordenes.filter((o) => o.orden.estado === "en_revision").length;
  return (
    <BarraNavegacion
      pestanas={pestanasPara(usuario.rol)}
      activa={activa}
      porRevisar={porRevisar}
      onIr={(p) => router.replace(p.ruta as never)}
    />
  );
}
