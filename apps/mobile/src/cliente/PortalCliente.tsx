import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Insignia, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import type { OrdenParaLista } from "../ordenes/lista";
import { diasHasta } from "./DecisionCliente";

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
}: {
  ordenes: readonly OrdenParaLista[];
  hoy: string;
  onAbrir: (ordenId: string) => void;
}) {
  const { porAprobar, cerradas } = seccionesCliente(ordenes);
  return (
    <ScrollView contentContainerStyle={estilos.contenido}>
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
            <Text style={estilos.vehiculo}>{o.vehiculoCodigo}</Text>
            <Text style={estilos.detalle}>{o.orden.fecha}</Text>
          </Tarjeta>
        );
      })}

      <Text style={estilos.seccion}>Servicios cerrados ({cerradas.length})</Text>
      {cerradas.map((o) => (
        <Tarjeta key={o.orden.id} onPress={() => onAbrir(o.orden.id)}>
          <Text style={estilos.folio}>{o.orden.folio ?? o.orden.codigoReferencia}</Text>
          <Text style={estilos.vehiculo}>{o.vehiculoCodigo}</Text>
          <Text style={estilos.detalle}>{o.orden.fecha}</Text>
        </Tarjeta>
      ))}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  contenido: { padding: espacio.lg, gap: espacio.md },
  seccion: { ...texto.subtitulo, color: colores.texto, marginTop: espacio.sm },
  fila: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  folio: { ...texto.codigo, color: colores.primario },
  vehiculo: { ...texto.cuerpoFuerte, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
