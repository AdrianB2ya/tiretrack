import { useMemo } from "react";
import { PantallaCarga, type FuentesCarga, type ResultadoCargaVista } from "../../src/carga/PantallaCarga";
import { elegirCSV } from "../../src/carga/elegirArchivo";
import { compartirArchivo } from "../../src/informe/compartirArchivo";
import { useServicios } from "../../src/app/Arranque";
import { useDatos } from "../../src/app/ProveedorDatos";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { puedeGestionarCatalogo } from "../../src/app/navegacion";
import { Vacio } from "../../src/diseno/componentes";

/** Carga masiva desde Excel (R12). Oficina, en línea. */
export default function RutaCarga() {
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const { sincronizar } = useDatos();
  const fuentes = useMemo<FuentesCarga>(
    () => ({
      elegir: elegirCSV,
      compartirPlantilla: compartirArchivo,
      cargar: async (tipo, csv) => {
        const r = await enLinea<ResultadoCargaVista>("POST", `/carga/${tipo}`, { csv });
        // Lo cargado aparece también en este teléfono.
        if (r.ok) void sincronizar();
        return r;
      },
    }),
    [enLinea, sincronizar],
  );
  if (!puedeGestionarCatalogo(usuario.rol)) return <Vacio mensaje="La carga masiva la hace la oficina." />;
  return <PantallaCarga fuentes={fuentes} />;
}
