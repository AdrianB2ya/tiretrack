import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { nuevoId } from "@tiretrack/domain";
import { Aviso, Boton, Campo, CampoDecimal } from "../diseno/componentes";
import { ElegirUno } from "../diseno/ListaBuscable";
import { colores, espacio, texto } from "../diseno/tokens";

/**
 * Registrar una llanta en bodega (R8): una compra, o una que ya existía y no
 * se había registrado. Sin serial ni número interno no se puede seguir, así
 * que se pide uno de los dos. El costo de compra es la base del costo por
 * kilómetro.
 */

type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string };

export interface AltaPedida {
  id: string;
  clienteId: string;
  sedeId: string;
  serial?: string;
  numeroInterno?: string;
  numCalor?: string;
  dot?: string;
  medida?: string;
  costo?: number;
  profundidadInicial?: number;
}

export interface FuentesAlta {
  clientes(): Promise<{ id: string; nombre: string }[]>;
  sedes(): Promise<{ id: string; nombre: string }[]>;
  crear(a: AltaPedida): Promise<R<{ id: string }>>;
}

export function AltaLlanta({ fuentes, onCreada }: { fuentes: FuentesAlta; onCreada: (id: string) => void }) {
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [sedes, setSedes] = useState<{ id: string; nombre: string }[]>([]);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [sedeId, setSedeId] = useState<string | null>(null);
  const [serial, setSerial] = useState("");
  const [interno, setInterno] = useState("");
  const [calor, setCalor] = useState("");
  const [dot, setDot] = useState("");
  const [medida, setMedida] = useState("");
  const [costo, setCosto] = useState<number | null>(null);
  const [prof, setProf] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  // Un id por intento: un doble toque con mala señal no duplica la llanta.
  const [id] = useState(nuevoId);

  useEffect(() => {
    void fuentes.clientes().then(setClientes);
    void fuentes.sedes().then((s) => {
      setSedes(s);
      if (s.length === 1 && s[0]) setSedeId(s[0].id);
    });
  }, [fuentes]);

  const falta = [
    !clienteId ? "el cliente" : null,
    !sedeId ? "la sede" : null,
    !serial.trim() && !interno.trim() ? "el serial o el número interno" : null,
  ].filter(Boolean);

  const guardar = async () => {
    if (falta.length > 0 || !clienteId || !sedeId) return;
    setTrabajando(true);
    try {
      const r = await fuentes.crear({
        id, clienteId, sedeId,
        ...(serial.trim() ? { serial: serial.trim() } : {}),
        ...(interno.trim() ? { numeroInterno: interno.trim() } : {}),
        ...(calor.trim() ? { numCalor: calor.trim() } : {}),
        ...(dot.trim() ? { dot: dot.trim() } : {}),
        ...(medida.trim() ? { medida: medida.trim() } : {}),
        ...(costo !== null ? { costo } : {}),
        ...(prof !== null ? { profundidadInicial: prof } : {}),
      });
      if (!r.ok) {
        setError(r.status === 0 ? "Sin señal: el inventario se maneja en línea." : r.mensaje);
        return;
      }
      onCreada(r.datos.id);
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      <Text style={estilos.etiqueta}>Cliente dueño de la llanta</Text>
      <ElegirUno opciones={clientes.map((c) => ({ id: c.id, texto: c.nombre }))} seleccionado={clienteId} onElegir={setClienteId} />
      {sedes.length > 1 ? (
        <>
          <Text style={estilos.etiqueta}>Bodega (sede)</Text>
          <ElegirUno opciones={sedes.map((s) => ({ id: s.id, texto: s.nombre }))} seleccionado={sedeId} onElegir={setSedeId} />
        </>
      ) : null}
      <Campo etiqueta="Número interno (marcado a fuego o etiqueta)" value={interno} onChangeText={setInterno} autoCapitalize="characters" testID="alta-interno" />
      <Campo etiqueta="Serial" value={serial} onChangeText={setSerial} autoCapitalize="characters" testID="alta-serial" />
      <Campo etiqueta="Número de calor" value={calor} onChangeText={setCalor} autoCapitalize="characters" testID="alta-calor" />
      <Campo etiqueta="DOT" value={dot} onChangeText={setDot} keyboardType="number-pad" testID="alta-dot" />
      <Campo etiqueta="Medida" value={medida} onChangeText={setMedida} autoCapitalize="characters" placeholder="295/80R22.5" testID="alta-medida" />
      <CampoDecimal etiqueta="Costo de compra" ayuda="Con él se calcula el costo por kilómetro." valor={costo} onCambio={setCosto} testID="alta-costo" />
      <CampoDecimal etiqueta="Profundidad inicial (mm)" valor={prof} onCambio={setProf} testID="alta-prof" />
      {falta.length > 0 ? <Text style={estilos.detalle}>Falta {falta.join(", ")}.</Text> : null}
      {error ? <Aviso tono="advertencia" titulo="No se pudo" detalle={error} /> : null}
      <Boton testID="guardar-alta" cargando={trabajando} deshabilitado={falta.length > 0} onPress={() => void guardar()}>
        Registrar en bodega
      </Boton>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md, paddingBottom: espacio.xxl },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
