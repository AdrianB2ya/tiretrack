import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { FormularioNuevaOrden } from "../src/ordenes/FormularioNuevaOrden";
import { armarOrden, puedeCrearOrden, type QuienCrea } from "../src/ordenes/nuevaOrden";
import { useDatos } from "../src/app/ProveedorDatos";
import { useUsuario } from "../src/app/ProveedorSesion";
import { Vacio } from "../src/diseno/componentes";

/** Orden nueva: programada por el coordinador, o imprevista del técnico. */
export default function RutaNuevaOrden() {
  const router = useRouter();
  const usuario = useUsuario();
  const { fuentesOrden, crearOrden } = useDatos();
  const [creando, setCreando] = useState(false);
  const [hoy] = useState(() => new Date().toISOString().slice(0, 10));

  const quien = useMemo<QuienCrea>(
    // Una sesión guardada antes de que el login trajera las sedes no las
    // tiene: el formulario lo explica en vez de fallar.
    () => ({ usuarioId: usuario.id, rol: usuario.rol, sedes: usuario.sedes ?? [] }),
    [usuario],
  );

  if (!puedeCrearOrden(usuario.rol)) return <Vacio mensaje="Tu rol no crea órdenes." />;

  return (
    <FormularioNuevaOrden
      quien={quien}
      hoy={hoy}
      fuentes={fuentesOrden}
      creando={creando}
      onCrear={(f, vehiculo, codigoSede) => {
        setCreando(true);
        void (async () => {
          try {
            const orden = armarOrden(f, quien, vehiculo, codigoSede);
            await crearOrden(orden);
            // Directo a la orden: el técnico empieza a capturar; el
            // coordinador ve lo que acaba de programar.
            router.replace(`/orden/${orden.id}` as never);
          } finally {
            setCreando(false);
          }
        })();
      }}
    />
  );
}
