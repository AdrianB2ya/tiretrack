import { type ReactNode, useEffect, useState } from "react";
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
import { colores, conOpacidad, espacio, radio, tactil, texto, entrada } from "./tokens";

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
  // Un escalón sobre la tarjeta, para que se vea botón también dentro de una.
  secundario: colores.campo,
  peligro: colores.peligro,
  fantasma: "transparent",
};

const textosBoton: Record<TipoBoton, string> = {
  primario: colores.sobrePrimario,
  secundario: colores.texto,
  // Sobre el rojo coral se lee el texto oscuro (el blanco no llega a 3:1).
  peligro: colores.sobrePrimario,
  // Blanco como el resto: en gris parecía un botón apagado (revisión de diseño).
  fantasma: colores.texto,
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
        tipo === "fantasma" && { borderWidth: 1, borderColor: colores.bordeFuerte },
        tipo === "secundario" && { borderWidth: 1, borderColor: colores.borde },
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
      <Text style={[estilos.textoInsignia, { color }, compacta && { fontSize: texto.ayuda.fontSize }]}>
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

export function Campo({ etiqueta, ayuda, error, requerido, style, onFocus, onBlur, ...props }: CampoProps) {
  // Borde blanco mientras se escribe: antes no había señal de dónde estaba el cursor.
  const [enFoco, setEnFoco] = useState(false);
  // Varias líneas: alto para dos o tres renglones y el texto arriba, no centrado.
  return (
    <View style={estilos.campo}>
      <Text style={estilos.etiquetaCampo}>
        {etiqueta}
        {requerido ? <Text style={{ color: colores.peligro }}> *</Text> : null}
      </Text>
      <TextInput
        accessibilityLabel={etiqueta}
        placeholderTextColor={colores.textoTenue}
        style={[estilos.entrada, props.multiline ? estilos.entradaVariasLineas : null, enFoco ? estilos.entradaEnFoco : null, error ? { borderColor: colores.peligro } : null, style]}
        {...props}
        onFocus={(e) => {
          setEnFoco(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setEnFoco(false);
          onBlur?.(e);
        }}
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

/** Texto → número, con coma o punto. Vacío o inválido: null. */
export function leerDecimal(texto: string): number | null {
  const limpio = texto.replace(",", ".").trim();
  if (limpio === "" || limpio === ".") return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/**
 * Número con decimales que conserva lo que se escribe.
 *
 * Antes el campo guardaba el número y lo volvía a escribir: al teclear "8."
 * quedaba 8 y el punto desaparecía antes de poder poner el decimal. Aquí el
 * texto vive en el campo mientras se escribe; afuera solo sale el número. Si
 * el número cambia desde afuera (copiar de una hermana, abrir otra posición),
 * el texto se actualiza.
 */
export function CampoDecimal({ valor, onCambio, ...props }: Omit<CampoProps, "value" | "onChangeText"> & {
  valor: number | null;
  onCambio: (n: number | null) => void;
}) {
  // == null: si el valor llega vacío (undefined) el campo no puede decir "undefined".
  const [texto, setTexto] = useState(valor == null ? "" : String(valor).replace(".", ","));
  useEffect(() => {
    if (leerDecimal(texto) !== (valor ?? null)) setTexto(valor == null ? "" : String(valor).replace(".", ","));
    // Solo cuando cambia el número de afuera; el texto propio no se pisa.
  }, [valor]);
  return (
    <Campo
      keyboardType="decimal-pad"
      {...props}
      value={texto}
      onChangeText={(t) => {
        // Solo cifras y un separador: el teclado de algunos teléfonos trae guion o espacio.
        const t2 = t.replace(/[^0-9.,]/g, "");
        setTexto(t2);
        onCambio(leerDecimal(t2));
      }}
    />
  );
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
        // Las que se tocan llevan un brillo arriba: se ven "levantadas".
        onPress ? { borderTopColor: colores.bordeFuerte } : null,
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
      // Al presionarla se aclara un escalón (la transparencia dejaba ver el fondo).
      style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
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
        // Franja del color a la izquierda sobre fondo de tarjeta: las cajas
        // teñidas al 10 % se veían turbias sobre lo oscuro.
        { backgroundColor: colores.tarjeta, borderColor: colores.borde, borderLeftColor: color },
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
export function Opcion({ activa, etiqueta, detalle, onPress, testID, multiple = false }: {
  activa: boolean;
  etiqueta: string;
  /** Segunda línea, más tenue: el nombre del vehículo bajo su código. */
  detalle?: string;
  onPress: () => void;
  testID?: string;
  /** Casilla (se marcan varias) en vez de una sola opción. */
  multiple?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      role={multiple ? "checkbox" : "radio"}
      aria-checked={activa}
      accessibilityLabel={detalle ? `${etiqueta}, ${detalle}` : etiqueta}
      testID={testID}
      style={({ pressed }) => [estilos.opcion, activa && estilos.opcionActiva, pressed && !activa && { backgroundColor: colores.elevado }]}
    >
      <Text style={[estilos.textoOpcion, activa && estilos.textoOpcionActiva]}>
        {activa ? "✓ " : ""}
        {etiqueta}
      </Text>
      {detalle ? <Text style={[estilos.detalleOpcion, activa && estilos.detalleOpcionActiva]}>{detalle}</Text> : null}
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
    borderColor: colores.bordeFuerte,
  },
  // Lo elegido, invertido: se distingue de un vistazo, también bajo el sol.
  opcionActiva: { borderColor: colores.primario, backgroundColor: colores.primario },
  textoOpcion: { ...texto.cuerpo, color: colores.texto },
  textoOpcionActiva: { fontWeight: "700", color: colores.sobrePrimario },
  detalleOpcion: { ...texto.ayuda, color: colores.textoTenue },
  detalleOpcionActiva: { color: colores.sobrePrimario },
  boton: {
    minHeight: tactil.comodo,
    // Dos botones lado a lado caben sin partir el texto en dos renglones.
    paddingHorizontal: espacio.lg,
    borderRadius: radio.md,
    alignItems: "center",
    justifyContent: "center",
  },
  textoBoton: {
    fontSize: texto.cuerpoFuerte.fontSize,
    fontWeight: "600",
    // Si igual se parte, centrado (antes quedaba alineado a la izquierda).
    textAlign: "center",
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
    // La misma etiqueta en toda la app: campos, listas y opciones.
    color: colores.texto,
    marginBottom: espacio.sm,
  },
  entrada: { ...entrada },
  // 2 px para que se note con el sol de frente; el relleno baja 1 px y el texto no salta.
  entradaEnFoco: { borderWidth: 2, borderColor: colores.primario, paddingHorizontal: espacio.lg - 1 },
  entradaVariasLineas: {
    minHeight: 96,
    paddingTop: espacio.md,
    paddingBottom: espacio.md,
    textAlignVertical: "top",
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
    // Aire entre lo que va dentro (textos, botones): sin esto dos botones
    // seguidos quedaban pegados.
    gap: espacio.sm,
    backgroundColor: colores.tarjeta,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radio.md,
    padding: espacio.lg,
  },
  aviso: {
    borderWidth: 1,
    borderLeftWidth: 4,
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
    color: colores.texto,
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
