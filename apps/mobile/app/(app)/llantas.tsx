import { useMemo } from "react";
import { useRouter } from "expo-router";
import { PantallaLlantas, type FuentesLlantas, type LlantaVista } from "../../src/llantas/PantallaLlantas";
import { useServicios } from "../../src/app/Arranque";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { puedeGestionarCatalogo } from "../../src/app/navegacion";

/** Inventario de llantas (R8): en línea; la oficina además da de alta. */
export default function RutaLlantas() {
  const router = useRouter();
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const fuentes = useMemo<FuentesLlantas>(
    () => ({
      listar: (f) => {
        const q = new URLSearchParams({ ...(f.estado ? { estado: f.estado } : {}), ...(f.buscar ? { buscar: f.buscar } : {}) }).toString();
        return enLinea<LlantaVista[]>("GET", `/llantas${q ? `?${q}` : ""}`);
      },
    }),
    [enLinea],
  );
  return (
    <PantallaLlantas
      fuentes={fuentes}
      onAbrir={(id) => router.push(`/llanta/${id}` as never)}
      {...(puedeGestionarCatalogo(usuario.rol) ? { onAlta: () => router.push("/llanta-nueva" as never) } : {})}
    />
  );
}
