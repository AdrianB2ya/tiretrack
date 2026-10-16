import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Aviso, Boton, Campo, CampoDecimal, Opcion } from "./componentes";
import { colores, espacio, radio, tactil, texto } from "./tokens";
import { filtrarPorTexto, type EvaluacionAlta } from "../catalogo/alta";

/**
 * Lista para elegir uno entre muchos (marcas, diseños, medidas, clientes…).
 *
 * Es un desplegable: con algo elegido se ve CERRADO en una sola línea, tenga
 * tres opciones o mil (pedido del usuario: "una aplicación limpia"; con pocas
 * opciones la lista se quedaba abierta y la pantalla crecía con cada cliente).
 * Con muchas, al abrirlo aparece un campo para buscar: con guantes, escribir tres letras es más rápido y más seguro
 * que desplazarse por cincuenta fichas. La búsqueda ignora tildes,
 * mayúsculas, espacios y guiones ("xze" encuentra "X-ZE").
 *
 * Con `alta`, lo que no está se puede agregar desde aquí mismo, pero antes se
 * compara con lo que hay: un duplicado se ofrece para elegirlo y lo parecido
 * se muestra, y crear igual pide un segundo toque.
 */

export interface OpcionLista {
  readonly id: string;
  readonly texto: string;
  readonly detalle?: string;
  /** Creada en este celular, pendiente de revisión. */
  readonly nueva?: boolean;
  /** Por defecto `opcion-{id}`. */
  readonly testID?: string;
}

export interface AltaLista {
  /** "Agregar marca", "Agregar medida". */
  readonly etiqueta: string;
  readonly evaluar: (texto: string) => EvaluacionAlta;
  /** Un número opcional que se pide al crear (la profundidad de fábrica). */
  readonly numero?: { readonly etiqueta: string; readonly ayuda?: string };
  /** Crea y elige. Devuelve un mensaje si no se pudo. */
  readonly onCrear: (valor: string, numero: number | null) => Promise<string | null>;
  /** Línea bajo el botón: qué pasa con lo que se crea. */
  readonly nota?: string;
}

/** Con más opciones que estas, se busca en vez de mostrarlas todas. */
export const MAX_SIN_BUSQUEDA = 8;
/**
 * Cuántas se ven sin escribir y cuántas al buscar. Con mil clientes, mostrar
 * treinta fichas de entrada llenaba la pantalla (lo reportó el usuario en el
 * informe): sin texto se ven pocas, y la búsqueda hace el resto.
 */
export const MAX_SIN_TEXTO = 10;
export const MAX_A_LA_VISTA = 20;

