import { View } from "react-native";
import { useRouter } from "expo-router";
import { useSesion } from "./ProveedorSesion";
import { useDatos } from "./ProveedorDatos";
import { BarraSesion } from "../sesion/BarraSesion";
import { Aviso } from "../diseno/componentes";
import { espacio } from "../diseno/tokens";

/** Unión de la barra con la sesión y la navegación. La barra se prueba aparte. */
export function BarraDeSesion() {
  const router = useRouter();
  const { usuario } = useSesion();
  const { errorDescarga } = useDatos();
  if (!usuario) return null;
  return (
    <>
      <BarraSesion
        nombre={usuario.nombre}
        rol={usuario.rol}
        onCuenta={() => router.push("/cuenta" as never)}
      />
      {errorDescarga ? (
        // Que la lista no se vea vacía "porque sí": se dice que no se pudo
        // actualizar y con qué error, para poder reportarlo.
        <View style={{ paddingHorizontal: espacio.md, paddingTop: espacio.sm }}>
          <Aviso
            tono="advertencia"
            titulo="No se pudo actualizar desde el servidor"
            detalle={`Se muestra lo que hay en el teléfono. Detalle: ${errorDescarga}`}
          />
        </View>
      ) : null}
    </>
  );
}
