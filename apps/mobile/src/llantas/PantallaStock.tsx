import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Aviso, Boton, Campo, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";

/**
 * Stock de bodega por sede y medida (R8), contra el mínimo que la oficina
 * quiere tener. Lo que está por debajo es lo que hay que comprar, y se dice en
 * texto, no solo en color.
 */

type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string };

export interface FilaStock {
  sedeId: string;
  sedeNombre: string;
  medida: string;
  cantidad: number;
  minimo: number | null;
}

export interface FuentesStock {
  cargar(): Promise<R<FilaStock[]>>;
  fijarMinimo: ((sedeId: string, medida: string, cantidad: number) => Promise<R<unknown>>) | null;
}

export const faltante = (f: FilaStock) => (f.minimo !== null && f.cantidad < f.minimo ? f.minimo - f.cantidad : 0);

export function PantallaStock({ fuentes }: { fuentes: FuentesStock }) {
  const [filas, setFilas] = useState<FilaStock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [valor, setValor] = useState("");

  const cargar = useCallback(async () => {
    const r = await fuentes.cargar();
    if (r.ok) {
      setFilas(Array.isArray(r.datos) ? r.datos : []);
      setError(null);
    } else setError(r.status === 0 ? "Sin señal: el stock se consulta en línea." : r.mensaje);
  }, [fuentes]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!filas) {
    return error ? (
      <View style={estilos.centrado}>
        <Aviso tono="advertencia" titulo="No se pudo cargar" detalle={error} />
        <Boton tipo="secundario" testID="reintentar-stock" onPress={() => void cargar()}>
          Reintentar
        </Boton>
      </View>
    ) : (
      <Vacio mensaje="Cargando el stock…" />
    );
  }
  if (filas.length === 0) return <Vacio mensaje="No hay llantas en bodega ni mínimos fijados todavía." />;

  const porComprar = filas.filter((f) => faltante(f) > 0);
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      {porComprar.length > 0 ? (
        <Aviso
          tono="advertencia"
          titulo={`${porComprar.length} ${porComprar.length === 1 ? "medida está" : "medidas están"} por debajo del mínimo`}
          detalle={porComprar.map((f) => `${f.medida} en ${f.sedeNombre}: faltan ${faltante(f)}`).join(". ")}
        />
      ) : null}
      {filas.map((f) => {
        const clave = `${f.sedeId}|${f.medida}`;
        return (
          <Tarjeta key={clave} testID={`stock-${f.medida}`}>
            <Text style={estilos.codigo}>{f.medida}</Text>
            <Text style={estilos.detalle}>{f.sedeNombre}</Text>
            <Text style={faltante(f) > 0 ? estilos.falta : estilos.cuerpo}>
              {f.cantidad} en bodega
              {f.minimo !== null ? ` · mínimo ${f.minimo}` : " · sin mínimo"}
              {faltante(f) > 0 ? ` · POR DEBAJO: faltan ${faltante(f)}` : ""}
            </Text>
            {fuentes.fijarMinimo ? (
              editando === clave ? (
                <>
                  <Campo etiqueta="Mínimo en bodega" value={valor} onChangeText={setValor} keyboardType="number-pad" testID={`minimo-${f.medida}`} />
                  <Boton
                    testID={`guardar-minimo-${f.medida}`}
                    onPress={() =>
                      void (async () => {
                        const n = Number.parseInt(valor, 10);
                        if (!Number.isFinite(n) || n < 0 || !fuentes.fijarMinimo) return;
                        const r = await fuentes.fijarMinimo(f.sedeId, f.medida, n);
                        if (!r.ok) return setError(r.mensaje);
                        setEditando(null);
                        await cargar();
                      })()
                    }
                  >
                    Guardar mínimo
                  </Boton>
                </>
              ) : (
                <Boton tipo="fantasma" testID={`cambiar-minimo-${f.medida}`} onPress={() => { setEditando(clave); setValor(f.minimo === null ? "" : String(f.minimo)); }}>
                  {f.minimo === null ? "Fijar mínimo" : "Cambiar mínimo"}
                </Boton>
              )
            ) : null}
          </Tarjeta>
        );
      })}
      {error ? <Aviso tono="advertencia" titulo="No se pudo" detalle={error} /> : null}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md, paddingBottom: espacio.xxl },
  centrado: { flex: 1, justifyContent: "center", padding: espacio.lg, gap: espacio.md, backgroundColor: colores.fondo },
  codigo: { ...texto.codigo, color: colores.texto },
  cuerpo: { ...texto.cuerpo, color: colores.texto },
  falta: { ...texto.cuerpo, color: colores.advertencia, fontWeight: "700" },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
