import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { puedeAprobar } from "@tiretrack/domain";
import { ListaOrdenes } from "../../src/ordenes/ListaOrdenes";
import { TITULO_FILTRO, esFiltroOrdenes, filtrar, filtrarOrdenes } from "../../src/ordenes/lista";
import { MIN_PARA_BUSCAR } from "../../src/diseno/BusquedaLista";
import { useDatos } from "../../src/app/ProveedorDatos";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { BarraDeSesion } from "../../src/app/BarraDeSesion";
import { NavegacionInferior } from "../../src/app/NavegacionInferior";
import { Boton } from "../../src/diseno/componentes";
import { colores, entrada, espacio, texto } from "../../src/diseno/tokens";

/**
 * "Mis órdenes".
 *
 * Los datos salen de la base local: la pantalla no espera a la red. El
 * indicador de pendientes le dice al técnico cuánto le falta por enviar, que
 * es lo que decide si busca señal ahora o al terminar el turno.
 */
export default function PantallaOrdenes() {
  const router = useRouter();
  const { cargando, ordenes, pendientesDeEnviar, sincronizando, sincronizar } = useDatos();
  const usuario = useUsuario();
  // Coordinador y administrador ven las órdenes de sus sedes, no "las suyas".
  const oficina = puedeAprobar(usuario.rol);
  const { filtro: crudo } = useLocalSearchParams<{ filtro?: string }>();
  const filtro = esFiltroOrdenes(crudo) ? crudo : null;
  // La búsqueda por folio, vehículo o cliente existía en lista.ts y ninguna
  // pantalla la usaba: son las formas en que se pregunta por una orden.
  const [texto, setTexto] = useState("");
  const visibles = filtrar(filtrarOrdenes(ordenes, filtro), { texto });

  const abrir = useCallback(
    (ordenId: string) => router.push(`/orden/${ordenId}` as never),
    [router],
  );

  if (cargando) {
    return (
      <View style={estilos.centrado}>
        <ActivityIndicator color={colores.primario} />
      </View>
    );
  }

  return (
    <View style={estilos.pantalla}>
      <Stack.Screen options={{ title: oficina ? "Órdenes" : "Mis órdenes" }} />
      <BarraDeSesion />
      {/* La imprevista: el vehículo que llegó sin estar programado. */}
      {/* R17: lo que el técnico hace frente al camión, a un toque: escanear su
          QR o abrir la imprevista. Sin pasar por "Más". */}
      <View style={estilos.accion}>
        <View style={estilos.mitad}>
          <Boton ancho tipo="secundario" testID="nueva-orden" onPress={() => router.push("/nueva-orden" as never)}>
            {oficina ? "Programar orden" : "Nueva orden"}
          </Boton>
        </View>
        <View style={estilos.mitad}>
          <Boton ancho tipo="secundario" testID="escanear-vehiculo" onPress={() => router.push("/escanear" as never)}>
            Escanear vehículo
          </Boton>
        </View>
      </View>
      {filtro ? (
        // Se dice qué se está viendo y cómo salir del filtro: sin esto, una
        // lista corta parece que le faltan órdenes.
        <View style={estilos.filtro}>
          <Text style={estilos.textoFiltro}>Mostrando: {TITULO_FILTRO[filtro]} ({visibles.length})</Text>
          <Boton tipo="fantasma" testID="ver-todas" onPress={() => router.setParams({ filtro: undefined } as never)}>
            Ver todas
          </Boton>
        </View>
      ) : null}
      {ordenes.length > MIN_PARA_BUSCAR ? (
        <View style={estilos.accion}>
          <TextInput
            style={estilos.buscar}
            value={texto}
            onChangeText={setTexto}
            placeholder="Buscar por folio, vehículo o cliente"
            placeholderTextColor={colores.textoTenue}
            autoCorrect={false}
            accessibilityLabel="Buscar orden"
            testID="buscar-orden"
          />
        </View>
      ) : null}
      {pendientesDeEnviar > 0 ? (
        <View style={estilos.barraPendientes}>
          <Text style={estilos.textoPendientes}>
            {pendientesDeEnviar} cambio{pendientesDeEnviar > 1 ? "s" : ""} sin enviar
          </Text>
          {sincronizando ? <ActivityIndicator size="small" color={colores.advertencia} /> : null}
        </View>
      ) : null}

      <View style={{ flex: 1 }}>
        <ListaOrdenes
          ordenes={visibles}
          onAbrir={abrir}
          mensajeVacio={
            texto.trim()
              ? `Ninguna orden con "${texto.trim()}".`
              : filtro
              ? `No hay órdenes en "${TITULO_FILTRO[filtro]}".`
              : oficina
                ? "No hay órdenes en tus sedes. Tira hacia abajo para actualizar."
                : undefined
          }
          refreshControl={
            // Tirar para sincronizar: el técnico decide cuándo gastar datos.
            <RefreshControl
              refreshing={sincronizando}
              onRefresh={() => void sincronizar()}
              tintColor={colores.primario}
            />
          }
        />
      </View>
      <NavegacionInferior activa="ordenes" />
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  accion: { flexDirection: "row", gap: espacio.sm, paddingHorizontal: espacio.lg, paddingTop: espacio.md },
  mitad: { flex: 1 },
  buscar: { ...entrada, flex: 1 },
  filtro: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: espacio.lg, paddingTop: espacio.sm,
  },
  textoFiltro: { ...texto.cuerpoFuerte, color: colores.texto, flexShrink: 1 },
  centrado: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
  barraPendientes: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: espacio.sm,
    paddingVertical: espacio.sm,
    backgroundColor: colores.superficie,
  },
  textoPendientes: { ...texto.ayuda, color: colores.advertencia, fontWeight: "600" },
});
