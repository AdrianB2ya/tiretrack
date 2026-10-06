import { useMemo } from "react";
import { Share } from "react-native";
import { nuevoId, puedeGestionarUsuarios } from "@tiretrack/domain";
import { PantallaUsuarios, type FuentesUsuarios, type UsuarioListado } from "../src/admin/PantallaUsuarios";
import { useServicios } from "../src/app/Arranque";
import { useDatos } from "../src/app/ProveedorDatos";
import { useUsuario } from "../src/app/ProveedorSesion";
import { Vacio } from "../src/diseno/componentes";

/** Usuarios de la empresa: alta con código de activación. En línea. */
export default function RutaUsuarios() {
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const { fuentesFlota } = useDatos();

  const fuentes = useMemo<FuentesUsuarios>(() => {
    const llamar = async <T,>(metodo: "GET" | "POST", ruta: string, cuerpo?: unknown) => {
      const r = await enLinea<T>(metodo, ruta, cuerpo);
      return r.ok ? { ok: true as const, datos: r.datos } : { ok: false as const, mensaje: r.mensaje };
    };
    return {
      usuarios: () => llamar<UsuarioListado[]>("GET", "/usuarios"),
      sedes: () => llamar("GET", "/sedes"),
      clientes: () => fuentesFlota.clientes(),
      crear: (f) =>
        llamar<{ codigo: string; expiraEn: string }>("POST", "/usuarios", {
          id: nuevoId(),
          nombre: f.nombre.trim(),
          cedula: f.cedula.trim(),
          email: f.email.trim().toLowerCase(),
          ...(f.telefono.trim() ? { telefono: f.telefono.trim() } : {}),
          rol: f.rol,
          sedes: f.sedes,
          ...(f.rol === "cliente" && f.clienteId ? { clienteId: f.clienteId } : {}),
        }),
      nuevoCodigo: (id) => llamar<{ codigo: string; expiraEn: string }>("POST", `/usuarios/${id}/codigo`, {}),
      // La hoja de compartir del sistema: WhatsApp, SMS, lo que tenga.
      compartir: (mensaje) => void Share.share({ message: mensaje }).catch(() => undefined),
    };
  }, [enLinea, fuentesFlota]);

  if (!puedeGestionarUsuarios(usuario.rol)) return <Vacio mensaje="Solo el administrador gestiona usuarios." />;
  return <PantallaUsuarios fuentes={fuentes} />;
}
