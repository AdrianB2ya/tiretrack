import { useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Aviso, Boton, Campo, Insignia, Tarjeta, Vacio } from "../diseno/componentes";
import { DiagramaLlantas, LeyendaDiagrama, ResumenDiagrama } from "../ordenes/DiagramaLlantas";
import { colores, conOpacidad, espacio, radio, tactil, texto } from "../diseno/tokens";
import {
  accionesDe,
  motivosSugeridos,
  ordenarBandeja,
  senalesDe,
  validarDevolucion,
  type ContextoCoordinador,
  type OrdenEnBandeja,
  type Senal,
} from "./bandeja";

/**
 * Bandeja de revisión.
 *
 * La tarjeta muestra las señales que cambian la decisión, para que el
 * coordinador sepa cuáles abrir sin abrirlas todas. Con veinte órdenes, lo
 * que no está en la tarjeta no se revisa.
 */

const coloresSenal: Record<Senal["clase"], string> = {
  critica: colores.peligro,
  atencion: colores.advertencia,
  informativa: colores.textoTenue,
};

export interface BandejaRevisionProps {
  items: readonly OrdenEnBandeja[];
  ctx: ContextoCoordinador;
  onAbrir: (ordenId: string) => void;
}

export function BandejaRevision({ items, ctx, onAbrir }: BandejaRevisionProps) {
  const ordenadas = ordenarBandeja(items, ctx);

  if (ordenadas.length === 0) {
    return <Vacio mensaje="No hay órdenes esperando revisión" />;
  }

  return (
    <FlatList
      data={ordenadas}
      keyExtractor={(i) => i.orden.id}
      contentContainerStyle={estilos.lista}
      ItemSeparatorComponent={() => <View style={{ height: espacio.md }} />}
      renderItem={({ item }) => (
        <TarjetaRevision item={item} ctx={ctx} onPress={() => onAbrir(item.orden.id)} />
      )}
    />
  );
}

export function TarjetaRevision({
  item,
  ctx,
  onPress,
}: {
  item: OrdenEnBandeja;
  ctx: ContextoCoordinador;
  /** Sin onPress es solo resumen (arriba de la decisión). */
  onPress?: () => void;
}) {
  const senales = senalesDe(item, ctx);
  const critica = senales.some((s) => s.clase === "critica");

  return (
    <Tarjeta
      {...(onPress ? { onPress } : {})}
      acento={critica ? colores.peligro : colores.secundario}
      testID={`revisar-${item.orden.id}`}
    >
      <View style={estilos.filaSuperior}>
        <Text style={estilos.folio}>{item.orden.folio ?? item.orden.codigoReferencia}</Text>
        <View style={{ flex: 1 }} />
        <Text style={estilos.avance}>
          {item.diagrama.capturadas}/{item.diagrama.totalPosiciones}
        </Text>
      </View>

      <View>
        <Text style={estilos.vehiculo}>
          {item.vehiculoCodigo}
          {item.vehiculoPlaca ? ` · ${item.vehiculoPlaca}` : ""}
        </Text>
        <Text style={estilos.secundario}>
          {item.clienteNombre} · {item.tecnicoNombre}
        </Text>
      </View>

      {senales.length > 0 ? (
        <View style={estilos.senales}>
          {senales.map((s) => (
            <Insignia key={s.clave} color={coloresSenal[s.clase]} compacta>
              {s.texto}
            </Insignia>
          ))}
        </View>
      ) : null}
    </Tarjeta>
  );
}

// ── Decisión sobre una orden ────────────────────────────────────────────────

export interface DecisionRevisionProps {
  item: OrdenEnBandeja;
  ctx: ContextoCoordinador;
  onAprobar: () => void;
  onDevolver: (motivo: string) => void;
  procesando?: boolean;
  /** Tocar una casilla abre la orden completa. */
  onVerOrden?: () => void;
}

