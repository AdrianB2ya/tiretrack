import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Aviso, Boton } from "../diseno/componentes";
import { colores, conOpacidad, espacio, radio, texto } from "../diseno/tokens";
import {
  advertenciasDe,
  consecuenciasDeEnviar,
  puedeEnviar,
  resumenEnvio,
  revisarEnvio,
  type EstadoEnvio,
  type PuntoRevision,
} from "./envio";
import type { Rol } from "@tiretrack/domain";

/**
 * Pantalla de envío a revisión.
 *
 * Muestra la lista completa de revisión en vez de un botón con un error al
 * final. El técnico está en el patio: tiene que ver de una qué le falta, o
 * termina yendo y viniendo al camión.
 */

export interface PantallaEnvioProps {
  estado: EstadoEnvio;
  rol: Rol;
  usuarioId: string;
  onEnviar: () => void;
  onVolver: () => void;
  enviando?: boolean;
}

export function PantallaEnvio({
  estado,
  rol,
  usuarioId,
  onEnviar,
  onVolver,
  enviando = false,
}: PantallaEnvioProps) {
  const [confirmando, setConfirmando] = useState(false);

  const puntos = revisarEnvio(estado);
  const veredicto = puedeEnviar(estado, rol, usuarioId);
  const advertencias = advertenciasDe(estado);
  const resumen = resumenEnvio(estado);
  const consecuencias = consecuenciasDeEnviar(estado);

  const bloqueos = puntos.filter((p) => p.clase === "impide");

  const intentar = () => {
    // Con advertencias se confirma una vez: enviar con posiciones sin
    // capturar es legítimo, pero no debe pasar por descuido.
    if (advertencias.length > 0 && !confirmando) {
      setConfirmando(true);
      return;
    }
    onEnviar();
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <View style={estilos.resumen}>
        <Text style={estilos.cuenta}>
          {resumen.capturadas} de {resumen.totales}
        </Text>
        <Text style={estilos.etiquetaResumen}>posiciones capturadas</Text>
        {resumen.conAlerta > 0 ? (
          <Text style={estilos.alertaResumen}>
            {resumen.conAlerta} bajo el mínimo de profundidad
          </Text>
        ) : null}
      </View>

      <Seccion titulo="Requisitos">
        {bloqueos.map((p) => (
          <Punto key={p.clave} punto={p} />
        ))}
      </Seccion>

      {advertencias.length > 0 ? (
        <Seccion titulo="Revisa antes de enviar">
          {advertencias.map((p) => (
            <Punto key={p.clave} punto={p} />
          ))}
        </Seccion>
      ) : null}

      {/* Las consecuencias van ANTES del botón: si el técnico se entera
          después, ya no puede corregir. */}
      <Seccion titulo="Al enviar">
        {consecuencias.map((c) => (
          <Text key={c} style={estilos.consecuencia}>
            · {c}
          </Text>
        ))}
      </Seccion>

      {confirmando ? (
        <Aviso
          tono="advertencia"
          titulo="Confirma el envío"
          detalle={advertencias.map((a) => a.texto).join("\n")}
        />
      ) : null}

      {!veredicto.permitido ? (
        <Aviso tono="peligro" titulo="Todavía no se puede enviar" detalle={veredicto.mensaje ?? ""} />
      ) : null}

      <View style={estilos.acciones}>
        <Boton tipo="fantasma" ancho onPress={onVolver}>
          Seguir capturando
        </Boton>
        <Boton
          ancho
          testID="enviar"
          onPress={intentar}
          cargando={enviando}
          deshabilitado={!veredicto.permitido}
        >
          {confirmando ? "Enviar de todos modos" : "Enviar a revisión"}
        </Boton>
      </View>
    </ScrollView>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <View style={estilos.seccion}>
      <Text style={estilos.tituloSeccion}>{titulo}</Text>
      {children}
    </View>
  );
}

function Punto({ punto }: { punto: PuntoRevision }) {
  const color = punto.cumplido
    ? colores.exito
    : punto.clase === "impide"
      ? colores.peligro
      : colores.advertencia;

  return (
    <View style={estilos.punto} testID={`punto-${punto.clave}`}>
      {/* El símbolo acompaña al color: bajo el sol los tonos se confunden */}
      <Text style={[estilos.simbolo, { color }]}>{punto.cumplido ? "✓" : "○"}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[estilos.textoPunto, punto.cumplido && { color: colores.textoTenue }]}>
          {punto.texto}
        </Text>
        {/* Cómo resolverlo, cuando no es obvio por el texto */}
        {!punto.cumplido && punto.comoResolver ? (
          <Text style={estilos.comoResolver}>{punto.comoResolver}</Text>
        ) : null}
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.lg, paddingBottom: espacio.xxl },
  resumen: {
    alignItems: "center",
    padding: espacio.xl,
    borderRadius: radio.md,
    backgroundColor: conOpacidad(colores.primario, 0.1),
  },
  cuenta: { fontSize: 32, fontWeight: "700", color: colores.primario },
  etiquetaResumen: { ...texto.ayuda, color: colores.textoTenue },
  alertaResumen: { ...texto.ayuda, color: colores.peligro, marginTop: espacio.sm },
  seccion: { gap: espacio.md },
  tituloSeccion: {
    ...texto.etiqueta,
    color: colores.textoTenue,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  punto: { flexDirection: "row", gap: espacio.md, alignItems: "flex-start" },
  simbolo: { ...texto.cuerpoFuerte, width: 18 },
  textoPunto: { ...texto.cuerpo, color: colores.texto },
  comoResolver: { ...texto.ayuda, color: colores.textoTenue, marginTop: 2 },
  consecuencia: { ...texto.cuerpo, color: colores.textoTenue },
  acciones: { gap: espacio.md, marginTop: espacio.lg },
});
