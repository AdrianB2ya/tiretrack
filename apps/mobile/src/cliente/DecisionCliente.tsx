import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Aviso, Boton, Campo } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";

/**
 * Aprobación del cliente: aprobar u objetar con motivo.
 *
 * Si el cliente no responde, la orden se cierra sola al vencer el plazo y
 * queda marcada como cierre tácito: se le muestra cuánto le queda, porque
 * no responder también es una decisión.
 */

/** Mínimo para que el técnico sepa qué revisar: un "no" suelto no sirve. */
export const MOTIVO_MINIMO = 10;

export function diasHasta(limite: string | null, hoy: string): number | null {
  if (!limite) return null;
  const ms = Date.parse(`${limite}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000);
}

export function textoPlazo(limite: string | null, hoy: string): string | null {
  const d = diasHasta(limite, hoy);
  if (d === null) return null;
  if (d < 0) return "El plazo venció: se cerrará automáticamente.";
  if (d === 0) return "Hoy vence el plazo para responder.";
  return `Tienes ${d} día${d === 1 ? "" : "s"} para responder. Si no respondes, se aprueba sola.`;
}

export interface DecisionClienteProps {
  limiteCliente: string | null;
  hoy: string;
  onAprobar: () => void;
  onObjetar: (motivo: string) => void;
  procesando?: boolean;
}

export function DecisionCliente({ limiteCliente, hoy, onAprobar, onObjetar, procesando = false }: DecisionClienteProps) {
  const [objetando, setObjetando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [intentado, setIntentado] = useState(false);
  const plazo = textoPlazo(limiteCliente, hoy);
  const corto = motivo.trim().length < MOTIVO_MINIMO;

  if (objetando) {
    return (
      <View style={estilos.bloque}>
        <Campo
          etiqueta="¿Qué no corresponde?"
          value={motivo}
          onChangeText={setMotivo}
          multiline
          placeholder="Ej.: la posición 3 no se cambió, como dice la orden"
          {...(intentado && corto ? { error: `Explícalo con al menos ${MOTIVO_MINIMO} caracteres` } : {})}
        />
        <Text style={estilos.ayuda}>La orden vuelve al técnico para que la revise.</Text>
        <Boton
          ancho
          tipo="peligro"
          testID="confirmar-objecion"
          cargando={procesando}
          onPress={() => {
            setIntentado(true);
            if (!corto) onObjetar(motivo.trim());
          }}
        >
          Enviar objeción
        </Boton>
        <Boton ancho tipo="fantasma" onPress={() => setObjetando(false)}>
          Cancelar
        </Boton>
      </View>
    );
  }

  return (
    <View style={estilos.bloque}>
      {plazo ? <Aviso tono="info" titulo="Esperando tu aprobación" detalle={plazo} /> : null}
      <Boton ancho testID="aprobar" cargando={procesando} onPress={onAprobar}>
        Aprobar el servicio
      </Boton>
      <Boton ancho tipo="secundario" testID="objetar" onPress={() => setObjetando(true)}>
        Algo no corresponde
      </Boton>
    </View>
  );
}

const estilos = StyleSheet.create({
  bloque: { gap: espacio.md },
  ayuda: { ...texto.ayuda, color: colores.textoTenue },
});
