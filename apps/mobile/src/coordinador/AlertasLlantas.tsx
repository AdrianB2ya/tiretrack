import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Aviso, Boton, Insignia, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";

/**
 * Llantas para cambiar: DOT vencido o por vencer y profundidad bajo el mínimo
 * del eje, de la última medición de cada posición. El servidor las calculaba
 * desde la 1.9 sin mostrárselas a nadie.
 *
 * Agrupadas por vehículo, que es como se programa el cambio; lo crítico
 * primero, y la severidad en texto, no solo en color.
 */

export interface AlertaLlanta {
  readonly vehiculoId: string;
  readonly vehiculoCodigo: string;
  readonly vehiculoPlaca: string | null;
  readonly clienteNombre: string;
  readonly posicion: number;
  readonly serial: string | null;
  readonly tipo: string;
  readonly severidad: string;
  readonly mensaje: string;
}

type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string };

const SEVERIDAD: Record<string, { etiqueta: string; color: string; peso: number }> = {
  critica: { etiqueta: "Crítica", color: colores.peligro, peso: 0 },
  alta: { etiqueta: "Alta", color: colores.advertencia, peso: 1 },
  media: { etiqueta: "Media", color: colores.textoTenue, peso: 2 },
};

/** Por vehículo; los que tienen algo crítico, arriba. */
export function agruparAlertas(alertas: readonly AlertaLlanta[]) {
  const grupos = new Map<string, AlertaLlanta[]>();
  for (const a of alertas) grupos.set(a.vehiculoId, [...(grupos.get(a.vehiculoId) ?? []), a]);
  const peso = (a: AlertaLlanta) => SEVERIDAD[a.severidad]?.peso ?? 9;
  return [...grupos.values()]
    .map((as) => [...as].sort((x, y) => peso(x) - peso(y) || x.posicion - y.posicion))
    .sort((a, b) => peso(a[0] as AlertaLlanta) - peso(b[0] as AlertaLlanta) || (a[0]?.vehiculoCodigo ?? "").localeCompare(b[0]?.vehiculoCodigo ?? ""));
}

export function AlertasLlantas({ cargar, onProgramar }: { cargar: () => Promise<R<AlertaLlanta[]>>; onProgramar: () => void }) {
  const [alertas, setAlertas] = useState<AlertaLlanta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    setError(null);
    const r = await cargar();
    if (r.ok) setAlertas(r.datos);
    else setError(r.status === 0 ? "Sin señal: las alertas se consultan en línea." : r.mensaje);
  }, [cargar]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (error) {
    return (
      <View style={estilos.centrado}>
        <Aviso tono="advertencia" titulo="No se pudieron cargar las alertas" detalle={error} />
        <Boton tipo="secundario" testID="reintentar-alertas" onPress={() => void recargar()}>
          Reintentar
        </Boton>
      </View>
    );
  }
  if (!alertas) return <Vacio mensaje="Revisando las últimas mediciones…" />;
  if (alertas.length === 0) return <Vacio mensaje="Ninguna llanta para cambiar en tus sedes, según las últimas órdenes cerradas." />;

  const grupos = agruparAlertas(alertas);
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.resumen}>
        {alertas.length} {alertas.length === 1 ? "alerta" : "alertas"} en {grupos.length} {grupos.length === 1 ? "vehículo" : "vehículos"}
      </Text>
      <Text style={estilos.detalle}>Según la última orden cerrada de cada posición.</Text>
      {grupos.map((g) => {
        const v = g[0] as AlertaLlanta;
        return (
          <Tarjeta key={v.vehiculoId} testID={`alertas-${v.vehiculoCodigo}`}>
            <Text style={estilos.codigo}>
              {v.vehiculoCodigo}
              {v.vehiculoPlaca ? ` · ${v.vehiculoPlaca}` : ""}
            </Text>
            <Text style={estilos.detalle}>{v.clienteNombre}</Text>
            {g.map((a, i) => {
              const s = SEVERIDAD[a.severidad];
              return (
                <View key={`${a.posicion}-${a.tipo}-${i}`} style={estilos.alerta}>
                  <Insignia color={s?.color ?? colores.textoTenue} compacta>
                    {s?.etiqueta ?? a.severidad}
                  </Insignia>
                  <Text style={estilos.cuerpo}>{a.mensaje}</Text>
                </View>
              );
            })}
            <Boton tipo="fantasma" onPress={onProgramar}>
              Programar el cambio
            </Boton>
          </Tarjeta>
        );
      })}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md },
  centrado: { flex: 1, justifyContent: "center", padding: espacio.lg, gap: espacio.md, backgroundColor: colores.fondo },
  resumen: { ...texto.cuerpoFuerte, color: colores.texto },
  codigo: { ...texto.codigo, color: colores.texto },
  cuerpo: { ...texto.cuerpo, color: colores.texto, flexShrink: 1 },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  alerta: { flexDirection: "row", alignItems: "flex-start", gap: espacio.sm },
});
