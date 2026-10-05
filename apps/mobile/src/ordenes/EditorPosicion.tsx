import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Aviso, Boton, Campo, CampoNumerico, Insignia } from "../diseno/componentes";
import { colores, conOpacidad, espacio, radio, tactil, texto } from "../diseno/tokens";
import type { Casilla } from "./diagrama";
import {
  ESTADOS_LLANTA,
  ETIQUETA_MOTIVO,
  MOTIVOS_NO_IDENTIFICADA,
  advertenciasParaConfirmar,
  desgasteRespectoAFabrica,
  puedeGuardar,
  revisar,
  tieneContenido,
  type AvisoCampo,
  type BorradorMedicion,
} from "./reglasEditorPosicion";
import type { DisenoLocal, MarcaLocal, MedidaLocal, ServicioLocal } from "../datos/repositorio";

/**
 * Editor de una posición, a pantalla completa.
 *
 * El orden de los campos sigue el orden en que el técnico trabaja: primero
 * identifica la llanta, después la mide, después registra qué le hizo. Un
 * formulario ordenado por estructura de datos en vez de por flujo obliga a
 * saltar de un lado a otro con el celular en una mano.
 *
 * Los bloques van colapsados salvo el que toca: con veinte campos visibles a
 * la vez, el técnico se pierde y se salta uno.
 */

export interface CatalogoEditor {
  readonly marcas: readonly MarcaLocal[];
  readonly disenos: readonly DisenoLocal[];
  readonly medidas: readonly MedidaLocal[];
  readonly servicios: readonly ServicioLocal[];
}

export interface EditorPosicionProps {
  casilla: Casilla;
  borrador: BorradorMedicion;
  catalogo: CatalogoEditor;
  onCambiar: (b: BorradorMedicion) => void;
  onGuardar: () => void;
  onCancelar: () => void;
  /** Número de la hermana de la que se puede copiar, si la hay. */
  hermanaCapturada?: number | null;
  onCopiarHermana?: () => void;
  guardando?: boolean;
}

