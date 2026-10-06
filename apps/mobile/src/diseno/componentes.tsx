import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { colores, conOpacidad, espacio, radio, tactil, texto } from "./tokens";

/**
 * Componentes base.
 *
 * Todos respetan el tamaño táctil mínimo y ninguno depende del color como
 * única señal: un técnico con la pantalla bajo el sol distingue mal los
 * tonos, así que el estado va también en el texto o el icono.
 */

// ── Botón ───────────────────────────────────────────────────────────────────

export type TipoBoton = "primario" | "secundario" | "peligro" | "fantasma";

export interface BotonProps {
  children: ReactNode;
  onPress?: () => void;
  tipo?: TipoBoton;
  deshabilitado?: boolean;
  cargando?: boolean;
  /** Para el caso frecuente de un botón que ocupa el ancho disponible. */
  ancho?: boolean;
  testID?: string;
}

const fondosBoton: Record<TipoBoton, string> = {
  primario: colores.primario,
  secundario: colores.tarjeta,
  peligro: colores.peligro,
  fantasma: "transparent",
};

const textosBoton: Record<TipoBoton, string> = {
  primario: colores.blanco,
  secundario: colores.texto,
  peligro: colores.blanco,
  fantasma: colores.textoTenue,
};

export function Boton({
  children,
  onPress,
  tipo = "primario",
  deshabilitado = false,
  cargando = false,
  ancho = false,
  testID,
}: BotonProps) {
  const inactivo = deshabilitado || cargando;

  return (
    <Pressable
      testID={testID}
      onPress={inactivo ? undefined : onPress}
      // `disabled` además de quitar el manejador: es lo que la capa nativa
      // usa para anunciarlo. Sin esto un lector de pantalla dice "botón
      // Guardar" y la persona lo toca sin saber que no hace nada.
      disabled={inactivo}
      accessibilityRole="button"
      // `aria-busy` además de accessibilityState: esta última no llega a la
      // capa de presentación y el "cargando" se perdía en silencio.
      aria-busy={cargando}
      accessibilityState={{ disabled: inactivo, busy: cargando }}
      style={({ pressed }) => [
        estilos.boton,
        { backgroundColor: fondosBoton[tipo] },
        tipo === "fantasma" && { borderWidth: 1, borderColor: colores.borde },
        ancho && { alignSelf: "stretch" },
        // La respuesta al toque es visual: con guantes no se siente el clic
        pressed && !inactivo && { opacity: 0.7 },
        inactivo && { opacity: 0.4 },
      ]}
    >
      {cargando ? (
        <ActivityIndicator color={textosBoton[tipo]} />
      ) : (
        <Text style={[estilos.textoBoton, { color: textosBoton[tipo] }]}>{children}</Text>
      )}
    </Pressable>
  );
}

// ── Insignia de estado ──────────────────────────────────────────────────────

export interface InsigniaProps {
  children: ReactNode;
  color: string;
  compacta?: boolean;
  /** React la consume antes de llegar al componente; se declara para TS. */
  key?: string | number;
}

export function Insignia({ children, color, compacta = false }: InsigniaProps) {
  return (
    <View
      style={[
        estilos.insignia,
        {
          backgroundColor: conOpacidad(color, 0.13),
          borderColor: conOpacidad(color, 0.4),
        },
        compacta && { paddingVertical: 2, paddingHorizontal: 8 },
      ]}
    >
      {/* El texto lleva el estado, no solo el color: bajo el sol los tonos
          se confunden y hay técnicos con daltonismo. */}
      <Text style={[estilos.textoInsignia, { color }, compacta && { fontSize: 12 }]}>
        {children}
      </Text>
    </View>
  );
}

// ── Campo de texto ──────────────────────────────────────────────────────────

export interface CampoProps extends TextInputProps {
  etiqueta: string;
  ayuda?: string;
  error?: string;
  requerido?: boolean;
}

export function Campo({ etiqueta, ayuda, error, requerido, style, ...props }: CampoProps) {
  return (
    <View style={estilos.campo}>
      <Text style={estilos.etiquetaCampo}>
        {etiqueta}
        {requerido ? <Text style={{ color: colores.peligro }}> *</Text> : null}
      </Text>
      <TextInput
        accessibilityLabel={etiqueta}
        placeholderTextColor={colores.textoTenue}
        style={[estilos.entrada, error ? { borderColor: colores.peligro } : null, style]}
        {...props}
      />
      {/* El error reemplaza a la ayuda: dos textos bajo el campo compiten */}
      {error ? (
        <Text style={estilos.textoError}>{error}</Text>
      ) : ayuda ? (
        <Text style={estilos.textoAyuda}>{ayuda}</Text>
      ) : null}
    </View>
  );
}

/**
 * Campo numérico. Abre el teclado numérico directamente: el técnico captura
 * decenas de cifras por orden y cambiar de teclado cada vez cuesta.
 */
export function CampoNumerico(props: CampoProps) {
  return <Campo keyboardType="decimal-pad" {...props} />;
}

// ── Tarjeta ─────────────────────────────────────────────────────────────────

export interface TarjetaProps {
  children: ReactNode;
  onPress?: () => void;
  /** Franja lateral de color, para estados. */
  acento?: string;
  estilo?: ViewStyle;
  testID?: string;
}

