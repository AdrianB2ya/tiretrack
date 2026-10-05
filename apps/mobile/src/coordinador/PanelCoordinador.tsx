import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colores, conOpacidad, espacio, radio, tactil, texto } from "../diseno/tokens";
import type { OrdenLocal } from "../datos/repositorio";

/**
 * Panel del coordinador.
 *
 * No es un tablero de métricas: es una lista de **lo que requiere una
 * decisión suya hoy**. Los números que no llevan a una acción se quedan
 * fuera, porque en el celular el espacio es poco y cada indicador que no se
 * usa empuja hacia abajo al que sí.
 */

export interface Indicadores {
  readonly porRevisar: number;
  readonly devueltas: number;
  readonly esperandoCliente: number;
  readonly clienteVencePronto: number;
  readonly enCurso: number;
  readonly sinEnviar: number;
}

/** Días hábiles antes del límite en que ya conviene recordar al cliente. */
export const DIAS_AVISO_CLIENTE = 1;

export function calcularIndicadores(
  ordenes: readonly OrdenLocal[],
  hoy: string,
  pendientesDeEnviar: number,
): Indicadores {
  const limiteAviso = sumarDias(hoy, DIAS_AVISO_CLIENTE);

  return {
    porRevisar: ordenes.filter((o) => o.estado === "en_revision").length,
    // Devueltas y aún sin corregir: el coordinador puede necesitar
    // insistirle al técnico.
    devueltas: ordenes.filter((o) => o.estado === "en_proceso" && o.motivoDevolucion).length,
    esperandoCliente: ordenes.filter((o) => o.estado === "pendiente_cliente").length,
    // Las que el cliente está por dejar vencer: llamarlo ahora evita un
    // cierre tácito que después él puede disputar.
    clienteVencePronto: ordenes.filter(
      (o) =>
        o.estado === "pendiente_cliente" &&
        o.limiteCliente !== null &&
        o.limiteCliente <= limiteAviso,
    ).length,
    enCurso: ordenes.filter((o) => o.estado === "en_proceso" && !o.motivoDevolucion).length,
    sinEnviar: pendientesDeEnviar,
  };
}

function sumarDias(fechaISO: string, dias: number): string {
  const d = new Date(`${fechaISO}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export type Accion = "revisar" | "devueltas" | "cliente" | "en_curso";

export interface Tarjeta {
  readonly accion: Accion;
  readonly titulo: string;
  readonly valor: number;
  readonly detalle?: string;
  readonly urgente: boolean;
}

/**
 * Tarjetas del panel, en orden de urgencia.
 *
 * Las que están en cero se muestran igual pero al final: ver "0 por revisar"
 * también es información —significa que puede dedicarse a otra cosa— y
 * ocultarla haría que el coordinador dude si el panel cargó.
 */
export function tarjetasDelPanel(i: Indicadores): Tarjeta[] {
  const tarjetas: Tarjeta[] = [
    {
      accion: "revisar",
      titulo: "Por revisar",
      valor: i.porRevisar,
      urgente: i.porRevisar > 0,
    },
    {
      accion: "cliente",
      titulo: "Esperando al cliente",
      valor: i.esperandoCliente,
      ...(i.clienteVencePronto > 0
        ? { detalle: `${i.clienteVencePronto} vence${i.clienteVencePronto > 1 ? "n" : ""} pronto` }
        : {}),
      urgente: i.clienteVencePronto > 0,
    },
    {
      accion: "devueltas",
      titulo: "Devueltas sin corregir",
      valor: i.devueltas,
      urgente: false,
    },
    {
      accion: "en_curso",
      titulo: "En curso",
      valor: i.enCurso,
      urgente: false,
    },
  ];

  return tarjetas.sort((a, b) => {
    if (a.urgente !== b.urgente) return a.urgente ? -1 : 1;
    if ((a.valor === 0) !== (b.valor === 0)) return a.valor === 0 ? 1 : -1;
    return 0;
  });
}

// ── Componente ──────────────────────────────────────────────────────────────

export function PanelCoordinador({
  indicadores,
  nombre,
  onAbrir,
}: {
  indicadores: Indicadores;
  nombre: string;
  onAbrir: (accion: Accion) => void;
}) {
  const tarjetas = tarjetasDelPanel(indicadores);

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.saludo}>Hola, {nombre.split(" ")[0]}</Text>

      {indicadores.sinEnviar > 0 ? (
        <Text style={estilos.sinEnviar}>
          {indicadores.sinEnviar} cambio{indicadores.sinEnviar > 1 ? "s" : ""} tuyo
          {indicadores.sinEnviar > 1 ? "s" : ""} sin enviar
        </Text>
      ) : null}

      {tarjetas.map((t) => (
        <Pressable
          key={t.accion}
          onPress={() => onAbrir(t.accion)}
          testID={`indicador-${t.accion}`}
          accessibilityRole="button"
          aria-label={`${t.titulo}: ${t.valor}`}
          style={({ pressed }) => [
            estilos.tarjeta,
            t.urgente && estilos.tarjetaUrgente,
            t.valor === 0 && estilos.tarjetaVacia,
            pressed && { opacity: 0.75 },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={estilos.titulo}>{t.titulo}</Text>
            {t.detalle ? <Text style={estilos.detalle}>{t.detalle}</Text> : null}
          </View>
          <Text style={[estilos.valor, t.urgente && { color: colores.primario }]}>{t.valor}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md },
  saludo: { ...texto.titulo, color: colores.texto, marginBottom: espacio.sm },
  sinEnviar: { ...texto.ayuda, color: colores.advertencia, marginBottom: espacio.sm },
  tarjeta: {
    minHeight: tactil.comodo + 16,
    flexDirection: "row",
    alignItems: "center",
    padding: espacio.lg,
    borderRadius: radio.md,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.tarjeta,
  },
  tarjetaUrgente: {
    borderColor: colores.primario,
    backgroundColor: conOpacidad(colores.primario, 0.1),
  },
  tarjetaVacia: { opacity: 0.6 },
  titulo: { ...texto.cuerpoFuerte, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.advertencia, marginTop: 2 },
  valor: { fontSize: 28, fontWeight: "700", color: colores.texto },
});