export function ListaBuscable({
  etiqueta,
  opciones,
  seleccionado,
  onElegir,
  alta,
  vacio = "Sin opciones descargadas. Sincroniza cuando tengas señal",
  testID = "lista",
  abrirSola = false,
  placeholder = "Toca para elegir",
}: {
  /** Sin etiqueta, cuando la pantalla ya pone su propio título encima. */
  etiqueta?: string;
  opciones: readonly OpcionLista[];
  seleccionado: string | null;
  onElegir: (id: string) => void;
  alta?: AltaLista;
  vacio?: string;
  testID?: string;
  /**
   * Por defecto se ve CERRADA aunque no haya nada elegido ("Toca para elegir
   * · Elegir ▾"): toda lista se ve igual en toda la app (pedido del usuario:
   * la marca salía desplegable en el informe y abierta en la orden). Con
   * true, sin nada elegido se abre sola.
   */
  abrirSola?: boolean;
  placeholder?: string;
}) {
  const [termino, setTermino] = useState("");
  const [numero, setNumero] = useState<number | null>(null);
  const [confirmarParecida, setConfirmarParecida] = useState(false);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conBusqueda = opciones.length > MAX_SIN_BUSQUEDA || alta !== undefined;
  const elegida = opciones.find((o) => o.id === seleccionado);
  // Desplegable: cerrado en una sola línea hasta que se toca.
  const [abierta, setAbierta] = useState(!elegida && abrirSola);
  // Si la elección cambia desde fuera (se eligió sola, o la cascada la
  // limpió), la lista se cierra o se vuelve a abrir como al montarse.
  useEffect(() => {
    setAbierta(seleccionado ? false : abrirSola);
  }, [seleccionado, abrirSola]);
  const filtradas = useMemo(() => filtrarPorTexto(opciones, termino), [opciones, termino]);
  const tope = termino.trim() === "" ? MAX_SIN_TEXTO : MAX_A_LA_VISTA;
  const aLaVista = filtradas.slice(0, tope);
  const evaluacion = alta && termino.trim() !== "" ? alta.evaluar(termino) : null;

  const elegir = (id: string) => {
    onElegir(id);
    setTermino("");
    setAbierta(false);
  };

  const cambiarTermino = (t: string) => {
    setTermino(t);
    setConfirmarParecida(false);
    setError(null);
  };

  const crear = async (valor: string, parecidas: number) => {
    if (!alta) return;
    if (parecidas > 0 && !confirmarParecida) {
      setConfirmarParecida(true);
      return;
    }
    setCreando(true);
    try {
      const fallo = await alta.onCrear(valor, numero);
      if (fallo) {
        setError(fallo);
        return;
      }
      setTermino("");
      setNumero(null);
      setConfirmarParecida(false);
    } finally {
      setCreando(false);
    }
  };

  if (!abierta && (elegida || opciones.length > 0)) {
    return (
      <View style={estilos.grupo} testID={testID}>
        {etiqueta ? <Text style={estilos.etiqueta}>{etiqueta}</Text> : null}
        <Pressable
          onPress={() => setAbierta(true)}
          accessibilityRole="button"
          accessibilityLabel={elegida ? `${etiqueta ?? "Elegido"}: ${elegida.texto}. Tocar para cambiar` : `${etiqueta ?? placeholder}. Tocar para elegir`}
          testID={`${testID}-abrir`}
          style={({ pressed }) => [estilos.cerrada, pressed && estilos.presionada]}
        >
          <View style={estilos.cerradaTexto}>
            {elegida ? (
              <>
                <Text style={estilos.valor} numberOfLines={1}>
                  {elegida.nueva ? `${elegida.texto} (nueva)` : elegida.texto}
                </Text>
                {elegida.detalle ? <Text style={estilos.tenue} numberOfLines={1}>{elegida.detalle}</Text> : null}
              </>
            ) : (
              <Text style={estilos.tenue} numberOfLines={1}>{placeholder}</Text>
            )}
          </View>
          <Text style={estilos.cambiar}>{elegida ? "Cambiar ▾" : "Elegir ▾"}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={estilos.grupo} testID={testID}>
      {etiqueta ? <Text style={estilos.etiqueta}>{etiqueta}</Text> : null}

      {conBusqueda ? (
        <Campo
          etiqueta={alta ? "Buscar o escribir una nueva" : "Buscar"}
          value={termino}
          onChangeText={cambiarTermino}
          autoCorrect={false}
          testID={`${testID}-buscar`}
        />
      ) : null}

      {opciones.length === 0 && !alta ? <Text style={estilos.tenue}>{vacio}</Text> : null}

      {/* Una por línea: una lista, no un bloque de fichas. */}
      <View style={estilos.columna}>
        {aLaVista.map((o) => (
          <Opcion
            key={o.id}
            activa={o.id === seleccionado}
            etiqueta={o.nueva ? `${o.texto} (nueva)` : o.texto}
            {...(o.detalle ? { detalle: o.detalle } : {})}
            testID={o.testID ?? `opcion-${o.id}`}
            onPress={() => elegir(o.id)}
          />
        ))}
      </View>
      {filtradas.length > tope ? (
        <Text style={estilos.tenue} testID={`${testID}-mas`}>
          Hay {filtradas.length - tope} más: escribe para encontrarlas.
        </Text>
      ) : null}
      {elegida || !abrirSola ? (
        <Boton tipo="fantasma" testID={`${testID}-cerrar`} onPress={() => { setTermino(""); setAbierta(false); }}>
          {elegida ? `Dejar ${elegida.texto}` : "Cerrar"}
        </Boton>
      ) : null}
      {termino.trim() !== "" && filtradas.length === 0 && !alta ? (
        <Text style={estilos.tenue}>Nada coincide con “{termino.trim()}”.</Text>
      ) : null}

      {evaluacion?.estado === "invalida" ? <Text style={estilos.error}>{evaluacion.mensaje}</Text> : null}
      {evaluacion?.estado === "existe" ? (
        <View style={estilos.alta}>
          <Aviso tono="info" titulo={`Ya existe: ${evaluacion.existente.nombre}`} />
          <Boton tipo="secundario" testID={`${testID}-elegir-existente`} onPress={() => {
            elegir(evaluacion.existente.id);
            cambiarTermino("");
          }}>
            Elegir {evaluacion.existente.nombre}
          </Boton>
        </View>
      ) : null}
      {evaluacion?.estado === "nueva" && alta ? (
        <View style={estilos.alta}>
          {evaluacion.parecidas.length > 0 ? (
            <Aviso
              tono="advertencia"
              titulo="¿Es alguna de estas?"
              detalle={`${evaluacion.parecidas.map((p) => p.nombre).join(", ")}. Si es una de ellas, elígela: una variante mal escrita parte los informes en dos.`}
            />
          ) : null}
          {alta.numero ? (
            <CampoDecimal
              etiqueta={alta.numero.etiqueta}
              {...(alta.numero.ayuda ? { ayuda: alta.numero.ayuda } : {})}
              valor={numero}
              onCambio={setNumero}
              testID={`${testID}-numero`}
            />
          ) : null}
          <Boton
            tipo="secundario"
            cargando={creando}
            testID={`${testID}-agregar`}
            onPress={() => void crear(evaluacion.valor, evaluacion.parecidas.length)}
          >
            {confirmarParecida ? `Agregar “${evaluacion.valor}” de todos modos` : `${alta.etiqueta}: “${evaluacion.valor}”`}
          </Boton>
          {alta.nota ? <Text style={estilos.tenue}>{alta.nota}</Text> : null}
        </View>
      ) : null}
      {error ? <Text style={estilos.error}>{error}</Text> : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  grupo: { gap: espacio.sm, marginBottom: espacio.md },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  fichas: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  tenue: { ...texto.ayuda, color: colores.textoTenue },
  error: { ...texto.ayuda, color: colores.peligro },
  alta: { gap: espacio.sm },
  columna: { gap: espacio.sm },
  cerrada: {
    minHeight: tactil.comodo,
    flexDirection: "row",
    alignItems: "center",
    gap: espacio.sm,
    paddingHorizontal: espacio.md,
    paddingVertical: espacio.sm,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radio.md,
    backgroundColor: colores.superficie,
  },
  presionada: { opacity: 0.7 },
  cerradaTexto: { flex: 1 },
  valor: { ...texto.cuerpoFuerte, color: colores.texto },
  cambiar: { ...texto.ayuda, color: colores.primario },
});

/**
 * Elegir uno: siempre el desplegable (clientes, sedes, vehículos, técnicos
 * crecen con el tiempo y no deben alargar la pantalla). La única excepción es
 * un interruptor fijo de hasta `MAX_FICHAS` opciones (`enLinea`: sencilla o
 * dual, prioridad), que se ve como botones en fila: abrir una lista para
 * elegir entre dos sería un toque de más. Con más opciones, aunque sea un
 * vocabulario fijo, desplegable: la regla es la misma en toda la app.
 */
export const MAX_FICHAS = 3;

export function ElegirUno({
  opciones,
  seleccionado,
  onElegir,
  enLinea = false,
  testID,
  abrirSola,
  placeholder,
  etiqueta,
}: {
  opciones: readonly OpcionLista[];
  seleccionado: string | null;
  onElegir: (id: string) => void;
  /** Interruptor fijo y corto: botones en fila en vez de desplegable. */
  enLinea?: boolean;
  testID?: string;
  abrirSola?: boolean;
  placeholder?: string;
  /** Título encima del desplegable. */
  etiqueta?: string;
}) {
  if (!enLinea || opciones.length > MAX_FICHAS) {
    return (
      <ListaBuscable
        opciones={opciones}
        seleccionado={seleccionado}
        onElegir={onElegir}
        {...(testID ? { testID } : {})}
        {...(abrirSola !== undefined ? { abrirSola } : {})}
        {...(placeholder ? { placeholder } : {})}
        {...(etiqueta ? { etiqueta } : {})}
      />
    );
  }
  return (
    <View style={estilos.grupo}>
      {etiqueta ? <Text style={estilos.etiqueta}>{etiqueta}</Text> : null}
      <View style={estilos.fichas}>
      {opciones.map((o) => (
        <Opcion
          key={o.id}
          activa={o.id === seleccionado}
          etiqueta={o.texto}
          {...(o.detalle ? { detalle: o.detalle } : {})}
          {...(o.testID ? { testID: o.testID } : {})}
          onPress={() => onElegir(o.id)}
        />
      ))}
      </View>
    </View>
  );
}

/**
 * Elegir varios (las sedes de un usuario): el mismo desplegable, cerrado en
 * una línea con lo elegido; abierto, casillas para marcar varias y "Listo".
 * Las sedes crecen como los clientes: una lista de casillas siempre abierta
 * alargaba la pantalla igual.
 */
export function ElegirVarios({
  etiqueta,
  opciones,
  seleccionados,
  onAlternar,
  testID = "varios",
  placeholder = "Toca para elegir",
}: {
  etiqueta?: string;
  opciones: readonly OpcionLista[];
  seleccionados: readonly string[];
  onAlternar: (id: string) => void;
  testID?: string;
  placeholder?: string;
}) {
  const [abierta, setAbierta] = useState(false);
  const [termino, setTermino] = useState("");
  const elegidas = opciones.filter((o) => seleccionados.includes(o.id));
  const filtradas = useMemo(() => filtrarPorTexto(opciones, termino), [opciones, termino]);
  const tope = termino.trim() === "" ? MAX_SIN_TEXTO : MAX_A_LA_VISTA;

  if (!abierta) {
    const resumen = elegidas.map((o) => o.texto).join(", ");
    return (
      <View style={estilos.grupo} testID={testID}>
        {etiqueta ? <Text style={estilos.etiqueta}>{etiqueta}</Text> : null}
        <Pressable
          onPress={() => setAbierta(true)}
          accessibilityRole="button"
          accessibilityLabel={`${etiqueta ?? "Elegidas"}: ${resumen || "ninguna"}. Tocar para cambiar`}
          testID={`${testID}-abrir`}
          style={({ pressed }) => [estilos.cerrada, pressed && estilos.presionada]}
        >
          <View style={estilos.cerradaTexto}>
            <Text style={elegidas.length > 0 ? estilos.valor : estilos.tenue} numberOfLines={2}>
              {elegidas.length > 0 ? resumen : placeholder}
            </Text>
          </View>
          <Text style={estilos.cambiar}>{elegidas.length > 0 ? "Cambiar ▾" : "Elegir ▾"}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={estilos.grupo} testID={testID}>
      {etiqueta ? <Text style={estilos.etiqueta}>{etiqueta}</Text> : null}
      {opciones.length > MAX_SIN_BUSQUEDA ? (
        <Campo etiqueta="Buscar" value={termino} onChangeText={setTermino} autoCorrect={false} testID={`${testID}-buscar`} />
      ) : null}
      <View style={estilos.columna}>
        {filtradas.slice(0, tope).map((o) => (
          <Opcion
            key={o.id}
            multiple
            activa={seleccionados.includes(o.id)}
            etiqueta={o.texto}
            {...(o.detalle ? { detalle: o.detalle } : {})}
            testID={o.testID ?? `opcion-${o.id}`}
            onPress={() => onAlternar(o.id)}
          />
        ))}
      </View>
      {filtradas.length > tope ? (
        <Text style={estilos.tenue}>Hay {filtradas.length - tope} más: escribe para encontrarlas.</Text>
      ) : null}
      <Boton tipo="secundario" testID={`${testID}-listo`} onPress={() => { setTermino(""); setAbierta(false); }}>
        Listo{elegidas.length > 0 ? ` (${elegidas.length})` : ""}
      </Boton>
    </View>
  );
}
