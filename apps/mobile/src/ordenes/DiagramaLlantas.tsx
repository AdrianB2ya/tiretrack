import { Pressable, StyleSheet, Text, View } from "react-native";
import { colores, conOpacidad, espacio, radio, tactil, texto, tiposEje } from "../diseno/tokens";
import type { Casilla, Diagrama, FilaEje } from "./diagrama";

/**
 * Diagrama de llantas.
 *
 * Se dibuja como el técnico ve el camión: ejes de arriba hacia abajo, y
 * dentro de cada eje, izquierda a la izquierda. La línea central es el chasis.
 *
 * Las casillas son de 52 puntos porque se tocan de a una con guantes, y el
 * estado va en el color **y** en el número: bajo el sol los tonos se pierden.
 */

export interface DiagramaLlantasProps {
  diagrama: Diagrama;
  onTocarPosicion: (numero: number) => void;
  /** Resalta la posición que se está capturando. */
  posicionActiva?: number;
}

export function DiagramaLlantas({
  diagrama,
  onTocarPosicion,
  posicionActiva,
}: DiagramaLlantasProps) {
  if (diagrama.totalPosiciones === 0) {
    return (
      <View style={estilos.sinConfiguracion}>
        <Text style={estilos.textoSinConfiguracion}>
          Este vehículo no tiene configuración de ejes. Avisa al coordinador
        </Text>
      </View>
    );
  }

  return (
    <View style={estilos.diagrama} testID="diagrama">
      {diagrama.ejes.map((eje) => (
        <Eje
          key={eje.numero}
          eje={eje}
          onTocarPosicion={onTocarPosicion}
          {...(posicionActiva !== undefined ? { posicionActiva } : {})}
        />
      ))}
    </View>
  );
}

function Eje({
  eje,
  onTocarPosicion,
  posicionActiva,
}: {
  eje: FilaEje;
  onTocarPosicion: (n: number) => void;
  posicionActiva?: number;
}) {
  const colorEje = tiposEje[eje.tipoEje as keyof typeof tiposEje]?.color ?? colores.textoTenue;

  return (
    <View style={estilos.eje}>
      <View style={estilos.ladoIzquierdo}>
        {eje.izquierda.map((c) => (
          <CasillaLlanta
            key={c.numero}
            casilla={c}
            activa={c.numero === posicionActiva}
            onPress={() => onTocarPosicion(c.numero)}
          />
        ))}
      </View>

      {/* Chasis: da la referencia de qué lado es cuál */}
      <View style={[estilos.chasis, { backgroundColor: conOpacidad(colorEje, 0.35) }]}>
        {/* Prefijo "E": sin él, el número del eje se confunde con el de una
            posición, que es el error más caro de todos aquí. */}
        <Text style={[estilos.numeroEje, { color: colorEje }]}>E{eje.numero}</Text>
      </View>

      <View style={estilos.ladoDerecho}>
        {eje.derecha.map((c) => (
          <CasillaLlanta
            key={c.numero}
            casilla={c}
            activa={c.numero === posicionActiva}
            onPress={() => onTocarPosicion(c.numero)}
          />
        ))}
      </View>
    </View>
  );
}

const coloresEstado: Record<Casilla["estado"], string> = {
  vacia: colores.borde,
  capturada: colores.exito,
  no_identificada: colores.advertencia,
  alerta_profundidad: colores.peligro,
};

const etiquetasEstado: Record<Casilla["estado"], string> = {
  vacia: "sin capturar",
  capturada: "capturada",
  no_identificada: "sin identificar",
  alerta_profundidad: "bajo el mínimo",
};

export function CasillaLlanta({
  casilla,
  onPress,
  activa = false,
}: {
  casilla: Casilla;
  onPress: () => void;
  activa?: boolean;
}) {
  const color = coloresEstado[casilla.estado];
  const vacia = casilla.estado === "vacia";

  return (
    <Pressable
      onPress={onPress}
      testID={`posicion-${casilla.numero}`}
      accessibilityRole="button"
      // El lector de pantalla dice el estado completo: el color solo no basta
      accessibilityLabel={`Posición ${casilla.numero}, ${etiquetasEstado[casilla.estado]}`}
      style={({ pressed }) => [
        estilos.casilla,
        {
          backgroundColor: vacia ? colores.tarjeta : conOpacidad(color, 0.18),
          borderColor: activa ? colores.primario : color,
          borderWidth: activa ? 3 : 2,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[estilos.numeroCasilla, { color: vacia ? colores.textoTenue : color }]}>
        {casilla.numero}
      </Text>

      {/* La profundidad se muestra en la casilla: es el dato que el técnico
          compara entre posiciones sin abrir cada una. */}
      {casilla.profundidad !== null ? (
        <Text style={[estilos.profundidad, { color }]}>{casilla.profundidad}</Text>
      ) : null}

      {casilla.esInterna ? <View style={estilos.marcaInterna} /> : null}
    </Pressable>
  );
}

/** Resumen del avance, para mostrar sobre el diagrama. */
export function ResumenDiagrama({ diagrama }: { diagrama: Diagrama }) {
  const faltan = diagrama.faltantes.length;
  const alertas = diagrama.conAlerta.length;

  return (
    <View style={estilos.resumen}>
      <Text style={estilos.textoResumen}>
        {diagrama.capturadas} de {diagrama.totalPosiciones} posiciones
      </Text>
      {faltan > 0 ? (
        <Text style={estilos.textoFaltan}>
          Faltan: {diagrama.faltantes.join(", ")}
        </Text>
      ) : null}
      {alertas > 0 ? (
        <Text style={estilos.textoAlerta}>
          {alertas} bajo el mínimo: {diagrama.conAlerta.join(", ")}
        </Text>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  diagrama: { gap: espacio.md, paddingVertical: espacio.md },
  eje: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  ladoIzquierdo: {
    flexDirection: "row",
    gap: tactil.separacion,
    justifyContent: "flex-end",
    flex: 1,
  },
  ladoDerecho: {
    flexDirection: "row",
    gap: tactil.separacion,
    justifyContent: "flex-start",
    flex: 1,
  },
  chasis: {
    width: 44,
    height: 28,
    marginHorizontal: espacio.md,
    borderRadius: radio.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  numeroEje: { ...texto.ayuda, fontWeight: "700" },
  casilla: {
    width: tactil.posicionLlanta,
    height: tactil.posicionLlanta,
    borderRadius: radio.md,
    alignItems: "center",
    justifyContent: "center",
  },
  numeroCasilla: { ...texto.cuerpoFuerte, fontWeight: "700" },
  profundidad: { fontSize: 11, fontWeight: "600", marginTop: 1 },
  marcaInterna: {
    position: "absolute",
    bottom: 3,
    width: 14,
    height: 2,
    borderRadius: radio.completo,
    backgroundColor: colores.textoTenue,
  },
  resumen: { gap: espacio.xs, marginBottom: espacio.sm },
  textoResumen: { ...texto.cuerpoFuerte, color: colores.texto },
  textoFaltan: { ...texto.ayuda, color: colores.textoTenue },
  textoAlerta: { ...texto.ayuda, color: colores.peligro, fontWeight: "600" },
  sinConfiguracion: {
    padding: espacio.xl,
    alignItems: "center",
  },
  textoSinConfiguracion: {
    ...texto.cuerpo,
    color: colores.advertencia,
    textAlign: "center",
  },
});
