import { ActivityIndicator, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useSesion } from "../../src/app/ProveedorSesion";
import { colores } from "../../src/diseno/tokens";

export { ErrorDePantalla as ErrorBoundary } from "../../src/app/ErrorDePantalla";

/**
 * Pantallas que exigen sesión.
 *
 * Al cerrar sesión salía "Render error: Esta pantalla requiere sesión
 * iniciada": las pantallas que seguían montadas debajo (el panel, la lista)
 * se volvían a dibujar sin usuario, y `useUsuario` falla a propósito antes que
 * inventar uno vacío (4.4). La guardia va aquí, una sola vez: sin sesión, el
 * grupo entero se desmonta —ninguna de sus pantallas llega a dibujarse— y se
 * va al ingreso. Es el patrón de autenticación de Expo Router.
 *
 * El grupo `(app)` no cambia las direcciones: `/panel` sigue siendo `/panel`.
 */
export default function DisposicionConSesion() {
  const { cargando, usuario } = useSesion();

  if (cargando) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo }}>
        <ActivityIndicator color={colores.primario} />
      </View>
    );
  }
  if (!usuario) return <Redirect href={"/ingresar" as never} />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colores.superficie },
        headerTintColor: colores.texto,
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: colores.fondo },
        // El gesto de volver atrás con el dedo es fácil de disparar sin
        // querer mientras se captura: se controla por pantalla.
        gestureEnabled: false,
      }}
    >
      <Stack.Screen name="ordenes" options={{ title: "Mis órdenes" }} />
      <Stack.Screen name="revision" options={{ title: "Por revisar" }} />
      <Stack.Screen name="panel" options={{ title: "Panel" }} />
      <Stack.Screen name="cuenta" options={{ title: "Cuenta" }} />
      <Stack.Screen name="nueva-orden" options={{ title: "Nueva orden" }} />
      <Stack.Screen name="flota" options={{ title: "Clientes y vehículos" }} />
      <Stack.Screen name="cliente" options={{ title: "Mis servicios" }} />
      <Stack.Screen name="usuarios" options={{ title: "Usuarios" }} />
      <Stack.Screen name="sedes" options={{ title: "Sedes" }} />
      <Stack.Screen name="plantillas" options={{ title: "Plantillas de ejes" }} />
      <Stack.Screen name="informe" options={{ title: "Informe" }} />
      <Stack.Screen name="programaciones" options={{ title: "Visitas recurrentes" }} />
      <Stack.Screen name="mas" options={{ title: "Más" }} />
      <Stack.Screen name="alertas" options={{ title: "Llantas para cambiar" }} />
      <Stack.Screen name="auditoria" options={{ title: "Auditoría" }} />
      <Stack.Screen name="revision-catalogo" options={{ title: "Creado en campo" }} />
      <Stack.Screen name="plataforma" options={{ title: "Plataforma" }} />
      <Stack.Screen name="catalogo-general" options={{ title: "Catálogo general" }} />
      <Stack.Screen name="soporte" options={{ title: "Sesión de soporte" }} />
      <Stack.Screen name="catalogo" options={{ title: "Catálogo de llantas" }} />
      <Stack.Screen name="limites" options={{ title: "Límites de cambio" }} />
      <Stack.Screen name="llantas" options={{ title: "Llantas" }} />
      <Stack.Screen name="llanta/[id]" options={{ title: "Llanta" }} />
      <Stack.Screen name="llanta-nueva" options={{ title: "Registrar llanta" }} />
      <Stack.Screen name="stock" options={{ title: "Stock de bodega" }} />
      <Stack.Screen name="reclamos" options={{ title: "Garantías y reclamos" }} />
      <Stack.Screen name="causas-retiro" options={{ title: "Causas de retiro" }} />
      <Stack.Screen name="tablero" options={{ title: "Indicadores" }} />
      <Stack.Screen name="cotizacion" options={{ title: "Cotización" }} />
      <Stack.Screen name="carga" options={{ title: "Cargar desde Excel" }} />
      <Stack.Screen name="codigos-qr" options={{ title: "Códigos QR" }} />
      <Stack.Screen name="escanear" options={{ title: "Escanear vehículo" }} />
      <Stack.Screen name="vehiculo/[id]" options={{ title: "Vehículo" }} />
      <Stack.Screen name="orden/[id]/index" options={{ title: "Orden" }} />
      <Stack.Screen name="orden/[id]/reasignar" options={{ title: "Reasignar" }} />
      <Stack.Screen name="orden/[id]/decidir" options={{ title: "Revisar orden" }} />
      <Stack.Screen name="orden/[id]/enviar" options={{ title: "Enviar a revisión" }} />
      <Stack.Screen name="orden/[id]/datos" options={{ title: "Kilometraje y hallazgos" }} />
      <Stack.Screen name="orden/[id]/fotos" options={{ title: "Evidencia" }} />
      <Stack.Screen name="orden/[id]/firma" options={{ title: "Firma", gestureEnabled: false }} />
      <Stack.Screen name="orden/[id]/posicion/[numero]" options={{ title: "Posición", gestureEnabled: false }} />
    </Stack>
  );
}
