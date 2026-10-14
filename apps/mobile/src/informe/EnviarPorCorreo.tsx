import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { MAX_DESTINATARIOS, revisarDestinatarios } from "@tiretrack/domain";
import { Aviso, Boton, Opcion } from "../diseno/componentes";
import { colores, espacio, radio, texto } from "../diseno/tokens";

/**
 * Enviar un informe por correo, directo desde el servidor (R13): no pasa por
 * el teléfono de quien lo genera ni gasta sus datos con el adjunto.
 *
 * Plegado al principio: es una acción secundaria junto a "Descargar". Los
 * destinatarios se revisan ANTES de enviar, con la misma regla del servidor.
 * Sin correo activado en el servidor se dice, y se recuerda "Compartir".
 */

type R = { ok: true; datos: { enviadoA?: string[] } } | { ok: false; status: number; mensaje: string; codigo?: string | null };
export type Formato = "csv" | "pdf";

export function EnviarPorCorreo({
  enviar,
  formatos,
  etiqueta = "Enviar por correo",
  testID = "correo",
}: {
  enviar: (para: string[], mensaje: string | undefined, formato: Formato | undefined) => Promise<R>;
  /** Si se ofrece elegir formato (el informe: CSV o PDF). */
  formatos?: readonly Formato[];
  etiqueta?: string;
  testID?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [para, setPara] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [formato, setFormato] = useState<Formato | undefined>(formatos?.[0]);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "exito" | "advertencia"; titulo: string; detalle?: string } | null>(null);

  if (!abierto) {
    return (
      <View style={estilos.bloque}>
        <Boton tipo="fantasma" ancho testID={`${testID}-abrir`} onPress={() => setAbierto(true)}>
          {etiqueta}
        </Boton>
        {aviso ? <Aviso tono={aviso.tono} titulo={aviso.titulo} {...(aviso.detalle ? { detalle: aviso.detalle } : {})} /> : null}
      </View>
    );
  }

  const dest = revisarDestinatarios(para);
  const problema =
    dest.invalidos.length > 0
      ? `No son correos válidos: ${dest.invalidos.join(", ")}`
      : dest.validos.length > MAX_DESTINATARIOS
        ? `Máximo ${MAX_DESTINATARIOS} destinatarios`
        : null;

  const mandar = async () => {
    setEnviando(true);
    setAviso(null);
    try {
      const r = await enviar(dest.validos, mensaje.trim() || undefined, formato);
      if (r.ok) {
        setAviso({ tono: "exito", titulo: "Enviado", detalle: `A ${(r.datos.enviadoA ?? dest.validos).join(", ")}` });
        setAbierto(false);
        setMensaje("");
        return;
      }
      setAviso({
        tono: "advertencia",
        titulo: r.status === 0 ? "Sin señal: el envío se hace en línea" : "No se envió",
        detalle: r.mensaje,
      });
    } catch (e) {
      setAviso({ tono: "advertencia", titulo: "No se envió", detalle: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <View style={estilos.bloque} testID={`${testID}-formulario`}>
      <Text style={estilos.etiqueta}>Para</Text>
      <TextInput
        style={estilos.campo}
        value={para}
        onChangeText={setPara}
        placeholder="correo@empresa.co, otro@empresa.co"
        placeholderTextColor={colores.textoTenue}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        testID={`${testID}-para`}
        accessibilityLabel="Destinatarios"
      />
      {problema ? <Text style={estilos.mal}>{problema}</Text> : null}
      {formatos && formatos.length > 1 ? (
        <View style={estilos.fila}>
          {formatos.map((f) => (
            <Opcion
              key={f}
              etiqueta={f === "csv" ? "CSV (Excel)" : "PDF"}
              activa={formato === f}
              onPress={() => setFormato(f)}
              testID={`${testID}-formato-${f}`}
            />
          ))}
        </View>
      ) : null}
      <Text style={estilos.etiqueta}>Mensaje (opcional)</Text>
      <TextInput
        style={[estilos.campo, estilos.mensaje]}
        value={mensaje}
        onChangeText={setMensaje}
        multiline
        maxLength={1000}
        testID={`${testID}-mensaje`}
        accessibilityLabel="Mensaje"
      />
      <Boton
        ancho
        testID={`${testID}-enviar`}
        cargando={enviando}
        deshabilitado={dest.validos.length === 0 || problema !== null}
        onPress={() => void mandar()}
      >
        Enviar
      </Boton>
      <Boton tipo="fantasma" ancho testID={`${testID}-cancelar`} onPress={() => setAbierto(false)}>
        Cancelar
      </Boton>
      {aviso ? <Aviso tono={aviso.tono} titulo={aviso.titulo} {...(aviso.detalle ? { detalle: aviso.detalle } : {})} /> : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  bloque: { gap: espacio.sm },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  campo: {
    ...texto.cuerpo,
    color: colores.texto,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radio.md,
    paddingHorizontal: espacio.md,
    backgroundColor: colores.superficie,
  },
  mensaje: { minHeight: 96, textAlignVertical: "top", paddingVertical: espacio.sm },
  mal: { ...texto.ayuda, color: colores.advertencia },
});
