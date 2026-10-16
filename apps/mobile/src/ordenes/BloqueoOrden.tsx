import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MOTIVO_MINIMO_LIBERAR, fechaHoraEnColombia } from "@tiretrack/domain";
import { Aviso, Boton, Campo } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import { MENSAJE_RETIRADA, type SituacionBloqueoVista } from "./detalle";
import { fechaHoraCorta } from "../diseno/formato";

/**
 * Bloqueo de la orden en el detalle (R7).
 *
 * - El técnico asignado, con señal, se la lleva antes de salir: así nadie la
 *   reasigna ni la anula mientras él trabaja sin señal.
 * - La oficina ve quién la tiene y la libera con motivo (el técnico va a ver
 *   que ya no es suya).
 * - Si ya no es de este técnico, se dice, con dónde ver lo que capturó.
 *
 * Tomar y soltar son en línea: sin señal no se puede pedir ni comprobar un
 * bloqueo. Por eso se toma ANTES de salir.
 */

const cuando = (iso: string | null) => (iso ? fechaHoraCorta(fechaHoraEnColombia(new Date(iso))) : "");

export function BloqueoOrden({
  situacion,
  onTomar,
  onLiberar,
}: {
  situacion: SituacionBloqueoVista;
  /** Devuelven un mensaje si no se pudo. */
  onTomar: () => Promise<string | null>;
  onLiberar: (motivo: string | null) => Promise<string | null>;
}) {
  const [motivo, setMotivo] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const correr = async (accion: () => Promise<string | null>) => {
    setTrabajando(true);
    try {
      setError(await accion());
    } finally {
      setTrabajando(false);
    }
  };

  if (situacion.tipo === "retirada") {
    return <Aviso tono="peligro" titulo="Ya no está a tu cargo" detalle={MENSAJE_RETIRADA} />;
  }

  return (
    <View style={estilos.bloque} testID="bloqueo-orden">
      {situacion.tipo === "tomable" ? (
        // Una sola línea con el botón al lado: antes era un párrafo y un botón
        // ancho que empujaban el diagrama hacia abajo en cada orden.
        <View style={estilos.fila}>
          <Text style={[estilos.detalle, { flex: 1 }]}>
            ¿Vas sin señal? Llévatela antes de salir: nadie la reasigna ni la anula mientras la tengas.
          </Text>
          <Boton tipo="secundario" testID="tomar-bloqueo" cargando={trabajando} onPress={() => void correr(onTomar)}>
            Llevármela
          </Boton>
        </View>
      ) : null}

      {situacion.tipo === "mia" ? (
        <>
          <Aviso
            tono="info"
            titulo="La tienes tú"
            detalle={`Desde ${cuando(situacion.desde)}. Nadie la reasigna ni la anula; se suelta sola al enviarla a revisión.`}
          />
          <Boton tipo="fantasma" testID="soltar-bloqueo" cargando={trabajando} onPress={() => void correr(() => onLiberar(null))}>
            Soltarla
          </Boton>
        </>
      ) : null}

      {situacion.tipo === "de_otro" ? (
        <>
          <Aviso
            tono="advertencia"
            titulo={`La tiene ${situacion.nombre}`}
            detalle={`Se la llevó para trabajar sin señal${situacion.desde ? ` (${cuando(situacion.desde)})` : ""}. Mientras tanto solo se puede ver.`}
          />
          {situacion.puedeLiberar ? (
            <>
              <Campo
                etiqueta="Por qué la liberas"
                ayuda={`Al menos ${MOTIVO_MINIMO_LIBERAR} letras: ${situacion.nombre} va a ver que ya no es suya.`}
                value={motivo}
                onChangeText={setMotivo}
                testID="motivo-liberar"
              />
              <Boton
                tipo="peligro"
                testID="liberar-bloqueo"
                cargando={trabajando}
                deshabilitado={motivo.trim().length < MOTIVO_MINIMO_LIBERAR}
                onPress={() => void correr(() => onLiberar(motivo.trim()))}
              >
                Liberarla
              </Boton>
            </>
          ) : null}
        </>
      ) : null}

      {error ? <Aviso tono="advertencia" titulo="No se pudo" detalle={error} /> : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  bloque: { gap: espacio.sm },
  fila: { flexDirection: "row", alignItems: "center", gap: espacio.md },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
