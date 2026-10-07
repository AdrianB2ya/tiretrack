import { useCallback, useEffect, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { puedeGestionarFlota, type Rol } from "@tiretrack/domain";
import { Aviso, Boton, Campo, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, conOpacidad, espacio, radio, tactil, texto } from "../diseno/tokens";
import {
  puedeCrearCliente,
  puedeCrearVehiculo,
  revisarCliente,
  revisarSede,
  revisarVehiculo,
  type Problema,
} from "./reglasFlota";

/**
 * Clientes, sus sedes y sus vehículos.
 *
 * Todo se lee y se crea en el celular: el técnico llega a una sede que no
 * estaba registrada y la crea sin señal. Lo creado viaja en la cola.
 */

type Cliente = { id: string; nombre: string; nit: string | null };
type Sede = { id: string; nombre: string };
type Vehiculo = { id: string; codigo: string; placa: string | null; nombre: string };
type Plantilla = { id: string; nombre: string; posiciones: number };

export interface FuentesFlota {
  clientes(): Promise<Cliente[]>;
  sedesDeCliente(clienteId: string): Promise<Sede[]>;
  vehiculos(sedeClienteId: string): Promise<Vehiculo[]>;
  plantillas(): Promise<Plantilla[]>;
}

export interface AccionesFlota {
  crearCliente(c: { nombre: string; nit: string; contacto?: string; telefono?: string }): Promise<string>;
  crearSede(s: { clienteId: string; nombre: string; ciudad?: string }): Promise<string>;
  crearVehiculo(v: {
    sedeClienteId: string; configuracionEjeId: string; codigo: string; placa?: string;
    nombre: string; tipo: string; kmActual?: number;
  }): Promise<string>;
}

/**
 * Deshabilitar (nada se borra). En línea: el servidor es quien sabe si hay
 * órdenes abiertas en otros teléfonos, y la persona espera saber por qué no.
 * Al terminar, quien llama sincroniza para que la lista lo refleje.
 */
export type Deshabilitar = (
  que: "cliente" | "sede" | "vehiculo",
  id: string,
) => Promise<{ ok: true } | { ok: false; mensaje: string }>;

export interface PantallaFlotaProps {
  rol: Rol;
  fuentes: FuentesFlota;
  acciones: AccionesFlota;
  deshabilitar?: Deshabilitar;
}

type Modo =
  | { tipo: "lista" }
  | { tipo: "nuevo_cliente" }
  | { tipo: "cliente"; cliente: Cliente }
  | { tipo: "nueva_sede"; cliente: Cliente }
  | { tipo: "nuevo_vehiculo"; cliente: Cliente; sede: Sede };

export function PantallaFlota({ rol, fuentes, acciones, deshabilitar }: PantallaFlotaProps) {
  const [modo, setModo] = useState<Modo>({ tipo: "lista" });
  const [clientes, setClientes] = useState<Cliente[] | null>(null);

  const recargar = useCallback(async () => setClientes(await fuentes.clientes()), [fuentes]);
  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (modo.tipo === "nuevo_cliente") {
    return (
      <FormCliente
        existentes={clientes ?? []}
        onCancelar={() => setModo({ tipo: "lista" })}
        onGuardar={async (c) => {
          const id = await acciones.crearCliente(c);
          await recargar();
          setModo({ tipo: "cliente", cliente: { id, nombre: c.nombre.trim(), nit: c.nit.trim() } });
        }}
      />
    );
  }
  if (modo.tipo === "nueva_sede") {
    return (
      <FormSede
        cliente={modo.cliente}
        onCancelar={() => setModo({ tipo: "cliente", cliente: modo.cliente })}
        onGuardar={async (s) => {
          await acciones.crearSede({ ...s, clienteId: modo.cliente.id });
          setModo({ tipo: "cliente", cliente: modo.cliente });
        }}
      />
    );
  }
  if (modo.tipo === "nuevo_vehiculo") {
    return (
      <FormVehiculo
        sede={modo.sede}
        fuentes={fuentes}
        onCancelar={() => setModo({ tipo: "cliente", cliente: modo.cliente })}
        onGuardar={async (v) => {
          await acciones.crearVehiculo({ ...v, sedeClienteId: modo.sede.id });
          setModo({ tipo: "cliente", cliente: modo.cliente });
        }}
      />
    );
  }
  if (modo.tipo === "cliente") {
    return (
      <DetalleCliente
        cliente={modo.cliente}
        rol={rol}
        fuentes={fuentes}
        onVolver={() => setModo({ tipo: "lista" })}
        onNuevaSede={() => setModo({ tipo: "nueva_sede", cliente: modo.cliente })}
        onNuevoVehiculo={(sede) => setModo({ tipo: "nuevo_vehiculo", cliente: modo.cliente, sede })}
        {...(deshabilitar && puedeGestionarFlota(rol)
          ? {
              deshabilitar: async (que, id) => {
                const r = await deshabilitar(que, id);
                // El cliente deshabilitado ya no está en la lista: se vuelve a ella.
                if (r.ok && que === "cliente") {
                  await recargar();
                  setModo({ tipo: "lista" });
                }
                return r;
              },
            }
          : {})}
      />
    );
  }

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      {puedeCrearCliente(rol) ? (
        <Boton ancho testID="nuevo-cliente" onPress={() => setModo({ tipo: "nuevo_cliente" })}>
          Nuevo cliente
        </Boton>
      ) : null}
      {clientes && clientes.length === 0 ? <Vacio mensaje="Sin clientes. Sincroniza con señal o crea uno." /> : null}
      {(clientes ?? []).map((c) => (
        <Tarjeta key={c.id} onPress={() => setModo({ tipo: "cliente", cliente: c })}>
          <Text style={estilos.nombre}>{c.nombre}</Text>
          {c.nit ? <Text style={estilos.detalle}>NIT {c.nit}</Text> : null}
        </Tarjeta>
      ))}
    </ScrollView>
  );
}

