import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { TIPOS_EJE } from "@tiretrack/domain";
import { Aviso, Boton, CampoDecimal, Tarjeta } from "../diseno/componentes";
import { ListaBuscable, ElegirUno } from "../diseno/ListaBuscable";
import { colores, espacio, texto, tiposEje } from "../diseno/tokens";
import { evaluarAltaMedida, evaluarAltaNombre } from "./alta";
import type { AccionesCatalogo } from "../app/ProveedorDatos";
import type { DisenoLocal, MarcaLocal, MedidaLocal } from "../datos/repositorio";

/**
 * Catálogo de llantas (R1): marca → diseño → medida.
 *
 * Se lee y se agrega en el celular, como en el editor de la posición: lo
 * nuevo viaja por la cola y funciona sin señal. Lo único en línea es
 * corregir la profundidad de fábrica, porque la decide la oficina sobre lo que
 * ya está en el servidor y de ella depende el desgaste de toda la flota.
 */

type R = { ok: true } | { ok: false; status: number; mensaje: string };

export interface FuentesCatalogo {
  catalogo: AccionesCatalogo;
  /** Corrige la profundidad de fábrica en el servidor (oficina, en línea). */
  fijarProfundidad?: (medidaId: string, profundidad: number | null) => Promise<R>;
  /** El texto de arriba: el catálogo general (plataforma) no funciona sin señal. */
  descripcion?: string;
}

/** Crear devuelve el mensaje del fallo en vez de dejar escapar la excepción. */
const intentar = async (f: () => Promise<void>): Promise<string | null> => {
  try {
    await f();
    return null;
  } catch (e) {
    return (e as Error).message || "No se pudo crear";
  }
};

const etiquetaEje = (t: string) => (tiposEje as Record<string, { etiqueta: string }>)[t]?.etiqueta ?? t;

export function PantallaCatalogo({ fuentes }: { fuentes: FuentesCatalogo }) {
  const { catalogo } = fuentes;
  const [marcas, setMarcas] = useState<MarcaLocal[]>([]);
  const [disenos, setDisenos] = useState<DisenoLocal[]>([]);
  const [medidas, setMedidas] = useState<MedidaLocal[]>([]);
  const [marcaId, setMarcaId] = useState<string | null>(null);
  const [disenoId, setDisenoId] = useState<string | null>(null);
  const [tipoEjeNuevo, setTipoEjeNuevo] = useState<string>("multiuso");

  const cargar = useCallback(async () => {
    setMarcas(await catalogo.marcas());
    setDisenos(marcaId ? await catalogo.disenosDe(marcaId) : []);
    setMedidas(disenoId ? await catalogo.medidasDe(disenoId) : []);
  }, [catalogo, marcaId, disenoId]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const marca = marcas.find((m) => m.id === marcaId);
  const diseno = disenos.find((d) => d.id === disenoId);

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      <Text style={estilos.detalle}>
        {fuentes.descripcion ??
          "Marca, diseño y medida, con la profundidad de fábrica de cada medida: de ella sale el desgaste. Lo que agregas aquí funciona sin señal y viaja con la próxima sincronización."}
      </Text>

      <ListaBuscable
        etiqueta="Marca"
        testID="cat-marca"
        vacio="Todavía no hay marcas en este teléfono. Sincroniza o agrega la primera."
        opciones={marcas.map((m) => ({ id: m.id, texto: m.nombre, nueva: m.creadaLocal, ...(m.esGlobal ? { detalle: "Catálogo general" } : {}) }))}
        seleccionado={marcaId}
        onElegir={(id) => {
          setMarcaId(id);
          setDisenoId(null);
        }}
        alta={{
          etiqueta: "Agregar marca",
          evaluar: (t) => evaluarAltaNombre(t, marcas),
          onCrear: (v) =>
            intentar(async () => {
              const m = await catalogo.crearMarca(v);
              setMarcaId(m.id);
              setDisenoId(null);
            }),
        }}
      />

      {marca ? (
        <>
          <Text style={estilos.subtitulo}>Diseños de {marca.nombre}</Text>
          <ListaBuscable
            etiqueta="Diseño"
            testID="cat-diseno"
            opciones={disenos.map((d) => ({ id: d.id, texto: d.nombre, nueva: d.creadaLocal, detalle: etiquetaEje(d.tipoEje) }))}
            seleccionado={disenoId}
            onElegir={setDisenoId}
            vacio="Esta marca no tiene diseños todavía."
            alta={{
              etiqueta: "Agregar diseño",
              evaluar: (t) => evaluarAltaNombre(t, disenos),
              nota: `Se registra como ${etiquetaEje(tipoEjeNuevo).toLowerCase()} (elígelo abajo).`,
              onCrear: (v) =>
                intentar(async () => {
                  const d = await catalogo.crearDiseno(marca.id, v, tipoEjeNuevo);
                  setDisenoId(d.id);
                }),
            }}
          />
          <ElegirUno
            enLinea
            etiqueta="Tipo de eje del diseño nuevo"
            testID="cat-eje"
            opciones={TIPOS_EJE.map((t) => ({ id: t, texto: etiquetaEje(t), testID: `cat-eje-${t}` }))}
            seleccionado={tipoEjeNuevo}
            onElegir={(id) => setTipoEjeNuevo(id as typeof tipoEjeNuevo)}
          />
        </>
      ) : null}

      {diseno ? (
        <>
          <Text style={estilos.subtitulo}>Medidas de {diseno.nombre}</Text>
          {medidas.length === 0 ? <Text style={estilos.detalle}>Este diseño no tiene medidas todavía.</Text> : null}
          {medidas.map((m) => (
            <FilaMedida key={m.id} medida={m} fuentes={fuentes} onCambio={cargar} />
          ))}
          <ListaBuscable
            etiqueta="Agregar medida"
            testID="cat-medida"
            opciones={[]}
            seleccionado={null}
            onElegir={() => undefined}
            alta={{
              etiqueta: "Agregar medida",
              evaluar: (t) => evaluarAltaMedida(t, medidas.map((x) => ({ id: x.id, nombre: x.medida }))),
              numero: {
                etiqueta: "Profundidad de fábrica en mm",
                ayuda: "Si no la sabes, déjala vacía: el desgaste se calcula cuando se complete.",
              },
              onCrear: (v, n) =>
                intentar(async () => {
                  await catalogo.crearMedida(diseno.id, v, n);
                  await cargar();
                }),
            }}
          />
        </>
      ) : null}
    </ScrollView>
  );
}

