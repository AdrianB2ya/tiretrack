import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ETIQUETA_MOTIVO_RETIRO, esFalla, fechaEnColombia, type MotivoRetiro } from "@tiretrack/domain";
import { Aviso, Boton, Opcion, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";

/**
 * Causas de retiro (R10): por qué salen las llantas, por motivo, marca,
 * posición y vehículo. Es lo que dice qué marca rinde y qué eje se las come.
 * Las cifras van en texto y con su porcentaje: se leen sin gráfico.
 */

type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string };
interface Grupo { grupo: string | null; motivo: string; cantidad: number }
export interface Causas {
  total: number;
  porMotivo: { motivo: string; cantidad: number }[];
  porMarca: Grupo[];
  porPosicion: Grupo[];
  porVehiculo: Grupo[];
}

export interface FuentesCausas {
  cargar(f: { desde?: string; hasta?: string }): Promise<R<Causas>>;
}

const etiqueta = (m: string) => ETIQUETA_MOTIVO_RETIRO[m as MotivoRetiro] ?? m;
const pct = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 100)} %` : "");

/** Los grupos con su motivo principal, los de más retiros primero. */
export function resumirGrupos(g: readonly Grupo[]): { grupo: string; total: number; principal: string; fallas: number }[] {
  const porGrupo = new Map<string, Grupo[]>();
  for (const x of g) {
    const k = x.grupo ?? "Sin dato";
    porGrupo.set(k, [...(porGrupo.get(k) ?? []), x]);
  }
  return [...porGrupo.entries()]
    .map(([grupo, xs]) => {
      const orden = [...xs].sort((a, b) => b.cantidad - a.cantidad);
      return {
        grupo,
        total: xs.reduce((a, x) => a + x.cantidad, 0),
        principal: etiqueta(orden[0]?.motivo ?? ""),
        fallas: xs.filter((x) => esFalla(x.motivo)).reduce((a, x) => a + x.cantidad, 0),
      };
    })
    .sort((a, b) => b.total - a.total || a.grupo.localeCompare(b.grupo));
}

const PERIODOS = [
  { clave: "90", etiqueta: "90 días", dias: 90 },
  { clave: "365", etiqueta: "Un año", dias: 365 },
  { clave: "todo", etiqueta: "Todo", dias: null },
] as const;

export function PantallaCausas({ fuentes, hoy = new Date() }: { fuentes: FuentesCausas; hoy?: Date }) {
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]["clave"]>("365");
  const [causas, setCausas] = useState<Causas | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fijo al montar: un "hoy" nuevo en cada dibujo recargaría sin fin.
  const [hoyFijo] = useState(hoy);

  const cargar = useCallback(async () => {
    const p = PERIODOS.find((x) => x.clave === periodo);
    const desde = p?.dias ? fechaEnColombia(new Date(hoyFijo.getTime() - p.dias * 86_400_000)) : undefined;
    const r = await fuentes.cargar(desde ? { desde } : {});
    if (r.ok && r.datos && Array.isArray(r.datos.porMotivo)) {
      setCausas(r.datos);
      setError(null);
    } else if (!r.ok) setError(r.status === 0 ? "Sin señal: las causas se consultan en línea." : r.mensaje);
    else setError("La respuesta llegó incompleta.");
  }, [fuentes, periodo, hoyFijo]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <View style={estilos.fila}>
        {PERIODOS.map((p) => (
          <Opcion key={p.clave} etiqueta={p.etiqueta} activa={periodo === p.clave} onPress={() => setPeriodo(p.clave)} testID={`periodo-${p.clave}`} />
        ))}
      </View>
      {error ? (
        <>
          <Aviso tono="advertencia" titulo="No se pudo cargar" detalle={error} />
          <Boton tipo="secundario" testID="reintentar-causas" onPress={() => void cargar()}>
            Reintentar
          </Boton>
        </>
      ) : null}
      {!causas && !error ? <Vacio mensaje="Contando los retiros…" /> : null}
      {causas && causas.total === 0 ? (
        <Vacio mensaje="Ningún retiro con motivo en este período. El motivo se anota al desmontar la llanta." />
      ) : null}
      {causas && causas.total > 0 ? (
        <>
          <Text style={estilos.resumen}>{causas.total} llantas retiradas</Text>
          <Tarjeta testID="por-motivo">
            <Text style={estilos.subtitulo}>Por motivo</Text>
            {causas.porMotivo.map((m) => (
              <Text key={m.motivo} style={esFalla(m.motivo) ? estilos.falla : estilos.linea}>
                {etiqueta(m.motivo)}: {m.cantidad} ({pct(m.cantidad, causas.total)}){esFalla(m.motivo) ? " · falla" : ""}
              </Text>
            ))}
          </Tarjeta>
          {(
            [
              ["Por marca", causas.porMarca, "por-marca"],
              ["Por posición", causas.porPosicion, "por-posicion"],
              ["Por vehículo", causas.porVehiculo, "por-vehiculo"],
            ] as const
          ).map(([titulo, grupos, id]) => (
            <Tarjeta key={id} testID={id}>
              <Text style={estilos.subtitulo}>{titulo}</Text>
              {resumirGrupos(grupos).slice(0, 15).map((g) => (
                <Text key={g.grupo} style={estilos.linea}>
                  {id === "por-posicion" ? `Posición ${g.grupo}` : g.grupo}: {g.total} · más por {g.principal.toLowerCase()}
                  {g.fallas > 0 ? ` · ${g.fallas} por falla` : ""}
                </Text>
              ))}
            </Tarjeta>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md, paddingBottom: espacio.xxl },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  resumen: { ...texto.cuerpoFuerte, color: colores.texto },
  subtitulo: { ...texto.cuerpoFuerte, color: colores.texto },
  linea: { ...texto.cuerpo, color: colores.texto },
  falla: { ...texto.cuerpo, color: colores.advertencia },
});
