import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Compras, Rendimiento, VidaUtil } from "@tiretrack/domain";
import { Aviso, Boton, Opcion, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import { nombreDeEtiqueta } from "@tiretrack/domain";

/**
 * Tablero de la flota (R11): qué comprar y cuándo, y qué marca rinde.
 *
 * Primero lo que pide acción (las compras), después el análisis. Las cifras
 * van en texto: con guantes y bajo el sol, una barra de color no se lee.
 * El mismo tablero lo ve el cliente en su portal, con su flota.
 */

type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string };

export interface Tablero {
  llantas: number;
  porMarca: Rendimiento[];
  porDiseno: Rendimiento[];
  porPosicion: Rendimiento[];
  compras: Compras;
  /** Brecha C: lo que rodaron las que ya terminaron su vida. Opcional: un servidor anterior no la manda. */
  vidaUtil?: { retiradas: number; porMarca: VidaUtil[]; porDiseno: VidaUtil[] };
}

export interface FuentesTablero {
  cargar(): Promise<R<Tablero>>;
}

const pesos = (n: number | null) => (n === null ? "—" : `$${String(n).replace(".", ",")}`);
const km = (n: number | null) => (n === null ? "—" : `${Math.round(n).toLocaleString("es-CO")} km`);
const lista = (xs: { medida: string; cantidad: number }[]) =>
  xs.length === 0 ? "ninguna" : xs.map((x) => `${x.cantidad} de ${x.medida}`).join(", ");

type Vista = "marca" | "diseno" | "posicion";

export function PantallaTablero({ fuentes }: { fuentes: FuentesTablero }) {
  const [tablero, setTablero] = useState<Tablero | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("marca");

  const cargar = useCallback(async () => {
    const r = await fuentes.cargar();
    if (r.ok && r.datos?.compras && Array.isArray(r.datos.porMarca)) {
      setTablero(r.datos);
      setError(null);
    } else if (!r.ok) setError(r.status === 0 ? "Sin señal: el tablero se consulta en línea." : r.mensaje);
    else setError("La respuesta llegó incompleta.");
  }, [fuentes]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!tablero) {
    return error ? (
      <View style={estilos.centrado}>
        <Aviso tono="advertencia" titulo="No se pudo cargar" detalle={error} />
        <Boton tipo="secundario" testID="reintentar-tablero" onPress={() => void cargar()}>
          Reintentar
        </Boton>
      </View>
    ) : (
      <Vacio mensaje="Calculando el tablero…" />
    );
  }
  if (tablero.llantas === 0) return <Vacio mensaje="Todavía no hay mediciones para el tablero." />;

  const c = tablero.compras;
  const filas = vista === "marca" ? tablero.porMarca : vista === "diseno" ? tablero.porDiseno : tablero.porPosicion;
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.resumen}>{tablero.llantas} llantas, con su última medición</Text>

      <Tarjeta testID="compras">
        <Text style={estilos.subtitulo}>Para comprar</Text>
        <Text style={c.yaPedidas.length > 0 ? estilos.urgente : estilos.linea}>Ya en su límite: {lista(c.yaPedidas)}</Text>
        <Text style={estilos.linea}>En 30 días: {lista(c.en30)}</Text>
        <Text style={estilos.linea}>En 60 días: {lista(c.en60)}</Text>
        <Text style={estilos.linea}>En 90 días: {lista(c.en90)}</Text>
        {c.sinEstimar > 0 ? (
          <Text style={estilos.detalle}>
            {c.sinEstimar} sin estimar: falta la profundidad de fábrica, la fecha de montaje o un primer desgaste.
          </Text>
        ) : null}
      </Tarjeta>

      <Text style={estilos.subtitulo}>Rendimiento</Text>
      <View style={estilos.fila}>
        <Opcion etiqueta="Por marca" activa={vista === "marca"} onPress={() => setVista("marca")} testID="vista-marca" />
        <Opcion etiqueta="Por diseño" activa={vista === "diseno"} onPress={() => setVista("diseno")} testID="vista-diseno" />
        <Opcion etiqueta="Por posición" activa={vista === "posicion"} onPress={() => setVista("posicion")} testID="vista-posicion" />
      </View>
      <Text style={estilos.detalle}>Del menor costo por kilómetro al mayor.</Text>
      {filas.map((g) => (
        <Tarjeta key={g.grupo} testID={`rendimiento-${g.grupo}`}>
          <Text style={estilos.nombre}>{vista === "posicion" ? nombreDeEtiqueta(g.grupo) : g.grupo}</Text>
          <Text style={estilos.linea}>
            Costo por km {pesos(g.cpk)} · {g.kmPorMm === null ? "—" : `${g.kmPorMm.toLocaleString("es-CO")} km/mm`} · proyección {km(g.proyeccionKm)}
          </Text>
          <Text style={estilos.detalle}>{g.llantas} {g.llantas === 1 ? "llanta" : "llantas"}</Text>
        </Tarjeta>
      ))}
      {tablero.vidaUtil && vista !== "posicion" ? (
        <Tarjeta testID="vida-util">
          <Text style={estilos.subtitulo}>Vida útil real</Text>
          <Text style={estilos.detalle}>
            Lo que rodaron las llantas que ya terminaron su vida (desechadas o a reencauche): {tablero.vidaUtil.retiradas}.
          </Text>
          {(vista === "marca" ? tablero.vidaUtil.porMarca : tablero.vidaUtil.porDiseno).length === 0 ? (
            <Text style={estilos.detalle}>Todavía ninguna con kilómetros registrados al montar y al desmontar.</Text>
          ) : (
            (vista === "marca" ? tablero.vidaUtil.porMarca : tablero.vidaUtil.porDiseno).map((v) => (
              <Text key={v.grupo} style={estilos.linea}>
                {v.grupo}: {km(v.kmPromedio)} ({v.llantas} {v.llantas === 1 ? "llanta" : "llantas"})
              </Text>
            ))
          )}
        </Tarjeta>
      ) : null}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md, paddingBottom: espacio.xxl },
  centrado: { flex: 1, justifyContent: "center", padding: espacio.lg, gap: espacio.md, backgroundColor: colores.fondo },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  resumen: { ...texto.cuerpoFuerte, color: colores.texto },
  subtitulo: { ...texto.cuerpoFuerte, color: colores.texto },
  nombre: { ...texto.cuerpoFuerte, color: colores.texto },
  linea: { ...texto.cuerpo, color: colores.texto },
  urgente: { ...texto.cuerpo, color: colores.peligro, fontWeight: "700" },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
