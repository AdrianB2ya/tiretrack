import { useMemo } from "react";
import { PantallaCatalogo, type FuentesCatalogo } from "../../src/catalogo/PantallaCatalogo";
import { accionesCatalogoGeneral } from "../../src/plataforma/catalogoGeneral";
import { useServicios } from "../../src/app/Arranque";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { Vacio } from "../../src/diseno/componentes";

/** Catálogo general de la plataforma: lo que ven todas las empresas. Superadmin, en línea. */
export default function RutaCatalogoGeneral() {
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const fuentes = useMemo<FuentesCatalogo>(
    () => ({
      catalogo: accionesCatalogoGeneral(enLinea),
      fijarProfundidad: (id, profundidad) =>
        enLinea("POST", `/plataforma/catalogo/medidas/${id}/profundidad`, { profundidadOriginal: profundidad }),
      descripcion:
        "El catálogo general: marcas, diseños y medidas que ven todas las empresas. Se administra en línea. Lo propio de cada empresa lo maneja su oficina.",
    }),
    [enLinea],
  );
  if (usuario.rol !== "superadmin") return <Vacio mensaje="El catálogo general lo administra la plataforma." />;
  return <PantallaCatalogo fuentes={fuentes} />;
}
