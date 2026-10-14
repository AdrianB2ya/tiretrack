import { useMemo } from "react";
import { useRouter } from "expo-router";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { BarraDeSesion } from "../../src/app/BarraDeSesion";
import { NavegacionInferior } from "../../src/app/NavegacionInferior";
import { useServicios } from "../../src/app/Arranque";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { Boton, Tarjeta } from "../../src/diseno/componentes";
import { colores, espacio, texto } from "../../src/diseno/tokens";
import { EmpresasPlataforma, type EmpresaListada, type FuentesEmpresas } from "../../src/plataforma/EmpresasPlataforma";
import { sesionSoporte, type SesionSoporte } from "../../src/plataforma/soporte";

/**
 * Pantalla del superadministrador (cuenta de plataforma).
 *
 * El superadmin no pertenece a ninguna empresa y, por diseño, no ve datos
 * operativos. Desde aquí da de alta empresas (R16) sin scripts.
 */
export default function PantallaPlataforma() {
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const router = useRouter();
  const fuentes = useMemo<FuentesEmpresas>(() => {
    const llamar = async <T,>(metodo: "GET" | "POST", ruta: string, cuerpo?: unknown) => {
      const r = await enLinea<T>(metodo, ruta, cuerpo);
      return r.ok
        ? { ok: true as const, datos: r.datos }
        : { ok: false as const, mensaje: r.status === 0 ? "Sin señal: la plataforma se administra en línea" : r.mensaje };
    };
    return {
      empresas: () => llamar<EmpresaListada[]>("GET", "/plataforma/empresas"),
      crear: (f) =>
        llamar<{ codigo: string | null; expiraEn: string | null }>("POST", "/plataforma/empresas", {
          empresa: { nombre: f.nombre.trim(), nit: f.nit.trim() },
          sede: { nombre: f.sedeNombre.trim(), codigo: f.sedeCodigo.trim(), ...(f.sedeCiudad.trim() ? { ciudad: f.sedeCiudad.trim() } : {}) },
          administrador: {
            nombre: f.adminNombre.trim(),
            cedula: f.adminCedula.trim(),
            email: f.adminEmail.trim().toLowerCase(),
            ...(f.adminTelefono.trim() ? { telefono: f.adminTelefono.trim() } : {}),
          },
        }),
      // La hoja de compartir del sistema: WhatsApp, SMS, lo que tenga.
      compartir: (mensaje) => void Share.share({ message: mensaje }).catch(() => undefined),
      abrirSoporte: (empresaId, d) => llamar<SesionSoporte>("POST", "/plataforma/soporte", { empresaId, ...d }),
      onSoporteAbierto: (s) => {
        sesionSoporte.fijar(s);
        router.push("/soporte" as never);
      },
    };
  }, [enLinea, router]);

  return (
    <View style={estilos.pantalla}>
      <BarraDeSesion />
      <ScrollView contentContainerStyle={estilos.contenido}>
        <Text style={estilos.titulo}>Cuenta de plataforma</Text>
        <Tarjeta>
          <Text style={estilos.cuerpo}>
            {usuario.nombre}, tu cuenta administra Asistectire, no una empresa. Por seguridad no ve las órdenes,
            clientes ni mediciones de ninguna empresa.
          </Text>
        </Tarjeta>
        <Boton ancho tipo="secundario" testID="catalogo-general" onPress={() => router.push("/catalogo-general" as never)}>
          Catálogo general de llantas
        </Boton>
        <EmpresasPlataforma fuentes={fuentes} />
      </ScrollView>
      <NavegacionInferior activa="plataforma" />
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md, paddingBottom: espacio.xxl },
  titulo: { ...texto.subtitulo, color: colores.texto },
  cuerpo: { ...texto.cuerpo, color: colores.texto },
});
