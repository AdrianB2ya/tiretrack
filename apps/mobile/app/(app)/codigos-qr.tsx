import { useMemo } from "react";
import { fechaEnColombia } from "@tiretrack/domain";
import { PantallaEtiquetasQR, type FuentesEtiquetas } from "../../src/flota/PantallaEtiquetasQR";
import { bajarACache, compartirUri } from "../../src/informe/compartirArchivo";
import { useServicios } from "../../src/app/Arranque";
import { useDatos } from "../../src/app/ProveedorDatos";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { puedeGestionarCatalogo } from "../../src/app/navegacion";
import { Vacio } from "../../src/diseno/componentes";

/** Etiquetas QR de los vehículos de un cliente (R15). Oficina, en línea. */
export default function RutaCodigosQR() {
  const usuario = useUsuario();
  const { descargarArchivo } = useServicios();
  const { fuentesFlota } = useDatos();
  const fuentes = useMemo<FuentesEtiquetas>(
    () => ({
      clientes: () => fuentesFlota.clientes(),
      descargar: async (clienteId) => {
        const r = await descargarArchivo(
          `/flota/qr?clienteId=${encodeURIComponent(clienteId)}`,
          bajarACache(`codigos-qr-${fechaEnColombia()}.pdf`),
        );
        if (!r.ok) return r;
        const c = await compartirUri(r.uri, "application/pdf");
        return c.ok ? { ok: true } : { ok: false, status: 0, mensaje: c.mensaje };
      },
    }),
    [descargarArchivo, fuentesFlota],
  );
  if (!puedeGestionarCatalogo(usuario.rol)) return <Vacio mensaje="Las etiquetas las imprime la oficina." />;
  return <PantallaEtiquetasQR fuentes={fuentes} />;
}
