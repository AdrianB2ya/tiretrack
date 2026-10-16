import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ETIQUETA_ESTADO_ORDEN } from "@tiretrack/domain";
import type { FichaVehiculoLocal } from "../datos/repositorio";
import type { OrdenParaLista } from "../ordenes/lista";
import { Aviso, Boton, Insignia, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, espacio, texto, estadosOrden } from "../diseno/tokens";
import { fechaCorta } from "../diseno/formato";

/**
 * La ficha que abre el QR del vehículo (R15): qué vehículo es, de quién, y
 * su orden en curso a un toque. Sale de la base del teléfono: en el patio no
 * siempre hay señal.
 */

const ABIERTAS = new Set(["borrador", "programada", "en_proceso", "en_revision", "pendiente_cliente"]);

export function FichaVehiculo({
  ficha,
  ordenes,
  onAbrirOrden,
  onNuevaOrden,
  onImprimirQR,
}: {
  /** undefined mientras carga; null si no está en el teléfono. */
  ficha: FichaVehiculoLocal | null | undefined;
  /** Las órdenes de ESTE vehículo que hay en el teléfono. */
  ordenes: readonly OrdenParaLista[];
  onAbrirOrden: (ordenId: string) => void;
  onNuevaOrden?: () => void;
  /** La oficina reimprime la etiqueta si se dañó. */
  onImprimirQR?: () => void;
}) {
  if (ficha === undefined) return <Vacio mensaje="Buscando el vehículo…" />;
  if (ficha === null) {
    return (
      <View style={estilos.centrado}>
        <Aviso
          tono="advertencia"
          titulo="Este vehículo no está en el teléfono"
          detalle="Puede que la flota no se haya descargado todavía (tira de la lista de órdenes para actualizar) o que el vehículo sea de otra empresa."
        />
      </View>
    );
  }

  const abiertas = ordenes.filter((o) => ABIERTAS.has(o.orden.estado)).sort((a, b) => a.orden.fecha.localeCompare(b.orden.fecha));
  const cerradas = ordenes
    .filter((o) => !ABIERTAS.has(o.orden.estado))
    .sort((a, b) => b.orden.fecha.localeCompare(a.orden.fecha))
    .slice(0, 5);

  const tarjeta = (o: OrdenParaLista) => (
    <Tarjeta key={o.orden.id} testID={`orden-${o.orden.id}`} onPress={() => onAbrirOrden(o.orden.id)}>
      <View style={estilos.fila}>
        <Text style={estilos.folio}>{o.orden.folio ?? o.orden.codigoReferencia ?? "Sin folio"}</Text>
        {/* Mismo nombre y color del estado que en la lista de órdenes. */}
        <Insignia color={estadosOrden[o.orden.estado as keyof typeof estadosOrden]?.color ?? colores.textoTenue} compacta>
          {estadosOrden[o.orden.estado as keyof typeof estadosOrden]?.etiqueta ?? ETIQUETA_ESTADO_ORDEN[o.orden.estado] ?? o.orden.estado}
        </Insignia>
      </View>
      <Text style={estilos.detalle}>
        {fechaCorta(o.orden.fecha)} · {o.posicionesCapturadas} de {o.posicionesTotales} posiciones
      </Text>
    </Tarjeta>
  );

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.codigo} testID="codigo-vehiculo">
        {ficha.codigo}
      </Text>
      <Text style={estilos.linea}>{ficha.placa ? `Placa ${ficha.placa}` : "Sin placa"} · {ficha.nombre}</Text>
      <Text style={estilos.detalle}>
        {[ficha.cliente, ficha.sede].filter(Boolean).join(" · ") || "Cliente sin descargar"}
      </Text>
      <Text style={estilos.detalle}>
        {ficha.plantilla ?? "Plantilla sin descargar"} · {ficha.kmActual.toLocaleString("es-CO")} km
      </Text>
      {!ficha.activo ? (
        <Aviso tono="advertencia" titulo="Vehículo deshabilitado" detalle="No se le pueden crear órdenes nuevas. Si sigue en servicio, la oficina lo reactiva." />
      ) : null}

      <Text style={estilos.subtitulo}>En curso ({abiertas.length})</Text>
      {abiertas.length === 0 ? <Text style={estilos.detalle}>Ninguna orden abierta en este teléfono.</Text> : abiertas.map(tarjeta)}
      {ficha.activo && onNuevaOrden ? (
        <Boton ancho tipo={abiertas.length === 0 ? "primario" : "secundario"} testID="nueva-orden-vehiculo" onPress={onNuevaOrden}>
          Nueva orden
        </Boton>
      ) : null}

      {cerradas.length > 0 ? (
        <>
          <Text style={estilos.subtitulo}>Anteriores</Text>
          {cerradas.map(tarjeta)}
        </>
      ) : null}

      {onImprimirQR ? (
        <Boton ancho tipo="fantasma" testID="imprimir-qr" onPress={onImprimirQR}>
          Imprimir su código QR
        </Boton>
      ) : null}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md, paddingBottom: espacio.xxl },
  centrado: { flex: 1, justifyContent: "center", padding: espacio.lg, backgroundColor: colores.fondo },
  fila: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: espacio.sm },
  codigo: { ...texto.titulo, color: colores.texto, fontFamily: "monospace" },
  folio: { ...texto.codigo, color: colores.texto },
  linea: { ...texto.cuerpo, color: colores.texto },
  subtitulo: { ...texto.cuerpoFuerte, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
