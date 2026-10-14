import { useMemo } from "react";
import { PantallaTablero, type FuentesTablero, type Tablero } from "../../src/informe/PantallaTablero";
import { useServicios } from "../../src/app/Arranque";

/** Tablero de la flota (R11). En línea; el cliente ve el de su flota. */
export default function RutaTablero() {
  const { enLinea } = useServicios();
  const fuentes = useMemo<FuentesTablero>(() => ({ cargar: () => enLinea<Tablero>("GET", "/tablero") }), [enLinea]);
  return <PantallaTablero fuentes={fuentes} />;
}
