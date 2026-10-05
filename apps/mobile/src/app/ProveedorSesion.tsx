import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Rol } from "@tiretrack/domain";
import type { ServicioSesion, UsuarioSesion } from "../sesion/servicio";

/**
 * Sesión en la interfaz.
 *
 * Reemplaza los roles fijos que las pantallas del coordinador traían desde la
 * tarea 4.1. Un rol fijo en código es un permiso que nadie comprueba: la
 * bandeja habría mostrado las mismas acciones a un técnico que a un
 * coordinador.
 */

export interface EstadoSesion {
  readonly cargando: boolean;
  readonly usuario: UsuarioSesion | null;
}

const Contexto = createContext<EstadoSesion | null>(null);

export function ProveedorSesion({
  servicio,
  children,
}: {
  servicio: ServicioSesion;
  children: ReactNode;
}) {
  const [cargando, setCargando] = useState(true);
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);

  useEffect(() => {
    let vigente = true;
    void (async () => {
      const restaurado = await servicio.restaurar();
      if (!vigente) return;
      setUsuario(restaurado);
      setCargando(false);
    })();
    return () => {
      vigente = false;
    };
  }, [servicio]);

  const valor = useMemo(() => ({ cargando, usuario }), [cargando, usuario]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): EstadoSesion {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useSesion debe usarse dentro de ProveedorSesion");
  return ctx;
}

/**
 * Usuario con sesión garantizada, para pantallas que solo existen con sesión.
 *
 * Falla en vez de devolver un usuario vacío: un contexto con id "" y rol por
 * defecto pasaría las comprobaciones de permiso de forma impredecible.
 */
export function useUsuario(): UsuarioSesion {
  const { usuario } = useSesion();
  if (!usuario) throw new Error("Esta pantalla requiere sesión iniciada");
  return usuario;
}

export type Destino = "/ingresar" | "/ordenes" | "/revision" | "/panel";

/**
 * Pantalla de inicio según el rol.
 *
 * El técnico entra directo a sus órdenes: es lo único que hace en campo, y
 * un panel intermedio sería un toque más con guantes. El coordinador entra a
 * su panel, donde ve primero lo que requiere decisión.
 */
export function destinoInicial(usuario: UsuarioSesion | null): Destino {
  if (!usuario) return "/ingresar";
  const porRol: Record<Rol, Destino> = {
    tecnico: "/ordenes",
    coordinador: "/panel",
    administrador: "/panel",
    superadmin: "/panel",
    // El cliente no usa la app de campo; si llega aquí, se lo manda a
    // ingresar para que la pantalla le explique dónde está su portal.
    cliente: "/ingresar",
  };
  return porRol[usuario.rol] ?? "/ingresar";
}