export function EditorPosicion({
  casilla,
  borrador,
  catalogo,
  onCambiar,
  onGuardar,
  onCancelar,
  hermanaCapturada,
  onCopiarHermana,
  guardando = false,
}: EditorPosicionProps) {
  const [confirmando, setConfirmando] = useState(false);

  const avisos = useMemo(() => revisar(borrador, casilla), [borrador, casilla]);
  const veredicto = puedeGuardar(avisos);
  const advertencias = advertenciasParaConfirmar(avisos);
  const hayContenido = tieneContenido(borrador);

  const cambiar = <K extends keyof BorradorMedicion>(campo: K, valor: BorradorMedicion[K]) => {
    onCambiar({ ...borrador, [campo]: valor });
    // Un cambio invalida la confirmación anterior: lo que se confirmó ya no
    // es lo que se va a guardar.
    if (confirmando) setConfirmando(false);
  };

  const intentarGuardar = () => {
    if (advertencias.length > 0 && !confirmando) {
      setConfirmando(true);
      return;
    }
    onGuardar();
  };

  const medidaElegida = catalogo.medidas.find((m) => m.medida === borrador.medida);
  const desgaste = desgasteRespectoAFabrica(
    borrador.profundidad,
    medidaElegida?.profundidadOriginal ?? null,
  );

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Cabecera casilla={casilla} />

      {hermanaCapturada && onCopiarHermana ? (
        <Boton tipo="secundario" ancho onPress={onCopiarHermana} testID="copiar-hermana">
          Copiar llanta de la posición {hermanaCapturada}
        </Boton>
      ) : null}

      {/* ── Identificación ── */}
      <Bloque titulo="Identificación">
        <View style={estilos.filaSwitch}>
          <View style={{ flex: 1 }}>
            <Text style={estilos.etiquetaSwitch}>No se pudo identificar</Text>
            <Text style={estilos.ayudaSwitch}>
              Marca esto en vez de dejar el serial en blanco
            </Text>
          </View>
          <Switch
            testID="switch-no-identificada"
            value={borrador.noIdentificada}
            onValueChange={(v) => cambiar("noIdentificada", v)}
            trackColor={{ true: conOpacidad(colores.advertencia, 0.5), false: colores.borde }}
            thumbColor={borrador.noIdentificada ? colores.advertencia : colores.textoTenue}
          />
        </View>

        {borrador.noIdentificada ? (
          <Opciones
            etiqueta="Motivo"
            requerido
            // El valor es el código del contrato; la etiqueta es solo para leer.
            opciones={MOTIVOS_NO_IDENTIFICADA.map((m) => ({ id: m, texto: ETIQUETA_MOTIVO[m] }))}
            seleccionado={borrador.motivoNoId}
            onElegir={(id) => cambiar("motivoNoId", id)}
            error={mensajeDe(avisos, "motivoNoId")}
          />
        ) : (
          <Campo
            etiqueta="Serial"
            value={borrador.serial ?? ""}
            onChangeText={(v) => cambiar("serial", v || null)}
            autoCapitalize="characters"
            placeholder="MX10023458"
            {...avisoProps(avisos, "serial")}
          />
        )}

        <Campo
          etiqueta="DOT"
          value={borrador.dot ?? ""}
          onChangeText={(v) => cambiar("dot", v || null)}
          keyboardType="number-pad"
          maxLength={4}
          placeholder="3624"
          ayuda="Semana y año de fabricación"
          {...avisoProps(avisos, "dot")}
        />

        <Selector
          etiqueta="Marca"
          opciones={catalogo.marcas.map((m) => ({
            id: m.id,
            texto: m.nombre,
            // Lo creado en campo se distingue: está pendiente de revisión
            marca: m.creadaLocal ? "nueva" : undefined,
          }))}
          seleccionado={borrador.marcaId}
          onElegir={(id) => onCambiar({ ...borrador, marcaId: id, disenoId: null, medida: null })}
        />

        {borrador.marcaId ? (
          <Selector
            etiqueta="Diseño"
            opciones={catalogo.disenos.map((d) => ({
              id: d.id,
              texto: d.nombre,
              ...(d.creadaLocal ? { marca: "nueva" as const } : {}),
            }))}
            seleccionado={borrador.disenoId}
            onElegir={(id) => onCambiar({ ...borrador, disenoId: id, medida: null })}
          />
        ) : null}

        {borrador.disenoId ? (
          <Selector
            etiqueta="Medida"
            opciones={catalogo.medidas.map((m) => ({ id: m.medida, texto: m.medida }))}
            seleccionado={borrador.medida}
            onElegir={(id) => cambiar("medida", id)}
          />
        ) : null}

        <Opciones
          etiqueta="Estado de la llanta"
          opciones={ESTADOS_LLANTA.map((e) => ({ id: e, texto: e }))}
          seleccionado={borrador.estadoLlanta}
          onElegir={(id) => cambiar("estadoLlanta", id)}
        />
      </Bloque>

      {/* ── Medición ── */}
      <Bloque titulo="Medición">
        <View style={estilos.filaDoble}>
          <View style={{ flex: 1 }}>
            <CampoNumerico
              etiqueta="PSI encontrada"
              value={aTexto(borrador.psiEncontrada)}
              onChangeText={(v) => cambiar("psiEncontrada", aNumero(v))}
              placeholder="105"
              {...avisoProps(avisos, "psiEncontrada")}
            />
          </View>
          <View style={{ flex: 1 }}>
            <CampoNumerico
              etiqueta="PSI calibrada"
              value={aTexto(borrador.psiCalibrado)}
              onChangeText={(v) => cambiar("psiCalibrado", aNumero(v))}
              {...avisoProps(avisos, "psiCalibrado")}
            />
          </View>
        </View>

        <CampoNumerico
          etiqueta="Profundidad (mm)"
          value={aTexto(borrador.profundidad)}
          onChangeText={(v) => cambiar("profundidad", aNumero(v))}
          placeholder="9.5"
          {...(casilla.profundidadMinima !== null
            ? { ayuda: `Mínimo del eje: ${casilla.profundidadMinima} mm` }
            : {})}
          {...avisoProps(avisos, "profundidad")}
        />

        {/* El desgaste se calcula solo: ver "50% gastada" al lado del número
            le dice al técnico si vale la pena rotarla o ya no. */}
        {desgaste ? (
          <View style={estilos.desgaste}>
            <Text style={estilos.textoDesgaste}>
              {desgaste.porcentaje}% desgastada respecto a fábrica
            </Text>
          </View>
        ) : null}
      </Bloque>

      {/* ── Trabajo realizado ── */}
      <Bloque titulo="Trabajo realizado">
        <ServiciosPorLlanta
          servicios={catalogo.servicios.filter((s) => s.porLlanta)}
          seleccionados={borrador.servicios}
          onCambiar={(ids) => cambiar("servicios", ids)}
        />

        <Campo
          etiqueta="Número de parche"
          value={borrador.numParche ?? ""}
          onChangeText={(v) => cambiar("numParche", v || null)}
          placeholder="Opcional"
          {...avisoProps(avisos, "tipoParcheId")}
        />

        <Campo
          etiqueta="Observaciones"
          value={borrador.observaciones ?? ""}
          onChangeText={(v) => cambiar("observaciones", v || null)}
          multiline
          numberOfLines={3}
          placeholder="Lo que no cabe en los campos anteriores"
        />
      </Bloque>

      {/* Las advertencias se muestran juntas al intentar guardar, no una por
          campo mientras escribe: interrumpir la captura es peor. */}
      {confirmando ? (
        <Aviso
          tono="advertencia"
          titulo="Revisa antes de guardar"
          detalle={advertencias.map((a) => a.mensaje).join("\n")}
        />
      ) : null}

      {!veredicto.permitido ? (
        <Aviso tono="peligro" titulo="Falta corregir" detalle={veredicto.mensaje ?? ""} />
      ) : null}

      <View style={estilos.acciones}>
        <Boton tipo="fantasma" ancho onPress={onCancelar}>
          Cancelar
        </Boton>
        <Boton
          ancho
          testID="guardar"
          onPress={intentarGuardar}
          cargando={guardando}
          deshabilitado={!veredicto.permitido || !hayContenido}
        >
          {confirmando ? "Guardar de todos modos" : "Guardar posición"}
        </Boton>
      </View>
    </ScrollView>
  );
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function Cabecera({ casilla }: { casilla: Casilla }) {
  return (
    <View style={estilos.cabecera}>
      <View style={estilos.numeroGrande}>
        <Text style={estilos.textoNumero}>{casilla.numero}</Text>
      </View>
      <View style={{ flex: 1, gap: espacio.xs }}>
        <Text style={estilos.tituloCabecera}>Posición {casilla.numero}</Text>
        <View style={estilos.filaInsignias}>
          <Insignia color={colores.secundario} compacta>
            {casilla.tipoEje}
          </Insignia>
          {/* Saber si es interna evita medir la de al lado */}
          {casilla.esInterna ? (
            <Insignia color={colores.textoTenue} compacta>
              Interna
            </Insignia>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <View style={estilos.bloque}>
      <Text style={estilos.tituloBloque}>{titulo}</Text>
      {children}
    </View>
  );
}

interface Opcion {
  id: string;
  texto: string;
  marca?: "nueva";
}

/** Lista corta: se muestran todas como botones, sin desplegable. */
function Opciones({
  etiqueta,
  opciones,
  seleccionado,
  onElegir,
  requerido,
  error,
}: {
  etiqueta: string;
  opciones: readonly Opcion[];
  seleccionado: string | null;
  onElegir: (id: string) => void;
  requerido?: boolean;
  error?: string;
}) {
  return (
    <View style={estilos.grupoOpciones}>
      <Text style={estilos.etiquetaGrupo}>
        {etiqueta}
        {requerido ? <Text style={{ color: colores.peligro }}> *</Text> : null}
      </Text>
      <View style={estilos.filaOpciones}>
        {opciones.map((o) => (
          <Ficha
            key={o.id}
            opcion={o}
            activa={seleccionado === o.id}
            onPress={() => onElegir(o.id)}
          />
        ))}
      </View>
      {error ? <Text style={estilos.textoError}>{error}</Text> : null}
    </View>
  );
}

/** Lista que puede ser larga: se comporta igual pero se desplaza. */
function Selector(props: {
  etiqueta: string;
  opciones: readonly Opcion[];
  seleccionado: string | null;
  onElegir: (id: string) => void;
}) {
  if (props.opciones.length === 0) {
    return (
      <View style={estilos.grupoOpciones}>
        <Text style={estilos.etiquetaGrupo}>{props.etiqueta}</Text>
        <Text style={estilos.sinOpciones}>
          Sin opciones descargadas. Sincroniza cuando tengas señal
        </Text>
      </View>
    );
  }
  return <Opciones {...props} />;
}

function Ficha({
  opcion,
  activa,
  onPress,
}: {
  opcion: Opcion;
  activa: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={`opcion-${opcion.id}`}
      // La forma moderna (`role` + `aria-*`) es la que la capa nativa y el
      // adaptador web propagan; `accessibilityState` sola se pierde.
      role="radio"
      aria-checked={activa}
      style={({ pressed }) => [
        estilos.ficha,
        activa && {
          backgroundColor: conOpacidad(colores.primario, 0.18),
          borderColor: colores.primario,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[estilos.textoFicha, activa && { color: colores.primario }]}>
        {opcion.texto}
      </Text>
      {opcion.marca === "nueva" ? <Text style={estilos.marcaNueva}>nueva</Text> : null}
    </Pressable>
  );
}

function ServiciosPorLlanta({
  servicios,
  seleccionados,
  onCambiar,
}: {
  servicios: readonly ServicioLocal[];
  seleccionados: readonly string[];
  onCambiar: (ids: string[]) => void;
}) {
  const alternar = (id: string) => {
    onCambiar(
      seleccionados.includes(id)
        ? seleccionados.filter((x) => x !== id)
        : [...seleccionados, id],
    );
  };

  return (
    <View style={estilos.grupoOpciones}>
      <Text style={estilos.etiquetaGrupo}>Servicios</Text>
      <View style={estilos.filaOpciones}>
        {servicios.map((s) => {
          const activo = seleccionados.includes(s.id);
          return (
            <Pressable
              key={s.id}
              onPress={() => alternar(s.id)}
              testID={`servicio-${s.id}`}
              role="checkbox"
              aria-checked={activo}
              aria-label={s.nombre}
              style={({ pressed }) => [
                estilos.ficha,
                activo && {
                  backgroundColor: conOpacidad(colores.exito, 0.18),
                  borderColor: colores.exito,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[estilos.textoFicha, activo && { color: colores.exito }]}>
                {s.nombre}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ── Auxiliares ──────────────────────────────────────────────────────────────

function mensajeDe(avisos: readonly AvisoCampo[], campo: string): string | undefined {
  return avisos.find((a) => a.campo === campo && a.severidad === "error")?.mensaje;
}

/** Los errores van como error del campo; lo demás como ayuda. */
function avisoProps(avisos: readonly AvisoCampo[], campo: string) {
  const del = avisos.filter((a) => a.campo === campo);
  const error = del.find((a) => a.severidad === "error");
  if (error) return { error: error.mensaje };
  const otro = del[0];
  return otro ? { ayuda: otro.mensaje } : {};
}

const aTexto = (n: number | null): string => (n === null ? "" : String(n));

function aNumero(v: string): number | null {
  const limpio = v.replace(",", ".").trim();
  if (limpio === "") return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.lg, paddingBottom: espacio.xxl },
  cabecera: { flexDirection: "row", alignItems: "center", gap: espacio.lg },
  numeroGrande: {
    width: 56,
    height: 56,
    borderRadius: radio.md,
    backgroundColor: conOpacidad(colores.primario, 0.18),
    borderWidth: 2,
    borderColor: colores.primario,
    alignItems: "center",
    justifyContent: "center",
  },
  textoNumero: { ...texto.titulo, color: colores.primario },
  tituloCabecera: { ...texto.subtitulo, color: colores.texto },
  filaInsignias: { flexDirection: "row", gap: espacio.sm },
  bloque: {
    backgroundColor: colores.superficie,
    borderRadius: radio.md,
    padding: espacio.lg,
    gap: espacio.sm,
  },
  tituloBloque: {
    ...texto.etiqueta,
    color: colores.textoTenue,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: espacio.sm,
  },
  filaDoble: { flexDirection: "row", gap: espacio.md },
  filaSwitch: {
    flexDirection: "row",
    alignItems: "center",
    gap: espacio.md,
    marginBottom: espacio.lg,
    minHeight: tactil.minimo,
  },
  etiquetaSwitch: { ...texto.cuerpoFuerte, color: colores.texto },
  ayudaSwitch: { ...texto.ayuda, color: colores.textoTenue, marginTop: 2 },
  grupoOpciones: { marginBottom: espacio.lg },
  etiquetaGrupo: {
    ...texto.etiqueta,
    color: colores.textoTenue,
    marginBottom: espacio.sm,
  },
  filaOpciones: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  ficha: {
    minHeight: tactil.minimo,
    paddingHorizontal: espacio.lg,
    justifyContent: "center",
    borderRadius: radio.completo,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.tarjeta,
  },
  textoFicha: { ...texto.cuerpo, color: colores.texto },
  marcaNueva: { fontSize: 11, color: colores.advertencia, textAlign: "center" },
  sinOpciones: { ...texto.ayuda, color: colores.advertencia },
  textoError: { ...texto.ayuda, color: colores.peligro, marginTop: espacio.xs },
  desgaste: {
    padding: espacio.md,
    borderRadius: radio.sm,
    backgroundColor: conOpacidad(colores.secundario, 0.12),
  },
  textoDesgaste: { ...texto.ayuda, color: colores.secundario, fontWeight: "600" },
  acciones: { gap: espacio.md },
});
