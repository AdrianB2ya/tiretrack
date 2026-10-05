import { PantallaFlota } from "../src/flota/PantallaFlota";
import { useDatos } from "../src/app/ProveedorDatos";
import { useUsuario } from "../src/app/ProveedorSesion";

/** Clientes, sedes y vehículos. */
export default function RutaFlota() {
  const usuario = useUsuario();
  const { fuentesFlota, accionesFlota } = useDatos();
  return <PantallaFlota rol={usuario.rol} fuentes={fuentesFlota} acciones={accionesFlota} />;
}