export function Tarjeta({ children, onPress, acento, estilo, testID }: TarjetaProps) {
  const contenido = (
    <View
      testID={onPress ? undefined : testID}
      style={[
        estilos.tarjeta,
        acento ? { borderLeftWidth: 4, borderLeftColor: acento } : null,
        estilo,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) return contenido;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => (pressed ? { opacity: 0.75 } : undefined)}
    >
      {contenido}
    </Pressable>
  );
}

// ── Aviso ───────────────────────────────────────────────────────────────────

export type TonoAviso = "info" | "advertencia" | "peligro" | "exito";

const coloresAviso: Record<TonoAviso, string> = {
  info: colores.secundario,
  advertencia: colores.advertencia,
  peligro: colores.peligro,
  exito: colores.exito,
};

export interface AvisoProps {
  titulo: string;
  detalle?: string;
  tono?: TonoAviso;
}

export function Aviso({ titulo, detalle, tono = "info" }: AvisoProps) {
  const color = coloresAviso[tono];
  return (
    <View
      accessibilityRole="alert"
      style={[
        estilos.aviso,
        { backgroundColor: conOpacidad(color, 0.1), borderColor: conOpacidad(color, 0.35) },
      ]}
    >
      <Text style={[estilos.tituloAviso, { color }]}>{titulo}</Text>
      {detalle ? <Text style={estilos.detalleAviso}>{detalle}</Text> : null}
    </View>
  );
}

// ── Estado vacío ────────────────────────────────────────────────────────────

export function Vacio({ mensaje }: { mensaje: string }) {
  return (
    <View style={estilos.vacio}>
      <Text style={estilos.textoVacio}>{mensaje}</Text>
    </View>
  );
}

// ── Opción ──────────────────────────────────────────────────────────────────

/**
 * Una opción entre varias (tipo de eje, servicio, rango de fechas). La elegida
 * lleva "✓" en el texto, no solo otro color, y se anuncia con `aria-checked`
 * —`accessibilityState` se pierde en la presentación (tarea 3.4)—.
 */
export function Opcion({ activa, etiqueta, detalle, onPress, testID }: {
  activa: boolean;
  etiqueta: string;
  /** Segunda línea, más tenue: el nombre del vehículo bajo su código. */
  detalle?: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      role="radio"
      aria-checked={activa}
      accessibilityLabel={detalle ? `${etiqueta}, ${detalle}` : etiqueta}
      testID={testID}
      style={({ pressed }) => [estilos.opcion, activa && estilos.opcionActiva, pressed && { opacity: 0.7 }]}
    >
      <Text style={[estilos.textoOpcion, activa && estilos.textoOpcionActiva]}>
        {activa ? "✓ " : ""}
        {etiqueta}
      </Text>
      {detalle ? <Text style={estilos.detalleOpcion}>{detalle}</Text> : null}
    </Pressable>
  );
}

// ── Estilos ─────────────────────────────────────────────────────────────────

const estilos = StyleSheet.create({
  opcion: {
    minHeight: tactil.minimo,
    justifyContent: "center",
    paddingHorizontal: espacio.md,
    borderRadius: radio.md,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  opcionActiva: { borderColor: colores.primario, backgroundColor: conOpacidad(colores.primario, 0.12) },
  textoOpcion: { ...texto.cuerpo, color: colores.texto },
  textoOpcionActiva: { fontWeight: "700", color: colores.primario },
  detalleOpcion: { ...texto.ayuda, color: colores.textoTenue },
  boton: {
    minHeight: tactil.comodo,
    paddingHorizontal: espacio.xl,
    borderRadius: radio.md,
    alignItems: "center",
    justifyContent: "center",
  },
  textoBoton: {
    fontSize: texto.cuerpoFuerte.fontSize,
    fontWeight: "600",
  },
  insignia: {
    borderRadius: radio.sm,
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 10,
    alignSelf: "flex-start",
  },
  textoInsignia: {
    fontSize: texto.ayuda.fontSize,
    fontWeight: "600",
  },
  campo: {
    marginBottom: espacio.lg,
  },
  etiquetaCampo: {
    fontSize: texto.etiqueta.fontSize,
    fontWeight: "600",
    color: colores.textoTenue,
    marginBottom: espacio.sm,
  },
  entrada: {
    minHeight: tactil.comodo,
    backgroundColor: colores.tarjeta,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radio.md,
    paddingHorizontal: espacio.lg,
    fontSize: texto.cuerpo.fontSize,
    color: colores.texto,
  },
  textoAyuda: {
    fontSize: texto.ayuda.fontSize,
    color: colores.textoTenue,
    marginTop: espacio.xs,
  },
  textoError: {
    fontSize: texto.ayuda.fontSize,
    color: colores.peligro,
    marginTop: espacio.xs,
  },
  tarjeta: {
    backgroundColor: colores.tarjeta,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radio.md,
    padding: espacio.lg,
  },
  aviso: {
    borderWidth: 1,
    borderRadius: radio.md,
    padding: espacio.lg,
    marginBottom: espacio.lg,
  },
  tituloAviso: {
    fontSize: texto.etiqueta.fontSize,
    fontWeight: "700",
    marginBottom: espacio.xs,
  },
  detalleAviso: {
    fontSize: texto.ayuda.fontSize,
    color: colores.textoTenue,
  },
  vacio: {
    padding: espacio.xxl,
    alignItems: "center",
  },
  textoVacio: {
    fontSize: texto.cuerpo.fontSize,
    color: colores.textoTenue,
    textAlign: "center",
  },
});
