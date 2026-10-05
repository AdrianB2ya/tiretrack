import { useCallback, useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import {
  TEXTO_CONSENTIMIENTO,
  normalizarCedula,
  serializarTrazo,
  trazoASvg,
  validarFirma,
  VERSION_CONSENTIMIENTO,
} from "@tiretrack/domain";
import { Aviso, Boton, Campo } from "../diseno/componentes";
import { colores, conOpacidad, espacio, radio, tactil, texto } from "../diseno/tokens";

/**
 * Captura de la firma de quien recibe.
 *
 * El consentimiento va **primero y bloquea el lienzo**: el trazo es un dato
 * biométrico y la Ley 1581 exige autorización antes de recolectarlo. Poner la
 * casilla debajo del lienzo sería capturar primero y preguntar después.
 */

export type Punto = { x: number; y: number };

export interface DatosFirmaCapturada {
  nombre: string;
  cedula: string;
  cargo: string | null;
  trazoSerializado: string;
  consentimiento: string;
}

export interface CapturaFirmaProps {
  onFirmar: (datos: DatosFirmaCapturada) => void;
  onCancelar: () => void;
  guardando?: boolean;
}

export function CapturaFirma({ onFirmar, onCancelar, guardando = false }: CapturaFirmaProps) {
  const [acepta, setAcepta] = useState(false);
  const [nombre, setNombre] = useState("");
  const [cedula, setCedula] = useState("");
  const [cargo, setCargo] = useState("");
  const [trazo, setTrazo] = useState<Punto[][]>([]);
  const [intentado, setIntentado] = useState(false);

  // El trazo en curso vive en una referencia: actualizar el estado en cada
  // movimiento del dedo haría que la línea se dibuje a tirones.
  const enCurso = useRef<Punto[]>([]);
  const [trazoActual, setTrazoActual] = useState<Punto[]>([]);
  const [tamano, setTamano] = useState({ ancho: 0, alto: 0 });

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        enCurso.current = [{ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }];
        setTrazoActual(enCurso.current);
      },
      onPanResponderMove: (e) => {
        enCurso.current = [
          ...enCurso.current,
          { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY },
        ];
        setTrazoActual(enCurso.current);
      },
      onPanResponderRelease: () => {
        const segmento = enCurso.current;
        if (segmento.length > 0) setTrazo((previos) => [...previos, segmento]);
        enCurso.current = [];
        setTrazoActual([]);
      },
    }),
  ).current;

  const medir = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setTamano({ ancho: width, alto: height });
  }, []);

  const limpiar = useCallback(() => {
    setTrazo([]);
    setTrazoActual([]);
    enCurso.current = [];
  }, []);

  const datos = {
    nombre,
    cedula: normalizarCedula(cedula),
    cargo: cargo.trim() || null,
    trazo,
    consentimientoAceptado: acepta,
  };
  const veredicto = validarFirma(datos);

  const firmar = () => {
    setIntentado(true);
    if (!veredicto.permitido) return;
    onFirmar({
      nombre: nombre.trim(),
      cedula: normalizarCedula(cedula),
      cargo: cargo.trim() || null,
      trazoSerializado: serializarTrazo(trazo),
      consentimiento: VERSION_CONSENTIMIENTO,
    });
  };

  const rutaGuardada = trazoASvg(trazo);
  const rutaEnCurso = trazoASvg([trazoActual]);

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.titulo}>Firma de quien recibe</Text>

      {/* El consentimiento va arriba: es lo que habilita todo lo demás. */}
      <Pressable
        onPress={() => setAcepta(!acepta)}
        testID="aceptar-consentimiento"
        role="checkbox"
        aria-checked={acepta}
        aria-label="Autorizo el registro de mi firma y mis datos"
        style={[estilos.consentimiento, acepta && estilos.consentimientoAceptado]}
      >
        <View style={[estilos.casilla, acepta && estilos.casillaMarcada]}>
          {acepta ? <Text style={estilos.marca}>✓</Text> : null}
        </View>
        <Text style={estilos.textoConsentimiento}>{TEXTO_CONSENTIMIENTO}</Text>
      </Pressable>

      <Campo
        etiqueta="Nombre de quien recibe"
        requerido
        value={nombre}
        onChangeText={setNombre}
        editable={acepta}
        // `editable={false}` solo marca readonly. Aquí el campo no es de
        // solo lectura: está bloqueado hasta que se autorice, y un lector de
        // pantalla debe decirlo así.
        aria-disabled={!acepta}
        autoCapitalize="words"
        placeholder="Nombre completo"
      />
      <Campo
        etiqueta="Cédula"
        requerido
        value={cedula}
        onChangeText={setCedula}
        editable={acepta}
        aria-disabled={!acepta}
        keyboardType="number-pad"
        placeholder="77221004"
        ayuda="Se puede escribir con puntos"
      />
      <Campo
        etiqueta="Cargo"
        value={cargo}
        onChangeText={setCargo}
        editable={acepta}
        aria-disabled={!acepta}
        placeholder="Opcional"
      />

      <Text style={estilos.etiquetaLienzo}>Firma</Text>
      <View
        testID="lienzo"
        onLayout={medir}
        style={[estilos.lienzo, !acepta && estilos.lienzoBloqueado]}
        // Sin autorización el lienzo no responde: no se captura el dato
        // biométrico antes de tener permiso.
        {...(acepta ? responder.panHandlers : {})}
      >
        {tamano.ancho > 0 ? (
          <Svg width={tamano.ancho} height={tamano.alto}>
            {rutaGuardada ? (
              <Path d={rutaGuardada} stroke={colores.texto} strokeWidth={2.5} fill="none" />
            ) : null}
            {rutaEnCurso ? (
              <Path d={rutaEnCurso} stroke={colores.texto} strokeWidth={2.5} fill="none" />
            ) : null}
          </Svg>
        ) : null}

        {trazo.length === 0 && trazoActual.length === 0 ? (
          <Text style={estilos.placeholderLienzo}>
            {acepta ? "Firme aquí con el dedo" : "Primero autorice el registro"}
          </Text>
        ) : null}
      </View>

      <Boton tipo="fantasma" onPress={limpiar} deshabilitado={trazo.length === 0}>
        Borrar y repetir
      </Boton>

      {/* El motivo solo aparece tras intentar: señalar errores mientras la
          persona escribe es ruido. */}
      {intentado && !veredicto.permitido ? (
        <Aviso tono="advertencia" titulo="Falta" detalle={veredicto.mensaje ?? ""} />
      ) : null}

      <View style={estilos.acciones}>
        <Boton tipo="fantasma" ancho onPress={onCancelar}>
          Cancelar
        </Boton>
        <Boton ancho testID="confirmar-firma" onPress={firmar} cargando={guardando}>
          Confirmar firma
        </Boton>
      </View>
    </ScrollView>
  );
}

