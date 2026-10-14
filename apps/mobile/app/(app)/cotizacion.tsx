import { useMemo } from "react";
import { fechaEnColombia } from "@tiretrack/domain";
import { PantallaCotizacion, type FuentesCotizacion } from "../../src/informe/PantallaCotizacion";
import { bajarACache, compartirUri } from "../../src/informe/compartirArchivo";
import { useServicios } from "../../src/app/Arranque";
import { useDatos } from "../../src/app/ProveedorDatos";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { puedeGestionarCatalogo } from "../../src/app/navegacion";
import { Vacio } from "../../src/diseno/componentes";

/** Cotización de los cambios recomendados (R14). Oficina, en línea. */
export default function RutaCotizacion() {
  const usuario = useUsuario();
  const { enLinea, descargarArchivo } = useServicios();
  const { fuentesFlota } = useDatos();
  const fuentes = useMemo<FuentesCotizacion>(
    () => ({
      clientes: () => fuentesFlota.clientes(),
      ver: (q) => enLinea("GET", `/cotizacion${q}`),
      descargarPdf: async (q) => {
        const r = await descargarArchivo(`/cotizacion/pdf${q}`, bajarACache(`cotizacion-${fechaEnColombia()}.pdf`));
        if (!r.ok) return r;
        const c = await compartirUri(r.uri, "application/pdf");
        return c.ok ? { ok: true } : { ok: false, status: 0, mensaje: c.mensaje };
      },
      enviar: (q, para, mensaje) => enLinea("POST", `/cotizacion/enviar${q}`, { para, ...(mensaje ? { mensaje } : {}) }),
    }),
    [enLinea, descargarArchivo, fuentesFlota],
  );
  if (!puedeGestionarCatalogo(usuario.rol)) return <Vacio mensaje="La cotización la hace la oficina." />;
  return <PantallaCotizacion fuentes={fuentes} />;
}
