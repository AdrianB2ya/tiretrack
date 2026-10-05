import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { DiagramaLlantas, ResumenDiagrama } from "../../../src/ordenes/DiagramaLlantas";
import { Aviso, Boton, Insignia } from "../../../src/diseno/componentes";
import { useDatos, type DatosOrden } from "../../../src/app/ProveedorDatos";
import { useUsuario } from "../../../src/app/ProveedorSesion";
import { accionesDisponibles, requisitosParaEnviar } from "../../../src/ordenes/detalle";
import { colores, espacio, estadosOrden, texto } from "../../../src/diseno/tokens";

/**
 * Detalle de la orden con su diagrama.
 *
 * Al volver del editor se recarga: el diagrama tiene que reflejar la posición
 * que se acaba de guardar, o el técnico no sabe si quedó.
 */
export default function PantallaDetalle() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { cargarOrden, ordenes } = useDatos();
  const usuario = useUsuario();
  const [datos, setDatos] = useState<DatosOrden | null>(null);

  const recargar = useCallback(async () => {
    if (id) setDatos(await cargarOrden(id));
  }, [id, cargarOrden]);

  // `ordenes` cambia tras cada guardado: recargar entonces mantiene el
  // diagrama al día sin tener que avisar manualmente desde el editor.
  useEffect(() => {
    void recargar();
  }, [recargar, ordenes]);

  if (!datos) {
    return (
      <View style={estilos.centrado}>
        <ActivityIndicator color={colores.primario} />
      </View>
    );
  }

  const { orden, diagrama } = datos;
  const estado = estadosOrden[orden.estado as keyof typeof estadosOrden];

  const detalle = {
    orden,
    vehiculoCodigo: orden.vehiculoId,
    vehiculoPlaca: null,
    clienteNombre: orden.clienteId,
    sedeClienteNombre: "",
    mediciones: datos.mediciones,
    posicionesTotales: diagrama.totalPosiciones,
    fotosSinSubir: 0,
  };
  const acciones = accionesDisponibles(detalle, { usuarioId: usuario.id, rol: usuario.rol });
  const capturar = acciones.find((a) => a.accion === "capturar");
  const enviar = acciones.find((a) => a.accion === "enviar");

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <View style={estilos.cabecera}>
        <Text style={estilos.folio}>{orden.folio ?? orden.codigoReferencia ?? "Sin folio"}</Text>
        {estado ? <Insignia color={estado.color}>{estado.etiqueta}</Insignia> : null}
      </View>

      {orden.motivoDevolucion ? (
        <Aviso tono="peligro" titulo="Devuelta para corregir" detalle={orden.motivoDevolucion} />
      ) : null}
      {orden.notaCoordinador ? (
        <Aviso tono="info" titulo="Instrucciones" detalle={orden.notaCoordinador} />
      ) : null}

      <ResumenDiagrama diagrama={diagrama} />
      <DiagramaLlantas
        diagrama={diagrama}
        onTocarPosicion={(n) => router.push(`/orden/${orden.id}/posicion/${n}` as never)}
      />

      <View style={estilos.requisitos}>
        {requisitosParaEnviar(detalle).map((r) => (
          <Text key={r.clave} style={[estilos.requisito, r.cumplido && estilos.cumplido]}>
            {r.cumplido ? "✓" : "○"} {r.texto}
          </Text>
        ))}
      </View>

      {/* El motivo del bloqueo se muestra: un botón gris sin explicación en
          el patio termina en una llamada al coordinador. */}
      {enviar && !enviar.habilitada && enviar.motivo ? (
        <Aviso tono="advertencia" titulo="Falta para poder enviar" detalle={enviar.motivo} />
      ) : null}

      <Boton ancho deshabilitado={!capturar?.habilitada} onPress={() => undefined}>
        Continuar captura
      </Boton>

      <Boton
        ancho
        tipo="secundario"
        deshabilitado={!capturar?.habilitada}
        onPress={() => router.push(`/orden/${orden.id}/enviar` as never)}
      >
        Revisar y enviar
      </Boton>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.lg },
  centrado: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
  cabecera: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  folio: { ...texto.codigo, color: colores.primario },
  requisitos: { gap: espacio.sm },
  requisito: { ...texto.cuerpo, color: colores.textoTenue },
  cumplido: { color: colores.exito },
});
