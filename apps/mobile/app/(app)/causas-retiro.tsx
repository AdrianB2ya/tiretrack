import { useMemo } from "react";
import { PantallaCausas, type Causas, type FuentesCausas } from "../../src/llantas/PantallaCausas";
import { useServicios } from "../../src/app/Arranque";

/** Causas de retiro (R10). En línea; el cliente ve las de su flota. */
export default function RutaCausas() {
  const { enLinea } = useServicios();
  const fuentes = useMemo<FuentesCausas>(
    () => ({
      cargar: (f) => enLinea<Causas>("GET", `/informe/causas-retiro${f.desde ? `?desde=${f.desde}` : ""}`),
    }),
    [enLinea],
  );
  return <PantallaCausas fuentes={fuentes} />;
}
