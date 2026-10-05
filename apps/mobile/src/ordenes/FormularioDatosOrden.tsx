import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from "react-native";
import { evaluarKilometraje } from "@tiretrack/domain";
import { Aviso, Boton, Campo } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";

/**
 * Datos del servicio: kilometraje, hallazgos y acción realizada.
 *
 * Sin esta pantalla ninguna orden podía enviarse a revisión: el envío exige
 * kilometraje, y nada en la app lo pedía.
 */

export interface DatosServicio {
  readonly kilometraje?: number;
  readonly hallazgos?: string;
  readonly accion?: string;
}

/** Los mismos topes que el contrato del servidor (zKilometraje, zTextoLargo). */
export const KM_MAXIMO = 9_999_999;
export const TEXTO_MAXIMO = 2000;

export type ProblemaDatos = { campo: "kilometraje" | "hallazgos" | "accion"; mensaje: string };

/**
 * Lee el kilometraje como lo escribe el técnico: con puntos o espacios de
 * miles ("78.950", "78 950"). null si está vacío; NaN si no es un número.
 */
export function leerKilometraje(texto: string): number | null {
  const limpio = texto.replace(/[.\s]/g, "");
  if (!limpio) return null;
  if (!/^[0-9]+$/.test(limpio)) return Number.NaN;
  return Number(limpio);
}

export function revisarDatos(
  kmTexto: string,
  hallazgos: string,
  accion: string,
): ProblemaDatos[] {
  const problemas: ProblemaDatos[] = [];
  const km = leerKilometraje(kmTexto);
  if (km !== null && (Number.isNaN(km) || km > KM_MAXIMO)) {
    problemas.push({ campo: "kilometraje", mensaje: "Escribe el kilometraje en números enteros, sin decimales" });
  }
  if (hallazgos.length > TEXTO_MAXIMO) {
    problemas.push({ campo: "hallazgos", mensaje: `Máximo ${TEXTO_MAXIMO} caracteres` });
  }
  if (accion.length > TEXTO_MAXIMO) {
    problemas.push({ campo: "accion", mensaje: `Máximo ${TEXTO_MAXIMO} caracteres` });
  }
  return problemas;
}

/**
 * ¿Hay que confirmar antes de guardar? Un kilometraje menor al conocido se
 * avisa pero no se bloquea: cambiar el odómetro es real en flotas viejas.
 */
export function avisoKilometraje(km: number | null, kmVehiculo: number | null): string | null {
  if (km === null || Number.isNaN(km) || kmVehiculo === null) return null;
  const { requiereConfirmacion } = evaluarKilometraje(km, kmVehiculo);
  if (!requiereConfirmacion) return null;
  const formato = (n: number) => n.toLocaleString("es-CO");
  return `El último kilometraje registrado de este vehículo es ${formato(kmVehiculo)}. ` +
    `Si le cambiaron el odómetro, guarda de todos modos.`;
}

export interface FormularioDatosOrdenProps {
  inicial: { kilometraje: number | null; hallazgos: string | null; accion: string | null };
  kmVehiculo: number | null;
  onGuardar: (datos: DatosServicio) => Promise<void> | void;
  guardando?: boolean;
  /** Si la orden ya no se puede editar, se muestra pero no se guarda. */
  soloLectura?: string | null;
}

export function FormularioDatosOrden({
  inicial,
  kmVehiculo,
  onGuardar,
  guardando = false,
  soloLectura = null,
}: FormularioDatosOrdenProps) {
  const [km, setKm] = useState(inicial.kilometraje === null ? "" : String(inicial.kilometraje));
  const [hallazgos, setHallazgos] = useState(inicial.hallazgos ?? "");
  const [accion, setAccion] = useState(inicial.accion ?? "");
  const [intentado, setIntentado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const problemas = revisarDatos(km, hallazgos, accion);
  const problemaDe = (campo: ProblemaDatos["campo"]) =>
    intentado ? problemas.find((p) => p.campo === campo)?.mensaje : undefined;
  const aviso = avisoKilometraje(leerKilometraje(km), kmVehiculo);

  const guardar = () => {
    setIntentado(true);
    if (problemas.length > 0) return;
    // Se pide confirmar UNA vez: el aviso queda a la vista y el botón cambia.
    if (aviso && !confirmando) {
      setConfirmando(true);
      return;
    }
    const kmLeido = leerKilometraje(km);
    void onGuardar({
      ...(kmLeido !== null ? { kilometraje: kmLeido } : {}),
      ...(hallazgos.trim() ? { hallazgos: hallazgos.trim() } : {}),
      ...(accion.trim() ? { accion: accion.trim() } : {}),
    });
  };

  return (
    <KeyboardAvoidingView style={estilos.pantalla} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
        {soloLectura ? <Aviso tono="info" titulo="Solo lectura" detalle={soloLectura} /> : null}

        <Campo
          etiqueta="Kilometraje"
          value={km}
          onChangeText={(v) => {
            setKm(v);
            setConfirmando(false);
          }}
          keyboardType="number-pad"
          placeholder="78950"
          editable={!soloLectura}
          {...(problemaDe("kilometraje") ? { error: problemaDe("kilometraje") } : {})}
        />
        {kmVehiculo !== null ? (
          <Text style={estilos.ayuda}>Último registrado: {kmVehiculo.toLocaleString("es-CO")} km</Text>
        ) : null}
        {aviso && confirmando ? <Aviso tono="advertencia" titulo="El kilometraje bajó" detalle={aviso} /> : null}

        <Campo
          etiqueta="Hallazgos"
          value={hallazgos}
          onChangeText={setHallazgos}
          multiline
          placeholder="Lo que encontraste: desgaste irregular, golpes, presión baja…"
          editable={!soloLectura}
          {...(problemaDe("hallazgos") ? { error: problemaDe("hallazgos") } : {})}
        />

        <Campo
          etiqueta="Acción realizada"
          value={accion}
          onChangeText={setAccion}
          multiline
          placeholder="Lo que hiciste: calibración, rotación, cambio de llanta…"
          editable={!soloLectura}
          {...(problemaDe("accion") ? { error: problemaDe("accion") } : {})}
        />

        {!soloLectura ? (
          <Boton ancho testID="guardar-datos" cargando={guardando} onPress={guardar}>
            {aviso && confirmando ? "Guardar de todos modos" : "Guardar"}
          </Boton>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md },
  ayuda: { ...texto.ayuda, color: colores.textoTenue },
});
