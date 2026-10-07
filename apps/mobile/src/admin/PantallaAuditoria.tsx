import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  ETIQUETA_ACCION_AUDITORIA,
  fechaEnColombia,
  fechaHoraEnColombia,
  resumirDetalleAuditoria,
  type AccionAuditoria,
} from "@tiretrack/domain";
import { Aviso, Boton, Insignia, Opcion, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import { rangoRapido } from "../informe/reglasInforme";

/**
 * Auditoría (5.4), solo administrador. Quién sacó datos, quién cambió qué y
 * qué hizo el sistema solo. Se consulta en línea, de a una página.
 */

export interface RegistroAuditoria {
  id: string;
  usuarioId: string | null;
  usuarioNombre: string | null;
  rol: string | null;
  accion: string;
  detalle: Record<string, unknown> | null;
  ip: string | null;
  viaSuplantacion?: boolean;
  creadoEn: string;
}
export interface PaginaAuditoria {
  registros: RegistroAuditoria[];
  siguiente: string | null;
}
type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string };

type Rango = "hoy" | "7dias" | "mes" | "todo";
const RANGOS: { clave: Rango; etiqueta: string }[] = [
  { clave: "hoy", etiqueta: "Hoy" },
  { clave: "7dias", etiqueta: "7 días" },
  { clave: "mes", etiqueta: "Este mes" },
  { clave: "todo", etiqueta: "Todo" },
];
/** Lo que más se busca; el resto entra en "Todas". */
const ACCIONES: { clave: AccionAuditoria | null; etiqueta: string }[] = [
  { clave: null, etiqueta: "Todas" },
  { clave: "exportar_informe", etiqueta: "Salidas de datos" },
  { clave: "deshabilitar", etiqueta: "Deshabilitados" },
  { clave: "cambiar_estado", etiqueta: "Cambios de estado" },
  { clave: "login_fallido", etiqueta: "Ingresos fallidos" },
];

/** Los parámetros de la consulta: días de Colombia, como el resto del sistema. */
export function consultaAuditoria(rango: Rango, accion: AccionAuditoria | null, hoy: string, antes?: string): string {
  const p = new URLSearchParams();
  if (rango !== "todo") {
    const r = rangoRapido(rango, hoy);
    p.set("desde", r.desde);
    p.set("hasta", r.hasta);
  }
  if (accion) p.set("accion", accion);
  if (antes) p.set("antes", antes);
  const q = p.toString();
  return q ? `?${q}` : "";
}

export function PantallaAuditoria({ cargar, hoy = fechaEnColombia() }: {
  cargar: (consulta: string) => Promise<R<PaginaAuditoria>>;
  hoy?: string;
}) {
  const [rango, setRango] = useState<Rango>("7dias");
  const [accion, setAccion] = useState<AccionAuditoria | null>(null);
  const [registros, setRegistros] = useState<RegistroAuditoria[] | null>(null);
  const [siguiente, setSiguiente] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const pedir = useCallback(
    async (antes?: string) => {
      setCargando(true);
      setError(null);
      try {
        const r = await cargar(consultaAuditoria(rango, accion, hoy, antes));
        if (!r.ok) return setError(r.status === 0 ? "Sin señal: la auditoría se consulta en línea." : r.mensaje);
        // "Ver más" agrega; un filtro nuevo reemplaza.
        setRegistros((previos) => (antes ? [...(previos ?? []), ...r.datos.registros] : r.datos.registros));
        setSiguiente(r.datos.siguiente);
      } finally {
        setCargando(false);
      }
    },
    [cargar, rango, accion, hoy],
  );

  useEffect(() => {
    setRegistros(null);
    void pedir();
  }, [pedir]);

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.subtitulo}>Período</Text>
      <View style={estilos.opciones}>
        {RANGOS.map((r) => (
          <Opcion key={r.clave} activa={rango === r.clave} etiqueta={r.etiqueta} testID={`rango-${r.clave}`} onPress={() => setRango(r.clave)} />
        ))}
      </View>
      <Text style={estilos.subtitulo}>Qué</Text>
      <View style={estilos.opciones}>
        {ACCIONES.map((a) => (
          <Opcion key={a.clave ?? "todas"} activa={accion === a.clave} etiqueta={a.etiqueta} testID={`accion-${a.clave ?? "todas"}`} onPress={() => setAccion(a.clave)} />
        ))}
      </View>

      {error ? (
        <View style={{ gap: espacio.sm }}>
          <Aviso tono="advertencia" titulo="No se pudo consultar" detalle={error} />
          <Boton tipo="secundario" testID="reintentar-auditoria" onPress={() => void pedir()}>
            Reintentar
          </Boton>
        </View>
      ) : null}
      {!registros && !error ? <Vacio mensaje="Consultando…" /> : null}
      {registros && registros.length === 0 ? <Vacio mensaje="Nada registrado en ese período." /> : null}

      {(registros ?? []).map((r) => {
        const resumen = resumirDetalleAuditoria(r.accion, r.detalle);
        return (
          <Tarjeta key={r.id} testID={`registro-${r.id}`} onPress={() => setAbierto(abierto === r.id ? null : r.id)}>
            <View style={estilos.fila}>
              <Text style={estilos.accion}>{ETIQUETA_ACCION_AUDITORIA[r.accion as AccionAuditoria] ?? r.accion}</Text>
              {r.viaSuplantacion ? <Insignia color={colores.advertencia}>Soporte</Insignia> : null}
            </View>
            {/* Sin usuario lo hizo el sistema: cierres tácitos, visitas recurrentes. */}
            <Text style={estilos.cuerpo}>
              {r.usuarioId ? r.usuarioNombre ?? r.usuarioId : "Sistema"}
              {r.rol && r.usuarioId ? ` · ${r.rol}` : ""}
            </Text>
            <Text style={estilos.detalle}>{fechaHoraEnColombia(r.creadoEn)}</Text>
            {resumen ? <Text style={estilos.cuerpo}>{resumen}</Text> : null}
            {abierto === r.id ? (
              <Text style={estilos.json} selectable>
                {JSON.stringify(r.detalle ?? {}, null, 2)}
                {r.ip ? `\nIP: ${r.ip}` : ""}
              </Text>
            ) : null}
          </Tarjeta>
        );
      })}

      {siguiente ? (
        <Boton tipo="secundario" ancho cargando={cargando} testID="ver-mas-auditoria" onPress={() => void pedir(siguiente)}>
          Ver más
        </Boton>
      ) : null}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md },
  subtitulo: { ...texto.cuerpoFuerte, color: colores.texto },
  opciones: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  fila: { flexDirection: "row", alignItems: "center", gap: espacio.sm },
  accion: { ...texto.cuerpoFuerte, color: colores.texto },
  cuerpo: { ...texto.cuerpo, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  json: { ...texto.codigo, color: colores.textoTenue },
});
