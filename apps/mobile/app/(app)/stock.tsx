import { useMemo } from "react";
import { PantallaStock, type FilaStock, type FuentesStock } from "../../src/llantas/PantallaStock";
import { useServicios } from "../../src/app/Arranque";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { puedeGestionarCatalogo } from "../../src/app/navegacion";
import { Vacio } from "../../src/diseno/componentes";

/** Stock de bodega por sede y medida (R8). */
export default function RutaStock() {
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const fuentes = useMemo<FuentesStock>(
    () => ({
      cargar: () => enLinea<FilaStock[]>("GET", "/llantas/stock"),
      fijarMinimo: (sedeId, medida, cantidad) => enLinea("POST", "/llantas/stock-minimo", { sedeId, medida, cantidad }),
    }),
    [enLinea],
  );
  if (!puedeGestionarCatalogo(usuario.rol)) return <Vacio mensaje="El stock de bodega es de la oficina." />;
  return <PantallaStock fuentes={fuentes} />;
}
