import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Aviso, Boton, Campo, Vacio } from "../diseno/componentes";
import { colores, conOpacidad, espacio, radio, tactil, texto } from "../diseno/tokens";
import type { TecnicoLocal } from "../datos/repositorio";
import type { Veredicto } from "@tiretrack/domain";

/**
 * Reasignación de una orden a otro técnico.
 *
 * Se usa cuando el técnico se enferma, cambia de turno o no llega. Lo que la
 * gobierna es que el técnico nuevo **herede el contexto**: si recibe una
 * orden a medias sin saber por qué, rehace lo que ya estaba hecho o se salta
 * lo que faltaba.
 */

export const MOTIVOS_REASIGNACION = [
  "Incapacidad o permiso",
  "Cambio de turno",
  "No llegó al sitio",
  "Carga de trabajo",
] as const;

export interface EstadoReasignacion {
  readonly tecnicoActualId: string;
  readonly tecnicoNuevoId: string | null;
  readonly motivo: string;
  readonly posicionesCapturadas: number;
}

export function validarReasignacion(e: EstadoReasignacion): Veredicto {
  if (!e.tecnicoNuevoId) {
    return { permitido: false, codigo: "SIN_TECNICO", mensaje: "Elige a quién reasignar" };
  }
  if (e.tecnicoNuevoId === e.tecnicoActualId) {
    return {
      permitido: false,
      codigo: "MISMO_TECNICO",
      mensaje: "La orden ya está asignada a esa persona",
    };
  }
  if (e.motivo.trim().length < 5) {
    return {
      permitido: false,
      codigo: "SIN_MOTIVO",
      // Queda en la auditoría: sin motivo, una reasignación es indistinguible
      // de alguien quitándole trabajo a otro.
      mensaje: "Indica el motivo de la reasignación",
    };
  }
  return { permitido: true };
}

/**
 * Qué hereda el técnico nuevo.
 *
 * Se le dice antes, no después: si la orden ya tiene posiciones capturadas,
 * el técnico nuevo tiene que saber que no empieza de cero.
 */
export function mensajeHerencia(posicionesCapturadas: number, totales: number): string {
  if (posicionesCapturadas === 0) {
    return "La orden no tiene mediciones: el técnico nuevo empieza desde el principio";
  }
  const faltan = totales - posicionesCapturadas;
  // El plural se escribe entero, no pegando sufijos: "posición" + "es" da
  // "posiciónes", con una tilde que el plural no lleva.
  const sustantivo =
    posicionesCapturadas === 1 ? "posición ya capturada" : "posiciones ya capturadas";
  return (
    `Hereda ${posicionesCapturadas} ${sustantivo}` +
    (faltan > 0 ? ` y le quedan ${faltan} por capturar` : " y la captura está completa")
  );
}

// ── Pantalla ────────────────────────────────────────────────────────────────

export interface ReasignarOrdenProps {
  tecnicos: readonly TecnicoLocal[];
  tecnicoActualId: string;
  posicionesCapturadas: number;
  posicionesTotales: number;
  onReasignar: (tecnicoId: string, motivo: string) => void;
  onCancelar: () => void;
  procesando?: boolean;
}

export function ReasignarOrden({
  tecnicos,
  tecnicoActualId,
  posicionesCapturadas,
  posicionesTotales,
  onReasignar,
  onCancelar,
  procesando = false,
}: ReasignarOrdenProps) {
  const [elegido, setElegido] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [intentado, setIntentado] = useState(false);

  // El técnico actual se excluye: ofrecerlo como opción invita al error.
  const candidatos = tecnicos.filter((t) => t.id !== tecnicoActualId);

  const veredicto = validarReasignacion({
    tecnicoActualId,
    tecnicoNuevoId: elegido,
    motivo,
    posicionesCapturadas,
  });

  const confirmar = () => {
    setIntentado(true);
    if (!veredicto.permitido || !elegido) return;
    onReasignar(elegido, motivo.trim());
  };

  if (candidatos.length === 0) {
    return (
      <View style={estilos.pantalla}>
        <Vacio mensaje="No hay otros técnicos activos en esta sede" />
        <View style={estilos.contenido}>
          <Boton tipo="fantasma" ancho onPress={onCancelar}>
            Volver
          </Boton>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.titulo}>Reasignar a</Text>

      <View style={estilos.lista}>
        {candidatos.map((t) => {
          const activo = elegido === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setElegido(t.id)}
              testID={`tecnico-${t.id}`}
              role="radio"
              aria-checked={activo}
              style={[estilos.opcion, activo && estilos.opcionActiva]}
            >
              <Text style={[estilos.nombre, activo && { color: colores.primario }]}>{t.nombre}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Se dice qué hereda ANTES de confirmar: si la orden va a medias, el
          técnico nuevo no puede empezar de cero sin saberlo. */}
      <Aviso tono="info" titulo="Lo que recibe" detalle={mensajeHerencia(posicionesCapturadas, posicionesTotales)} />

      <Text style={estilos.subtitulo}>Motivo</Text>
      <View style={estilos.fichas}>
        {MOTIVOS_REASIGNACION.map((m) => (
          <Pressable
            key={m}
            onPress={() => setMotivo(m)}
            testID={`motivo-${MOTIVOS_REASIGNACION.indexOf(m)}`}
            style={[estilos.ficha, motivo === m && estilos.fichaActiva]}
          >
            <Text style={[estilos.textoFicha, motivo === m && { color: colores.primario }]}>{m}</Text>
          </Pressable>
        ))}
      </View>
      <Campo
        etiqueta="Detalle del motivo"
        value={motivo}
        onChangeText={setMotivo}
        placeholder="O escribe otro motivo"
        {...(intentado && !veredicto.permitido ? { error: veredicto.mensaje } : {})}
      />

      <View style={estilos.acciones}>
        <Boton tipo="fantasma" ancho onPress={onCancelar}>
          Cancelar
        </Boton>
        <Boton ancho testID="confirmar-reasignacion" onPress={confirmar} cargando={procesando}>
          Reasignar
        </Boton>
      </View>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.lg, paddingBottom: espacio.xxl },
  titulo: { ...texto.subtitulo, color: colores.texto },
  subtitulo: { ...texto.etiqueta, color: colores.textoTenue },
  lista: { gap: espacio.sm },
  opcion: {
    minHeight: tactil.comodo,
    justifyContent: "center",
    paddingHorizontal: espacio.lg,
    borderRadius: radio.md,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.tarjeta,
  },
  opcionActiva: { borderColor: colores.primario, backgroundColor: conOpacidad(colores.primario, 0.12) },
  nombre: { ...texto.cuerpoFuerte, color: colores.texto },
  fichas: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  ficha: {
    minHeight: tactil.minimo,
    justifyContent: "center",
    paddingHorizontal: espacio.lg,
    borderRadius: radio.completo,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.tarjeta,
  },
  fichaActiva: { borderColor: colores.primario, backgroundColor: conOpacidad(colores.primario, 0.12) },
  textoFicha: { ...texto.cuerpo, color: colores.texto },
  acciones: { gap: espacio.md },
});
