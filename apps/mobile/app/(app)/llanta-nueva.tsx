import { useMemo } from "react";
import { useRouter } from "expo-router";
import { AltaLlanta, type FuentesAlta } from "../../src/llantas/AltaLlanta";
import { useServicios } from "../../src/app/Arranque";
import { useDatos } from "../../src/app/ProveedorDatos";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { puedeGestionarCatalogo } from "../../src/app/navegacion";
import { Vacio } from "../../src/diseno/componentes";

/** Registrar una llanta en bodega (R8). Oficina, en línea. */
export default function RutaAltaLlanta() {
  const router = useRouter();
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const { fuentesOrden } = useDatos();
  const fuentes = useMemo<FuentesAlta>(
    () => ({
      clientes: () => fuentesOrden.clientes(),
      sedes: () => fuentesOrden.sedes(),
      crear: (a) => enLinea<{ id: string }>("POST", "/llantas", a),
    }),
    [enLinea, fuentesOrden],
  );
  if (!puedeGestionarCatalogo(usuario.rol)) return <Vacio mensaje="El inventario lo maneja la oficina." />;
  return <AltaLlanta fuentes={fuentes} onCreada={(id) => router.replace(`/llanta/${id}` as never)} />;
}
