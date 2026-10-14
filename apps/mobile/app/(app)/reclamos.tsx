import { useMemo } from "react";
import { useRouter } from "expo-router";
import { PantallaReclamos, type FuentesReclamos, type ReclamoVista } from "../../src/llantas/PantallaReclamos";
import { useServicios } from "../../src/app/Arranque";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { puedeGestionarCatalogo } from "../../src/app/navegacion";
import { Vacio } from "../../src/diseno/componentes";

/** Garantías y reclamos (R10). Oficina, en línea. */
export default function RutaReclamos() {
  const router = useRouter();
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const fuentes = useMemo<FuentesReclamos>(
    () => ({
      cargar: () => enLinea<ReclamoVista[]>("GET", "/reclamos"),
      cambiar: (id, c) => enLinea("POST", `/reclamos/${id}/estado`, c),
    }),
    [enLinea],
  );
  if (!puedeGestionarCatalogo(usuario.rol)) return <Vacio mensaje="Los reclamos los lleva la oficina." />;
  return <PantallaReclamos fuentes={fuentes} onAbrirLlanta={(id) => router.push(`/llanta/${id}` as never)} />;
}
