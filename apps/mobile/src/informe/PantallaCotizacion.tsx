import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { LineaCotizacion } from "@tiretrack/domain";
import { Aviso, Boton, Insignia, Tarjeta, Vacio } from "../diseno/componentes";
import { ElegirUno } from "../diseno/ListaBuscable";
import { colores, espacio, texto } from "../diseno/tokens";
import { EnviarPorCorreo } from "./EnviarPorCorreo";

/**
 * Cotización de los cambios recomendados (R14). Se elige el cliente, se ve
 * lo que se cotizaría y se descarga o se envía el PDF.
 *
 * Sin precios hasta la parte D: los valores van en blanco en el PDF, y la
 * pantalla lo dice antes de que alguien lo mande pensando que está completo.
 */

type Fallo = { ok: false; status: number; mensaje: string };

export interface VistaCotizacion {
  llantas: LineaCotizacion[];
  servicios: LineaCotizacion[];
  totalLlantas: number;
  nota: string;
  fecha: string;
}

export interface FuentesCotizacion {
  clientes(): Promise<{ id: string; nombre: string }[]>;
  ver(consulta: string): Promise<{ ok: true; datos: VistaCotizacion } | Fallo>;
  descargarPdf(consulta: string): Promise<{ ok: true } | Fallo>;
  enviar(consulta: string, para: string[], mensaje?: string): Promise<{ ok: true; datos: { enviadoA?: string[] } } | Fallo>;
}

const URGENCIA = { inmediato: "INMEDIATO", programar: "PROGRAMAR" } as const;

export function PantallaCotizacion({ fuentes }: { fuentes: FuentesCotizacion }) {
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [vista, setVista] = useState<VistaCotizacion | null>(null);
  const [cargando, setCargando] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "exito" | "advertencia"; titulo: string; detalle?: string } | null>(null);

  useEffect(() => {
    void fuentes.clientes().then(setClientes).catch(() => setClientes([]));
  }, [fuentes]);

  const consulta = clienteId ? `?clienteId=${encodeURIComponent(clienteId)}` : "";

  const ver = useCallback(async () => {
    if (!clienteId) return;
    setCargando(true);
    setAviso(null);
    try {
      const r = await fuentes.ver(consulta);
      if (r.ok && Array.isArray(r.datos?.llantas) && Array.isArray(r.datos?.servicios)) setVista(r.datos);
      else {
        setVista(null);
        setAviso({
          tono: "advertencia",
          titulo: !r.ok && r.status === 0 ? "Sin señal: la cotización se arma en línea" : "No se pudo armar la cotización",
          ...(!r.ok ? { detalle: r.mensaje } : {}),
        });
      }
    } finally {
      setCargando(false);
    }
  }, [clienteId, consulta, fuentes]);

  const descargar = async () => {
    setBajando(true);
    setAviso(null);
    try {
      const r = await fuentes.descargarPdf(consulta);
      if (!r.ok) setAviso({ tono: "advertencia", titulo: "No se generó el PDF", detalle: r.mensaje });
    } catch (e) {
      setAviso({ tono: "advertencia", titulo: "No se generó el PDF", detalle: (e as Error).message });
    } finally {
      setBajando(false);
    }
  };

  const linea = (l: LineaCotizacion, i: number) => (
    <Tarjeta key={i} testID={`linea-${i}`}>
      <View style={estilos.fila}>
        <Text style={estilos.nombre}>
          {l.cantidad} × {l.concepto}
        </Text>
        {l.urgencia ? <Insignia color={l.urgencia === "inmediato" ? colores.peligro : colores.advertencia}>{URGENCIA[l.urgencia]}</Insignia> : null}
      </View>
      <Text style={estilos.detalle}>{l.detalle}</Text>
    </Tarjeta>
  );

  const vacia = vista !== null && vista.llantas.length === 0 && vista.servicios.length === 0;
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.detalle}>
        Lo que hoy hay que cambiar en la flota del cliente, según la última medición de cada posición y los límites de
        tu empresa, más las recomendaciones abiertas.
      </Text>
      <Text style={estilos.etiqueta}>Cliente</Text>
      {clientes.length === 0 ? <Vacio mensaje="No hay clientes en este teléfono. Sincroniza con señal para traerlos." /> : null}
      <ElegirUno
        opciones={clientes.map((c) => ({ id: c.id, texto: c.nombre, testID: `cliente-${c.id}` }))}
        seleccionado={clienteId}
        onElegir={(id) => {
          setClienteId(id);
          setVista(null);
        }}
      />
      <Boton ancho testID="ver-cotizacion" cargando={cargando} deshabilitado={!clienteId} onPress={() => void ver()}>
        Ver la cotización
      </Boton>

      {vista && vacia ? <Vacio mensaje="Nada que cotizar: ninguna llanta llegó a su límite y no hay recomendaciones abiertas." /> : null}
      {vista && !vacia ? (
        <>
          <Aviso tono="advertencia" titulo="Sin precios" detalle={vista.nota} />
          <Text style={estilos.subtitulo}>Llantas ({vista.totalLlantas})</Text>
          {vista.llantas.length === 0 ? <Text style={estilos.detalle}>Ninguna llanta para cambiar.</Text> : vista.llantas.map(linea)}
          <Text style={estilos.subtitulo}>Servicios</Text>
          {vista.servicios.length === 0 ? <Text style={estilos.detalle}>Ninguno.</Text> : vista.servicios.map((l, i) => linea(l, 100 + i))}
          <Boton ancho tipo="secundario" testID="descargar-cotizacion" cargando={bajando} onPress={() => void descargar()}>
            Descargar el PDF
          </Boton>
          <EnviarPorCorreo testID="correo-cotizacion" etiqueta="Enviar por correo" enviar={(para, mensaje) => fuentes.enviar(consulta, para, mensaje)} />
        </>
      ) : null}
      {aviso ? <Aviso tono={aviso.tono} titulo={aviso.titulo} {...(aviso.detalle ? { detalle: aviso.detalle } : {})} /> : null}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md, paddingBottom: espacio.xxl },
  fila: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: espacio.sm, flexWrap: "wrap" },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  subtitulo: { ...texto.cuerpoFuerte, color: colores.texto },
  nombre: { ...texto.cuerpoFuerte, color: colores.texto, flexShrink: 1 },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
