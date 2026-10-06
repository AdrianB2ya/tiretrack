import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  ETIQUETA_PRIORIDAD_RECOMENDACION,
  PRIORIDADES_RECOMENDACION,
  ordenarRecomendaciones,
  type PrioridadRecomendacion,
} from "@tiretrack/domain";
import { Aviso, Boton, Campo, CampoNumerico, Insignia, Opcion, Tarjeta } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import type { RecomendacionLocal } from "../datos/repositorio";

/**
 * Recomendaciones de la orden (regla del negocio: persistentes).
 *
 * Arriba lo pendiente de visitas ANTERIORES —es lo que el técnico tiene que
 * mirar al llegar al vehículo—; después lo que se registró en esta visita.
 */

export interface RecomendacionesProps {
  ordenId: string;
  recomendaciones: readonly RecomendacionLocal[];
  /** null: se puede registrar y resolver. Con texto: por qué no (se muestra). */
  bloqueo: string | null;
  onCrear: (r: { texto: string; prioridad: PrioridadRecomendacion; posicion: number | null }) => Promise<void>;
  onResolver: (id: string, estado: "ejecutada" | "descartada") => Promise<void>;
}

const TONO: Record<string, string> = { urgente: colores.peligro, proxima: colores.advertencia, seguimiento: colores.textoTenue };

export function separarRecomendaciones(ordenId: string, rs: readonly RecomendacionLocal[]) {
  return {
    anteriores: ordenarRecomendaciones(rs.filter((r) => r.estado === "abierta" && r.origenOrdenId !== ordenId)),
    deEstaVisita: ordenarRecomendaciones(rs.filter((r) => r.origenOrdenId === ordenId)),
    resueltasAqui: rs.filter((r) => r.resueltaOrdenId === ordenId && r.origenOrdenId !== ordenId),
  };
}

export function Recomendaciones({ ordenId, recomendaciones, bloqueo, onCrear, onResolver }: RecomendacionesProps) {
  const { anteriores, deEstaVisita, resueltasAqui } = separarRecomendaciones(ordenId, recomendaciones);
  const [escribiendo, setEscribiendo] = useState(false);
  const [textoNuevo, setTextoNuevo] = useState("");
  const [prioridad, setPrioridad] = useState<PrioridadRecomendacion>("proxima");
  const [posicion, setPosicion] = useState("");
  const [intentado, setIntentado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const errorTexto = textoNuevo.trim().length < 5 ? "Escribe qué hay que hacer (al menos 5 letras)" : null;
  const posicionNumero = /^\d+$/.test(posicion.trim()) ? Number(posicion.trim()) : null;
  const errorPosicion = posicion.trim() && posicionNumero === null ? "Solo el número de la posición" : null;

  const agregar = async () => {
    setIntentado(true);
    if (errorTexto || errorPosicion) return;
    setGuardando(true);
    try {
      await onCrear({ texto: textoNuevo.trim(), prioridad, posicion: posicionNumero });
      setTextoNuevo("");
      setPosicion("");
      setPrioridad("proxima");
      setIntentado(false);
      setEscribiendo(false);
    } finally {
      setGuardando(false);
    }
  };

  const fila = (r: RecomendacionLocal, acciones: boolean) => (
    <Tarjeta key={r.id} testID={`recomendacion-${r.id}`}>
      <View style={estilos.cabecera}>
        <Insignia color={TONO[r.prioridad] ?? colores.textoTenue} compacta>
          {ETIQUETA_PRIORIDAD_RECOMENDACION[r.prioridad as PrioridadRecomendacion] ?? r.prioridad}
        </Insignia>
        {r.posicion !== null ? <Text style={estilos.detalle}>Posición {r.posicion}</Text> : null}
        {r.estado !== "abierta" ? (
          <Text style={estilos.detalle}>{r.estado === "ejecutada" ? "✓ Hecha" : "Descartada"}</Text>
        ) : null}
      </View>
      <Text style={estilos.cuerpo}>{r.texto}</Text>
      {acciones && r.estado === "abierta" && !bloqueo ? (
        <View style={estilos.acciones}>
          <Boton tipo="secundario" testID={`hecha-${r.id}`} onPress={() => void onResolver(r.id, "ejecutada")}>
            Hecha en esta visita
          </Boton>
          <Boton tipo="fantasma" testID={`descartar-${r.id}`} onPress={() => void onResolver(r.id, "descartada")}>
            Descartar
          </Boton>
        </View>
      ) : null}
    </Tarjeta>
  );

  return (
    <View style={estilos.bloque} testID="recomendaciones">
      <Text style={estilos.titulo}>Recomendaciones</Text>

      {anteriores.length > 0 ? (
        <View style={estilos.bloque}>
          {/* Lo que quedó pendiente de antes es lo primero que hay que ver
              al llegar al vehículo. */}
          <Text style={estilos.subtitulo}>Pendientes de visitas anteriores ({anteriores.length})</Text>
          {anteriores.map((r) => fila(r, true))}
        </View>
      ) : null}

      {resueltasAqui.length > 0 ? (
        <View style={estilos.bloque}>
          <Text style={estilos.subtitulo}>Resueltas en esta visita</Text>
          {resueltasAqui.map((r) => fila(r, false))}
        </View>
      ) : null}

      <Text style={estilos.subtitulo}>De esta visita</Text>
      {deEstaVisita.length === 0 ? <Text style={estilos.detalle}>Ninguna registrada.</Text> : null}
      {deEstaVisita.map((r) => fila(r, false))}

      {bloqueo ? (
        <Text style={estilos.detalle}>{bloqueo}</Text>
      ) : escribiendo ? (
        <View style={estilos.bloque}>
          <Campo
            etiqueta="Qué hay que hacer"
            value={textoNuevo}
            onChangeText={setTextoNuevo}
            multiline
            placeholder="Cambiar la llanta de la posición 3 en la próxima visita"
            {...(intentado && errorTexto ? { error: errorTexto } : {})}
          />
          <View style={estilos.chips}>
            {PRIORIDADES_RECOMENDACION.map((p) => (
              <Opcion key={p} etiqueta={ETIQUETA_PRIORIDAD_RECOMENDACION[p]} activa={prioridad === p} onPress={() => setPrioridad(p)} />
            ))}
          </View>
          <CampoNumerico
            etiqueta="Posición (opcional)"
            value={posicion}
            onChangeText={setPosicion}
            {...(intentado && errorPosicion ? { error: errorPosicion } : {})}
          />
          {intentado && (errorTexto || errorPosicion) ? (
            <Aviso tono="peligro" titulo="Falta para guardar" detalle={[errorTexto, errorPosicion].filter(Boolean).join(". ")} />
          ) : null}
          <Boton ancho testID="guardar-recomendacion" cargando={guardando} onPress={() => void agregar()}>
            Guardar recomendación
          </Boton>
          <Boton ancho tipo="fantasma" onPress={() => setEscribiendo(false)}>
            Cancelar
          </Boton>
        </View>
      ) : (
        <Boton ancho tipo="secundario" testID="nueva-recomendacion" onPress={() => setEscribiendo(true)}>
          Agregar recomendación
        </Boton>
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  bloque: { gap: espacio.sm },
  titulo: { ...texto.subtitulo, color: colores.texto },
  subtitulo: { ...texto.etiqueta, color: colores.texto },
  cabecera: { flexDirection: "row", alignItems: "center", gap: espacio.sm, flexWrap: "wrap" },
  cuerpo: { ...texto.cuerpo, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  acciones: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
});
