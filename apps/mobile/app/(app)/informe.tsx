import { useMemo } from "react";
import { fechaEnColombia } from "@tiretrack/domain";
import { PantallaInforme, type FuentesInforme } from "../../src/informe/PantallaInforme";
import { bajarACache, compartirArchivo, compartirUri } from "../../src/informe/compartirArchivo";
import { nombreDeDescarga } from "../../src/informe/reglasInforme";
import { useServicios } from "../../src/app/Arranque";
import { useDatos } from "../../src/app/ProveedorDatos";

/**
 * Informe y exportación. Quién puede exportar lo decide el servidor (sigue
 * siendo una decisión abierta, CLAUDE.md); la app no lo duplica.
 */
export default function RutaInforme() {
  const { enLinea, descargarTexto, descargarArchivo } = useServicios();
  const { fuentesFlota } = useDatos();
  const fuentes = useMemo<FuentesInforme>(
    () => ({
      clientes: () => fuentesFlota.clientes(),
      vehiculosDe: async (clienteId) => {
        const sedes = await fuentesFlota.sedesDeCliente(clienteId);
        const listas = await Promise.all(sedes.map((s) => fuentesFlota.vehiculos(s.id)));
        return listas.flat().map((v) => ({ id: v.id, codigo: v.codigo, placa: v.placa }));
      },
      vistaPrevia: (q) => enLinea("GET", `/informe/resumen${q}`),
      trazabilidad: (serial) => enLinea("GET", `/informe/trazabilidad?serial=${encodeURIComponent(serial)}`),
      exportar: async (q) => {
        const r = await descargarTexto(`/informe/exportar${q}`);
        if (!r.ok) return r;
        return { ok: true, texto: r.texto, nombre: nombreDeDescarga(r.encabezado("content-disposition")) };
      },
      exportarPdf: async (q) => {
        const r = await descargarArchivo(`/informe/pdf${q}`, bajarACache(`ordenes-${fechaEnColombia()}.pdf`));
        if (!r.ok) return r;
        const c = await compartirUri(r.uri, "application/pdf");
        return c.ok ? { ok: true } : { ok: false, status: 0, mensaje: c.mensaje };
      },
      compartir: compartirArchivo,
      // El día en Colombia, igual que el servidor: no la zona que tenga
      // configurada el celular.
      hoy: () => fechaEnColombia(),
    }),
    [enLinea, descargarTexto, descargarArchivo, fuentesFlota],
  );
  return <PantallaInforme fuentes={fuentes} />;
}