function FilaMedida({ medida, fuentes, onCambio }: { medida: MedidaLocal; fuentes: FuentesCatalogo; onCambio: () => Promise<void> }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState<number | null>(medida.profundidadOriginal);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    if (!fuentes.fijarProfundidad) return;
    setGuardando(true);
    try {
      const r = await fuentes.fijarProfundidad(medida.id, valor);
      if (!r.ok) {
        setError(r.status === 0 ? "Sin señal: la profundidad se corrige en línea." : r.mensaje);
        return;
      }
      await fuentes.catalogo.fijarProfundidadLocal(medida.id, valor);
      setEditando(false);
      setError(null);
      await onCambio();
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Tarjeta testID={`cat-medida-${medida.id}`}>
      <Text style={estilos.nombre}>
        {medida.medida}
        {medida.creadaLocal ? " (nueva, sin enviar)" : ""}
      </Text>
      <Text style={medida.profundidadOriginal === null ? estilos.falta : estilos.detalle}>
        {medida.profundidadOriginal === null
          ? "Sin profundidad de fábrica: no se calcula el desgaste"
          : `Profundidad de fábrica: ${String(medida.profundidadOriginal).replace(".", ",")} mm`}
      </Text>
      {fuentes.fijarProfundidad && !medida.creadaLocal ? (
        editando ? (
          <>
            <CampoDecimal etiqueta="Profundidad de fábrica en mm" valor={valor} onCambio={setValor} testID={`cat-prof-${medida.id}`} />
            {error ? <Aviso tono="advertencia" titulo="No se pudo" detalle={error} /> : null}
            <View style={estilos.fila}>
              <Boton tipo="primario" cargando={guardando} testID={`cat-guardar-prof-${medida.id}`} onPress={() => void guardar()}>
                Guardar
              </Boton>
              <Boton tipo="fantasma" onPress={() => setEditando(false)}>
                Cancelar
              </Boton>
            </View>
          </>
        ) : (
          <Boton tipo="secundario" testID={`cat-corregir-${medida.id}`} onPress={() => setEditando(true)}>
            {medida.profundidadOriginal === null ? "Completar profundidad" : "Corregir profundidad"}
          </Boton>
        )
      ) : null}
    </Tarjeta>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md, paddingBottom: espacio.xxl },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  falta: { ...texto.ayuda, color: colores.advertencia },
  subtitulo: { ...texto.subtitulo, color: colores.texto, marginTop: espacio.md },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  nombre: { ...texto.cuerpo, fontWeight: "700", color: colores.texto },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
});
