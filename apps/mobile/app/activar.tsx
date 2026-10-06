import { Linking } from "react-native";
import { useRouter } from "expo-router";
import { PantallaActivacion } from "../src/sesion/PantallaActivacion";
import { activar } from "../src/sesion/activacion";
import { ingresar } from "../src/sesion/ingreso";
import { useServicios } from "../src/app/Arranque";
import { destinoInicial, useSesion } from "../src/app/ProveedorSesion";

/**
 * Activación con el código del administrador. Al terminar entra solo, con la
 * contraseña que la persona acaba de elegir: pedírsela otra vez sería un
 * paso de más con guantes.
 */
export default function RutaActivar() {
  const router = useRouter();
  const { apiUrl } = useServicios();
  const { iniciar } = useSesion();

  return (
    <PantallaActivacion
      onVolver={() => router.replace("/ingresar" as never)}
      // El enlace otpauth abre la app autenticadora con la cuenta lista.
      onAbrirAutenticador={(uri) => void Linking.openURL(uri).catch(() => undefined)}
      onActivar={async (d) => {
        const r = await activar({ baseUrl: apiUrl }, d);
        if (r.tipo !== "ok") return r;
        const sesion = await ingresar({ baseUrl: apiUrl }, {
          email: d.email,
          password: d.password,
          ...(d.empresaId ? { empresaId: d.empresaId } : {}),
          ...(d.codigo2fa ? { codigo2fa: d.codigo2fa } : {}),
        });
        if (sesion.tipo === "ok") {
          const abierta = await iniciar({ token: sesion.token, refreshToken: sesion.refreshToken, usuario: sesion.usuario });
          if (abierta.ok) {
            router.replace(destinoInicial(sesion.usuario) as never);
            return r;
          }
        }
        // Activada, pero no se pudo entrar de una vez (p. ej. el código de 6
        // números ya cambió): que entre desde el ingreso, ya con su clave.
        router.replace("/ingresar" as never);
        return r;
      }}
    />
  );
}
