import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Aviso, Boton, Campo } from "../diseno/componentes";
import { colores, conOpacidad, espacio, radio, tactil, texto } from "../diseno/tokens";
import { revisarFormulario, type ResultadoIngreso } from "./ingreso";

/**
 * Pantalla de ingreso.
 *
 * Es la única pantalla que NO funciona sin señal, así que lo dice claro en
 * vez de fallar con un error genérico: un técnico sin cobertura tiene que
 * saber que el problema es la señal y no su contraseña.
 */

export interface PantallaIngresoProps {
  onIngresar: (credenciales: { email: string; password: string; empresaId?: string }) => Promise<ResultadoIngreso | { tipo: "trabajo_de_otro"; mensaje: string }>;
  /** Descarta el trabajo sin enviar del usuario anterior, ya advertido. */
  onDescartarYEntrar: (credenciales: { email: string; password: string; empresaId?: string }) => Promise<void>;
  entrando?: boolean;
}

export function PantallaIngreso({ onIngresar, onDescartarYEntrar, entrando = false }: PantallaIngresoProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [intentado, setIntentado] = useState(false);
  const [empresas, setEmpresas] = useState<{ id: string; nombre: string }[] | null>(null);
  const [aviso, setAviso] = useState<{ tono: "peligro" | "advertencia"; titulo: string; detalle?: string } | null>(null);
  const [trabajoDeOtro, setTrabajoDeOtro] = useState<string | null>(null);

  const problemas = revisarFormulario({ email, password });
  const problemaDe = (campo: "email" | "password") =>
    intentado ? problemas.find((p) => p.campo === campo)?.mensaje : undefined;

  const entrar = async (empresaId?: string) => {
    setIntentado(true);
    if (problemas.length > 0) return;
    setAviso(null);
    setTrabajoDeOtro(null);

    const r = await onIngresar({ email, password, ...(empresaId ? { empresaId } : {}) });
    if (r.tipo === "ok") return;

    if (r.tipo === "elegir_empresa") {
      setEmpresas(r.empresas);
      return;
    }
    if (r.tipo === "trabajo_de_otro") {
      // No se entra encima del trabajo de un compañero sin confirmarlo.
      setTrabajoDeOtro(r.mensaje);
      return;
    }
    if (r.tipo === "sin_conexion") {
      // Se separa de las credenciales a propósito: si no, alguien sin señal
      // cambiaría su contraseña creyendo que la olvidó.
      setAviso({ tono: "advertencia", titulo: "No se pudo conectar", detalle: r.mensaje });
      return;
    }
    setAviso({ tono: "peligro", titulo: "No pudimos entrar", detalle: r.mensaje });
  };

  if (empresas) {
    return (
      <View style={estilos.pantalla}>
        <ScrollView contentContainerStyle={estilos.contenido}>
          <Text style={estilos.titulo}>¿Con cuál empresa entras?</Text>
          <Text style={estilos.ayuda}>Tu correo está registrado en más de una</Text>
          {empresas.map((e) => (
            <Pressable
              key={e.id}
              testID={`empresa-${e.id}`}
              onPress={() => void entrar(e.id)}
              style={estilos.opcionEmpresa}
            >
              <Text style={estilos.nombreEmpresa}>{e.nombre}</Text>
            </Pressable>
          ))}
          <Boton tipo="fantasma" ancho onPress={() => setEmpresas(null)}>
            Volver
          </Boton>
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={estilos.pantalla}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
        <Text style={estilos.marca}>TireTrack</Text>
        <Text style={estilos.ayuda}>Entra para ver tus órdenes del día</Text>

        <Campo
          etiqueta="Correo"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="tu.correo@empresa.com"
          {...(problemaDe("email") ? { error: problemaDe("email") } : {})}
        />

        <Campo
          etiqueta="Contraseña"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!verClave}
          autoCapitalize="none"
          {...(problemaDe("password") ? { error: problemaDe("password") } : {})}
        />
        {/* Con guantes y bajo el sol se escribe mal: poder ver lo escrito
            evita tres intentos fallidos y una cuenta bloqueada. */}
        <Pressable
          onPress={() => setVerClave(!verClave)}
          testID="ver-clave"
          role="switch"
          aria-checked={verClave}
          style={estilos.verClave}
        >
          <Text style={estilos.textoVerClave}>{verClave ? "Ocultar contraseña" : "Ver contraseña"}</Text>
        </Pressable>

        {aviso ? <Aviso tono={aviso.tono} titulo={aviso.titulo} {...(aviso.detalle ? { detalle: aviso.detalle } : {})} /> : null}

        {trabajoDeOtro ? (
          <View style={estilos.bloque}>
            <Aviso tono="peligro" titulo="Hay trabajo sin enviar en este equipo" detalle={trabajoDeOtro} />
            <Boton
              tipo="peligro"
              ancho
              testID="descartar-y-entrar"
              onPress={() => void onDescartarYEntrar({ email, password })}
            >
              Descartar ese trabajo y entrar
            </Boton>
          </View>
        ) : null}

        <Boton ancho testID="entrar" onPress={() => void entrar()} cargando={entrando}>
          Entrar
        </Boton>

        <Text style={estilos.nota}>
          Para entrar la primera vez necesitas señal. Después podrás trabajar sin ella.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.xl, gap: espacio.md, flexGrow: 1, justifyContent: "center" },
  marca: { fontSize: 30, fontWeight: "800", color: colores.primario, textAlign: "center" },
  titulo: { ...texto.subtitulo, color: colores.texto },
  ayuda: { ...texto.ayuda, color: colores.textoTenue, textAlign: "center", marginBottom: espacio.lg },
  verClave: { minHeight: tactil.minimo, justifyContent: "center" },
  textoVerClave: { ...texto.ayuda, color: colores.secundario },
  bloque: { gap: espacio.md },
  opcionEmpresa: {
    minHeight: tactil.comodo,
    justifyContent: "center",
    paddingHorizontal: espacio.lg,
    borderRadius: radio.md,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: conOpacidad(colores.primario, 0.08),
  },
  nombreEmpresa: { ...texto.cuerpoFuerte, color: colores.texto },
  nota: { ...texto.ayuda, color: colores.textoTenue, textAlign: "center", marginTop: espacio.lg },
});
