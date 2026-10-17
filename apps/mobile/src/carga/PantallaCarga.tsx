import { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import {
  ETIQUETA_CARGA,
  PLANTILLAS,
  TIPOS_CARGA,
  leerCSV,
  plantillaCSV,
  validarCarga,
  type ErrorFila,
  type TipoCarga,
} from "@tiretrack/domain";
import { Aviso, Boton, Tarjeta } from "../diseno/componentes";
import { ElegirUno } from "../diseno/ListaBuscable";
import { colores, espacio, texto } from "../diseno/tokens";
import type { ArchivoElegido } from "./elegirArchivo";

/**
 * Carga masiva desde Excel (R12).
 *
 * 1. Se elige qué cargar y se baja la plantilla (con una fila de ejemplo).
 * 2. Se llena en Excel y se guarda como CSV.
 * 3. Se elige el archivo: la app lo revisa fila por fila ANTES de enviar,
 *    con las mismas reglas que el servidor, y dice qué está mal y en qué
 *    fila (como la ve Excel).
 * 4. Se carga: todo o nada.
 */

type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string; cuerpo?: unknown };

export interface ResultadoCargaVista {
  filas: number;
  creados: Record<string, number>;
  existentes: number;
}

export interface FuentesCarga {
  elegir(): Promise<ArchivoElegido>;
  compartirPlantilla(nombre: string, contenido: string): Promise<{ ok: true } | { ok: false; mensaje: string }>;
  cargar(tipo: TipoCarga, csv: string): Promise<R<ResultadoCargaVista>>;
}

const NOMBRE_CREADO: Record<string, string> = {
  clientes: "clientes", sedes: "sedes", vehiculos: "vehículos", llantas: "llantas",
  marcas: "marcas", disenos: "diseños", medidas: "medidas",
  ordenes: "órdenes anteriores", mediciones: "mediciones",
};

