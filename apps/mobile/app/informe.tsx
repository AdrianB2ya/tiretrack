import { useMemo } from "react";
import { PantallaInforme, type FuentesInforme } from "../src/informe/PantallaInforme";
import { compartirArchivo } from "../src/informe/compartirArchivo";
import { nombreDeDescarga } from "../src/informe/reglasInforme";
import { useServicios } from "../src/app/Arranque";
import { useDatos } from "../src/app/ProveedorDatos";

/**
 * Informe y exportación. Quién puede exportar lo decide el servidor (sigue
 * siendo una decisión abierta, CLAUDE.md); la app no lo duplica.
 */
export default function RutaInforme() {
  const { enLinea, descargarTexto } = useServicios();
  const { fuentesFlota } = useDatos();
  const fuentes = useMemo<FuentesInforme>(
    () => ({
      clientes: () => fuentesFlota.clientes(),
      vistaPrevia: (q) => enLinea("GET", `/informe/resumen${q}`),
      trazabilidad: (serial) => enLinea("GET", `/informe/trazabilidad?serial=${encodeURIComponent(serial)}`),
      exportar: async (q) => {
        const r = await descargarTexto(`/informe/exportar${q}`);
        if (!r.ok) return r;
        return { ok: true, texto: r.texto, nombre: nombreDeDescarga(r.encabezado("content-disposition")) };
      },
      compartir: compartirArchivo,
      hoy: () => {
        // Fecha local del celular: "hoy" es el día del coordinador, no el de UTC.
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      },
    }),
    [enLinea, descargarTexto, fuentesFlota],
  );
  return <PantallaInforme fuentes={fuentes} />;
}
