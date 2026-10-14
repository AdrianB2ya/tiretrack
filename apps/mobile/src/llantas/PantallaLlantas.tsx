import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ESTADOS_ACTIVO, ETIQUETA_ESTADO_ACTIVO, type EstadoActivo } from "@tiretrack/domain";
import { Aviso, Boton, Campo, Insignia, Opcion, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";

/**
 * Inventario de llantas (R8): cada llanta del cliente como activo, con su
 * estado y dónde está. Se consulta en línea: el inventario es de la oficina,
 * y lo que pasa en las órdenes llega al aprobarlas.
 */

type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string };

export interface LlantaVista {
  readonly id: string;
  readonly serial: string | null;
  readonly numeroInterno: string | null;
  readonly numCalor: string | null;
  readonly marca: string | null;
  readonly diseno: string | null;
  readonly medida: string | null;
  readonly estado: EstadoActivo;
  readonly clienteNombre: string;
  readonly sedeNombre: string | null;
  readonly vehiculoCodigo: string | null;
  readonly posicion: number | null;
  readonly vidas: number;
}

export interface FuentesLlantas {
  listar(filtro: { estado?: EstadoActivo; buscar?: string }): Promise<R<LlantaVista[]>>;
}

export const COLOR_ESTADO: Record<EstadoActivo, string> = {
  bodega: colores.secundario,
  montada: colores.exito,
  reencauche: colores.advertencia,
  reparacion: colores.advertencia,
  desecho: colores.textoTenue,
};

/** "A-17 · MX10023", o el que haya. */
export function nombreLlanta(l: { numeroInterno: string | null; serial: string | null }): string {
  return [l.numeroInterno, l.serial].filter(Boolean).join(" · ") || "Sin identificar";
}

/** Dónde está, en palabras: "CA-12, posición 3", "Bodega de Fundación". */
export function dondeEsta(l: LlantaVista): string {
  if (l.estado === "montada" && l.vehiculoCodigo) return `${l.vehiculoCodigo}, posición ${l.posicion ?? "?"}`;
  if (l.estado === "bodega") return l.sedeNombre ? `Bodega de ${l.sedeNombre}` : "En bodega";
  return ETIQUETA_ESTADO_ACTIVO[l.estado];
}

export function PantallaLlantas({
  fuentes,
  onAbrir,
  onAlta,
}: {
  fuentes: FuentesLlantas;
  onAbrir: (id: string) => void;
  /** Solo la oficina da de alta. */
  onAlta?: () => void;
}) {
  const [estado, setEstado] = useState<EstadoActivo | null>(null);
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<LlantaVista[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const r = await fuentes.listar({ ...(estado ? { estado } : {}), ...(buscar.trim() ? { buscar: buscar.trim() } : {}) });
    if (r.ok) {
      setLista(Array.isArray(r.datos) ? r.datos : []);
      setError(null);
    } else setError(r.status === 0 ? "Sin señal: el inventario se consulta en línea." : r.mensaje);
  }, [fuentes, estado, buscar]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      {onAlta ? (
        <Boton tipo="secundario" testID="alta-llanta" onPress={onAlta}>
          Registrar una llanta en bodega
        </Boton>
      ) : null}
      <Campo etiqueta="Buscar por serial, número interno o calor" value={buscar} onChangeText={setBuscar} autoCorrect={false} testID="buscar-llanta" />
      <View style={estilos.fila}>
        <Opcion etiqueta="Todas" activa={estado === null} onPress={() => setEstado(null)} testID="estado-todas" />
        {ESTADOS_ACTIVO.map((e) => (
          <Opcion key={e} etiqueta={ETIQUETA_ESTADO_ACTIVO[e]} activa={estado === e} onPress={() => setEstado(e)} testID={`estado-${e}`} />
        ))}
      </View>

      {error ? (
        <>
          <Aviso tono="advertencia" titulo="No se pudo cargar" detalle={error} />
          <Boton tipo="secundario" testID="reintentar-llantas" onPress={() => void cargar()}>
            Reintentar
          </Boton>
        </>
      ) : null}
      {!lista && !error ? <Vacio mensaje="Cargando el inventario…" /> : null}
      {lista && lista.length === 0 ? (
        <Vacio mensaje="Ninguna llanta con ese filtro. Las de los vehículos aparecen al aprobarse sus órdenes." />
      ) : null}
      {lista && lista.length > 0 ? <Text style={estilos.detalle}>{lista.length} llantas</Text> : null}
      {(lista ?? []).map((l) => (
        <Tarjeta key={l.id} onPress={() => onAbrir(l.id)} testID={`llanta-${l.id}`}>
          <View style={estilos.cabecera}>
            <Text style={estilos.codigo}>{nombreLlanta(l)}</Text>
            <Insignia color={COLOR_ESTADO[l.estado]} compacta>
              {ETIQUETA_ESTADO_ACTIVO[l.estado]}
            </Insignia>
          </View>
          <Text style={estilos.cuerpo}>{[l.marca, l.diseno, l.medida].filter(Boolean).join(" ") || "Sin referencia"}</Text>
          <Text style={estilos.detalle}>
            {dondeEsta(l)} · {l.clienteNombre}
            {l.vidas > 0 ? ` · ${l.vidas} ${l.vidas === 1 ? "reencauche" : "reencauches"}` : ""}
          </Text>
        </Tarjeta>
      ))}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md, paddingBottom: espacio.xxl },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  cabecera: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: espacio.sm },
  codigo: { ...texto.codigo, color: colores.texto, flexShrink: 1 },
  cuerpo: { ...texto.cuerpo, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
