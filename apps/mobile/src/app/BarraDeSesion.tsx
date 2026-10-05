import { useRouter } from "expo-router";
import { useSesion } from "./ProveedorSesion";
import { BarraSesion } from "../sesion/BarraSesion";

/** Unión de la barra con la sesión y la navegación. La barra se prueba aparte. */
export function BarraDeSesion() {
  const router = useRouter();
  const { usuario } = useSesion();
  if (!usuario) return null;
  return (
    <BarraSesion
      nombre={usuario.nombre}
      rol={usuario.rol}
      onCuenta={() => router.push("/cuenta" as never)}
    />
  );
}
