import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Aviso, Boton, Campo } from "../diseno/componentes";
import { colores, conOpacidad, espacio, radio, tactil, texto } from "../diseno/tokens";
import { revisarCodigo, revisarFormulario, type Credenciales, type ResultadoIngreso } from "./ingreso";

/**
 * Pantalla de ingreso.
 *
 * Es la única pantalla que NO funciona sin señal, así que lo dice claro en
 * vez de fallar con un error genérico: un técnico sin cobertura tiene que
 * saber que el problema es la señal y no su contraseña.
 */

export interface PantallaIngresoProps {
  onIngresar: (credenciales: Credenciales) => Promise<ResultadoIngreso | { tipo: "trabajo_de_otro"; mensaje: string }>;
  /** Descarta el trabajo sin enviar del usuario anterior, ya advertido. */
  onDescartarYEntrar: (credenciales: Credenciales) => Promise<void>;
  entrando?: boolean;
  /** Primera vez: el administrador le dio un código de activación. */
  onActivarCuenta?: () => void;
}

export function PantallaIngreso({ onIngresar, onDescartarYEntrar, entrando = false, onActivarCuenta }: PantallaIngresoProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [intentado, setIntentado] = useState(false);
  const [empresas, setEmpresas] = useState<{ id: string; nombre: string }[] | null>(null);
  const [aviso, setAviso] = useState<{ tono: "peligro" | "advertencia"; titulo: string; detalle?: string } | null>(null);
  const [trabajoDeOtro, setTrabajoDeOtro] = useState<string | null>(null);
  // Lo elegido en pasos anteriores se conserva: antes, "descartar y entrar"
  // mandaba solo correo y clave y perdía la empresa elegida.
  const [empresaElegida, setEmpresaElegida] = useState<string | null>(null);
  const [pidiendoCodigo, setPidiendoCodigo] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [codigoIntentado, setCodigoIntentado] = useState(false);

  const problemas = revisarFormulario({ email, password });
  const problemaDe = (campo: "email" | "password") =>
    intentado ? problemas.find((p) => p.campo === campo)?.mensaje : undefined;

  const problemaCodigo = pidiendoCodigo ? revisarCodigo(codigo) : null;

  /** Todo lo que hace falta para entrar, en un solo sitio. */
  const credenciales = (empresaId: string | null = empresaElegida): Credenciales => ({
    email,
    password,
    ...(empresaId ? { empresaId } : {}),
    ...(pidiendoCodigo ? { codigo2fa: codigo } : {}),
  });

  const entrar = async (empresaId: string | null = empresaElegida) => {
    setIntentado(true);
    if (problemas.length > 0) return;
    if (pidiendoCodigo) {
      setCodigoIntentado(true);
      if (problemaCodigo) return;
    }
    setAviso(null);
    setTrabajoDeOtro(null);
    if (empresaId !== empresaElegida) setEmpresaElegida(empresaId);

    const r = await onIngresar(credenciales(empresaId));
    if (r.tipo === "ok") return;

    if (r.tipo === "elegir_empresa") {
      setEmpresas(r.empresas);
      return;
    }
    if (r.tipo === "requiere_codigo") {
      // La contraseña era correcta: no es un error, es el segundo paso.
      setEmpresas(null);
      setPidiendoCodigo(true);
      return;
    }
    if (r.tipo === "codigo_invalido") {
      setCodigo("");
      setCodigoIntentado(false);
      setAviso({ tono: "peligro", titulo: "Ese código no sirvió", detalle: r.mensaje });
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
              onPress={() => {
                setEmpresas(null);
                void entrar(e.id);
              }}
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

  if (pidiendoCodigo) {
    return (
      <KeyboardAvoidingView
        style={estilos.pantalla}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
          <Text style={estilos.titulo}>Código de verificación</Text>
          <Text style={estilos.explicacion}>
            Tu cuenta pide un segundo paso. Abre tu app autenticadora (Google Authenticator,
            Authy…) y escribe el código de 6 números que muestra para TireTrack.
          </Text>
          <Text style={estilos.ayudaIzq}>Entrando como {email.trim().toLowerCase()}</Text>

          <Campo
            etiqueta="Código"
            value={codigo}
            onChangeText={setCodigo}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={7}
            placeholder="123456"
            testID="codigo-2fa"
            {...(codigoIntentado && problemaCodigo ? { error: problemaCodigo } : {})}
          />
          <Text style={estilos.ayudaIzq}>
            El código cambia cada 30 segundos. Si está por cambiar, espera el siguiente.
          </Text>

          {aviso ? <Aviso tono={aviso.tono} titulo={aviso.titulo} {...(aviso.detalle ? { detalle: aviso.detalle } : {})} /> : null}

          {trabajoDeOtro ? (
            <View style={estilos.bloque}>
              <Aviso tono="peligro" titulo="Hay trabajo sin enviar en este equipo" detalle={trabajoDeOtro} />
              <Boton
                tipo="peligro"
                ancho
                testID="descartar-y-entrar"
                onPress={() => void onDescartarYEntrar(credenciales())}
              >
                Descartar ese trabajo y entrar
              </Boton>
            </View>
          ) : null}

          <Boton ancho testID="verificar" onPress={() => void entrar()} cargando={entrando}>
            Verificar y entrar
          </Boton>
          <Boton
            tipo="fantasma"
            ancho
            onPress={() => {
              setPidiendoCodigo(false);
              setCodigo("");
              setCodigoIntentado(false);
              setAviso(null);
            }}
          >
            Volver
          </Boton>
        </ScrollView>
      </KeyboardAvoidingView>
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
              onPress={() => void onDescartarYEntrar(credenciales())}
            >
              Descartar ese trabajo y entrar
            </Boton>
          </View>
        ) : null}

        <Boton ancho testID="entrar" onPress={() => void entrar()} cargando={entrando}>
          Entrar
        </Boton>

        {onActivarCuenta ? (
          <Boton ancho tipo="fantasma" testID="activar-cuenta" onPress={onActivarCuenta}>
            Tengo un código de activación
          </Boton>
        ) : null}

        <Text style={estilos.nota}>
          Para entrar la primera vez necesitas señal. Después podrás trabajar sin ella.
        </Text>
        <Text style={estilos.nota}>¿Olvidaste tu contraseña? Pídele un código nuevo a tu administrador.</Text>
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
  ayudaIzq: { ...texto.ayuda, color: colores.textoTenue },
  explicacion: { ...texto.cuerpo, color: colores.texto },
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