export function PantallaCarga({ fuentes }: { fuentes: FuentesCarga }) {
  const [tipo, setTipo] = useState<TipoCarga>("flota");
  const [archivo, setArchivo] = useState<{ nombre: string; texto: string } | null>(null);
  const [errores, setErrores] = useState<ErrorFila[]>([]);
  const [filas, setFilas] = useState(0);
  const [aviso, setAviso] = useState<{ tono: "exito" | "advertencia"; titulo: string; detalle?: string } | null>(null);
  const [cargando, setCargando] = useState(false);

  const revisar = (t: TipoCarga, texto: string) => {
    const v = validarCarga(t, leerCSV(texto));
    setErrores(v.errores);
    setFilas(v.filas);
  };

  const elegir = async () => {
    setAviso(null);
    const r = await fuentes.elegir();
    if (!r.ok) {
      if (!r.cancelado) setAviso({ tono: "advertencia", titulo: "No se pudo abrir el archivo", detalle: r.mensaje });
      return;
    }
    setArchivo({ nombre: r.nombre, texto: r.texto });
    revisar(tipo, r.texto);
  };

  const cargar = async () => {
    if (!archivo) return;
    setCargando(true);
    try {
      const r = await fuentes.cargar(tipo, archivo.texto);
      if (r.ok) {
        const creados = Object.entries(r.datos.creados ?? {})
          .map(([k, n]) => `${n} ${NOMBRE_CREADO[k] ?? k}`)
          .join(", ");
        setAviso({
          tono: "exito",
          titulo: "Carga terminada",
          detalle: `${creados}.${r.datos.existentes > 0 ? ` ${r.datos.existentes} ya existían y no se duplicaron.` : ""}`,
        });
        setArchivo(null);
        return;
      }
      const delServidor = (r.cuerpo as { errores?: ErrorFila[] } | undefined)?.errores;
      if (Array.isArray(delServidor) && delServidor.length > 0) setErrores(delServidor);
      setAviso({ tono: "advertencia", titulo: r.status === 0 ? "Sin señal: la carga se hace en línea" : "No se cargó nada", detalle: r.mensaje });
    } finally {
      setCargando(false);
    }
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.detalle}>
        Llena la plantilla en Excel, guárdala como CSV y elígela aquí. Antes de cargar se revisa fila por fila; si
        una fila está mal no se carga nada, y lo que ya existe no se duplica.
      </Text>
      {/* Cuatro tipos: desplegable, como toda lista de más de tres. */}
      <ElegirUno
        enLinea
        etiqueta="Qué vas a cargar"
        testID="tipo-carga"
        opciones={TIPOS_CARGA.map((t) => ({ id: t, texto: ETIQUETA_CARGA[t], testID: `carga-${t}` }))}
        seleccionado={tipo}
        onElegir={(id) => {
          const t = id as TipoCarga;
          setTipo(t);
          if (archivo) revisar(t, archivo.texto);
        }}
      />
      {tipo === "ordenes" ? (
        // Lo que pasa con cada orden, antes de cargar: decisiones del usuario (2026-10-17).
        <Aviso
          tono="info"
          titulo="Cómo quedan las órdenes anteriores"
          detalle={"Una fila por llanta; las del mismo vehículo, fecha y número anterior son una orden. Entran cerradas y marcadas «Histórica», sin firma digital, con folio HIS-sede-000001 y su número anterior para buscarlas. Arman la historia de cada llanta, los km y los indicadores. Primero carga los vehículos y el catálogo de llantas."}
        />
      ) : null}
      <Text style={estilos.detalle}>
        Columnas: {PLANTILLAS[tipo].map((c) => (c.obligatoria ? c.nombre : `${c.nombre} (opcional)`)).join(", ")}.
      </Text>
      <Boton
        tipo="fantasma"
        testID="bajar-plantilla"
        onPress={() =>
          void (async () => {
            const r = await fuentes.compartirPlantilla(`plantilla-${tipo}.csv`, plantillaCSV(tipo));
            if (!r.ok) setAviso({ tono: "advertencia", titulo: "No se pudo compartir la plantilla", detalle: r.mensaje });
          })()
        }
      >
        Bajar la plantilla
      </Boton>
      <Boton tipo="secundario" testID="elegir-archivo" onPress={() => void elegir()}>
        {archivo ? "Elegir otro archivo" : "Elegir el archivo CSV"}
      </Boton>

      {archivo ? (
        <Tarjeta testID="revision-carga">
          <Text style={estilos.nombre}>{archivo.nombre}</Text>
          <Text style={estilos.linea}>{filas} filas</Text>
          {errores.length === 0 ? (
            <Text style={estilos.ok}>Todas las filas están bien.</Text>
          ) : (
            <>
              <Text style={estilos.mal}>
                {errores.length} {errores.length === 1 ? "problema" : "problemas"}: corrígelos en Excel y vuelve a elegirlo.
              </Text>
              {errores.slice(0, 50).map((e, i) => (
                <Text key={i} style={estilos.linea}>
                  Fila {e.fila}: {e.mensaje}
                </Text>
              ))}
              {errores.length > 50 ? <Text style={estilos.detalle}>…y {errores.length - 50} más.</Text> : null}
            </>
          )}
          <Boton testID="cargar" cargando={cargando} deshabilitado={errores.length > 0 || filas === 0} onPress={() => void cargar()}>
            {`Cargar ${filas} ${filas === 1 ? "fila" : "filas"}`}
          </Boton>
        </Tarjeta>
      ) : null}
      {aviso ? <Aviso tono={aviso.tono} titulo={aviso.titulo} {...(aviso.detalle ? { detalle: aviso.detalle } : {})} /> : null}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md, paddingBottom: espacio.xxl },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  nombre: { ...texto.cuerpoFuerte, color: colores.texto },
  linea: { ...texto.ayuda, color: colores.texto },
  ok: { ...texto.cuerpo, color: colores.exito },
  mal: { ...texto.cuerpo, color: colores.advertencia, fontWeight: "700" },
});
