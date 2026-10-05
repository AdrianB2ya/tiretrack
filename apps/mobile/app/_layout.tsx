import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colores } from "../src/diseno/tokens";
import { Arranque } from "../src/app/Arranque";


/** URL del backend. En producción viene de la configuración de EAS. */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:4000/api/v1";

/**
 * Raíz de la navegación.
 *
 * El tema es oscuro y fijo, no sigue al sistema: la app se usa a la
 * intemperie y el contraste alto sobre fondo oscuro se lee mejor bajo el sol
 * que el inverso. Además evita que el técnico vea una pantalla distinta a la
 * de su compañero.
 */
export default function DisposicionRaiz() {
  return (
    <Arranque apiUrl={API_URL}>
      <StatusBar style="light" />
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
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="ingresar" options={{ headerShown: false }} />
        <Stack.Screen name="ordenes" options={{ title: "Mis órdenes" }} />
        <Stack.Screen name="revision" options={{ title: "Por revisar" }} />
        <Stack.Screen name="panel" options={{ title: "Panel" }} />
        <Stack.Screen name="cuenta" options={{ title: "Cuenta" }} />
        <Stack.Screen name="orden/[id]/index" options={{ title: "Orden" }} />
        <Stack.Screen name="orden/[id]/reasignar" options={{ title: "Reasignar" }} />
        <Stack.Screen name="orden/[id]/enviar" options={{ title: "Enviar a revisión" }} />
        <Stack.Screen
          name="orden/[id]/posicion/[numero]"
          options={{ title: "Posición", gestureEnabled: false }}
        />
      </Stack>
    </Arranque>
  );
}
