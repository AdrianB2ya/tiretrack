import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { Aviso, Boton, Vacio } from "../diseno/componentes";
import { ElegirUno } from "../diseno/ListaBuscable";
import { colores, espacio, texto } from "../diseno/tokens";

/**
 * Etiquetas QR de los vehículos de un cliente (R15), en PDF para imprimir
 * (ocho por hoja) y pegar en cada vehículo. En línea: el PDF lo arma el
 * servidor.
 */
export interface FuentesEtiquetas {
  clientes(): Promise<{ id: string; nombre: string }[]>;
  descargar(clienteId: string): Promise<{ ok: true } | { ok: false; status: number; mensaje: string }>;
}

export function PantallaEtiquetasQR({ fuentes }: { fuentes: FuentesEtiquetas }) {
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "exito" | "advertencia"; titulo: string; detalle?: string } | null>(null);

  useEffect(() => {
    void fuentes.clientes().then(setClientes).catch(() => setClientes([]));
  }, [fuentes]);

  const bajar = async () => {
    if (!clienteId) return;
    setBajando(true);
    setAviso(null);
    try {
      const r = await fuentes.descargar(clienteId);
      setAviso(
        r.ok
          ? { tono: "exito", titulo: "Etiquetas listas", detalle: "Imprímelas en una hoja A4 y pega cada una en su vehículo, a la vista." }
          : { tono: "advertencia", titulo: r.status === 0 ? "Sin señal: las etiquetas se arman en línea" : "No se generaron", detalle: r.mensaje },
      );
    } catch (e) {
      setAviso({ tono: "advertencia", titulo: "No se generaron", detalle: (e as Error).message });
    } finally {
      setBajando(false);
    }
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.detalle}>
        Un código QR por vehículo activo del cliente, con su código y placa. Al escanearlo, la app abre la ficha del
        vehículo y su orden en curso. El código no lleva datos del cliente: sin sesión no abre nada.
      </Text>
      <Text style={estilos.etiqueta}>Cliente</Text>
      {clientes.length === 0 ? <Vacio mensaje="No hay clientes descargados en este teléfono." /> : null}
      <ElegirUno
        opciones={clientes.map((c) => ({ id: c.id, texto: c.nombre, testID: `cliente-${c.id}` }))}
        seleccionado={clienteId}
        onElegir={setClienteId}
      />
      <Boton ancho testID="bajar-etiquetas" cargando={bajando} deshabilitado={!clienteId} onPress={() => void bajar()}>
        Bajar las etiquetas (PDF)
      </Boton>
      {aviso ? <Aviso tono={aviso.tono} titulo={aviso.titulo} {...(aviso.detalle ? { detalle: aviso.detalle } : {})} /> : null}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md, paddingBottom: espacio.xxl },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
