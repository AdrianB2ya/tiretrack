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
  conOrdenes,
  motivoSinPdf,
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
  /** Los vehículos del cliente, para tocar uno en vez de escribir la placa. */
  vehiculosDe?(clienteId: string): Promise<{ id: string; codigo: string; placa: string | null }[]>;
  vistaPrevia(consulta: string): Promise<{ ok: true; datos: VistaPrevia } | Fallo>;
  trazabilidad(serial: string): Promise<{ ok: true; datos: Trazabilidad } | Fallo>;
  exportar(consulta: string): Promise<{ ok: true; texto: string; nombre: string } | Fallo>;
  /** Las órdenes en un solo PDF, bajado al teléfono y compartido. */
  exportarPdf(consulta: string): Promise<{ ok: true } | Fallo>;
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
  const [bajandoPdf, setBajandoPdf] = useState(false);
  // Las órdenes elegidas para exportar. Vacío = todas las del filtro.
  const [elegidas, setElegidas] = useState<string[]>([]);
  // Las órdenes con sus llantas a la vista.
  const [abiertas, setAbiertas] = useState<string[]>([]);
  const [aviso, setAviso] = useState<{ tono: "peligro" | "exito" | "advertencia"; titulo: string; detalle?: string } | null>(null);

  useEffect(() => {
    void fuentes.clientes().then(setClientes);
  }, [fuentes]);

  const [vehiculos, setVehiculos] = useState<{ id: string; codigo: string; placa: string | null }[]>([]);
  useEffect(() => {
    if (!f.clienteId || !fuentes.vehiculosDe) return setVehiculos([]);
    void fuentes.vehiculosDe(f.clienteId).then(setVehiculos);
  }, [fuentes, f.clienteId]);

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
      setElegidas([]);
      setAbiertas([]);
      // Con serial, el recorrido de esa llanta es casi siempre lo que se busca.
      if (f.serial.trim() && r.datos.registros > 0) {
        const t = await fuentes.trazabilidad(f.serial.trim());
        if (t.ok) setTraza(t.datos);
      }
    } finally {
      setBuscando(false);
    }
  };

  const exportarPdf = async () => {
    if (!vigente) return;
    setBajandoPdf(true);
    setAviso(null);
    try {
      const r = await fuentes.exportarPdf(conOrdenes(consulta, elegidas));
      setAviso(r.ok
        ? { tono: "exito", titulo: "PDF listo", detalle: "La exportación quedó registrada." }
        : { tono: "peligro", titulo: r.status === 0 ? "Sin señal" : "No se generó el PDF", detalle: r.mensaje });
    } catch (e) {
      setAviso({ tono: "peligro", titulo: "No se generó el PDF", detalle: (e as Error).message });
    } finally {
      setBajandoPdf(false);
    }
  };

  const listaOrdenes = vista?.datos.listaOrdenes ?? [];
  const plegar = (id: string) =>
    setAbiertas((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const alternar = (id: string) =>
    setElegidas((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const exportar = async () => {
    if (!vigente) return;
    setExportando(true);
    setAviso(null);
    try {
      const r = await fuentes.exportar(conOrdenes(consulta, elegidas));
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
          <Opcion key={c.id} etiqueta={c.nombre} activa={f.clienteId === c.id} onPress={() => cambiar({ clienteId: c.id, vehiculoId: null })} />
        ))}
      </View>

      {vehiculos.length > 0 ? (
        <>
          <Text style={estilos.etiqueta}>Vehículo</Text>
          <View style={estilos.enLinea}>
            <Opcion etiqueta="Todos" activa={f.vehiculoId === null} onPress={() => cambiar({ vehiculoId: null })} />
            {vehiculos.map((v) => (
              <Opcion
                key={v.id}
                etiqueta={v.placa ? `${v.codigo} · ${v.placa}` : v.codigo}
                activa={f.vehiculoId === v.id}
                testID={`vehiculo-${v.id}`}
                onPress={() => cambiar({ vehiculoId: v.id, vehiculo: "" })}
              />
            ))}
          </View>
        </>
      ) : null}
      <Campo
        etiqueta="Placa o código del vehículo"
        ayuda="Basta una parte: SXK482, sxk 482 o CA-12"
        value={f.vehiculo}
        onChangeText={(v) => cambiar({ vehiculo: v, vehiculoId: null })}
        autoCapitalize="characters"
        error={error("vehiculo")}
      />

      <Campo
        etiqueta="Serial de la llanta"
        ayuda="Busca la montada y la desmontada, y muestra su recorrido"
        value={f.serial}
        onChangeText={(v) => cambiar({ serial: v })}
        autoCapitalize="characters"
        error={error("serial")}
      />
      <Campo
        etiqueta="Número de calor"
        ayuda="Busca en la llanta montada y en la desmontada"
        value={f.numCalor}
        onChangeText={(v) => cambiar({ numCalor: v })}
        autoCapitalize="characters"
        error={error("numCalor")}
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
          {listaOrdenes.length > 0 ? (
            <Text style={estilos.nombre}>
              {elegidas.length === 0
                ? "Se exportan todas las órdenes. Marca las que quieras para exportar solo esas."
                : `${elegidas.length} ${elegidas.length === 1 ? "orden elegida" : "órdenes elegidas"}`}
            </Text>
          ) : null}
          {elegidas.length > 0 ? (
            <Boton tipo="fantasma" testID="todas-las-ordenes" onPress={() => setElegidas([])}>
              Quitar la selección (exportar todas)
            </Boton>
          ) : null}
          {vista.datos.registros > 0 ? (
            <>
              <Boton ancho tipo="secundario" testID="exportar-informe" cargando={exportando} deshabilitado={!vigente} onPress={() => void exportar()}>
                Exportar a hoja de cálculo (CSV)
              </Boton>
              {(() => {
                const motivo = motivoSinPdf(vista.datos.ordenes, elegidas.length);
                return (
                  <>
                    <Boton ancho tipo="secundario" testID="exportar-pdf" cargando={bajandoPdf} deshabilitado={!vigente || motivo !== null} onPress={() => void exportarPdf()}>
                      Descargar las órdenes en PDF
                    </Boton>
                    {motivo ? <Text style={estilos.detalle}>{motivo}</Text> : null}
                  </>
                );
              })()}
            </>
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

          {/* Una tarjeta por orden, con su casilla; sus llantas, plegadas. */}
          {listaOrdenes.map((o) => {
            const estado = estadosOrden[o.estado as keyof typeof estadosOrden];
            const suyas = vista.datos.filas.filter((x) => x.ordenId === o.id);
            const abierta = abiertas.includes(o.id);
            return (
              <Tarjeta key={o.id} testID={`orden-informe-${o.id}`}>
                <Opcion
                  multiple
                  activa={elegidas.includes(o.id)}
                  etiqueta={`${o.folio || "Sin folio"} · ${o.vehiculo}`}
                  detalle={`${o.fecha} · ${estado?.etiqueta ?? o.estado} · ${o.posiciones} ${o.posiciones === 1 ? "llanta" : "llantas"}`}
                  testID={`elegir-orden-${o.id}`}
                  onPress={() => alternar(o.id)}
                />
                {suyas.length > 0 ? (
                  <Boton tipo="fantasma" testID={`ver-llantas-${o.id}`} onPress={() => plegar(o.id)}>
                    {abierta ? "Ocultar sus llantas" : `Ver sus llantas (${o.posiciones})`}
                  </Boton>
                ) : null}
                {abierta
                  ? suyas.map((fila, i) => (
                      <Text key={`${fila.posicion}-${i}`} style={estilos.cuerpo}>
                        {describirFila(fila)}
                      </Text>
                    ))
                  : null}
                {abierta && suyas.length < o.posiciones ? (
                  <Text style={estilos.detalle}>Se muestran {suyas.length} de {o.posiciones}; el archivo las lleva todas.</Text>
                ) : null}
              </Tarjeta>
            );
          })}

          {/* Servidor anterior, sin lista de órdenes: la vista por llanta de antes. */}
          {listaOrdenes.length === 0 && vista.datos.filas.map((fila, i) => {
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
          {listaOrdenes.length === 0 && vista.datos.registros > vista.datos.filas.length ? (
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
