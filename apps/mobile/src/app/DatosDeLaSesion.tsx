import { useSesion } from "./ProveedorSesion";
import { ProveedorDatos, type ProveedorDatosProps } from "./ProveedorDatos";

/**
 * Los datos, atados a quién tiene la sesión.
 *
 * Mientras la sesión se restaura no se informa usuario: así no se dispara una
 * recarga por el paso de "cargando" a "sin sesión".
 */
export function DatosDeLaSesion(props: Omit<ProveedorDatosProps, "usuarioId" | "conservarCerradas">) {
  const { cargando, usuario } = useSesion();
  // El superadmin no tiene empresa: el servidor le responde 403 a la
  // descarga. Sincronizar solo llenaría la barra de errores cada minuto.
  const plataforma = usuario?.rol === "superadmin";
  return (
    <ProveedorDatos
      {...props}
      usuarioId={cargando ? undefined : plataforma ? null : (usuario?.id ?? null)}
      conservarCerradas={usuario?.rol === "cliente"}
      {...(plataforma ? { intervaloSincronizacionMs: 0 } : {})}
    />
  );
}
