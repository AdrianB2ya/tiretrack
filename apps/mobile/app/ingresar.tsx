import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { PantallaIngreso } from "../src/sesion/PantallaIngreso";
import { ingresar, type Credenciales, type ResultadoIngreso } from "../src/sesion/ingreso";
import { useServicios } from "../src/app/Arranque";
import { destinoInicial } from "../src/app/ProveedorSesion";

/**
 * Ingreso.
 *
 * Al entrar se va al destino que corresponde al rol, con `replace`: volver
 * atrás no debe devolver a la pantalla de ingreso con la sesión ya abierta.
 */
export default function PantallaIngresar() {
  const router = useRouter();
  const { sesion, apiUrl } = useServicios();
  const [entrando, setEntrando] = useState(false);

  const abrirSesion = useCallback(
    async (c: Credenciales, forzar: boolean): Promise<ResultadoIngreso | { tipo: "trabajo_de_otro"; mensaje: string }> => {
      setEntrando(true);
      try {
        const r = await ingresar({ baseUrl: apiUrl }, c);
        if (r.tipo !== "ok") return r;

        const abierta = await sesion.iniciar(
          { token: r.token, refreshToken: r.refreshToken, usuario: r.usuario },
          forzar,
        );
        if (!abierta.ok) {
          // Queda trabajo sin enviar de otro técnico: no se entra encima.
          return { tipo: "trabajo_de_otro", mensaje: abierta.veredicto.mensaje ?? "" };
        }
        router.replace(destinoInicial(r.usuario) as never);
        return r;
      } finally {
        setEntrando(false);
      }
    },
    [apiUrl, sesion, router],
  );

  return (
    <PantallaIngreso
      onIngresar={(c) => abrirSesion(c, false)}
      onDescartarYEntrar={async (c) => {
        await abrirSesion(c, true);
      }}
      entrando={entrando}
    />
  );
}
