import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { nuevoId, type Frecuencia, type TipoServicio } from "@tiretrack/domain";
import type { CrearProgramacion } from "@tiretrack/contracts";
import { Aviso, Boton, Campo, Opcion, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import {
  OPCIONES_FRECUENCIA,
  aContratoProgramacion,
  cambiarProgramacion,
  estadoProgramacion,
  fechaLegible,
  programacionVacia,
  revisarFormProgramacion,
  vistaPrevia,
  type CampoProgramacion,
  type FormularioProgramacion,
  type ProgramacionListada,
} from "./programacion";

/**
 * Visitas recurrentes (4.4). En línea: el coordinador necesita saber en el
 * momento si quedó programada o por qué no. Las listas para elegir (sede,
 * cliente, vehículo, técnico) salen del celular, como en la orden nueva.
 */

type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string };

export interface FuentesProgramaciones {
  listar(): Promise<R<ProgramacionListada[]>>;
  crear(p: CrearProgramacion): Promise<R<{ id: string; proxima: string }>>;
  pausar(id: string): Promise<R<unknown>>;
  cambiarTecnico(id: string, tecnicoId: string): Promise<R<unknown>>;
  sedes(): Promise<{ id: string; nombre: string; codigo: string }[]>;
  clientes(): Promise<{ id: string; nombre: string }[]>;
  sedesDeCliente(clienteId: string): Promise<{ id: string; nombre: string }[]>;
  vehiculos(sedeClienteId: string): Promise<{ id: string; codigo: string; placa: string | null; nombre: string }[]>;
  tecnicos(sedeId: string): Promise<{ id: string; nombre: string }[]>;
}

export interface PantallaProgramacionesProps {
  fuentes: FuentesProgramaciones;
  hoy: string;
  /** Sedes de quien programa (de la sesión): solo programa en las suyas. */
  sedesDelUsuario: readonly string[];
}

const TONOS = { peligro: colores.peligro, advertencia: colores.advertencia, normal: colores.texto, tenue: colores.textoTenue };
const TIPOS: { valor: TipoServicio; etiqueta: string }[] = [
  { valor: "preventivo", etiqueta: "Preventivo" },
  { valor: "correctivo", etiqueta: "Correctivo" },
];

export function PantallaProgramaciones({ fuentes, hoy, sedesDelUsuario }: PantallaProgramacionesProps) {
  const [nueva, setNueva] = useState(false);
  const [lista, setLista] = useState<ProgramacionListada[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    const r = await fuentes.listar();
    if (r.ok) {
      setLista(r.datos);
      setError(null);
    } else setError(r.status === 0 ? "Sin señal: las visitas programadas se consultan en línea." : r.mensaje);
  }, [fuentes]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (nueva) {
    return (
      <FormularioProgramacionNueva
        fuentes={fuentes}
        hoy={hoy}
        sedesDelUsuario={sedesDelUsuario}
        onListo={() => {
          setNueva(false);
          void recargar();
        }}
      />
    );
  }

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Boton ancho testID="nueva-programacion" onPress={() => setNueva(true)}>
        Programar visitas
      </Boton>
      <Text style={estilos.ayuda}>
        Cada visita genera una orden programada para el técnico, sola, el día que toca.
      </Text>
      {error ? <Aviso tono="advertencia" titulo="No se pudo cargar" detalle={error} /> : null}
      {lista && lista.length === 0 ? <Vacio mensaje="Aún no hay visitas programadas en tus sedes." /> : null}
      {(lista ?? []).map((p) => (
        <TarjetaProgramacion key={p.id} p={p} hoy={hoy} fuentes={fuentes} onCambio={() => void recargar()} />
      ))}
    </ScrollView>
  );
}

