import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Aviso, Boton, Campo, Insignia, Opcion, Tarjeta } from "../diseno/componentes";
import { colores, espacio, estadosOrden, texto } from "../diseno/tokens";
import {
  ESTADOS_FILTRO,
  FILTRO_VACIO,
  SERVICIOS_FILTRO,
  aConsulta,
  avisoSinCerrar,
  conBOM,
  describirDesgaste,
  describirFila,
  rangoRapido,
  resumen,
  revisarFiltro,
  type FiltroPantalla,
  type Trazabilidad,
  type VistaPrevia,
} from "./reglasInforme";

/**
 * Informe con filtros (6.1) y exportación (6.2).
 *
 * En línea: el informe cruza órdenes de toda la empresa y el celular solo
 * guarda las que le tocan. Se ve primero y se exporta después; el archivo
 * sale con los MISMOS parámetros que la vista previa.
 */

type Fallo = { ok: false; status: number; mensaje: string };

export interface FuentesInforme {
  clientes(): Promise<{ id: string; nombre: string }[]>;
  vistaPrevia(consulta: string): Promise<{ ok: true; datos: VistaPrevia } | Fallo>;
  trazabilidad(serial: string): Promise<{ ok: true; datos: Trazabilidad } | Fallo>;
  exportar(consulta: string): Promise<{ ok: true; texto: string; nombre: string } | Fallo>;
  compartir(nombre: string, contenido: string): Promise<{ ok: true } | { ok: false; mensaje: string }>;
  hoy(): string;
}

const RANGOS = [
  { cual: "hoy", etiqueta: "Hoy" },
  { cual: "7dias", etiqueta: "Últimos 7 días" },
  { cual: "mes", etiqueta: "Este mes" },
  { cual: "mesAnterior", etiqueta: "Mes anterior" },
] as const;

