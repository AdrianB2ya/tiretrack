import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Aviso } from "../diseno/componentes";
import { GaleriaFotos } from "./GaleriaFotos";
import { tomarYAdjuntar, type DependenciasFoto, type DestinoFoto } from "./tomarFoto";
import type { FotoEnGaleria } from "../datos/repositorio";

/**
 * Galería con cámara para una orden o una posición.
 *
 * La galería estaba construida desde la tarea 6.6 sin que ninguna pantalla
 * la mostrara: no había forma de tomar una foto en la app.
 */
export interface FotosDeProps {
  destino: DestinoFoto;
  cargar: () => Promise<FotoEnGaleria[]>;
  dependencias: Omit<DependenciasFoto, "adjuntar"> & Pick<DependenciasFoto, "adjuntar">;
  maximo: number;
  deshabilitada?: boolean;
}

export function FotosDe({ destino, cargar, dependencias, maximo, deshabilitada = false }: FotosDeProps) {
  const [fotos, setFotos] = useState<FotoEnGaleria[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [tomando, setTomando] = useState(false);

  const recargar = useCallback(async () => setFotos(await cargar()), [cargar]);
  useEffect(() => {
    void recargar();
  }, [recargar]);

  const tomar = async () => {
    if (tomando) return;
    setTomando(true);
    setAviso(null);
    try {
      const r = await tomarYAdjuntar(dependencias, destino);
      if (r.tipo === "aviso") setAviso(r.mensaje);
      if (r.tipo === "adjuntada") await recargar();
    } catch (e) {
      // Segunda red: lo que se escape de la captura se muestra, no queda
      // como un error sin atrapar ("toqué y no pasó nada").
      setAviso(`No se pudo tomar la foto: ${(e as Error).message}`);
    } finally {
      setTomando(false);
    }
  };

  return (
    <View>
      <GaleriaFotos
        fotos={fotos}
        onTomarFoto={() => void tomar()}
        deshabilitada={deshabilitada || tomando}
        maximo={maximo}
      />
      {aviso ? <Aviso tono="advertencia" titulo="Foto" detalle={aviso} /> : null}
    </View>
  );
}
