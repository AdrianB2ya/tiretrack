import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { Aviso, Boton, Campo } from "../diseno/componentes";
import { colores, conOpacidad, espacio, radio, tactil, texto } from "../diseno/tokens";
import { revisarActivacion, secretoLegible, type DatosActivacion, type ResultadoActivacion } from "./activacion";
import { revisarCodigo } from "./ingreso";

/**
 * Activar la cuenta con el código del administrador.
 *
 * Si el rol exige doble factor, hay un segundo paso: registrar la app
 * autenticadora y confirmar un código. Sin eso, el siguiente ingreso pediría
 * un código que la persona no tiene.
 */
export interface PantallaActivacionProps {
  onActivar: (d: DatosActivacion) => Promise<ResultadoActivacion>;
  /** Abre la app autenticadora con la cuenta lista para guardar (enlace otpauth). */
  onAbrirAutenticador: (uri: string) => void;
  onVolver: () => void;
}

export function PantallaActivacion({ onActivar, onAbrirAutenticador, onVolver }: PantallaActivacionProps) {
  const [d, setD] = useState({ email: "", codigo: "", password: "", confirmacion: "" });
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [empresas, setEmpresas] = useState<{ id: string; nombre: string }[] | null>(null);
  const [verClave, setVerClave] = useState(false);
  const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "peligro" | "advertencia"; titulo: string; detalle: string } | null>(null);
  const [dosFA, setDosFA] = useState<{ secreto: string; uri: string } | null>(null);
  const [codigo2fa, setCodigo2fa] = useState("");

  const problemas = revisarActivacion(d);
  const errorDe = (c: string) => {
    const m = intentado ? problemas.find((p) => p.campo === c)?.mensaje : undefined;
    return m ? { error: m } : {};
  };
  const problema2fa = dosFA ? revisarCodigo(codigo2fa) : null;

  const enviar = async (empresa: string | null = empresaId) => {
    setIntentado(true);
    if (problemas.length > 0) return;
    if (dosFA && problema2fa) return;
    setEnviando(true);
    setAviso(null);
    try {
      const r = await onActivar({
        ...d,
        ...(empresa ? { empresaId: empresa } : {}),
        ...(dosFA ? { codigo2fa } : {}),
      });
      if (r.tipo === "configurar_2fa") setDosFA({ secreto: r.secreto, uri: r.uri });
      else if (r.tipo === "elegir_empresa") setEmpresas(r.empresas);
      else if (r.tipo === "rechazada") {
        setAviso({ tono: "peligro", titulo: "No se pudo activar", detalle: r.mensaje });
        if (dosFA) setCodigo2fa("");
      } else if (r.tipo === "sin_conexion") setAviso({ tono: "advertencia", titulo: "No se pudo conectar", detalle: r.mensaje });
    } finally {
      setEnviando(false);
    }
  };

  if (empresas) {
    return (
      <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
        <Text style={estilos.titulo}>¿Con cuál empresa activas?</Text>
        {empresas.map((e) => (
          <Pressable
            key={e.id}
            style={estilos.opcion}
            onPress={() => {
              setEmpresaId(e.id);
              setEmpresas(null);
              void enviar(e.id);
            }}
          >
            <Text style={estilos.textoOpcion}>{e.nombre}</Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={estilos.pantalla} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
        {dosFA ? (
          <>
            <Text style={estilos.titulo}>Último paso: tu app autenticadora</Text>
            <Text style={estilos.explicacion}>
              Tu cuenta pide un segundo paso al entrar. Instala Google Authenticator (o Authy) y
              agrega esta cuenta. Después escribe aquí el código de 6 números que te muestre.
            </Text>
            <Boton ancho tipo="secundario" testID="abrir-autenticador" onPress={() => onAbrirAutenticador(dosFA.uri)}>
              Abrir la app autenticadora
            </Boton>
            <Text style={estilos.ayuda}>Si no se abre sola, agrega la cuenta a mano con esta clave:</Text>
            <Text style={estilos.secreto} selectable testID="secreto-2fa">
              {secretoLegible(dosFA.secreto)}
            </Text>
            <Campo
              etiqueta="Código de la app autenticadora"
              value={codigo2fa}
              onChangeText={setCodigo2fa}
              keyboardType="number-pad"
              maxLength={7}
              {...(intentado && problema2fa ? { error: problema2fa } : {})}
            />
          </>
        ) : (
          <>
            <Text style={estilos.titulo}>Activar mi cuenta</Text>
            <Text style={estilos.explicacion}>
              Escribe el código que te envió el administrador y elige tu contraseña. Solo tú la vas a conocer.
            </Text>
            <Campo etiqueta="Correo" value={d.email} onChangeText={(v) => setD({ ...d, email: v })} autoCapitalize="none" keyboardType="email-address" {...errorDe("email")} />
            <Campo etiqueta="Código de activación" value={d.codigo} onChangeText={(v) => setD({ ...d, codigo: v })} autoCapitalize="characters" placeholder="K7M2-X9QP" {...errorDe("codigo")} />
            <Campo etiqueta="Contraseña nueva" value={d.password} onChangeText={(v) => setD({ ...d, password: v })} secureTextEntry={!verClave} autoCapitalize="none" {...errorDe("password")} />
            <Campo etiqueta="Repite la contraseña" value={d.confirmacion} onChangeText={(v) => setD({ ...d, confirmacion: v })} secureTextEntry={!verClave} autoCapitalize="none" {...errorDe("confirmacion")} />
            <Pressable onPress={() => setVerClave(!verClave)} role="switch" aria-checked={verClave} style={estilos.verClave}>
              <Text style={estilos.textoVerClave}>{verClave ? "Ocultar contraseña" : "Ver contraseña"}</Text>
            </Pressable>
            <Text style={estilos.ayuda}>Mínimo 10 caracteres, con letras y números.</Text>
          </>
        )}

        {aviso ? <Aviso tono={aviso.tono} titulo={aviso.titulo} detalle={aviso.detalle} /> : null}

        <Boton ancho testID="activar" cargando={enviando} onPress={() => void enviar()}>
          {dosFA ? "Confirmar y entrar" : "Activar"}
        </Boton>
        <Boton ancho tipo="fantasma" onPress={onVolver}>
          Volver al ingreso
        </Boton>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.xl, gap: espacio.md, flexGrow: 1, justifyContent: "center" },
  titulo: { ...texto.subtitulo, color: colores.texto },
  explicacion: { ...texto.cuerpo, color: colores.texto },
  ayuda: { ...texto.ayuda, color: colores.textoTenue },
  secreto: { ...texto.codigo, color: colores.primario, fontSize: 18, letterSpacing: 1 },
  verClave: { minHeight: tactil.minimo, justifyContent: "center" },
  textoVerClave: { ...texto.ayuda, color: colores.secundario },
  opcion: {
    minHeight: tactil.comodo, justifyContent: "center", paddingHorizontal: espacio.lg,
    borderRadius: radio.md, borderWidth: 1, borderColor: colores.borde, backgroundColor: conOpacidad(colores.primario, 0.08),
  },
  textoOpcion: { ...texto.cuerpoFuerte, color: colores.texto },
});