export function PantallaInforme({ fuentes }: { fuentes: FuentesInforme }) {
  const [f, setF] = useState<FiltroPantalla>(FILTRO_VACIO);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [vista, setVista] = useState<{ datos: VistaPrevia; consulta: string } | null>(null);
  const [traza, setTraza] = useState<Trazabilidad | null>(null);
  const [intentado, setIntentado] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "peligro" | "exito" | "advertencia"; titulo: string; detalle?: string } | null>(null);

  useEffect(() => {
    void fuentes.clientes().then(setClientes);
  }, [fuentes]);

  const problemas = revisarFiltro(f);
  const error = (campo: string) => (intentado ? problemas.find((p) => p.campo === campo)?.mensaje : undefined);
  const consulta = aConsulta(f);
  // Si se cambió el filtro, la vista previa ya no corresponde: no se exporta
  // algo distinto de lo que se ve.
  const vigente = vista !== null && vista.consulta === consulta;
  const cambiar = (c: Partial<FiltroPantalla>) => {
    setF({ ...f, ...c });
    setAviso(null);
  };

  const ver = async () => {
    setIntentado(true);
    if (problemas.length > 0) return;
    setBuscando(true);
    setAviso(null);
    setTraza(null);
    try {
      const r = await fuentes.vistaPrevia(consulta);
      if (!r.ok) {
        setVista(null);
        return setAviso({ tono: "peligro", titulo: r.status === 0 ? "Sin señal" : "No se pudo consultar", detalle: r.mensaje });
      }
      setVista({ datos: r.datos, consulta });
      // Con serial, el recorrido de esa llanta es casi siempre lo que se busca.
      if (f.serial.trim() && r.datos.registros > 0) {
        const t = await fuentes.trazabilidad(f.serial.trim());
        if (t.ok) setTraza(t.datos);
      }
    } finally {
      setBuscando(false);
    }
  };

  const exportar = async () => {
    if (!vigente) return;
    setExportando(true);
    setAviso(null);
    try {
      const r = await fuentes.exportar(consulta);
      if (!r.ok) {
        return setAviso({ tono: "peligro", titulo: r.status === 0 ? "Sin señal" : "No se exportó", detalle: r.mensaje });
      }
      const c = await fuentes.compartir(r.nombre, conBOM(r.texto));
      setAviso(c.ok ? { tono: "exito", titulo: "Informe listo", detalle: `${r.nombre}. La exportación quedó registrada.` } : { tono: "peligro", titulo: "No se compartió", detalle: c.mensaje });
    } finally {
      setExportando(false);
    }
  };

  const sinCerrar = vista ? avisoSinCerrar(vista.datos) : null;
  const desgaste = traza ? describirDesgaste(traza) : null;

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      <Text style={estilos.etiqueta}>Fechas</Text>
      <View style={estilos.enLinea}>
        {RANGOS.map((r) => {
          const rango = rangoRapido(r.cual, fuentes.hoy());
          return (
            <Opcion
              key={r.cual}
              etiqueta={r.etiqueta}
              activa={f.desde === rango.desde && f.hasta === rango.hasta}
              onPress={() => cambiar(rango)}
            />
          );
        })}
      </View>
      <View style={estilos.enLinea}>
        <View style={estilos.mitad}>
          <Campo etiqueta="Desde" value={f.desde} onChangeText={(v) => cambiar({ desde: v })} placeholder="AAAA-MM-DD" error={error("desde")} />
        </View>
        <View style={estilos.mitad}>
          <Campo etiqueta="Hasta" value={f.hasta} onChangeText={(v) => cambiar({ hasta: v })} placeholder="AAAA-MM-DD" error={error("hasta")} />
        </View>
      </View>

      <Text style={estilos.etiqueta}>Cliente</Text>
      <View style={estilos.enLinea}>
        <Opcion etiqueta="Todos" activa={f.clienteId === null} onPress={() => cambiar({ clienteId: null })} />
        {clientes.map((c) => (
          <Opcion key={c.id} etiqueta={c.nombre} activa={f.clienteId === c.id} onPress={() => cambiar({ clienteId: c.id })} />
        ))}
      </View>

      <Campo
        etiqueta="Serial de la llanta"
        ayuda="Busca la montada y la desmontada, y muestra su recorrido"
        value={f.serial}
        onChangeText={(v) => cambiar({ serial: v })}
        autoCapitalize="characters"
        error={error("serial")}
      />

      <Text style={estilos.etiqueta}>Servicio</Text>
      <View style={estilos.enLinea}>
        <Opcion etiqueta="Todos" activa={f.servicio === null} onPress={() => cambiar({ servicio: null })} />
        {SERVICIOS_FILTRO.map((s) => (
          <Opcion key={s.codigo} etiqueta={s.nombre} activa={f.servicio === s.codigo} onPress={() => cambiar({ servicio: s.codigo })} />
        ))}
      </View>

      <Text style={estilos.etiqueta}>Estado de la llanta</Text>
      <View style={estilos.enLinea}>
        <Opcion etiqueta="Todos" activa={f.estadoLlanta === null} onPress={() => cambiar({ estadoLlanta: null })} />
        {ESTADOS_FILTRO.map((e) => (
          <Opcion key={e} etiqueta={e} activa={f.estadoLlanta === e} onPress={() => cambiar({ estadoLlanta: e })} />
        ))}
      </View>

      <Boton ancho testID="ver-informe" cargando={buscando} onPress={() => void ver()}>
        Ver resultados
      </Boton>

      {aviso ? <Aviso tono={aviso.tono} titulo={aviso.titulo} detalle={aviso.detalle} /> : null}

      {vista ? (
        <View style={estilos.bloque}>
          <Text style={estilos.resumen} testID="resumen-informe">{resumen(vista.datos)}</Text>
          {!vigente ? <Aviso tono="advertencia" titulo="Cambiaste el filtro" detalle="Vuelve a tocar Ver resultados antes de exportar." /> : null}
          {sinCerrar ? <Aviso tono="advertencia" titulo="Datos preliminares" detalle={sinCerrar} /> : null}
          {vista.datos.registros > 0 ? (
            <Boton ancho tipo="secundario" testID="exportar-informe" cargando={exportando} deshabilitado={!vigente} onPress={() => void exportar()}>
              Exportar a hoja de cálculo
            </Boton>
          ) : null}

          {traza && traza.pasos.length > 0 ? (
            <Tarjeta testID="trazabilidad">
              <Text style={estilos.nombre}>Recorrido de {f.serial.trim().toUpperCase()}</Text>
              {desgaste ? <Text style={estilos.detalle}>{desgaste}</Text> : null}
              {traza.pasos.map((p, i) => (
                <Text key={i} style={estilos.detalle}>
                  {p.fecha} · {p.vehiculoCodigo ?? "—"} · Pos. {p.posicion}
                  {p.profundidad === null ? "" : ` · ${String(p.profundidad).replace(".", ",")} mm`}
                </Text>
              ))}
            </Tarjeta>
          ) : null}

          {vista.datos.filas.map((fila, i) => {
            const estado = estadosOrden[fila.estado as keyof typeof estadosOrden];
            return (
              <Tarjeta key={`${fila.folio}-${fila.posicion}-${i}`}>
                <View style={estilos.fila}>
                  <Text style={estilos.folio}>{fila.folio || "Sin folio"}</Text>
                  {estado ? <Insignia color={estado.color} compacta>{estado.etiqueta}</Insignia> : null}
                </View>
                <Text style={estilos.detalle}>{fila.fecha} · {fila.vehiculo}</Text>
                <Text style={estilos.cuerpo}>{describirFila(fila)}</Text>
              </Tarjeta>
            );
          })}
          {vista.datos.registros > vista.datos.filas.length ? (
            <Text style={estilos.detalle}>
              Se muestran las primeras {vista.datos.filas.length}. El archivo lleva las {vista.datos.registros}.
            </Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  enLinea: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  mitad: { flex: 1, minWidth: 140 },
  bloque: { gap: espacio.sm },
  resumen: { ...texto.subtitulo, color: colores.texto },
  fila: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  folio: { ...texto.codigo, color: colores.texto },
  nombre: { ...texto.cuerpoFuerte, color: colores.texto },
  cuerpo: { ...texto.cuerpo, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
