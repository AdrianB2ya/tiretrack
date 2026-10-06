import { useMemo } from "react";
import { nuevoId, puedeGestionarConfiguraciones } from "@tiretrack/domain";
import { PantallaPlantillas, type FuentesPlantillas } from "../src/flota/PantallaPlantillas";
import { useServicios } from "../src/app/Arranque";
import { useDatos } from "../src/app/ProveedorDatos";
import { useUsuario } from "../src/app/ProveedorSesion";
import { Vacio } from "../src/diseno/componentes";

/**
 * Plantillas de ejes. Crear y versionar es en línea: una plantilla define cómo
 * se dibujan los vehículos de toda la empresa y no puede quedar a medias en
 * un celular. Al terminar se sincroniza para que la nueva llegue a la lista.
 */
export default function RutaPlantillas() {
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const { fuentesFlota, posicionesPlantilla, sincronizar } = useDatos();
  const fuentes = useMemo<FuentesPlantillas>(
    () => ({
      plantillas: () => fuentesFlota.plantillas(),
      posicionesDe: posicionesPlantilla,
      crear: async (nombre, ejes) => {
        const r = await enLinea("POST", "/configuraciones", { id: nuevoId(), nombre, ejes });
        if (r.ok) await sincronizar();
        return r.ok ? r : { ok: false, codigo: r.codigo, mensaje: r.mensaje };
      },
      nuevaVersion: async (id, ejes, confirmado) => {
        const r = await enLinea<{ vehiculosMovidos: number }>("POST", `/configuraciones/${id}/version`, {
          ejes,
          ...(confirmado ? { confirmado: true } : {}),
        });
        if (r.ok) await sincronizar();
        return r.ok ? r : { ok: false, codigo: r.codigo, mensaje: r.mensaje };
      },
    }),
    [enLinea, fuentesFlota, posicionesPlantilla, sincronizar],
  );
  if (!puedeGestionarConfiguraciones(usuario.rol)) {
    return <Vacio mensaje="Solo el administrador define las plantillas de ejes." />;
  }
  return <PantallaPlantillas fuentes={fuentes} />;
}
