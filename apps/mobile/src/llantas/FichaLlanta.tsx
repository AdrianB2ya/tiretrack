import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  ETIQUETA_ESTADO_ACTIVO,
  ETIQUETA_MOVIMIENTO,
  MOVIMIENTOS_MANUALES,
  MOTIVOS_FALLA,
  ETIQUETA_MOTIVO_RETIRO,
  evaluarMovimiento,
  type MotivoRetiro,
  type TipoMovimiento,
  etiquetaPosicion,
} from "@tiretrack/domain";
import { Aviso, Boton, Campo, CampoDecimal, Insignia, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import { ElegirUno } from "../diseno/ListaBuscable";
import { COLOR_ESTADO, dondeEsta, nombreLlanta, type LlantaVista } from "./PantallaLlantas";

/**
 * Ficha de una llanta (R8): qué es, dónde está, cuántas vidas lleva, por
 * dónde pasó y cuánto se le midió. La oficina la mueve desde aquí; solo se
 * ofrecen los pasos posibles desde su estado (el dominio decide).
 */

type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string };

export interface FichaVista {
  llanta: LlantaVista;
  vidas: { numero: number; banda: string | null; reencauchadora: string | null; costo: number | null; profundidadInicial: number | null; inicio: string }[];
  movimientos: { tipo: string; fecha: string; posicion: number | null; kilometraje: number | null; detalle: string | null; vehiculoCodigo: string | null; sedeNombre: string | null; folio: string | null }[];
  mediciones: { fecha: string; folio: string | null; vehiculoCodigo: string | null; posicion: number; profundidad: number | null; kilometraje: number | null }[];
  /** R9: los del Excel de levantamiento, con la última medición. */
  indicadores?: {
    profInicial: number | null; profBaja: number | null; mmDesgaste: number | null; pctRodado: number | null;
    referencia: string | null; kmRecorrido: number | null; kmPorMm: number | null; proyeccionKm: number | null;
    costo: number | null; cpk: number | null;
  } | null;
}

export interface MovimientoPedido {
  tipo: TipoMovimiento;
  sedeId?: string;
  detalle?: string;
  banda?: string;
  reencauchadora?: string;
  costo?: number;
  profundidadInicial?: number;
}

export interface FuentesFicha {
  cargar(): Promise<R<FichaVista>>;
  /** null si la persona no maneja el inventario (técnico, cliente). */
  mover: ((m: MovimientoPedido) => Promise<R<unknown>>) | null;
  sedes: { id: string; nombre: string }[];
  /** R10: abrir un reclamo de garantía (oficina). */
  abrirReclamo?: ((r: { proveedor: string; motivoRetiro: MotivoRetiro; notas?: string }) => Promise<R<unknown>>) | null;
}

const mm = (n: number | null) => (n === null ? "—" : `${String(n).replace(".", ",")} mm`);
const pesos = (n: number | null) => (n === null ? "—" : `$${Math.round(n).toLocaleString("es-CO")}`);

