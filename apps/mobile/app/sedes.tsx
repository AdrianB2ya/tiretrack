import { useMemo } from "react";
import { nuevoId, puedeGestionarUsuarios } from "@tiretrack/domain";
import { PantallaSedes, type FuentesSedes } from "../src/admin/PantallaSedes";
import { useServicios } from "../src/app/Arranque";
import { useUsuario } from "../src/app/ProveedorSesion";
import { Vacio } from "../src/diseno/componentes";

/** Sedes de la empresa. En línea. */
export default function RutaSedes() {
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const fuentes = useMemo<FuentesSedes>(
    () => ({
      sedes: async () => {
        const r = await enLinea<{ id: string; nombre: string; codigo: string; ciudad: string | null }[]>("GET", "/sedes");
        return r.ok ? { ok: true, datos: r.datos } : { ok: false, mensaje: r.mensaje };
      },
      crear: async (s) => {
        const r = await enLinea("POST", "/sedes", { id: nuevoId(), ...s });
        return r.ok ? { ok: true, datos: r.datos } : { ok: false, mensaje: r.mensaje };
      },
    }),
    [enLinea],
  );
  if (!puedeGestionarUsuarios(usuario.rol)) return <Vacio mensaje="Solo el administrador gestiona las sedes." />;
  return <PantallaSedes fuentes={fuentes} />;
}
