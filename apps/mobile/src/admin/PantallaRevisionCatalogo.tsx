import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Aviso, Boton, Insignia, Opcion, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";

/**
 * Revisión de lo creado en campo (la hace el administrador).
 *
 * Por cada marca o diseño que escribió un técnico: "Es correcta" la deja como
 * propia de la empresa; "Es la misma que…" la unifica con la correcta. Unificar
 * no reescribe lo registrado —los documentos cerrados no cambian—: la
 * duplicada deja de ofrecerse y los informes la cuentan como la correcta.
 */

export interface EntradaRevision {
  id: string;
  nombre: string;
  esGlobal: boolean;
  marcaNombre?: string;
  candidatas: { id: string; nombre: string; esGlobal: boolean; marcaNombre?: string }[];
}
export interface Revision {
  marcas: EntradaRevision[];
  disenos: EntradaRevision[];
}
type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string };
type Tipo = "marca" | "diseno";

export interface FuentesRevision {
  cargar(): Promise<R<Revision>>;
  aprobar(tipo: Tipo, id: string): Promise<R<unknown>>;
  unificar(tipo: Tipo, id: string, destinoId: string): Promise<R<{ disenosUnificados: number }>>;
}

export function PantallaRevisionCatalogo({ fuentes }: { fuentes: FuentesRevision }) {
  const [revision, setRevision] = useState<Revision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    const r = await fuentes.cargar();
    if (r.ok) {
      // Sin confiar en la forma: una respuesta incompleta se muestra vacía, no revienta.
      const conCandidatas = (es: EntradaRevision[] | undefined) => (Array.isArray(es) ? es : []).map((e) => ({ ...e, candidatas: e.candidatas ?? [] }));
      setRevision({ marcas: conCandidatas(r.datos?.marcas), disenos: conCandidatas(r.datos?.disenos) });
      setError(null);
    } else setError(r.status === 0 ? "Sin señal: la revisión se hace en línea." : r.mensaje);
  }, [fuentes]);
  useEffect(() => {
    void recargar();
  }, [recargar]);

  const hecho = async (r: R<unknown>, mensaje: string) => {
    if (!r.ok) return setError(r.mensaje);
    setAviso(mensaje);
    await recargar();
  };

  if (error && !revision) {
    return (
      <View style={estilos.centrado}>
        <Aviso tono="advertencia" titulo="No se pudo cargar" detalle={error} />
        <Boton tipo="secundario" testID="reintentar-revision" onPress={() => void recargar()}>
          Reintentar
        </Boton>
      </View>
    );
  }
  if (!revision) return <Vacio mensaje="Cargando lo creado en campo…" />;
  const total = revision.marcas.length + revision.disenos.length;

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.detalle}>
        Lo que los técnicos escribieron cuando la llanta no estaba en el catálogo. Si es una variante mal escrita,
        unifícala: lo registrado no cambia, pero los informes la cuentan como la correcta.
      </Text>
      {aviso ? <Aviso tono="exito" titulo={aviso} /> : null}
      {error ? <Aviso tono="advertencia" titulo="No se pudo" detalle={error} /> : null}
      {total === 0 ? <Vacio mensaje="Nada pendiente: todo lo creado en campo ya está revisado." /> : null}

      {revision.marcas.length > 0 ? <Text style={estilos.subtitulo}>Marcas</Text> : null}
      {revision.marcas.map((e) => (
        <Entrada key={e.id} tipo="marca" entrada={e} fuentes={fuentes} onHecho={hecho} />
      ))}
      {revision.disenos.length > 0 ? <Text style={estilos.subtitulo}>Diseños</Text> : null}
      {revision.disenos.map((e) => (
        <Entrada key={e.id} tipo="diseno" entrada={e} fuentes={fuentes} onHecho={hecho} />
      ))}
    </ScrollView>
  );
}

function Entrada({ tipo, entrada, fuentes, onHecho }: {
  tipo: Tipo;
  entrada: EntradaRevision;
  fuentes: FuentesRevision;
  onHecho: (r: R<unknown>, mensaje: string) => Promise<void>;
}) {
  const [destino, setDestino] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const elegido = entrada.candidatas.find((c) => c.id === destino);

  const correr = async (accion: () => Promise<R<unknown>>, mensaje: string) => {
    setTrabajando(true);
    try {
      await onHecho(await accion(), mensaje);
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Tarjeta testID={`revisar-${entrada.id}`}>
      <View style={estilos.fila}>
        <Text style={estilos.nombre}>{entrada.nombre}</Text>
        <Insignia color={colores.advertencia}>Creada en campo</Insignia>
      </View>
      {entrada.marcaNombre ? <Text style={estilos.detalle}>Marca: {entrada.marcaNombre}</Text> : null}

      <Boton
        tipo="secundario"
        testID={`aprobar-${entrada.id}`}
        cargando={trabajando && !destino}
        onPress={() => void correr(() => fuentes.aprobar(tipo, entrada.id), `"${entrada.nombre}" quedó en el catálogo`)}
      >
        Es correcta
      </Boton>

      {entrada.candidatas.length > 0 ? (
        <>
          <Text style={estilos.detalle}>¿Es la misma que alguna de estas?</Text>
          <View style={estilos.opciones}>
            {entrada.candidatas.map((c) => (
              <Opcion
                key={c.id}
                activa={destino === c.id}
                etiqueta={c.nombre}
                {...(c.esGlobal ? { detalle: "Del catálogo general" } : {})}
                testID={`destino-${entrada.id}-${c.id}`}
                onPress={() => setDestino(destino === c.id ? null : c.id)}
              />
            ))}
          </View>
        </>
      ) : null}
      {elegido ? (
        <>
          <Aviso
            tono="advertencia"
            titulo={`Unificar "${entrada.nombre}" con "${elegido.nombre}"`}
            detalle={`"${entrada.nombre}" deja de ofrecerse. Las órdenes ya registradas no cambian; los informes la cuentan como "${elegido.nombre}".`}
          />
          <Boton
            testID={`unificar-${entrada.id}`}
            cargando={trabajando}
            onPress={() =>
              void correr(
                () => fuentes.unificar(tipo, entrada.id, elegido.id),
                `"${entrada.nombre}" se unificó con "${elegido.nombre}"`,
              )
            }
          >
            Unificar
          </Boton>
        </>
      ) : null}
    </Tarjeta>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md },
  centrado: { flex: 1, justifyContent: "center", padding: espacio.lg, gap: espacio.md, backgroundColor: colores.fondo },
  subtitulo: { ...texto.cuerpoFuerte, color: colores.texto },
  fila: { flexDirection: "row", alignItems: "center", gap: espacio.sm, flexWrap: "wrap" },
  nombre: { ...texto.cuerpoFuerte, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  opciones: { gap: espacio.sm },
});