export function FichaLlanta({ fuentes }: { fuentes: FuentesFicha }) {
  const [ficha, setFicha] = useState<FichaVista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accion, setAccion] = useState<TipoMovimiento | null>(null);

  const cargar = useCallback(async () => {
    const r = await fuentes.cargar();
    if (r.ok) {
      // Sin confiar en la forma: una respuesta incompleta se dice, no revienta.
      if (!r.datos?.llanta) return setError("La llanta no está disponible.");
      setFicha({
        llanta: r.datos.llanta,
        vidas: Array.isArray(r.datos.vidas) ? r.datos.vidas : [],
        movimientos: Array.isArray(r.datos.movimientos) ? r.datos.movimientos : [],
        mediciones: Array.isArray(r.datos.mediciones) ? r.datos.mediciones : [],
        indicadores: r.datos.indicadores ?? null,
      });
      setError(null);
    } else setError(r.status === 0 ? "Sin señal: la ficha se consulta en línea." : r.mensaje);
  }, [fuentes]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!ficha) {
    return error ? (
      <View style={estilos.centrado}>
        <Aviso tono="advertencia" titulo="No se pudo cargar" detalle={error} />
        <Boton tipo="secundario" testID="reintentar-ficha" onPress={() => void cargar()}>
          Reintentar
        </Boton>
      </View>
    ) : (
      <Vacio mensaje="Cargando la llanta…" />
    );
  }

  const l = ficha.llanta;
  const posibles = fuentes.mover ? MOVIMIENTOS_MANUALES.filter((t) => evaluarMovimiento(l.estado, t).permitido) : [];

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      <View style={estilos.cabecera}>
        <Text style={estilos.codigo}>{nombreLlanta(l)}</Text>
        <Insignia color={COLOR_ESTADO[l.estado]}>{ETIQUETA_ESTADO_ACTIVO[l.estado]}</Insignia>
      </View>
      <Text style={estilos.cuerpo}>{[l.marca, l.diseno, l.medida].filter(Boolean).join(" ") || "Sin referencia"}</Text>
      <Text style={estilos.detalle}>
        {dondeEsta(l)} · {l.clienteNombre}
        {l.numCalor ? ` · calor ${l.numCalor}` : ""}
      </Text>

      {ficha.indicadores ? <Indicadores i={ficha.indicadores} /> : null}

      <Text style={estilos.subtitulo}>Vidas</Text>
      {ficha.vidas.map((v) => (
        <Text key={v.numero} style={estilos.linea}>
          {v.numero === 0 ? "Original" : `Reencauche ${v.numero}${v.banda ? ` · banda ${v.banda}` : ""}${v.reencauchadora ? ` · ${v.reencauchadora}` : ""}`}
          {" · "}desde {v.inicio} · costo {pesos(v.costo)} · prof. inicial {mm(v.profundidadInicial)}
        </Text>
      ))}

      <Text style={estilos.subtitulo}>Historia</Text>
      {ficha.movimientos.length === 0 ? <Text style={estilos.detalle}>Sin movimientos.</Text> : null}
      {ficha.movimientos.map((m, i) => (
        <Text key={i} style={estilos.linea}>
          {m.fecha} · {ETIQUETA_MOVIMIENTO[m.tipo as TipoMovimiento] ?? m.tipo}
          {m.vehiculoCodigo ? ` · ${m.vehiculoCodigo}${m.posicion ? ` pos. ${etiquetaPosicion(m.posicion)}` : ""}` : ""}
          {m.sedeNombre ? ` · ${m.sedeNombre}` : ""}
          {m.kilometraje !== null ? ` · ${m.kilometraje.toLocaleString("es-CO")} km` : ""}
          {m.folio ? ` · ${m.folio}` : ""}
          {m.detalle ? ` · ${m.detalle}` : ""}
        </Text>
      ))}

      <Text style={estilos.subtitulo}>Mediciones</Text>
      {ficha.mediciones.length === 0 ? <Text style={estilos.detalle}>Todavía no se ha medido en una orden aprobada.</Text> : null}
      {ficha.mediciones.map((m, i) => (
        <Text key={i} style={estilos.linea}>
          {m.fecha} · {m.vehiculoCodigo ?? ""} pos. {etiquetaPosicion(m.posicion)} · {mm(m.profundidad)}
          {m.folio ? ` · ${m.folio}` : ""}
        </Text>
      ))}

      {fuentes.abrirReclamo && l.estado !== "montada" ? (
        <AbrirReclamo marca={l.marca} onAbrir={fuentes.abrirReclamo} />
      ) : null}

      {posibles.length > 0 && fuentes.mover ? (
        <Tarjeta>
          <Text style={estilos.subtitulo}>Mover</Text>
          <ElegirUno
            enLinea
            testID="lista-mover"
            placeholder="Qué hacer con la llanta"
            opciones={posibles.map((t) => ({ id: t, texto: ETIQUETA_MOVIMIENTO[t], testID: `mover-${t}` }))}
            seleccionado={accion}
            onElegir={(id) => setAccion(accion === id ? null : (id as typeof accion))}
          />
          {accion ? (
            <Boton tipo="fantasma" testID="mover-cancelar" onPress={() => setAccion(null)}>
              No mover
            </Boton>
          ) : null}
          {accion ? (
            <FormularioMovimiento
              tipo={accion}
              sedes={fuentes.sedes}
              onEnviar={async (m) => {
                const r = await (fuentes.mover as NonNullable<FuentesFicha["mover"]>)(m);
                if (!r.ok) return r.status === 0 ? "Sin señal: se mueve en línea." : r.mensaje;
                setAccion(null);
                await cargar();
                return null;
              }}
            />
          ) : null}
        </Tarjeta>
      ) : null}
    </ScrollView>
  );
}

