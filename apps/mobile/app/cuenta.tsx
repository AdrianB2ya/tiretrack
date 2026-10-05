import { useRouter } from "expo-router";
import { PantallaCuenta } from "../src/sesion/PantallaCuenta";
import { useSesion } from "../src/app/ProveedorSesion";
import { useDatos } from "../src/app/ProveedorDatos";

/** Cuenta y cierre de sesión. */
export default function RutaCuenta() {
  const router = useRouter();
  const { usuario, cerrar } = useSesion();
  const { sincronizar, sincronizando } = useDatos();

  // Recién cerrada la sesión, la pantalla aún se dibuja una vez sin usuario.
  if (!usuario) return null;

  return (
    <PantallaCuenta
      usuario={usuario}
      onCerrar={cerrar}
      onSincronizar={sincronizar}
      sincronizando={sincronizando}
      // replace: volver atrás no debe regresar a una pantalla con sesión.
      onCerrada={() => router.replace("/ingresar" as never)}
    />
  );
}
