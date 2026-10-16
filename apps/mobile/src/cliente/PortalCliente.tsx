import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Insignia, Tarjeta, Vacio, Boton } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import type { OrdenParaLista } from "../ordenes/lista";
import { diasHasta } from "./DecisionCliente";
import { fechaCorta } from "../diseno/formato";

/**
 * Portal del cliente, dentro de la misma app (decisión del usuario).
 *
 * Primero lo que espera su aprobación, con el plazo a la vista; lo más
 * urgente arriba. Después, su historial de órdenes cerradas.
 */

export function seccionesCliente(ordenes: readonly OrdenParaLista[]) {
  const porAprobar = ordenes
    .filter((o) => o.orden.estado === "pendiente_cliente")
    // El plazo más cercano primero: es el que se cierra solo antes.
    .sort((a, b) => (a.orden.limiteCliente ?? "9999").localeCompare(b.orden.limiteCliente ?? "9999"));
  const cerradas = ordenes
    .filter((o) => o.orden.estado === "cerrada")
    .sort((a, b) => b.orden.fecha.localeCompare(a.orden.fecha));
  return { porAprobar, cerradas };
}

export function PortalCliente({
  ordenes,
  hoy,
  onAbrir,
  onIndicadores,
  onLlantas,
}: {
  ordenes: readonly OrdenParaLista[];
  hoy: string;
  onAbrir: (ordenId: string) => void;
  /** R11: el portal muestra su flota, no solo sus órdenes. */
  onIndicadores?: () => void;
  onLlantas?: () => void;
}) {
  const { porAprobar, cerradas } = seccionesCliente(ordenes);
  return (
    <ScrollView contentContainerStyle={estilos.contenido}>
      {onIndicadores || onLlantas ? (
        <View style={estilos.accesos}>
          {onIndicadores ? (
            <Boton tipo="secundario" testID="portal-indicadores" onPress={onIndicadores}>
              Indicadores de mi flota
            </Boton>
          ) : null}
          {onLlantas ? (
            <Boton tipo="fantasma" testID="portal-llantas" onPress={onLlantas}>
              Mis llantas
            </Boton>
          ) : null}
        </View>
      ) : null}
      <Text style={estilos.seccion}>Esperando tu aprobación ({porAprobar.length})</Text>
      {porAprobar.length === 0 ? <Vacio mensaje="No hay servicios pendientes de aprobar." /> : null}
      {porAprobar.map((o) => {
        const d = diasHasta(o.orden.limiteCliente, hoy);
        return (
          <Tarjeta key={o.orden.id} onPress={() => onAbrir(o.orden.id)} acento={colores.advertencia}>
            <View style={estilos.fila}>
              <Text style={estilos.folio}>{o.orden.folio ?? o.orden.codigoReferencia}</Text>
              {d !== null ? (
                <Insignia color={d <= 1 ? colores.peligro : colores.advertencia}>
                  {d < 0 ? "Vencido" : d === 0 ? "Vence hoy" : `${d} día${d === 1 ? "" : "s"}`}
                </Insignia>
              ) : null}
            </View>
            <Text style={estilos.vehiculo}>
              {o.vehiculoCodigo}
              {o.vehiculoPlaca ? ` · ${o.vehiculoPlaca}` : ""}
            </Text>
            <Text style={estilos.detalle}>Servicio del {fechaCorta(o.orden.fecha)}</Text>
            {/* El plazo en palabras y qué pasa si vence: antes solo decía "Vencido". */}
            {o.orden.limiteCliente ? (
              <Text style={[estilos.plazo, d !== null && d <= 1 && { color: colores.peligro }]}>
                {d !== null && d < 0
                  ? `El plazo venció el ${fechaCorta(o.orden.limiteCliente)}: se cierra por vencimiento`
                  : `Tienes hasta el ${fechaCorta(o.orden.limiteCliente)} para aprobarla u objetarla`}
              </Text>
            ) : null}
            <Boton ancho testID={`revisar-aprobar-${o.orden.id}`} onPress={() => onAbrir(o.orden.id)}>
              Revisar y aprobar
            </Boton>
          </Tarjeta>
        );
      })}

      <Text style={estilos.seccion}>Servicios cerrados ({cerradas.length})</Text>
      {cerradas.length === 0 ? <Vacio mensaje="Todavía no hay servicios cerrados. Aquí quedan los que apruebes." /> : null}
      {cerradas.map((o) => (
        <Tarjeta key={o.orden.id} onPress={() => onAbrir(o.orden.id)}>
          <Text style={estilos.folio}>{o.orden.folio ?? o.orden.codigoReferencia}</Text>
          <Text style={estilos.vehiculo}>
            {o.vehiculoCodigo}
            {o.vehiculoPlaca ? ` · ${o.vehiculoPlaca}` : ""}
          </Text>
          <Text style={estilos.detalle}>{fechaCorta(o.orden.fecha)}</Text>
        </Tarjeta>
      ))}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  accesos: { gap: 8 },
  contenido: { padding: espacio.lg, gap: espacio.md },
  seccion: { ...texto.subtitulo, color: colores.texto, marginTop: espacio.sm },
  fila: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  folio: { ...texto.codigo, color: colores.primario },
  vehiculo: { ...texto.cuerpoFuerte, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  plazo: { ...texto.etiqueta, color: colores.advertencia },
});