export function DecisionRevision({
  item,
  ctx,
  onAprobar,
  onDevolver,
  procesando = false,
  onVerOrden,
}: DecisionRevisionProps) {
  const [devolviendo, setDevolviendo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [intentado, setIntentado] = useState(false);

  const acciones = accionesDe(item, ctx);
  const aprobar = acciones.find((a) => a.decision === "aprobar");
  const devolver = acciones.find((a) => a.decision === "devolver");
  const sugerencias = motivosSugeridos(item, ctx);
  const veredictoMotivo = validarDevolucion(motivo);

  const confirmarDevolucion = () => {
    setIntentado(true);
    if (!veredictoMotivo.permitido) return;
    onDevolver(motivo.trim());
  };

  if (devolviendo) {
    return (
      <ScrollView contentContainerStyle={estilos.panel}>
        <Text style={estilos.tituloPanel}>¿Qué hay que corregir?</Text>
        <Text style={estilos.ayudaPanel}>
          El técnico verá esto en su lista, antes de abrir la orden
        </Text>

        {/* Las sugerencias salen de las señales detectadas: escribir a mano
            en el celular es lento, y lo lento se omite. */}
        {sugerencias.length > 0 ? (
          <View style={estilos.sugerencias}>
            {sugerencias.map((s) => (
              <Pressable
                key={s}
                onPress={() => setMotivo(s)}
                testID={`sugerencia-${sugerencias.indexOf(s)}`}
                style={estilos.sugerencia}
              >
                <Text style={estilos.textoSugerencia}>{s}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Campo
          etiqueta="Motivo"
          requerido
          value={motivo}
          onChangeText={setMotivo}
          multiline
          numberOfLines={4}
          placeholder="Falta el número de parche en la posición 6"
          {...(intentado && !veredictoMotivo.permitido
            ? { error: veredictoMotivo.mensaje }
            : {})}
        />

        <View style={estilos.acciones}>
          <Boton tipo="fantasma" ancho onPress={() => setDevolviendo(false)}>
            Cancelar
          </Boton>
          <Boton
            tipo="peligro"
            ancho
            testID="confirmar-devolucion"
            onPress={confirmarDevolucion}
            cargando={procesando}
          >
            Devolver al técnico
          </Boton>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={estilos.panel}>
      {/* Revisión de diseño: la pantalla de decidir no decía qué orden era; el
          coordinador aprobaba viendo solo dos botones. */}
      <TarjetaRevision item={item} ctx={ctx} />
      {/* El diagrama aquí mismo: antes había que salir a "Ver el diagrama
          completo" para saber qué llanta quedó bajo el mínimo. */}
      <View style={estilos.diagrama} testID="diagrama-decision">
        <ResumenDiagrama diagrama={item.diagrama} />
        <DiagramaLlantas diagrama={item.diagrama} onTocarPosicion={() => onVerOrden?.()} />
        <LeyendaDiagrama />
      </View>
      {item.orden.hallazgos ? (
        <View style={estilos.hallazgos}>
          <Text style={estilos.tituloHallazgos}>Hallazgos del técnico</Text>
          <Text style={estilos.textoHallazgos}>{item.orden.hallazgos}</Text>
        </View>
      ) : null}
      {/* La autoaprobación se avisa aquí, no solo en la tarjeta: es el
          momento en que la persona decide. */}
      {senalesDe(item, ctx)
        .filter((s) => s.clase === "critica" || s.clave === "autoaprobacion")
        .map((s) => (
          <Aviso
            key={s.clave}
            tono={s.clase === "critica" ? "peligro" : "advertencia"}
            titulo={s.texto}
            {...(s.clave === "autoaprobacion"
              ? { detalle: "Quedará registrado que aprobaste tu propia orden" }
              : {})}
          />
        ))}

      {aprobar && !aprobar.habilitada && aprobar.motivo ? (
        <Aviso tono="peligro" titulo="No se puede aprobar" detalle={aprobar.motivo} />
      ) : null}

      <View style={estilos.acciones}>
        <Boton
          ancho
          testID="aprobar"
          onPress={onAprobar}
          cargando={procesando}
          deshabilitado={!aprobar?.habilitada}
        >
          Aprobar y enviar al cliente
        </Boton>
        <Boton
          tipo="secundario"
          ancho
          testID="devolver"
          onPress={() => setDevolviendo(true)}
          deshabilitado={!devolver?.habilitada}
        >
          Devolver al técnico
        </Boton>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  lista: { padding: espacio.lg },
  filaSuperior: { flexDirection: "row", alignItems: "center" },
  folio: { ...texto.codigo, color: colores.primario },
  avance: { ...texto.ayuda, color: colores.textoTenue },
  vehiculo: { ...texto.subtitulo, color: colores.texto },
  secundario: { ...texto.ayuda, color: colores.textoTenue, marginTop: 2 },
  senales: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm, marginTop: espacio.xs },
  panel: { padding: espacio.lg, gap: espacio.lg },
  tituloPanel: { ...texto.subtitulo, color: colores.texto },
  ayudaPanel: { ...texto.ayuda, color: colores.textoTenue },
  sugerencias: { gap: espacio.sm },
  sugerencia: {
    minHeight: tactil.minimo,
    justifyContent: "center",
    padding: espacio.md,
    borderRadius: radio.sm,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: conOpacidad(colores.secundario, 0.08),
  },
  textoSugerencia: { ...texto.ayuda, color: colores.secundario },
  acciones: { gap: espacio.md },
  hallazgos: { gap: espacio.xs },
  diagrama: {
    padding: espacio.md,
    borderRadius: radio.md,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.tarjeta,
  },
  tituloHallazgos: { ...texto.etiqueta, color: colores.texto },
  textoHallazgos: { ...texto.cuerpo, color: colores.textoTenue },
});