const km = (n: number | null) => (n === null ? "—" : `${Math.round(n).toLocaleString("es-CO")} km`);

/** Lo que el Excel de levantamiento calculaba a mano, aquí ya hecho (R9). */
function Indicadores({ i }: { i: NonNullable<FichaVista["indicadores"]> }) {
  return (
    <View testID="indicadores-llanta" style={estilos.formulario}>
      <Text style={estilos.subtitulo}>Rendimiento</Text>
      {i.referencia ? <Text style={estilos.cuerpo}>{i.referencia}</Text> : null}
      <Text style={estilos.linea}>
        Rodado {i.pctRodado === null ? "—" : `${String(i.pctRodado).replace(".", ",")} %`} · desgaste {mm(i.mmDesgaste)} de {mm(i.profInicial)} (baja {mm(i.profBaja)})
      </Text>
      <Text style={estilos.linea}>
        Recorrido {km(i.kmRecorrido)} · {i.kmPorMm === null ? "—" : `${i.kmPorMm.toLocaleString("es-CO")} km/mm`} · proyección {km(i.proyeccionKm)}
      </Text>
      <Text style={estilos.linea}>
        Costo {pesos(i.costo)} · costo por km {i.cpk === null ? "—" : `$${String(i.cpk).replace(".", ",")}`}
      </Text>
      {i.profInicial === null ? <Text style={estilos.detalle}>Sin profundidad de fábrica de la medida: complétala en el catálogo para calcular el rendimiento.</Text> : null}
    </View>
  );
}

