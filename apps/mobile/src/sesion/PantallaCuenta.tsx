import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Rol } from "@tiretrack/domain";
import { Aviso, Boton, Tarjeta } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import type { Resultado, TrabajoPendiente, UsuarioSesion } from "./servicio";

/**
 * Cuenta: quién está dentro y cómo salir.
 *
 * Es una pantalla aparte y no un botón suelto en la cabecera: con guantes,
 * un toque sin querer en la barra cerraría la sesión, y volver a entrar
 * exige señal —que en el patio puede no haber—.
 *
 * Mostrar quién está dentro también importa: en un carro taller la tablet se
 * comparte, y lo primero es saber a nombre de quién quedará lo que se capture.
 */

/** Solo la etiqueta: el código del rol viene del dominio. */
export const ETIQUETA_ROL: Record<Rol, string> = {
  superadmin: "Soporte de plataforma",
  administrador: "Administrador",
  coordinador: "Coordinador",
  tecnico: "Técnico",
  cliente: "Cliente",
};

export interface PantallaCuentaProps {
  usuario: UsuarioSesion;
  /** Cierra la sesión. Sin forzar, se niega si hay trabajo sin enviar. */
  onCerrar: (forzar: boolean) => Promise<Resultado<{ descartado: TrabajoPendiente | null }>>;
  onSincronizar: () => Promise<unknown>;
  sincronizando: boolean;
  /** La sesión ya se cerró: llevar a la pantalla de ingreso. */
  onCerrada: () => void;
}

export function PantallaCuenta({
  usuario,
  onCerrar,
  onSincronizar,
  sincronizando,
  onCerrada,
}: PantallaCuentaProps) {
  const [cerrando, setCerrando] = useState(false);
  const [pendiente, setPendiente] = useState<string | null>(null);

  const cerrar = async (forzar: boolean) => {
    setCerrando(true);
    try {
      const r = await onCerrar(forzar);
      if (r.ok) {
        onCerrada();
        return;
      }
      // El único motivo para negarse es el trabajo sin enviar: se explica y se
      // ofrecen las salidas, en vez de un botón que no hace nada.
      setPendiente(r.veredicto.mensaje ?? "Hay trabajo sin enviar");
    } finally {
      setCerrando(false);
    }
  };

  const sincronizarYReintentar = async () => {
    await onSincronizar();
    setPendiente(null);
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Tarjeta>
        <Text style={estilos.etiqueta}>Sesión iniciada como</Text>
        <Text style={estilos.nombre}>{usuario.nombre}</Text>
        <Text style={estilos.detalle}>{usuario.email}</Text>
        <Text style={estilos.detalle}>{ETIQUETA_ROL[usuario.rol] ?? usuario.rol}</Text>
      </Tarjeta>

      {pendiente ? (
        <View style={estilos.bloque}>
          <Aviso tono="peligro" titulo="No se cerró la sesión" detalle={pendiente} />
          <Text style={estilos.explicacion}>
            Al cerrar sesión se borra todo lo guardado en este celular. Lo que no se haya
            enviado se pierde y no se puede recuperar.
          </Text>
          <Boton ancho cargando={sincronizando} onPress={() => void sincronizarYReintentar()}>
            Enviar ahora
          </Boton>
          <Boton ancho tipo="peligro" cargando={cerrando} onPress={() => void cerrar(true)}>
            Descartar lo pendiente y cerrar sesión
          </Boton>
          <Boton ancho tipo="fantasma" onPress={() => setPendiente(null)}>
            Cancelar
          </Boton>
        </View>
      ) : (
        <View style={estilos.bloque}>
          <Aviso
            tono="advertencia"
            titulo="Para volver a entrar vas a necesitar señal"
            detalle="Si estás en un sitio sin cobertura, no cierres la sesión hasta tenerla."
          />
          <Boton ancho tipo="secundario" cargando={cerrando} onPress={() => void cerrar(false)}>
            Cerrar sesión
          </Boton>
        </View>
      )}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.md, gap: espacio.md },
  bloque: { gap: espacio.md },
  etiqueta: { ...texto.ayuda, color: colores.textoTenue },
  nombre: { ...texto.subtitulo, color: colores.texto, marginTop: espacio.xs },
  detalle: { ...texto.cuerpo, color: colores.textoTenue },
  explicacion: { ...texto.cuerpo, color: colores.texto },
});
