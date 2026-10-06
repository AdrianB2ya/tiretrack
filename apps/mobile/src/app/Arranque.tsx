import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { abrirBaseDispositivo } from "../datos/conexion";
import { migrar, type Conexion } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";
import { MotorSincronizacion } from "../datos/sincronizacion";
import { ClienteHttp } from "../datos/clienteHttp";
import { abrirAlmacenSeguro } from "../sesion/almacen";
import { ServicioSesion } from "../sesion/servicio";
import { ProveedorSesion } from "./ProveedorSesion";
import { DatosDeLaSesion } from "./DatosDeLaSesion";
import { SubidorFotos } from "../fotos/subidor";
import { transporteDelDispositivo } from "../fotos/transporte";
import { colores, espacio, texto } from "../diseno/tokens";

/**
 * Arranque de la app: abre la base, migra y monta los proveedores.
 *
 * Es código de unión con el dispositivo (`expo-sqlite`, Keystore), así que
 * no corre en las pruebas de Node. Cada pieza que ensambla sí está probada
 * por separado; lo que se valida en el emulador es que el ensamblaje abra.
 */

interface Servicios {
  db: Conexion;
  sesion: ServicioSesion;
  motor: MotorSincronizacion;
  cliente: ClienteHttp;
  subidor: SubidorFotos;
}

async function iniciar(apiUrl: string): Promise<Servicios> {
  const db = await abrirBaseDispositivo();
  // Migrar antes de cualquier otra cosa: una pantalla que consulte una
  // columna nueva sobre una base vieja falla con un error ilegible.
  await migrar(db);

  const sesion = new ServicioSesion(await abrirAlmacenSeguro(), db);
  const repo = new RepositorioLocal(db);
  const cliente = new ClienteHttp({
      baseUrl: apiUrl,
      obtenerToken: () => sesion.token(),
      // Sin esto, un token vencido (duran 15 minutos) apartaría todo el
      // trabajo de un técnico que vuelve de una jornada sin señal.
      renovarSesion: () =>
        sesion.renovar(async (refreshToken) => {
          const r = await fetch(`${apiUrl}/auth/refrescar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken }),
          });
          if (!r.ok) return null;
          return (await r.json()) as { token: string; refreshToken: string };
        }),
  });
  const motor = new MotorSincronizacion(repo, cliente);
  // Sin un transporte real, el subidor nunca se usaba: ninguna foto salía
  // del celular.
  const subidor = new SubidorFotos(repo, transporteDelDispositivo);
  return { db, sesion, motor, cliente, subidor };
}

/** Lo que hace falta fuera de la cola: ingreso, activación y administración en línea. */
export interface ServiciosEnLinea {
  sesion: ServicioSesion;
  apiUrl: string;
  enLinea: ClienteHttp["enLinea"];
  descargarTexto: ClienteHttp["descargarTexto"];
}

const ContextoServicios = createContext<ServiciosEnLinea | null>(null);

export function useServicios(): ServiciosEnLinea {
  const ctx = useContext(ContextoServicios);
  if (!ctx) throw new Error("useServicios debe usarse dentro de Arranque");
  return ctx;
}

export function Arranque({ apiUrl, children }: { apiUrl: string; children: ReactNode }) {
  const [servicios, setServicios] = useState<Servicios | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    iniciar(apiUrl).then(setServicios, (e: Error) => setError(e.message));
  }, [apiUrl]);

  if (error) {
    // Un fallo aquí suele ser una migración: se muestra el mensaje en vez
    // de una pantalla en blanco, para que soporte pueda diagnosticarlo.
    return (
      <View style={estilos.centrado}>
        <Text style={estilos.titulo}>No se pudo abrir la base del dispositivo</Text>
        <Text style={estilos.detalle}>{error}</Text>
      </View>
    );
  }

  if (!servicios) {
    return (
      <View style={estilos.centrado}>
        <ActivityIndicator color={colores.primario} />
      </View>
    );
  }

  return (
    <ContextoServicios.Provider
      value={{ sesion: servicios.sesion, apiUrl, enLinea: servicios.cliente.enLinea.bind(servicios.cliente), descargarTexto: servicios.cliente.descargarTexto.bind(servicios.cliente) }}
    >
    <ProveedorSesion servicio={servicios.sesion}>
      <DatosDeLaSesion
        db={servicios.db}
        sesion={servicios.sesion}
        motor={servicios.motor}
        descarga={servicios.cliente}
        subidor={servicios.subidor}
      >
        {children}
      </DatosDeLaSesion>
    </ProveedorSesion>
    </ContextoServicios.Provider>
  );
}

const estilos = StyleSheet.create({
  centrado: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: espacio.xl,
    backgroundColor: colores.fondo,
  },
  titulo: { ...texto.subtitulo, color: colores.peligro, textAlign: "center" },
  detalle: { ...texto.ayuda, color: colores.textoTenue, marginTop: espacio.md, textAlign: "center" },
});