/** R10: una llanta que falló se reclama al proveedor; el reclamo sigue en "Garantías". */
function AbrirReclamo({ marca, onAbrir }: {
  marca: string | null;
  onAbrir: NonNullable<FuentesFicha["abrirReclamo"]>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [proveedor, setProveedor] = useState(marca ?? "");
  const [motivo, setMotivo] = useState<MotivoRetiro | null>(null);
  const [notas, setNotas] = useState("");
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  if (!abierto) {
    return (
      <Boton tipo="fantasma" testID="abrir-reclamo" onPress={() => setAbierto(true)}>
        Abrir reclamo de garantía
      </Boton>
    );
  }
  return (
    <Tarjeta>
      <Text style={estilos.subtitulo}>Reclamo de garantía</Text>
      <Campo etiqueta="Proveedor o marca" value={proveedor} onChangeText={setProveedor} testID="reclamo-proveedor" />
      <ElegirUno
        enLinea
        etiqueta="Por qué falló"
        testID="lista-reclamo-motivo"
        opciones={MOTIVOS_FALLA.map((m) => ({ id: m, texto: ETIQUETA_MOTIVO_RETIRO[m], testID: `reclamo-motivo-${m}` }))}
        seleccionado={motivo}
        onElegir={(id) => setMotivo(id as typeof motivo)}
      />
      <Campo etiqueta="Notas (opcional)" value={notas} onChangeText={setNotas} testID="reclamo-notas" />
      {mensaje ? <Aviso tono={mensaje.ok ? "exito" : "advertencia"} titulo={mensaje.texto} /> : null}
      <Boton
        testID="crear-reclamo"
        deshabilitado={!proveedor.trim() || !motivo}
        onPress={() =>
          void (async () => {
            if (!motivo) return;
            const r = await onAbrir({ proveedor: proveedor.trim(), motivoRetiro: motivo, ...(notas.trim() ? { notas: notas.trim() } : {}) });
            setMensaje(r.ok ? { ok: true, texto: "Reclamo abierto: síguelo en Garantías." } : { ok: false, texto: r.status === 0 ? "Sin señal: se abre en línea." : r.mensaje });
          })()
        }
      >
        Abrir el reclamo
      </Boton>
    </Tarjeta>
  );
}

function FormularioMovimiento({ tipo, sedes, onEnviar }: {
  tipo: TipoMovimiento;
  sedes: { id: string; nombre: string }[];
  onEnviar: (m: MovimientoPedido) => Promise<string | null>;
}) {
  const [sedeId, setSedeId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState("");
  const [banda, setBanda] = useState("");
  const [reencauchadora, setReencauchadora] = useState("");
  const [costo, setCosto] = useState<number | null>(null);
  const [prof, setProf] = useState<number | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const faltaSede = tipo === "traslado" && !sedeId;
  // Desechar no tiene vuelta atrás: segundo toque.
  const pideConfirmar = tipo === "desecho" && !confirmar;

  const enviar = async () => {
    if (faltaSede) return;
    if (pideConfirmar) {
      setConfirmar(true);
      return;
    }
    setTrabajando(true);
    try {
      setError(
        await onEnviar({
          tipo,
          ...(sedeId ? { sedeId } : {}),
          ...(detalle.trim() ? { detalle: detalle.trim() } : {}),
          ...(banda.trim() ? { banda: banda.trim() } : {}),
          ...(reencauchadora.trim() ? { reencauchadora: reencauchadora.trim() } : {}),
          ...(costo !== null ? { costo } : {}),
          ...(prof !== null ? { profundidadInicial: prof } : {}),
        }),
      );
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <View style={estilos.formulario}>
      {tipo === "traslado" ? (
        <>
          <Text style={estilos.etiqueta}>Sede de destino</Text>
          <ElegirUno testID="sede-destino" opciones={sedes.map((s) => ({ id: s.id, texto: s.nombre }))} seleccionado={sedeId} onElegir={setSedeId} />
        </>
      ) : null}
      {tipo === "retorno_reencauche" ? (
        <>
          <Campo etiqueta="Banda (diseño del reencauche)" value={banda} onChangeText={setBanda} testID="mov-banda" />
          <Campo etiqueta="Reencauchadora" value={reencauchadora} onChangeText={setReencauchadora} testID="mov-reencauchadora" />
          <CampoDecimal etiqueta="Costo del reencauche" valor={costo} onCambio={setCosto} testID="mov-costo" />
          <CampoDecimal etiqueta="Profundidad inicial de la banda (mm)" valor={prof} onCambio={setProf} testID="mov-prof" />
        </>
      ) : null}
      <Campo etiqueta="Detalle (opcional)" value={detalle} onChangeText={setDetalle} testID="mov-detalle" />
      {pideConfirmar ? null : tipo === "desecho" ? (
        <Aviso tono="advertencia" titulo="La llanta sale de servicio" detalle="No vuelve al inventario; su historia se conserva. Toca de nuevo para confirmar." />
      ) : null}
      {error ? <Aviso tono="advertencia" titulo="No se pudo" detalle={error} /> : null}
      <Boton
        tipo={tipo === "desecho" ? "peligro" : "primario"}
        testID="enviar-movimiento"
        cargando={trabajando}
        deshabilitado={faltaSede}
        onPress={() => void enviar()}
      >
        {tipo === "desecho" && confirmar ? "Sí, desecharla" : ETIQUETA_MOVIMIENTO[tipo]}
      </Boton>
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.sm, paddingBottom: espacio.xxl },
  centrado: { flex: 1, justifyContent: "center", padding: espacio.lg, gap: espacio.md, backgroundColor: colores.fondo },
  cabecera: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: espacio.sm },
  codigo: { ...texto.codigo, color: colores.texto, flexShrink: 1 },
  cuerpo: { ...texto.cuerpo, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  subtitulo: { ...texto.subtitulo, color: colores.texto, marginTop: espacio.md },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  linea: { ...texto.ayuda, color: colores.texto },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  formulario: { gap: espacio.sm, marginTop: espacio.sm },
});
