import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { FichaLlanta, type FichaVista, type FuentesFicha } from "../../../src/llantas/FichaLlanta";
import { useServicios } from "../../../src/app/Arranque";
import { useDatos } from "../../../src/app/ProveedorDatos";
import { useUsuario } from "../../../src/app/ProveedorSesion";
import { puedeGestionarCatalogo } from "../../../src/app/navegacion";

/** Ficha de una llanta (R8). */
export default function RutaFichaLlanta() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const { fuentesOrden } = useDatos();
  const [sedes, setSedes] = useState<{ id: string; nombre: string }[]>([]);
  useEffect(() => {
    void fuentesOrden.sedes().then(setSedes);
  }, [fuentesOrden]);
  const fuentes = useMemo<FuentesFicha>(
    () => ({
      cargar: () => enLinea<FichaVista>("GET", `/llantas/${id ?? ""}`),
      mover: puedeGestionarCatalogo(usuario.rol) ? (m) => enLinea("POST", `/llantas/${id ?? ""}/movimientos`, m) : null,
      sedes,
    }),
    [enLinea, id, usuario.rol, sedes],
  );
  return <FichaLlanta fuentes={fuentes} />;
}
