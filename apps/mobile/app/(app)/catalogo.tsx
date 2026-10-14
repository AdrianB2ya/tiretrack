import { useMemo } from "react";
import { PantallaCatalogo, type FuentesCatalogo } from "../../src/catalogo/PantallaCatalogo";
import { useServicios } from "../../src/app/Arranque";
import { useDatos } from "../../src/app/ProveedorDatos";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { puedeGestionarCatalogo } from "../../src/app/navegacion";
import { Vacio } from "../../src/diseno/componentes";

/** Catálogo de llantas (R1): la oficina lo consulta y lo completa. */
export default function RutaCatalogo() {
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const { accionesCatalogo } = useDatos();
  const fuentes = useMemo<FuentesCatalogo>(
    () => ({
      catalogo: accionesCatalogo,
      fijarProfundidad: (id, profundidad) =>
        enLinea("POST", `/catalogo/medidas/${id}/profundidad`, { profundidadOriginal: profundidad }),
    }),
    [accionesCatalogo, enLinea],
  );
  if (!puedeGestionarCatalogo(usuario.rol)) {
    return <Vacio mensaje="El catálogo lo administra la oficina. En la posición puedes agregar lo que falte." />;
  }
  return <PantallaCatalogo fuentes={fuentes} />;
}
