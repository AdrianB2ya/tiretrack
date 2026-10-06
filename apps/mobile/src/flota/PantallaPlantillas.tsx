import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Aviso, Boton, Campo, Opcion, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, espacio, radio, texto } from "../diseno/tokens";
import { DiagramaLlantas } from "../ordenes/DiagramaLlantas";
import { construirDiagrama } from "../ordenes/diagrama";
import type { PosicionEjeLocal } from "../datos/repositorio";
import {
  EJE_NUEVO,
  aDefiniciones,
  aPosicionesLocales,
  desdePosiciones,
  revisarPlantilla,
  type EjeEditable,
  type TipoEje,
} from "./editorPlantilla";
import type { DefinicionEje } from "@tiretrack/domain";

/**
 * Plantillas de ejes (solo administrador: son estructura, no operación).
 *
 * Nunca se editan: "Nueva versión" crea otra, y las órdenes viejas conservan
 * la suya —una orden de hace seis meses se sigue dibujando como el técnico la
 * vio—. La vista previa usa el mismo diagrama de las órdenes.
 */

type R<T> = { ok: true; datos: T } | { ok: false; codigo: string | null; mensaje: string };

export interface FuentesPlantillas {
  plantillas(): Promise<{ id: string; nombre: string; posiciones: number }[]>;
  posicionesDe(id: string): Promise<PosicionEjeLocal[]>;
  crear(nombre: string, ejes: DefinicionEje[]): Promise<R<unknown>>;
  nuevaVersion(id: string, ejes: DefinicionEje[], confirmado: boolean): Promise<R<{ vehiculosMovidos: number }>>;
}

const TIPOS: { valor: TipoEje; etiqueta: string }[] = [
  { valor: "direccional", etiqueta: "Direccional" },
  { valor: "traccion", etiqueta: "Tracción" },
  { valor: "arrastre", etiqueta: "Arrastre" },
  { valor: "multiuso", etiqueta: "Multiuso" },
];

type Modo = { tipo: "lista" } | { tipo: "editor"; base: { id: string; nombre: string } | null; ejes: EjeEditable[] };

export function PantallaPlantillas({ fuentes }: { fuentes: FuentesPlantillas }) {
  const [modo, setModo] = useState<Modo>({ tipo: "lista" });
  const [lista, setLista] = useState<{ id: string; nombre: string; posiciones: number }[] | null>(null);
  const recargar = useCallback(async () => setLista(await fuentes.plantillas()), [fuentes]);
  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (modo.tipo === "editor") {
    return (
      <Editor
        base={modo.base}
        ejesIniciales={modo.ejes}
        fuentes={fuentes}
        onListo={() => {
          setModo({ tipo: "lista" });
          void recargar();
        }}
      />
    );
  }

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Boton
        ancho
        testID="nueva-plantilla"
        onPress={() => setModo({ tipo: "editor", base: null, ejes: [{ ...EJE_NUEVO, tipoEje: "direccional", dual: false, psi: "110", profMin: "3" }] })}
      >
        Nueva plantilla
      </Boton>
      {lista && lista.length === 0 ? <Vacio mensaje="Sin plantillas descargadas. Sincroniza con señal." /> : null}
      {(lista ?? []).map((p) => (
        <Tarjeta key={p.id}>
          <Text style={estilos.nombre}>{p.nombre}</Text>
          <Text style={estilos.detalle}>{p.posiciones} posiciones</Text>
          <Boton
            tipo="fantasma"
            testID={`version-${p.id}`}
            onPress={() =>
              void fuentes.posicionesDe(p.id).then((pos) =>
                setModo({ tipo: "editor", base: { id: p.id, nombre: p.nombre }, ejes: desdePosiciones(pos) }),
              )
            }
          >
            Nueva versión
          </Boton>
        </Tarjeta>
      ))}
    </ScrollView>
  );
}

