import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BarraDeSesion } from "../../src/app/BarraDeSesion";
import { NavegacionInferior } from "../../src/app/NavegacionInferior";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { Tarjeta } from "../../src/diseno/componentes";
import { colores, espacio, texto } from "../../src/diseno/tokens";

/**
 * Pantalla del superadministrador (cuenta de plataforma).
 *
 * El superadmin no pertenece a ninguna empresa y, por diseño, no ve datos
 * operativos sin abrir una sesión de suplantación con motivo, ticket y
 * vencimiento —que todavía no está construida—. Antes entraba a un panel
 * vacío con un error de descarga; ahora se le explica qué es su cuenta.
 * Decisión del usuario (2026-10-06): esta pantalla ahora, la suplantación
 * antes de tener una segunda empresa o de dar soporte real.
 */
export default function PantallaPlataforma() {
  const usuario = useUsuario();
  return (
    <View style={estilos.pantalla}>
      <BarraDeSesion />
      <ScrollView contentContainerStyle={estilos.contenido}>
        <Text style={estilos.titulo}>Cuenta de plataforma</Text>
        <Tarjeta>
          <Text style={estilos.cuerpo}>
            {usuario.nombre}, tu cuenta administra TireTrack, no una empresa. Por seguridad no ve las órdenes,
            clientes ni mediciones de ninguna empresa.
          </Text>
        </Tarjeta>
        <Tarjeta>
          <Text style={estilos.subtitulo}>Para ayudar a una empresa</Text>
          <Text style={estilos.detalle}>
            Hará falta abrir una sesión de soporte con motivo, número de ticket y vencimiento; todo lo que se haga
            en ella quedará registrado. Esa función todavía no está disponible.
          </Text>
        </Tarjeta>
        <Tarjeta>
          <Text style={estilos.subtitulo}>Mientras tanto</Text>
          <Text style={estilos.detalle}>
            El administrador de cada empresa gestiona sus usuarios, sedes y plantillas desde su propia cuenta.
          </Text>
        </Tarjeta>
      </ScrollView>
      <NavegacionInferior activa="plataforma" />
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md },
  titulo: { ...texto.subtitulo, color: colores.texto },
  subtitulo: { ...texto.cuerpoFuerte, color: colores.texto },
  cuerpo: { ...texto.cuerpo, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