function DetalleCliente({
  cliente, rol, fuentes, onVolver, onNuevaSede, onNuevoVehiculo, deshabilitar,
}: {
  cliente: Cliente; rol: Rol; fuentes: FuentesFlota;
  onVolver: () => void; onNuevaSede: () => void; onNuevoVehiculo: (s: Sede) => void;
  deshabilitar?: Deshabilitar;
}) {
  const [sedes, setSedes] = useState<(Sede & { vehiculos: Vehiculo[] })[] | null>(null);
  const cargar = useCallback(async () => {
    const lista = await fuentes.sedesDeCliente(cliente.id);
    setSedes(await Promise.all(lista.map(async (s) => ({ ...s, vehiculos: await fuentes.vehiculos(s.id) }))));
  }, [fuentes, cliente.id]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const quitar = (que: "cliente" | "sede" | "vehiculo", id: string) => async () => {
    const r = await (deshabilitar as Deshabilitar)(que, id);
    if (r.ok && que !== "cliente") await cargar();
    return r;
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Text style={estilos.titulo}>{cliente.nombre}</Text>
      {cliente.nit ? <Text style={estilos.detalle}>NIT {cliente.nit}</Text> : null}
      {puedeCrearCliente(rol) ? (
        <Boton ancho tipo="secundario" testID="nueva-sede" onPress={onNuevaSede}>
          Nueva sede de este cliente
        </Boton>
      ) : null}
      {sedes && sedes.length === 0 ? <Vacio mensaje="Este cliente no tiene sedes todavía." /> : null}
      {(sedes ?? []).map((s) => (
        <View key={s.id} style={estilos.sede}>
          <Text style={estilos.nombre}>{s.nombre}</Text>
          {s.vehiculos.length === 0 ? <Text style={estilos.detalle}>Sin vehículos</Text> : null}
          {s.vehiculos.map((v) => (
            <View key={v.id}>
              <Text style={estilos.vehiculo}>
                {v.codigo}
                {v.placa ? ` · ${v.placa}` : ""} — {v.nombre}
              </Text>
              {deshabilitar ? (
                <BotonDeshabilitar testID={`deshabilitar-vehiculo-${v.id}`} que={`el vehículo ${v.codigo}`} onConfirmar={quitar("vehiculo", v.id)} />
              ) : null}
            </View>
          ))}
          {puedeCrearVehiculo(rol) ? (
            <Boton tipo="fantasma" testID={`nuevo-vehiculo-${s.id}`} onPress={() => onNuevoVehiculo(s)}>
              + Vehículo en esta sede
            </Boton>
          ) : null}
          {deshabilitar ? (
            <BotonDeshabilitar testID={`deshabilitar-sede-${s.id}`} que={`la sede ${s.nombre}`} onConfirmar={quitar("sede", s.id)} />
          ) : null}
        </View>
      ))}
      {deshabilitar ? (
        <BotonDeshabilitar testID="deshabilitar-cliente" que={`el cliente ${cliente.nombre}`} onConfirmar={quitar("cliente", cliente.id)} />
      ) : null}
      <Boton ancho tipo="fantasma" onPress={onVolver}>
        Volver a clientes
      </Boton>
    </ScrollView>
  );
}

/**
 * Pide un segundo toque y dice el motivo si no se puede (órdenes abiertas,
 * sedes o vehículos activos): un botón que no hace nada termina en una
 * llamada a soporte.
 */
function BotonDeshabilitar({ que, testID, onConfirmar }: {
  que: string;
  testID: string;
  onConfirmar: () => Promise<{ ok: true } | { ok: false; mensaje: string }>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={{ gap: espacio.xs }}>
      {confirmando ? (
        <Aviso
          tono="advertencia"
          titulo={`¿Deshabilitar ${que}?`}
          detalle="No se borra: las órdenes viejas lo conservan. Deja de ofrecerse para órdenes nuevas."
        />
      ) : null}
      <Boton
        tipo={confirmando ? "peligro" : "fantasma"}
        testID={testID}
        cargando={trabajando}
        onPress={() => {
          if (!confirmando) return setConfirmando(true);
          setTrabajando(true);
          setError(null);
          void onConfirmar()
            .then((r) => {
              if (!r.ok) setError(r.mensaje);
            })
            .finally(() => {
              setTrabajando(false);
              setConfirmando(false);
            });
        }}
      >
        {confirmando ? "Sí, deshabilitar" : `Deshabilitar ${que}`}
      </Boton>
      {error ? <Aviso tono="advertencia" titulo="No se deshabilitó" detalle={error} /> : null}
    </View>
  );
}

function errorDe(problemas: Problema[], campo: string, intentado: boolean) {
  const m = intentado ? problemas.find((p) => p.campo === campo)?.mensaje : undefined;
  return m ? { error: m } : {};
}

function Formulario({ titulo, children, onGuardar, onCancelar, guardando }: {
  titulo: string; children: ReactNode; onGuardar: () => void; onCancelar: () => void; guardando: boolean;
}) {
  return (
    <KeyboardAvoidingView style={estilos.pantalla} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
        <Text style={estilos.titulo}>{titulo}</Text>
        {children}
        <Boton ancho testID="guardar-flota" cargando={guardando} onPress={onGuardar}>
          Guardar
        </Boton>
        <Boton ancho tipo="fantasma" onPress={onCancelar}>
          Cancelar
        </Boton>
        <Text style={estilos.detalle}>Se guarda en el celular y se envía al sincronizar.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function FormCliente({ existentes, onGuardar, onCancelar }: {
  existentes: Cliente[];
  onGuardar: (c: { nombre: string; nit: string; contacto?: string; telefono?: string }) => Promise<void>;
  onCancelar: () => void;
}) {
  const [c, setC] = useState({ nombre: "", nit: "", contacto: "", telefono: "" });
  const [intentado, setIntentado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const r = revisarCliente(c, existentes);
  return (
    <Formulario
      titulo="Nuevo cliente"
      guardando={guardando}
      onCancelar={onCancelar}
      onGuardar={() => {
        setIntentado(true);
        if (r.problemas.length > 0) return;
        setGuardando(true);
        void onGuardar({
          nombre: c.nombre, nit: c.nit,
          ...(c.contacto.trim() ? { contacto: c.contacto } : {}),
          ...(c.telefono.trim() ? { telefono: c.telefono } : {}),
        }).finally(() => setGuardando(false));
      }}
    >
      <Campo etiqueta="Nombre" value={c.nombre} onChangeText={(v) => setC({ ...c, nombre: v })} {...errorDe(r.problemas, "nombre", intentado)} />
      <Campo etiqueta="NIT" value={c.nit} onChangeText={(v) => setC({ ...c, nit: v })} keyboardType="numbers-and-punctuation" {...errorDe(r.problemas, "nit", intentado)} />
      <Campo etiqueta="Contacto" value={c.contacto} onChangeText={(v) => setC({ ...c, contacto: v })} />
      <Campo etiqueta="Teléfono" value={c.telefono} onChangeText={(v) => setC({ ...c, telefono: v })} keyboardType="phone-pad" />
      {r.aviso ? <Aviso tono="advertencia" titulo="¿Es el mismo cliente?" detalle={r.aviso} /> : null}
    </Formulario>
  );
}

function FormSede({ cliente, onGuardar, onCancelar }: {
  cliente: Cliente;
  onGuardar: (s: { nombre: string; ciudad?: string }) => Promise<void>;
  onCancelar: () => void;
}) {
  const [s, setS] = useState({ nombre: "", ciudad: "" });
  const [intentado, setIntentado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const p = revisarSede({ clienteId: cliente.id, ...s });
  return (
    <Formulario
      titulo={`Nueva sede de ${cliente.nombre}`}
      guardando={guardando}
      onCancelar={onCancelar}
      onGuardar={() => {
        setIntentado(true);
        if (p.length > 0) return;
        setGuardando(true);
        void onGuardar({ nombre: s.nombre, ...(s.ciudad.trim() ? { ciudad: s.ciudad } : {}) }).finally(() => setGuardando(false));
      }}
    >
      <Campo etiqueta="Nombre de la sede" value={s.nombre} onChangeText={(v) => setS({ ...s, nombre: v })} placeholder="Patio Ciénaga" {...errorDe(p, "nombre", intentado)} />
      <Campo etiqueta="Ciudad" value={s.ciudad} onChangeText={(v) => setS({ ...s, ciudad: v })} />
    </Formulario>
  );
}

function FormVehiculo({ sede, fuentes, onGuardar, onCancelar }: {
  sede: Sede;
  fuentes: FuentesFlota;
  onGuardar: (v: { configuracionEjeId: string; codigo: string; placa?: string; nombre: string; tipo: string; kmActual?: number }) => Promise<void>;
  onCancelar: () => void;
}) {
  const [v, setV] = useState({ configuracionEjeId: null as string | null, codigo: "", placa: "", nombre: "", tipo: "", km: "" });
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [codigos, setCodigos] = useState<string[]>([]);
  const [intentado, setIntentado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    void fuentes.plantillas().then(setPlantillas);
    void fuentes.vehiculos(sede.id).then((l) => setCodigos(l.map((x) => x.codigo)));
  }, [fuentes, sede.id]);
  const p = revisarVehiculo({ sedeClienteId: sede.id, ...v }, codigos);
  return (
    <Formulario
      titulo={`Vehículo en ${sede.nombre}`}
      guardando={guardando}
      onCancelar={onCancelar}
      onGuardar={() => {
        setIntentado(true);
        if (p.length > 0 || !v.configuracionEjeId) return;
        setGuardando(true);
        const km = v.km.replace(/[.\s]/g, "");
        void onGuardar({
          configuracionEjeId: v.configuracionEjeId, codigo: v.codigo, nombre: v.nombre, tipo: v.tipo,
          ...(v.placa.trim() ? { placa: v.placa } : {}),
          ...(km ? { kmActual: Number(km) } : {}),
        }).finally(() => setGuardando(false));
      }}
    >
      <Campo etiqueta="Código interno" value={v.codigo} onChangeText={(x) => setV({ ...v, codigo: x })} placeholder="CA-12" autoCapitalize="characters" {...errorDe(p, "codigo", intentado)} />
      <Campo etiqueta="Placa" value={v.placa} onChangeText={(x) => setV({ ...v, placa: x })} autoCapitalize="characters" {...errorDe(p, "placa", intentado)} />
      <Campo etiqueta="Nombre" value={v.nombre} onChangeText={(x) => setV({ ...v, nombre: x })} placeholder="Tractocamión #12" {...errorDe(p, "nombre", intentado)} />
      <Campo etiqueta="Tipo" value={v.tipo} onChangeText={(x) => setV({ ...v, tipo: x })} placeholder="Tractocamión, volqueta…" {...errorDe(p, "tipo", intentado)} />
      <Campo etiqueta="Kilometraje actual" value={v.km} onChangeText={(x) => setV({ ...v, km: x })} keyboardType="number-pad" {...errorDe(p, "kmActual", intentado)} />
      <Text style={estilos.etiqueta}>Plantilla de ejes</Text>
      {plantillas.length === 0 ? (
        <Text style={estilos.detalle}>Sin plantillas descargadas. Sincroniza con señal.</Text>
      ) : (
        plantillas.map((pl) => {
          const activa = v.configuracionEjeId === pl.id;
          return (
            <Pressable
              key={pl.id}
              role="radio"
              aria-checked={activa}
              accessibilityLabel={`${pl.nombre}, ${pl.posiciones} posiciones`}
              onPress={() => setV({ ...v, configuracionEjeId: pl.id })}
              style={[estilos.opcion, activa && estilos.opcionActiva]}
            >
              <Text style={[estilos.textoOpcion, activa && estilos.textoActivo]}>
                {activa ? "✓ " : ""}
                {pl.nombre} · {pl.posiciones} posiciones
              </Text>
            </Pressable>
          );
        })
      )}
      {intentado && !v.configuracionEjeId ? <Text style={estilos.error}>Elige la plantilla de ejes</Text> : null}
    </Formulario>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md },
  titulo: { ...texto.subtitulo, color: colores.texto },
  nombre: { ...texto.cuerpoFuerte, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  error: { ...texto.ayuda, color: colores.peligro },
  vehiculo: { ...texto.cuerpo, color: colores.texto },
  sede: {
    gap: espacio.xs, padding: espacio.md, borderRadius: radio.md,
    borderWidth: 1, borderColor: colores.borde, backgroundColor: colores.superficie,
  },
  opcion: {
    minHeight: tactil.comodo, justifyContent: "center", paddingHorizontal: espacio.md,
    borderRadius: radio.md, borderWidth: 1, borderColor: colores.borde, backgroundColor: colores.superficie,
  },
  opcionActiva: { borderColor: colores.primario, backgroundColor: conOpacidad(colores.primario, 0.12) },
  textoOpcion: { ...texto.cuerpo, color: colores.texto },
  textoActivo: { fontWeight: "700", color: colores.primario },
});