/** Firma ya capturada, para mostrarla en el detalle de la orden. */
export function FirmaGuardada({
  trazo,
  nombre,
  cedula,
  cargo,
  fechaHora,
  invalidada = false,
}: {
  trazo: readonly (readonly Punto[])[];
  nombre: string;
  cedula: string | null;
  cargo?: string | null;
  fechaHora?: string | null;
  invalidada?: boolean;
}) {
  const ruta = trazoASvg(trazo);

  return (
    <View style={estilos.firmaGuardada}>
      <View style={estilos.lienzoPequeno}>
        {ruta ? (
          <Svg width="100%" height={80} viewBox="0 0 300 120">
            <Path
              d={ruta}
              stroke={invalidada ? colores.textoTenue : colores.texto}
              strokeWidth={2}
              fill="none"
            />
          </Svg>
        ) : (
          <Text style={estilos.sinTrazo}>Sin trazo registrado</Text>
        )}
      </View>
      <Text style={estilos.nombreFirma}>{nombre}</Text>
      <Text style={estilos.datosFirma}>
        {[cedula ? `C.C. ${cedula}` : null, cargo, fechaHora?.slice(0, 10)]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {invalidada ? (
        <Text style={estilos.avisoInvalidada}>
          La orden cambió después de firmarse. Hay que recapturar la firma
        </Text>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md, paddingBottom: espacio.xxl },
  titulo: { ...texto.subtitulo, color: colores.texto, marginBottom: espacio.sm },
  consentimiento: {
    flexDirection: "row",
    gap: espacio.md,
    padding: espacio.lg,
    borderRadius: radio.md,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie,
    marginBottom: espacio.lg,
  },
  consentimientoAceptado: {
    borderColor: colores.exito,
    backgroundColor: conOpacidad(colores.exito, 0.08),
  },
  casilla: {
    width: 26,
    height: 26,
    borderRadius: radio.sm,
    borderWidth: 2,
    borderColor: colores.borde,
    alignItems: "center",
    justifyContent: "center",
  },
  casillaMarcada: { borderColor: colores.exito, backgroundColor: colores.exito },
  marca: { color: colores.blanco, fontWeight: "700" },
  textoConsentimiento: { ...texto.ayuda, color: colores.texto, flex: 1, lineHeight: 19 },
  etiquetaLienzo: {
    ...texto.etiqueta,
    color: colores.textoTenue,
    marginTop: espacio.sm,
  },
  lienzo: {
    height: 180,
    borderRadius: radio.md,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colores.borde,
    backgroundColor: colores.tarjeta,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  lienzoBloqueado: { opacity: 0.5 },
  placeholderLienzo: {
    ...texto.ayuda,
    color: colores.textoTenue,
    position: "absolute",
    // En el estilo, no como prop: el texto no debe robarle el toque al
    // lienzo que tiene debajo.
    pointerEvents: "none",
  },
  acciones: { gap: espacio.md, marginTop: espacio.lg },
  firmaGuardada: {
    padding: espacio.lg,
    borderRadius: radio.md,
    backgroundColor: colores.superficie,
    gap: espacio.xs,
  },
  lienzoPequeno: {
    backgroundColor: colores.tarjeta,
    borderRadius: radio.sm,
    minHeight: 80,
    justifyContent: "center",
    marginBottom: espacio.sm,
  },
  sinTrazo: { ...texto.ayuda, color: colores.textoTenue, textAlign: "center" },
  nombreFirma: { ...texto.cuerpoFuerte, color: colores.texto },
  datosFirma: { ...texto.ayuda, color: colores.textoTenue },
  avisoInvalidada: { ...texto.ayuda, color: colores.peligro, marginTop: espacio.sm },
});

/** Alto mínimo táctil del lienzo, expuesto para las pruebas. */
export const ALTO_LIENZO = 180;
export const TACTIL_MINIMO = tactil.minimo;
