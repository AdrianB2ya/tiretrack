import { useState } from "react";
import { View } from "react-native";
import { Aviso, Boton } from "../diseno/componentes";
import { espacio } from "../diseno/tokens";

/**
 * Descargar el PDF de la orden y abrir la hoja de compartir (WhatsApp, correo…).
 * En línea: el documento lo arma el servidor, con los datos congelados.
 */
export function BotonPdf({ descargar, compartir }: {
  descargar: () => Promise<{ ok: true; uri: string } | { ok: false; status: number; mensaje: string }>;
  compartir: (uri: string) => Promise<{ ok: true } | { ok: false; mensaje: string }>;
}) {
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pedir = async () => {
    setBajando(true);
    setError(null);
    try {
      const r = await descargar();
      if (!r.ok) return setError(r.mensaje);
      const c = await compartir(r.uri);
      if (!c.ok) setError(c.mensaje);
    } catch (e) {
      // Nada se queda sin atrapar: "toqué y no pasó nada" no es aceptable.
      setError(`No se pudo descargar: ${(e as Error).message}`);
    } finally {
      setBajando(false);
    }
  };

  return (
    <View style={{ gap: espacio.sm }}>
      <Boton tipo="secundario" ancho testID="descargar-pdf" cargando={bajando} onPress={() => void pedir()}>
        Descargar PDF de la orden
      </Boton>
      {error ? <Aviso tono="advertencia" titulo="No se descargó el PDF" detalle={error} /> : null}
    </View>
  );
}
