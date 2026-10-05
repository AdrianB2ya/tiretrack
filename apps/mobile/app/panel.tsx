import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { PanelCoordinador, calcularIndicadores, type Accion } from "../src/coordinador/PanelCoordinador";
import { useDatos } from "../src/app/ProveedorDatos";
import { useUsuario } from "../src/app/ProveedorSesion";
import type { OrdenLocal } from "../src/datos/repositorio";

/** Panel del coordinador: lo que requiere su decisión hoy. */
export default function PantallaPanel() {
  const router = useRouter();
  const usuario = useUsuario();
  const { ordenes, pendientesDeEnviar } = useDatos();
  const [hoy] = useState(() => new Date().toISOString().slice(0, 10));
  const [locales, setLocales] = useState<OrdenLocal[]>([]);

  useEffect(() => {
    setLocales(ordenes.map((o) => o.orden));
  }, [ordenes]);

  const destinos: Record<Accion, string> = {
    revisar: "/revision",
    devueltas: "/ordenes",
    cliente: "/ordenes",
    en_curso: "/ordenes",
  };

  return (
    <PanelCoordinador
      indicadores={calcularIndicadores(locales, hoy, pendientesDeEnviar)}
      nombre={usuario.nombre}
      onAbrir={(accion) => router.push(destinos[accion] as never)}
    />
  );
}