function Editor({ base, ejesIniciales, fuentes, onListo }: {
  base: { id: string; nombre: string } | null;
  ejesIniciales: EjeEditable[];
  fuentes: FuentesPlantillas;
  onListo: () => void;
}) {
  const [nombre, setNombre] = useState(base?.nombre ?? "");
  const [ejes, setEjes] = useState<EjeEditable[]>(ejesIniciales);
  const [intentado, setIntentado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "peligro" | "advertencia"; titulo: string; detalle: string } | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  const problemas = revisarPlantilla(nombre, ejes);
  const defs = useMemo(() => (problemas.length === 0 ? aDefiniciones(ejes) : null), [ejes, problemas.length]);
  const diagrama = useMemo(() => (defs ? construirDiagrama(aPosicionesLocales(defs), []) : null), [defs]);
  const cambiarEje = (i: number, e: Partial<EjeEditable>) => {
    setConfirmar(false);
    setEjes(ejes.map((x, j) => (j === i ? { ...x, ...e } : x)));
  };

  const guardar = async () => {
    setIntentado(true);
    if (!defs) return;
    setGuardando(true);
    setAviso(null);
    try {
      if (!base) {
        const r = await fuentes.crear(nombre.trim(), defs);
        if (r.ok) return onListo();
        return setAviso({ tono: "peligro", titulo: "No se creó", detalle: r.mensaje });
      }
      const r = await fuentes.nuevaVersion(base.id, defs, confirmar);
      if (r.ok) return onListo();
      if (r.codigo === "REQUIERE_CONFIRMACION") {
        // Cambia cómo se dibujan vehículos en uso: se dice y se pide una vez.
        setConfirmar(true);
        return setAviso({ tono: "advertencia", titulo: "Cambia vehículos en uso", detalle: r.mensaje });
      }
      setAviso({ tono: "peligro", titulo: "No se guardó", detalle: r.mensaje });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      <Text style={estilos.titulo}>{base ? `Nueva versión de ${base.nombre}` : "Nueva plantilla"}</Text>
      {base ? (
        <Text style={estilos.detalle}>
          La versión actual no se modifica: las órdenes que ya la usan se siguen dibujando igual.
        </Text>
      ) : (
        <Campo etiqueta="Nombre" value={nombre} onChangeText={setNombre} placeholder="Tractocamión 6x2" />
      )}

      {ejes.map((e, i) => (
        <View key={i} style={estilos.eje} testID={`eje-${i + 1}`}>
          <View style={estilos.fila}>
            <Text style={estilos.nombre}>Eje {i + 1}</Text>
            {ejes.length > 1 ? (
              <Boton tipo="fantasma" onPress={() => setEjes(ejes.filter((_, j) => j !== i))}>
                Quitar
              </Boton>
            ) : null}
          </View>
          <View style={estilos.enLinea}>
            {TIPOS.map((t) => (
              <Opcion key={t.valor} activa={e.tipoEje === t.valor} etiqueta={t.etiqueta} onPress={() => cambiarEje(i, { tipoEje: t.valor })} />
            ))}
          </View>
          <View style={estilos.enLinea}>
            <Opcion activa={!e.dual} etiqueta="Sencilla (2 llantas)" onPress={() => cambiarEje(i, { dual: false })} />
            <Opcion activa={e.dual} etiqueta="Dual (4 llantas)" onPress={() => cambiarEje(i, { dual: true })} />
          </View>
          <View style={estilos.enLinea}>
            <View style={estilos.mitad}>
              <Campo etiqueta={`PSI eje ${i + 1}`} value={e.psi} onChangeText={(v) => cambiarEje(i, { psi: v })} keyboardType="decimal-pad" />
            </View>
            <View style={estilos.mitad}>
              <Campo etiqueta={`Prof. mínima eje ${i + 1} (mm)`} value={e.profMin} onChangeText={(v) => cambiarEje(i, { profMin: v })} keyboardType="decimal-pad" />
            </View>
          </View>
        </View>
      ))}
      <Boton ancho tipo="secundario" testID="agregar-eje" onPress={() => setEjes([...ejes, EJE_NUEVO])}>
        Agregar eje
      </Boton>

      {diagrama ? (
        <View style={estilos.bloque}>
          <Text style={estilos.etiqueta}>Así lo verá el técnico ({diagrama.totalPosiciones} posiciones)</Text>
          <DiagramaLlantas diagrama={diagrama} onTocarPosicion={() => undefined} />
        </View>
      ) : null}

      {intentado && problemas.length > 0 ? <Aviso tono="peligro" titulo="Revisa la plantilla" detalle={problemas.join(". ")} /> : null}
      {aviso ? <Aviso tono={aviso.tono} titulo={aviso.titulo} detalle={aviso.detalle} /> : null}

      <Boton ancho testID="guardar-plantilla" cargando={guardando} onPress={() => void guardar()}>
        {confirmar ? "Confirmar y mover los vehículos" : base ? "Crear versión nueva" : "Crear plantilla"}
      </Boton>
      <Boton ancho tipo="fantasma" onPress={onListo}>
        Cancelar
      </Boton>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md },
  titulo: { ...texto.subtitulo, color: colores.texto },
  nombre: { ...texto.cuerpoFuerte, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  bloque: { gap: espacio.sm },
  fila: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  enLinea: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  mitad: { flex: 1, minWidth: 140 },
  eje: { gap: espacio.sm, padding: espacio.md, borderRadius: radio.md, borderWidth: 1, borderColor: colores.borde, backgroundColor: colores.superficie },
});
