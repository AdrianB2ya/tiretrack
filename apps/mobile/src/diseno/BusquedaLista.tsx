import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput } from "react-native";
import { Boton } from "./componentes";
import { colores, espacio, radio, tactil, texto } from "./tokens";

/**
 * Listas que crecen: clientes, llantas, usuarios, visitas, reclamos…
 *
 * Pintar todo era inviable con datos reales (lo reportó el usuario: con mil
 * clientes la pantalla no se acaba). Una sola pieza para todas: búsqueda
 * palabra por palabra y sin tildes, y de a 20 con "Mostrar más". Con pocos
 * elementos no aparece la búsqueda: no estorba donde no hace falta.
 */

export const POR_PAGINA = 20;
/** Con más elementos que estos, se ofrece buscar. */
export const MIN_PARA_BUSCAR = 8;

const normal = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Todas las palabras, en cualquier orden: "reyna 482" encuentra "Transportes Reyna · SXK482". */
export function coincide(texto: string, termino: string): boolean {
  const q = normal(termino);
  if (!q) return true;
  const t = normal(texto);
  return q.split(/\s+/).every((p) => t.includes(p));
}

export interface Busqueda<T> {
  readonly termino: string;
  readonly buscar: (t: string) => void;
  readonly visibles: readonly T[];
  readonly total: number;
  readonly quedan: number;
  readonly verMas: () => void;
  readonly conBusqueda: boolean;
}

export function useBusqueda<T>(items: readonly T[], textoDe: (x: T) => string, porPagina = POR_PAGINA): Busqueda<T> {
  const [termino, setTermino] = useState("");
  const [paginas, setPaginas] = useState(1);
  const filtradas = useMemo(() => items.filter((x) => coincide(textoDe(x), termino)), [items, textoDe, termino]);
  const visibles = filtradas.slice(0, paginas * porPagina);
  return {
    termino,
    buscar: (t) => {
      setTermino(t);
      setPaginas(1);
    },
    visibles,
    total: filtradas.length,
    quedan: filtradas.length - visibles.length,
    verMas: () => setPaginas((p) => p + 1),
    conBusqueda: items.length > MIN_PARA_BUSCAR,
  };
}

/** El campo de búsqueda; con pocos elementos no aparece. */
export function CampoBusqueda<T>({ b, placeholder, testID = "buscar" }: { b: Busqueda<T>; placeholder: string; testID?: string }) {
  if (!b.conBusqueda) return null;
  return (
    <TextInput
      style={estilos.campo}
      value={b.termino}
      onChangeText={b.buscar}
      placeholder={placeholder}
      placeholderTextColor={colores.textoTenue}
      autoCorrect={false}
      accessibilityLabel={placeholder}
      testID={testID}
    />
  );
}

/** "Mostrar más" y "nada coincide", debajo de la lista. */
export function PieBusqueda<T>({ b, testID = "ver-mas" }: { b: Busqueda<T>; testID?: string }) {
  return (
    <>
      {b.termino.trim() !== "" && b.total === 0 ? <Text style={estilos.tenue}>Nada coincide con “{b.termino.trim()}”.</Text> : null}
      {b.quedan > 0 ? (
        <Boton tipo="fantasma" ancho testID={testID} onPress={b.verMas}>
          {`Mostrar ${Math.min(b.quedan, POR_PAGINA)} más (quedan ${b.quedan})`}
        </Boton>
      ) : null}
    </>
  );
}

const estilos = StyleSheet.create({
  campo: {
    ...texto.cuerpo,
    color: colores.texto,
    minHeight: tactil.minimo,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radio.md,
    paddingHorizontal: espacio.md,
    backgroundColor: colores.superficie,
  },
  tenue: { ...texto.ayuda, color: colores.textoTenue },
});