function TarjetaProgramacion({ p, hoy, fuentes, onCambio }: {
  p: ProgramacionListada;
  hoy: string;
  fuentes: FuentesProgramaciones;
  onCambio: () => void;
}) {
  const [modo, setModo] = useState<"ver" | "tecnico" | "pausar">("ver");
  const [tecnicos, setTecnicos] = useState<{ id: string; nombre: string }[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const estado = estadoProgramacion(p, hoy);

  const ejecutar = async (accion: () => Promise<R<unknown>>) => {
    setOcupado(true);
    setError(null);
    try {
      const r = await accion();
      if (r.ok) {
        setModo("ver");
        onCambio();
      } else setError(r.status === 0 ? "Sin señal. Inténtalo con conexión." : r.mensaje);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Tarjeta testID={`programacion-${p.id}`}>
      <Text style={estilos.codigo}>
        {p.vehiculoCodigo}
        {p.vehiculoPlaca ? ` · ${p.vehiculoPlaca}` : ""}
      </Text>
      <Text style={estilos.detalle}>
        {p.clienteNombre} · {p.sedeClienteNombre} · {p.sedeCodigo}
      </Text>
      <Text style={estilos.cuerpo}>
        {p.descripcion} · {p.tipo === "preventivo" ? "Preventivo" : "Correctivo"} · {p.tecnicoNombre}
      </Text>
      <Text style={[estilos.estado, { color: TONOS[estado.tono] }]}>{estado.texto}</Text>

      {p.activa && modo === "ver" ? (
        <View style={estilos.enLinea}>
          <Boton
            tipo="fantasma"
            testID={`cambiar-tecnico-${p.id}`}
            onPress={() => {
              setModo("tecnico");
              void fuentes.tecnicos(p.sedeId).then((t) => setTecnicos(t.filter((x) => x.id !== p.tecnicoId)));
            }}
          >
            Cambiar técnico
          </Boton>
          <Boton tipo="fantasma" testID={`pausar-${p.id}`} onPress={() => setModo("pausar")}>
            Pausar
          </Boton>
        </View>
      ) : null}

      {modo === "tecnico" ? (
        <View style={estilos.bloque}>
          {tecnicos.length === 0 ? (
            <Text style={estilos.ayuda}>No hay otros técnicos activos en esta sede.</Text>
          ) : (
            tecnicos.map((t) => (
              <Opcion
                key={t.id}
                etiqueta={t.nombre}
                activa={false}
                onPress={() => void ejecutar(() => fuentes.cambiarTecnico(p.id, t.id))}
              />
            ))
          )}
          <Boton tipo="fantasma" onPress={() => setModo("ver")}>
            Cancelar
          </Boton>
        </View>
      ) : null}

      {modo === "pausar" ? (
        // Se confirma una vez: pausar deja de generar visitas y no tiene
        // vuelta atrás desde aquí (se programa de nuevo).
        <View style={estilos.bloque}>
          <Text style={estilos.ayuda}>Dejará de generar órdenes para este vehículo. Para retomarla, prográmala de nuevo.</Text>
          <Boton tipo="peligro" testID={`confirmar-pausa-${p.id}`} cargando={ocupado} onPress={() => void ejecutar(() => fuentes.pausar(p.id))}>
            Pausar visitas
          </Boton>
          <Boton tipo="fantasma" onPress={() => setModo("ver")}>
            Cancelar
          </Boton>
        </View>
      ) : null}

      {error ? <Aviso tono="peligro" titulo="No se guardó" detalle={error} /> : null}
    </Tarjeta>
  );
}

function FormularioProgramacionNueva({ fuentes, hoy, sedesDelUsuario, onListo }: {
  fuentes: FuentesProgramaciones;
  hoy: string;
  sedesDelUsuario: readonly string[];
  onListo: () => void;
}) {
  const [f, setF] = useState<FormularioProgramacion>(() => programacionVacia(hoy, sedesDelUsuario));
  const [intentado, setIntentado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sedes, setSedes] = useState<{ id: string; nombre: string; codigo: string }[]>([]);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [sedesCliente, setSedesCliente] = useState<{ id: string; nombre: string }[]>([]);
  const [vehiculos, setVehiculos] = useState<Awaited<ReturnType<FuentesProgramaciones["vehiculos"]>>>([]);
  const [tecnicos, setTecnicos] = useState<{ id: string; nombre: string }[]>([]);
  // Un id por intento de alta: un doble toque con mala señal no crea dos.
  const [id] = useState(() => nuevoId());

  const poner = <K extends CampoProgramacion>(c: K, v: FormularioProgramacion[K]) => setF((x) => cambiarProgramacion(x, c, v));

  useEffect(() => {
    void fuentes.sedes().then((s) => setSedes(s.filter((x) => sedesDelUsuario.includes(x.id))));
    void fuentes.clientes().then(setClientes);
  }, [fuentes, sedesDelUsuario]);
  useEffect(() => {
    if (f.clienteId) void fuentes.sedesDeCliente(f.clienteId).then(setSedesCliente);
    else setSedesCliente([]);
  }, [fuentes, f.clienteId]);
  useEffect(() => {
    if (f.sedeClienteId) void fuentes.vehiculos(f.sedeClienteId).then(setVehiculos);
    else setVehiculos([]);
  }, [fuentes, f.sedeClienteId]);
  useEffect(() => {
    if (f.sedeId) void fuentes.tecnicos(f.sedeId).then(setTecnicos);
    else setTecnicos([]);
  }, [fuentes, f.sedeId]);

  const problemas = revisarFormProgramacion(f, hoy, sedesDelUsuario);
  const problemaDe = (c: CampoProgramacion) => (intentado ? problemas.find((p) => p.campo === c)?.mensaje : undefined);
  const fechas = vistaPrevia(f);
  const unidad = OPCIONES_FRECUENCIA.find((o) => o.valor === f.frecuencia)?.unidad ?? "";

  const guardar = async () => {
    setIntentado(true);
    if (problemas.length > 0) return;
    setGuardando(true);
    setAviso(null);
    try {
      const r = await fuentes.crear(aContratoProgramacion(f, id));
      if (r.ok) return onListo();
      setAviso(r.status === 0 ? "Sin señal. Programar visitas necesita conexión." : r.mensaje);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      {sedes.length > 1 ? (
        <Paso titulo="Sede que atiende" error={problemaDe("sedeId")}>
          {sedes.map((s) => (
            <Opcion key={s.id} etiqueta={s.nombre} detalle={s.codigo} activa={f.sedeId === s.id} onPress={() => poner("sedeId", s.id)} />
          ))}
        </Paso>
      ) : null}

      <Paso titulo="Cliente" error={problemaDe("clienteId")}>
        {clientes.length === 0 ? <Text style={estilos.ayuda}>Sin clientes descargados. Sincroniza con señal.</Text> : null}
        {clientes.map((c) => (
          <Opcion key={c.id} etiqueta={c.nombre} activa={f.clienteId === c.id} onPress={() => poner("clienteId", c.id)} />
        ))}
      </Paso>

      {f.clienteId ? (
        <Paso titulo="Sede del cliente" error={problemaDe("sedeClienteId")}>
          {sedesCliente.map((s) => (
            <Opcion key={s.id} etiqueta={s.nombre} activa={f.sedeClienteId === s.id} onPress={() => poner("sedeClienteId", s.id)} />
          ))}
        </Paso>
      ) : null}

      {f.sedeClienteId ? (
        <Paso titulo="Vehículo" error={problemaDe("vehiculoId")}>
          {vehiculos.length === 0 ? <Text style={estilos.ayuda}>Esta sede no tiene vehículos registrados.</Text> : null}
          {vehiculos.map((v) => (
            <Opcion
              key={v.id}
              etiqueta={`${v.codigo}${v.placa ? ` · ${v.placa}` : ""}`}
              detalle={v.nombre}
              activa={f.vehiculoId === v.id}
              onPress={() => poner("vehiculoId", v.id)}
            />
          ))}
        </Paso>
      ) : null}

      {f.sedeId ? (
        <Paso titulo="Técnico que hará las visitas" error={problemaDe("tecnicoId")}>
          {tecnicos.length === 0 ? <Text style={estilos.ayuda}>Esta sede no tiene técnicos activos.</Text> : null}
          {tecnicos.map((t) => (
            <Opcion key={t.id} etiqueta={t.nombre} activa={f.tecnicoId === t.id} onPress={() => poner("tecnicoId", t.id)} />
          ))}
        </Paso>
      ) : null}

      <Paso titulo="Tipo de servicio">
        <View style={estilos.enLinea}>
          {TIPOS.map((t) => (
            <Opcion key={t.valor} etiqueta={t.etiqueta} activa={f.tipo === t.valor} onPress={() => poner("tipo", t.valor)} />
          ))}
        </View>
      </Paso>

      <Paso titulo="Frecuencia" error={problemaDe("cada")}>
        <View style={estilos.enLinea}>
          {OPCIONES_FRECUENCIA.map((o) => (
            <Opcion
              key={o.valor}
              etiqueta={o.etiqueta}
              activa={f.frecuencia === o.valor}
              onPress={() => poner("frecuencia", o.valor as Frecuencia)}
            />
          ))}
        </View>
        <Campo etiqueta={`Cada cuántos ${unidad}`} value={f.cada} onChangeText={(v) => poner("cada", v)} keyboardType="number-pad" />
      </Paso>

      <Campo
        etiqueta="Primera visita"
        value={f.inicio}
        onChangeText={(v) => poner("inicio", v)}
        placeholder="AAAA-MM-DD"
        ayuda="Si cae en fin de semana, pasa al lunes"
        {...(problemaDe("inicio") ? { error: problemaDe("inicio") } : {})}
      />

      {fechas ? (
        <View style={estilos.bloque} testID="vista-previa">
          <Text style={estilos.etiqueta}>Próximas visitas</Text>
          {fechas.map((d) => (
            <Text key={d} style={estilos.cuerpo}>
              {fechaLegible(d)}
            </Text>
          ))}
        </View>
      ) : null}

      {intentado && problemas.length > 0 ? (
        <Aviso tono="peligro" titulo="Falta para programar" detalle={problemas.map((p) => p.mensaje).join(". ")} />
      ) : null}
      {aviso ? <Aviso tono="peligro" titulo="No se programó" detalle={aviso} /> : null}

      <Boton ancho testID="guardar-programacion" cargando={guardando} onPress={() => void guardar()}>
        Programar
      </Boton>
      <Boton ancho tipo="fantasma" onPress={onListo}>
        Cancelar
      </Boton>
    </ScrollView>
  );
}

function Paso({ titulo, error, children }: { titulo: string; error?: string | undefined; children: ReactNode }) {
  return (
    <View style={estilos.bloque}>
      <Text style={estilos.etiqueta}>{titulo}</Text>
      {children}
      {error ? <Text style={estilos.error}>{error}</Text> : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md },
  bloque: { gap: espacio.sm },
  enLinea: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  codigo: { ...texto.codigo, color: colores.texto },
  cuerpo: { ...texto.cuerpo, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  ayuda: { ...texto.ayuda, color: colores.textoTenue },
  estado: { ...texto.cuerpoFuerte },
  error: { ...texto.ayuda, color: colores.peligro },
});
