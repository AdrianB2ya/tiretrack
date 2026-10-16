import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  ETIQUETA_ESTADO_RECLAMO,
  ETIQUETA_MOTIVO_RETIRO,
  siguientesReclamo,
  type EstadoReclamo,
  type MotivoRetiro,
} from "@tiretrack/domain";
import { Aviso, Boton, Campo, CampoDecimal, Insignia, Opcion, Tarjeta, Vacio } from "../diseno/componentes";
import { CampoBusqueda, PieBusqueda, useBusqueda } from "../diseno/BusquedaLista";
import { colores, espacio, texto } from "../diseno/tokens";
import { fechaCorta } from "../diseno/formato";

/**
 * Garantías y reclamos (R10): cada reclamo al proveedor por una llanta que
 * falló, con su estado y la conversación anotada. Aprobar pide lo que el
 * proveedor reconoció: sin eso no hay cómo cobrarlo.
 */

type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string };

export interface ReclamoVista {
  id: string;
  proveedor: string;
  motivoRetiro: string;
  estado: EstadoReclamo;
  fecha: string;
  valorReconocido: number | null;
  notas: string | null;
  llantaId: string;
  llanta: string;
  clienteNombre: string;
}

export interface FuentesReclamos {
  cargar(): Promise<R<ReclamoVista[]>>;
  cambiar(id: string, c: { estado: EstadoReclamo; valorReconocido?: number; nota?: string }): Promise<R<unknown>>;
}

const COLOR: Record<EstadoReclamo, string> = {
  abierto: colores.advertencia,
  enviado: colores.secundario,
  aprobado: colores.exito,
  rechazado: colores.peligro,
  cerrado: colores.textoTenue,
};

const textoReclamo = (r: ReclamoVista) => `${r.llanta} ${r.proveedor} ${r.clienteNombre} ${r.estado}`;

export function PantallaReclamos({ fuentes, onAbrirLlanta }: { fuentes: FuentesReclamos; onAbrirLlanta: (id: string) => void }) {
  const [lista, setLista] = useState<ReclamoVista[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busqueda = useBusqueda(lista ?? [], textoReclamo);

  const cargar = useCallback(async () => {
    const r = await fuentes.cargar();
    if (r.ok) {
      setLista(Array.isArray(r.datos) ? r.datos : []);
      setError(null);
    } else setError(r.status === 0 ? "Sin señal: los reclamos se consultan en línea." : r.mensaje);
  }, [fuentes]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!lista) {
    return error ? (
      <View style={estilos.centrado}>
        <Aviso tono="advertencia" titulo="No se pudo cargar" detalle={error} />
        <Boton tipo="secundario" testID="reintentar-reclamos" onPress={() => void cargar()}>
          Reintentar
        </Boton>
      </View>
    ) : (
      <Vacio mensaje="Cargando los reclamos…" />
    );
  }
  if (lista.length === 0) {
    return <Vacio mensaje="Sin reclamos. Se abren desde la ficha de una llanta que falló." />;
  }
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      <CampoBusqueda b={busqueda} placeholder="Buscar por llanta, proveedor o cliente" testID="buscar-reclamo" />
      {busqueda.visibles.map((r) => (
        <TarjetaReclamo key={r.id} r={r} fuentes={fuentes} onCambio={cargar} onAbrirLlanta={onAbrirLlanta} />
      ))}
      <PieBusqueda b={busqueda} testID="mas-reclamos" />
    </ScrollView>
  );
}

function TarjetaReclamo({ r, fuentes, onCambio, onAbrirLlanta }: {
  r: ReclamoVista;
  fuentes: FuentesReclamos;
  onCambio: () => Promise<void>;
  onAbrirLlanta: (id: string) => void;
}) {
  const [hacia, setHacia] = useState<EstadoReclamo | null>(null);
  const [valor, setValor] = useState<number | null>(null);
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const siguientes = siguientesReclamo(r.estado);

  const guardar = async () => {
    if (!hacia) return;
    setTrabajando(true);
    try {
      const res = await fuentes.cambiar(r.id, {
        estado: hacia,
        ...(valor !== null ? { valorReconocido: valor } : {}),
        ...(nota.trim() ? { nota: nota.trim() } : {}),
      });
      if (!res.ok) return setError(res.status === 0 ? "Sin señal: se actualiza en línea." : res.mensaje);
      setHacia(null);
      setNota("");
      setError(null);
      await onCambio();
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Tarjeta testID={`reclamo-${r.id}`}>
      <View style={estilos.cabecera}>
        <Text style={estilos.codigo}>{r.llanta}</Text>
        <Insignia color={COLOR[r.estado]} compacta>
          {ETIQUETA_ESTADO_RECLAMO[r.estado]}
        </Insignia>
      </View>
      <Text style={estilos.cuerpo}>
        {r.proveedor} · {ETIQUETA_MOTIVO_RETIRO[r.motivoRetiro as MotivoRetiro] ?? r.motivoRetiro}
      </Text>
      <Text style={estilos.detalle}>
        {r.clienteNombre} · desde {fechaCorta(r.fecha)}
        {r.valorReconocido !== null ? ` · reconocido $${Math.round(r.valorReconocido).toLocaleString("es-CO")}` : ""}
      </Text>
      {r.notas ? <Text style={estilos.notas}>{r.notas}</Text> : null}
      <Boton tipo="fantasma" onPress={() => onAbrirLlanta(r.llantaId)}>
        Ver la llanta
      </Boton>
      {siguientes.length > 0 ? (
        <View style={estilos.fila}>
          {siguientes.map((e) => (
            <Opcion key={e} etiqueta={ETIQUETA_ESTADO_RECLAMO[e]} activa={hacia === e} onPress={() => setHacia(hacia === e ? null : e)} testID={`reclamo-${r.id}-${e}`} />
          ))}
        </View>
      ) : null}
      {hacia ? (
        <View style={estilos.formulario}>
          {hacia === "aprobado" ? (
            <CampoDecimal etiqueta="Valor reconocido por el proveedor" valor={valor} onCambio={setValor} testID={`reclamo-${r.id}-valor`} />
          ) : null}
          <Campo etiqueta="Nota (opcional)" value={nota} onChangeText={setNota} testID={`reclamo-${r.id}-nota`} />
          {error ? <Aviso tono="advertencia" titulo="No se pudo" detalle={error} /> : null}
          <Boton testID={`reclamo-${r.id}-guardar`} cargando={trabajando} deshabilitado={hacia === "aprobado" && valor === null} onPress={() => void guardar()}>
            Pasar a {ETIQUETA_ESTADO_RECLAMO[hacia].toLowerCase()}
          </Boton>
        </View>
      ) : null}
    </Tarjeta>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md, paddingBottom: espacio.xxl },
  centrado: { flex: 1, justifyContent: "center", padding: espacio.lg, gap: espacio.md, backgroundColor: colores.fondo },
  cabecera: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: espacio.sm },
  codigo: { ...texto.codigo, color: colores.texto, flexShrink: 1 },
  cuerpo: { ...texto.cuerpo, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  notas: { ...texto.ayuda, color: colores.texto },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  formulario: { gap: espacio.sm },
});
