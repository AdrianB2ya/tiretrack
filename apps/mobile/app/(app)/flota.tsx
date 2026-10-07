import { useCallback } from "react";
import { PantallaFlota, type Deshabilitar } from "../../src/flota/PantallaFlota";
import { useDatos } from "../../src/app/ProveedorDatos";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { useServicios } from "../../src/app/Arranque";

const RUTA = { cliente: "clientes", sede: "sedes", vehiculo: "vehiculos" } as const;

/** Clientes, sedes y vehículos. */
export default function RutaFlota() {
  const usuario = useUsuario();
  const { fuentesFlota, accionesFlota, sincronizar } = useDatos();
  const { enLinea } = useServicios();
  const deshabilitar = useCallback<Deshabilitar>(
    async (que, id) => {
      const r = await enLinea("POST", `/flota/${RUTA[que]}/${id}/desactivar`, {});
      if (!r.ok) return { ok: false, mensaje: r.status === 0 ? "Sin señal: deshabilitar necesita conexión." : r.mensaje };
      // Trae la flota con el cambio, para que deje de ofrecerse aquí también.
      await sincronizar();
      return { ok: true };
    },
    [enLinea, sincronizar],
  );
  return <PantallaFlota rol={usuario.rol} fuentes={fuentesFlota} acciones={accionesFlota} deshabilitar={deshabilitar} />;
}
