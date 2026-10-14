import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ESTADOS_ORDEN, evaluarTransicion, type EstadoOrden, type Rol } from "@tiretrack/domain";
import { Aviso, Boton, Campo } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import { LARGO_MINIMO_MOTIVO } from "./bandeja";

/**
 * Anular una orden (respuesta 7 del usuario, 2026-10-14). El servidor lo
 * permitía y la app no tenía cómo: solo se anulaba por la API.
 *
 * - Coordinador o administrador, en una orden abierta (regla del dominio).
 * - **Motivo con sustancia** (10 letras o más, como devolver): queda en el
 *   historial y en la auditoría.
 * - **Aunque un técnico se la haya llevado** (bloqueo): anular la suelta.
 * - **Segundo toque** para confirmar: no se deshace.
 */
export function AnularOrden({
  estado,
  rol,
  bloqueadaPorOtro,
  onAnular,
}: {
  /** Texto en el teléfono; se valida contra la lista del dominio. */
  estado: string;
  rol: Rol;
  bloqueadaPorOtro: boolean;
  onAnular: (motivo: string) => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lo que el dominio dice de anular con este rol y estado (sin el motivo aún).
  if (!(ESTADOS_ORDEN as readonly string[]).includes(estado)) return null;
  const puede = evaluarTransicion(estado as EstadoOrden, "anulada", { rol, esTecnicoAsignado: false, firmaVigente: false, motivo: "x" });
  if (!puede.permitido) return null;

  if (!abierto) {
    return (
      <Boton ancho tipo="fantasma" testID="anular" onPress={() => setAbierto(true)}>
        Anular la orden
      </Boton>
    );
  }

  const corto = motivo.trim().length < LARGO_MINIMO_MOTIVO;
  const anular = async () => {
    if (corto) return;
    if (!confirmando) return setConfirmando(true);
    setAnulando(true);
    setError(null);
    try {
      await onAnular(motivo.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnulando(false);
    }
  };

  return (
    <View style={estilos.bloque} testID="anular-formulario">
      <Text style={estilos.titulo}>Anular la orden</Text>
      <Text style={estilos.detalle}>
        Deja de trabajarse y no se puede deshacer. Nada se borra: queda con su motivo en el historial.
        {bloqueadaPorOtro
          ? " Un técnico se la llevó para trabajar sin señal: lo que traiga después se rechazará y le quedará apartado en su teléfono."
          : ""}
      </Text>
      <Campo
        etiqueta="Motivo"
        value={motivo}
        onChangeText={(t: string) => {
          setMotivo(t);
          setConfirmando(false);
        }}
        multiline
        testID="anular-motivo"
        {...(motivo.length > 0 && corto ? { error: `Al menos ${LARGO_MINIMO_MOTIVO} letras: queda en la auditoría` } : {})}
      />
      {error ? <Aviso tono="advertencia" titulo="No se anuló" detalle={error} /> : null}
      <Boton ancho tipo="peligro" testID="anular-confirmar" deshabilitado={corto} cargando={anulando} onPress={() => void anular()}>
        {confirmando ? "Tocar otra vez para anular" : "Anular"}
      </Boton>
      <Boton
        ancho
        tipo="fantasma"
        onPress={() => {
          setAbierto(false);
          setConfirmando(false);
        }}
      >
        Cancelar
      </Boton>
    </View>
  );
}

const estilos = StyleSheet.create({
  bloque: { gap: espacio.sm },
  titulo: { ...texto.cuerpoFuerte, color: colores.peligro },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
