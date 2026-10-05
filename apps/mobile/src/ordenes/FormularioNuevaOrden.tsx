import { useEffect, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { Prioridad, TipoServicio } from "@tiretrack/domain";
import { Aviso, Boton, Campo } from "../diseno/componentes";
import { colores, conOpacidad, espacio, radio, tactil, texto } from "../diseno/tokens";
import {
  cambiar,
  formularioVacio,
  revisarOrden,
  type CampoOrden,
  type FormularioOrden,
  type QuienCrea,
} from "./nuevaOrden";

/**
 * Orden nueva en cascada: sede → cliente → sede del cliente → vehículo →
 * técnico. Cada nivel aparece cuando el anterior está elegido; cambiar uno
 * limpia los que dependen de él.
 *
 * Todo sale de la base del celular: el técnico la crea en el patio, sin señal.
 */

type Opcion = { id: string; etiqueta: string; detalle?: string };

export interface FuentesNuevaOrden {
  sedes(): Promise<{ id: string; nombre: string; codigo: string }[]>;
  clientes(): Promise<{ id: string; nombre: string }[]>;
  sedesDeCliente(clienteId: string): Promise<{ id: string; nombre: string }[]>;
  vehiculos(sedeClienteId: string): Promise<
    { id: string; codigo: string; placa: string | null; nombre: string; configuracionEjeId: string; kmActual: number }[]
  >;
  tecnicos(sedeId: string): Promise<{ id: string; nombre: string }[]>;
  ordenesAbiertas(vehiculoId: string): Promise<string[]>;
}

export interface FormularioNuevaOrdenProps {
  quien: QuienCrea;
  hoy: string;
  fuentes: FuentesNuevaOrden;
  onCrear: (
    f: FormularioOrden,
    vehiculo: { id: string; configuracionEjeId: string; kmActual: number },
    codigoSede: string,
  ) => void;
  creando?: boolean;
  /** El técnico llega a un cliente que no está registrado: tiene que poder crearlo. */
  onRegistrarCliente?: () => void;
  /**
   * Cambia cuando la pantalla vuelve a primer plano: al regresar de
   * registrar un cliente, la lista tiene que mostrarlo.
   */
  recarga?: number;
}

const TIPOS: { valor: TipoServicio; etiqueta: string }[] = [
  { valor: "preventivo", etiqueta: "Preventivo" },
  { valor: "correctivo", etiqueta: "Correctivo" },
];
const PRIORIDADES: { valor: Prioridad; etiqueta: string }[] = [
  { valor: "baja", etiqueta: "Baja" },
  { valor: "normal", etiqueta: "Normal" },
  { valor: "alta", etiqueta: "Alta" },
];

export function FormularioNuevaOrden({
  quien, hoy, fuentes, onCrear, creando = false, onRegistrarCliente, recarga = 0,
}: FormularioNuevaOrdenProps) {
  const [f, setF] = useState<FormularioOrden>(() => formularioVacio(hoy, quien));
  const [intentado, setIntentado] = useState(false);
  const [sedes, setSedes] = useState<{ id: string; nombre: string; codigo: string }[] | null>(null);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [sedesCliente, setSedesCliente] = useState<{ id: string; nombre: string }[]>([]);
  const [vehiculos, setVehiculos] = useState<Awaited<ReturnType<FuentesNuevaOrden["vehiculos"]>>>([]);
  const [tecnicos, setTecnicos] = useState<{ id: string; nombre: string }[]>([]);
  const [abiertas, setAbiertas] = useState<string[]>([]);

  const tecnicoCrea = quien.rol === "tecnico";
  const poner = <K extends CampoOrden>(campo: K, valor: FormularioOrden[K]) => setF((x) => cambiar(x, campo, valor, quien));

  useEffect(() => {
    void fuentes.sedes().then((s) => setSedes(s.filter((x) => quien.sedes.includes(x.id))));
    void fuentes.clientes().then(setClientes);
  }, [fuentes, quien.sedes, recarga]);
  useEffect(() => {
    if (f.clienteId) void fuentes.sedesDeCliente(f.clienteId).then(setSedesCliente);
    else setSedesCliente([]);
  }, [fuentes, f.clienteId, recarga]);
  useEffect(() => {
    if (f.sedeClienteId) void fuentes.vehiculos(f.sedeClienteId).then(setVehiculos);
    else setVehiculos([]);
  }, [fuentes, f.sedeClienteId, recarga]);
  useEffect(() => {
    if (f.sedeId && !tecnicoCrea) void fuentes.tecnicos(f.sedeId).then(setTecnicos);
  }, [fuentes, f.sedeId, tecnicoCrea]);
  useEffect(() => {
    if (f.vehiculoId) void fuentes.ordenesAbiertas(f.vehiculoId).then(setAbiertas);
    else setAbiertas([]);
  }, [fuentes, f.vehiculoId]);

  const problemas = revisarOrden(f, quien);
  const problemaDe = (c: CampoOrden) => (intentado ? problemas.find((p) => p.campo === c)?.mensaje : undefined);

  const crear = () => {
    setIntentado(true);
    if (problemas.length > 0) return;
    const v = vehiculos.find((x) => x.id === f.vehiculoId);
    const s = sedes?.find((x) => x.id === f.sedeId);
    if (!v || !s) return;
    onCrear(f, v, s.codigo);
  };

  if (sedes !== null && sedes.length === 0) {
    // Sin sedes no hay a quién asignar la orden: o la sesión es vieja (antes el
    // login no traía las sedes) o la flota aún no se descargó.
    return (
      <View style={estilos.centrado}>
        <Aviso
          tono="advertencia"
          titulo="No hay sedes disponibles"
          detalle="Sincroniza con señal. Si sigue igual, cierra sesión y vuelve a entrar para actualizar tus sedes."
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={estilos.pantalla} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
        {sedes && sedes.length > 1 ? (
          <Paso titulo="Sede que atiende" error={problemaDe("sedeId")}>
            <Opciones
              opciones={sedes.map((s) => ({ id: s.id, etiqueta: s.nombre, detalle: s.codigo }))}
              elegida={f.sedeId}
              onElegir={(id) => poner("sedeId", id)}
            />
          </Paso>
        ) : null}

        <Paso titulo="Cliente" error={problemaDe("clienteId")}>
          {clientes.length === 0 ? (
            <Text style={estilos.ayuda}>Sin clientes descargados. Sincroniza con señal.</Text>
          ) : (
            <Opciones
              opciones={clientes.map((c) => ({ id: c.id, etiqueta: c.nombre }))}
              elegida={f.clienteId}
              onElegir={(id) => poner("clienteId", id)}
            />
          )}
          {onRegistrarCliente ? (
            <Boton tipo="fantasma" testID="registrar-cliente" onPress={onRegistrarCliente}>
              ¿No está el cliente o la sede? Regístralos
            </Boton>
          ) : null}
        </Paso>

        {f.clienteId ? (
          <Paso titulo="Sede del cliente" error={problemaDe("sedeClienteId")}>
            <Opciones
              opciones={sedesCliente.map((s) => ({ id: s.id, etiqueta: s.nombre }))}
              elegida={f.sedeClienteId}
              onElegir={(id) => poner("sedeClienteId", id)}
            />
          </Paso>
        ) : null}

        {f.sedeClienteId ? (
          <Paso titulo="Vehículo" error={problemaDe("vehiculoId")}>
            {vehiculos.length === 0 ? (
              <Text style={estilos.ayuda}>Esta sede no tiene vehículos registrados.</Text>
            ) : (
              <Opciones
                opciones={vehiculos.map((v) => ({
                  id: v.id,
                  etiqueta: `${v.codigo}${v.placa ? ` · ${v.placa}` : ""}`,
                  detalle: v.nombre,
                }))}
                elegida={f.vehiculoId}
                onElegir={(id) => poner("vehiculoId", id)}
              />
            )}
            {abiertas.length > 0 ? (
              // Avisa, no bloquea: puede ser un correctivo urgente sobre un preventivo.
              <Aviso
                tono="advertencia"
                titulo="Este vehículo ya tiene una orden abierta"
                detalle={`${abiertas.join(", ")}. Puedes crear otra si es un trabajo distinto.`}
              />
            ) : null}
          </Paso>
        ) : null}

        {!tecnicoCrea && f.sedeId ? (
          <Paso titulo="Técnico" error={problemaDe("tecnicoId")}>
            {tecnicos.length === 0 ? (
              <Text style={estilos.ayuda}>Esta sede no tiene técnicos activos.</Text>
            ) : (
              <Opciones
                opciones={tecnicos.map((t) => ({ id: t.id, etiqueta: t.nombre }))}
                elegida={f.tecnicoId}
                onElegir={(id) => poner("tecnicoId", id)}
              />
            )}
          </Paso>
        ) : null}

        <Paso titulo="Tipo de servicio">
          <Opciones
            opciones={TIPOS.map((t) => ({ id: t.valor, etiqueta: t.etiqueta }))}
            elegida={f.tipo}
            onElegir={(id) => poner("tipo", id as TipoServicio)}
            enLinea
          />
        </Paso>

        <Paso titulo="Prioridad">
          <Opciones
            opciones={PRIORIDADES.map((p) => ({ id: p.valor, etiqueta: p.etiqueta }))}
            elegida={f.prioridad}
            onElegir={(id) => poner("prioridad", id as Prioridad)}
            enLinea
          />
        </Paso>

        <Campo
          etiqueta="Fecha"
          value={f.fecha}
          onChangeText={(v) => poner("fecha", v)}
          placeholder="AAAA-MM-DD"
          {...(problemaDe("fecha") ? { error: problemaDe("fecha") } : {})}
        />

        <View style={estilos.fila}>
          <Text style={estilos.etiqueta}>Llegó sin conductor</Text>
          <Switch
            value={f.sinConductor}
            onValueChange={(v) => poner("sinConductor", v)}
            accessibilityLabel="Llegó sin conductor"
          />
        </View>
        {!f.sinConductor ? (
          <Campo
            etiqueta="Quién entrega el vehículo"
            value={f.conductorNombre}
            onChangeText={(v) => poner("conductorNombre", v)}
            placeholder="Nombre del conductor"
            {...(problemaDe("conductorNombre") ? { error: problemaDe("conductorNombre") } : {})}
          />
        ) : null}

        {!tecnicoCrea ? (
          <Campo
            etiqueta="Instrucciones para el técnico"
            value={f.nota}
            onChangeText={(v) => poner("nota", v)}
            multiline
            placeholder="Opcional: lo que debe revisar o llevar"
            {...(problemaDe("nota") ? { error: problemaDe("nota") } : {})}
          />
        ) : null}

        {intentado && problemas.length > 0 ? (
          <Aviso tono="peligro" titulo="Falta para crear la orden" detalle={problemas.map((p) => p.mensaje).join(". ")} />
        ) : null}

        <Boton ancho testID="crear-orden" cargando={creando} onPress={crear}>
          {tecnicoCrea ? "Crear y empezar" : "Crear orden"}
        </Boton>
        <Text style={estilos.ayuda}>
          {tecnicoCrea
            ? "Queda en proceso y asignada a ti. Sin señal recibe una referencia; el folio llega al sincronizar."
            : "Queda programada para el técnico. El folio llega al sincronizar."}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Paso({ titulo, error, children }: { titulo: string; error?: string; children: ReactNode }) {
  return (
    <View style={estilos.paso}>
      <Text style={estilos.etiqueta}>{titulo}</Text>
      {children}
      {error ? <Text style={estilos.error}>{error}</Text> : null}
    </View>
  );
}

function Opciones({
  opciones,
  elegida,
  onElegir,
  enLinea = false,
}: {
  opciones: Opcion[];
  elegida: string | null;
  onElegir: (id: string) => void;
  enLinea?: boolean;
}) {
  return (
    <View style={enLinea ? estilos.enLinea : estilos.lista}>
      {opciones.map((o) => {
        const activa = o.id === elegida;
        return (
          <Pressable
            key={o.id}
            onPress={() => onElegir(o.id)}
            role="radio"
            aria-checked={activa}
            accessibilityLabel={o.detalle ? `${o.etiqueta}, ${o.detalle}` : o.etiqueta}
            style={({ pressed }) => [
              estilos.opcion,
              enLinea && estilos.opcionEnLinea,
              activa && estilos.opcionActiva,
              pressed && estilos.presionada,
            ]}
          >
            {/* El estado va en texto, no solo en el color: bajo el sol se confunden. */}
            <Text style={[estilos.textoOpcion, activa && estilos.textoActivo]}>
              {activa ? "✓ " : ""}
              {o.etiqueta}
            </Text>
            {o.detalle ? <Text style={estilos.detalleOpcion}>{o.detalle}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  centrado: { flex: 1, justifyContent: "center", padding: espacio.lg, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.lg },
  paso: { gap: espacio.sm },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  ayuda: { ...texto.ayuda, color: colores.textoTenue },
  error: { ...texto.ayuda, color: colores.peligro },
  fila: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: tactil.minimo },
  lista: { gap: espacio.sm },
  enLinea: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  opcion: {
    minHeight: tactil.comodo,
    justifyContent: "center",
    paddingHorizontal: espacio.md,
    borderRadius: radio.md,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie,
  },
  opcionEnLinea: { flexGrow: 1, alignItems: "center" },
  opcionActiva: { borderColor: colores.primario, backgroundColor: conOpacidad(colores.primario, 0.12) },
  presionada: { opacity: 0.7 },
  textoOpcion: { ...texto.cuerpo, color: colores.texto },
  textoActivo: { fontWeight: "700", color: colores.primario },
  detalleOpcion: { ...texto.ayuda, color: colores.textoTenue },
});
