import type { ReactElement } from "react";
import { SectionList, StyleSheet, Text, View, type RefreshControlProps } from "react-native";
import { Insignia, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, conOpacidad, espacio, estadosOrden, radio, texto } from "../diseno/tokens";
import {
  construirSecciones,
  identificadorVisible,
  progresoDe,
  type OrdenParaLista,
  type SeccionLista,
} from "./lista";

/**
 * Listado de órdenes del técnico.
 *
 * El objetivo es que sepa qué hacer sin leer: la sección de arriba es lo
 * urgente, la barra de progreso dice cuánto le falta a cada orden, y el punto
 * naranja marca lo que tiene sin enviar.
 */

export interface ListaOrdenesProps {
  ordenes: readonly OrdenParaLista[];
  onAbrir: (ordenId: string) => void;
  mensajeVacio?: string;
  /**
   * "Tirar para actualizar" va en la lista misma. Envolverla en un ScrollView
   * anida dos desplazamientos: React Native lo advierte en pantalla
   * ("VirtualizedLists should never be nested") y la lista pierde la carga
   * por partes.
   */
  refreshControl?: ReactElement<RefreshControlProps>;
}

export function ListaOrdenes({ ordenes, onAbrir, mensajeVacio, refreshControl }: ListaOrdenesProps) {
  const secciones = construirSecciones(ordenes);

  return (
    <SectionList
      sections={secciones.map((s) => ({ ...s, data: [...s.ordenes] }))}
      keyExtractor={(item) => item.orden.id}
      // Vacía también se puede tirar para actualizar: es justo cuando más
      // falta hace.
      ListEmptyComponent={<Vacio mensaje={mensajeVacio ?? "No tienes órdenes asignadas"} />}
      {...(refreshControl ? { refreshControl } : {})}
      contentContainerStyle={[estilos.contenido, secciones.length === 0 && { flexGrow: 1 }]}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => (
        <EncabezadoSeccion seccion={section as unknown as SeccionLista} />
      )}
      renderItem={({ item }) => (
        <TarjetaOrden item={item} onPress={() => onAbrir(item.orden.id)} />
      )}
      ItemSeparatorComponent={() => <View style={{ height: espacio.sm }} />}
      SectionSeparatorComponent={() => <View style={{ height: espacio.xs }} />}
    />
  );
}

function EncabezadoSeccion({ seccion }: { seccion: SeccionLista }) {
  const urgente = seccion.grupo === "devueltas";
  return (
    <View style={estilos.encabezado}>
      <Text style={[estilos.tituloSeccion, urgente && { color: colores.peligro }]}>
        {seccion.titulo}
      </Text>
      <Text style={estilos.contadorSeccion}>{seccion.ordenes.length}</Text>
    </View>
  );
}

export function TarjetaOrden({
  item,
  onPress,
}: {
  item: OrdenParaLista;
  onPress: () => void;
}) {
  const { orden } = item;
  const estado = estadosOrden[orden.estado as keyof typeof estadosOrden];
  const identificador = identificadorVisible(orden);
  const progreso = progresoDe(item);
  const devuelta = orden.estado === "en_proceso" && orden.motivoDevolucion;

  return (
    <Tarjeta
      onPress={onPress}
      acento={devuelta ? colores.peligro : estado?.color}
      testID={`orden-${orden.id}`}
    >
      <View style={estilos.filaSuperior}>
        <Text
          style={[
            estilos.identificador,
            // El provisional se ve distinto: no es el consecutivo definitivo
            identificador.esProvisional && { color: colores.advertencia },
          ]}
        >
          {identificador.texto}
        </Text>

        {/* Un punto basta para decir "esto no ha salido del celular": el
            técnico lo reconoce de reojo sin leer. */}
        {item.tieneCambiosSinEnviar ? (
          <View style={estilos.puntoSinEnviar} accessibilityLabel="Con cambios sin enviar" />
        ) : null}

        <View style={{ flex: 1 }} />
        {estado ? (
          <Insignia color={estado.color} compacta>
            {estado.etiqueta}
          </Insignia>
        ) : null}
      </View>

      <Text style={estilos.vehiculo}>{item.vehiculoCodigo}</Text>
      <Text style={estilos.cliente}>{item.clienteNombre}</Text>

      {devuelta ? (
        <View style={estilos.motivo}>
          <Text style={estilos.textoMotivo}>{orden.motivoDevolucion}</Text>
        </View>
      ) : null}

      {progreso.totales > 0 ? <BarraProgreso progreso={progreso} /> : null}
    </Tarjeta>
  );
}

function BarraProgreso({ progreso }: { progreso: ReturnType<typeof progresoDe> }) {
  const color = progreso.completa ? colores.exito : colores.primario;
  return (
    <View style={estilos.bloqueProgreso}>
      <View style={estilos.rielProgreso}>
        <View
          style={[
            estilos.relleno,
            { width: `${progreso.porcentaje}%`, backgroundColor: color },
          ]}
        />
      </View>
      {/* El número va junto a la barra: "17 de 22" se entiende mejor que un
          porcentaje cuando lo que falta es tocar cinco casillas más. */}
      <Text style={[estilos.textoProgreso, progreso.completa && { color: colores.exito }]}>
        {progreso.capturadas} de {progreso.totales}
      </Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  contenido: { padding: espacio.lg },
  encabezado: {
    flexDirection: "row",
    alignItems: "center",
    gap: espacio.sm,
    marginTop: espacio.lg,
    marginBottom: espacio.sm,
  },
  tituloSeccion: {
    ...texto.etiqueta,
    color: colores.textoTenue,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  contadorSeccion: {
    ...texto.ayuda,
    color: colores.textoTenue,
  },
  filaSuperior: {
    flexDirection: "row",
    alignItems: "center",
    gap: espacio.sm,
    marginBottom: espacio.sm,
  },
  identificador: { ...texto.codigo, color: colores.primario },
  puntoSinEnviar: {
    width: 8,
    height: 8,
    borderRadius: radio.completo,
    backgroundColor: colores.advertencia,
  },
  vehiculo: { ...texto.subtitulo, color: colores.texto },
  cliente: { ...texto.ayuda, color: colores.textoTenue, marginTop: 2 },
  motivo: {
    marginTop: espacio.md,
    padding: espacio.md,
    borderRadius: radio.sm,
    backgroundColor: conOpacidad(colores.peligro, 0.12),
  },
  textoMotivo: { ...texto.ayuda, color: colores.peligro },
  bloqueProgreso: {
    flexDirection: "row",
    alignItems: "center",
    gap: espacio.md,
    marginTop: espacio.md,
  },
  rielProgreso: {
    flex: 1,
    height: 6,
    borderRadius: radio.completo,
    backgroundColor: colores.borde,
    overflow: "hidden",
  },
  relleno: { height: "100%", borderRadius: radio.completo },
  textoProgreso: { ...texto.ayuda, color: colores.textoTenue },
});
