import { useMemo } from "react";
import { puedeRevisarCreadasEnCampo } from "@tiretrack/domain";
import { PantallaRevisionCatalogo, type FuentesRevision, type Revision } from "../../src/admin/PantallaRevisionCatalogo";
import { useServicios } from "../../src/app/Arranque";
import { useDatos } from "../../src/app/ProveedorDatos";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { Vacio } from "../../src/diseno/componentes";

const RUTA = { marca: "marcas", diseno: "disenos" } as const;

/** Marcas y diseños creados en campo: los revisa el administrador, en línea. */
export default function RutaRevisionCatalogo() {
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const { sincronizar } = useDatos();
  const fuentes = useMemo<FuentesRevision>(
    () => ({
      cargar: () => enLinea<Revision>("GET", "/catalogo/revision"),
      aprobar: (tipo, id) => enLinea("POST", `/catalogo/${RUTA[tipo]}/${id}/aprobar`, {}),
      unificar: async (tipo, id, destinoId) => {
        const r = await enLinea<{ disenosUnificados: number }>("POST", `/catalogo/${RUTA[tipo]}/${id}/unificar`, { destinoId });
        // La duplicada deja de ofrecerse también en este teléfono.
        if (r.ok) void sincronizar();
        return r;
      },
    }),
    [enLinea, sincronizar],
  );
  // El superadmin no tiene empresa: no hay "lo creado aquí" que revisar.
  if (!puedeRevisarCreadasEnCampo(usuario.rol) || usuario.rol === "superadmin") return <Vacio mensaje="Lo creado en campo lo revisa el administrador." />;
  return <PantallaRevisionCatalogo fuentes={fuentes} />;
}
