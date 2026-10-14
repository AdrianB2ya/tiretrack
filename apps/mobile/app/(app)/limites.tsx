import { useMemo } from "react";
import type { LimitesEmpresa } from "@tiretrack/domain";
import { PantallaLimites, type FuentesLimites } from "../../src/admin/PantallaLimites";
import { useServicios } from "../../src/app/Arranque";
import { useDatos } from "../../src/app/ProveedorDatos";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { Vacio } from "../../src/diseno/componentes";

/** Límites de cambio de llanta (R2): los fija el administrador, en línea. */
export default function RutaLimites() {
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const { sincronizar } = useDatos();
  const fuentes = useMemo<FuentesLimites>(
    () => ({
      cargar: () => enLinea<LimitesEmpresa>("GET", "/empresa/limites"),
      guardar: async (l) => {
        const r = await enLinea<LimitesEmpresa>("POST", "/empresa/limites", l);
        // Este teléfono los toma ya; los demás, en su próxima sincronización.
        if (r.ok) void sincronizar();
        return r;
      },
    }),
    [enLinea, sincronizar],
  );
  if (usuario.rol !== "administrador") return <Vacio mensaje="Los límites de la empresa los fija el administrador." />;
  return <PantallaLimites fuentes={fuentes} />;
}
