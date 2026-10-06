import { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Rol } from "@tiretrack/domain";
import { Aviso, Boton, Campo, Insignia, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, conOpacidad, espacio, radio, tactil, texto } from "../diseno/tokens";
import { ETIQUETA_ROL } from "../sesion/PantallaCuenta";
import { ETIQUETA_ROL_ASIGNABLE, mensajeActivacion, revisarUsuario, type FormUsuario } from "./reglasAdmin";

/**
 * Usuarios de la empresa (solo administrador). Al crear uno, el código de
 * activación se muestra UNA vez, listo para enviar por WhatsApp.
 */

export interface UsuarioListado {
  id: string; nombre: string; email: string; rol: string; activo: boolean; sedes: string[]; sinActivar: boolean;
}
type Resultado<T> = { ok: true; datos: T } | { ok: false; mensaje: string };

export interface FuentesUsuarios {
  usuarios(): Promise<Resultado<UsuarioListado[]>>;
  sedes(): Promise<Resultado<{ id: string; nombre: string; codigo: string }[]>>;
  clientes(): Promise<{ id: string; nombre: string }[]>;
  crear(f: FormUsuario): Promise<Resultado<{ codigo: string; expiraEn: string }>>;
  nuevoCodigo(usuarioId: string): Promise<Resultado<{ codigo: string; expiraEn: string }>>;
  compartir(mensaje: string): void;
}

type Modo = { tipo: "lista" } | { tipo: "nuevo" } | { tipo: "codigo"; nombre: string; codigo: string; expiraEn: string };

export function PantallaUsuarios({ fuentes }: { fuentes: FuentesUsuarios }) {
  const [modo, setModo] = useState<Modo>({ tipo: "lista" });
  const [lista, setLista] = useState<UsuarioListado[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    const r = await fuentes.usuarios();
    if (r.ok) {
      setLista(r.datos);
      setError(null);
    } else setError(r.mensaje);
  }, [fuentes]);
  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (modo.tipo === "codigo") {
    const mensaje = mensajeActivacion(modo.nombre, modo.codigo, modo.expiraEn);
    return (
      <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
        <Text style={estilos.titulo}>Código de activación de {modo.nombre}</Text>
        {/* Grande y monoespaciado: se lee y se dicta por teléfono. */}
        <Text style={estilos.codigo} selectable testID="codigo-activacion">{modo.codigo}</Text>
        <Aviso
          tono="advertencia"
          titulo="Se muestra una sola vez"
          detalle="Envíalo ahora. Si se pierde, pide un código nuevo: el anterior deja de servir."
        />
        <Boton ancho testID="compartir" onPress={() => fuentes.compartir(mensaje)}>
          Enviar por WhatsApp u otra app
        </Boton>
        <Text style={estilos.detalle}>{mensaje}</Text>
        <Boton ancho tipo="fantasma" onPress={() => setModo({ tipo: "lista" })}>
          Listo
        </Boton>
      </ScrollView>
    );
  }

  if (modo.tipo === "nuevo") {
    return (
      <FormNuevo
        fuentes={fuentes}
        onCancelar={() => setModo({ tipo: "lista" })}
        onCreado={(nombre, c) => {
          void recargar();
          setModo({ tipo: "codigo", nombre, ...c });
        }}
      />
    );
  }

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Boton ancho testID="nuevo-usuario" onPress={() => setModo({ tipo: "nuevo" })}>
        Nuevo usuario
      </Boton>
      {error ? <Aviso tono="advertencia" titulo="No se pudo cargar" detalle={error} /> : null}
      {lista && lista.length === 0 ? <Vacio mensaje="Sin usuarios." /> : null}
      {(lista ?? []).map((u) => (
        <Tarjeta key={u.id}>
          <View style={estilos.fila}>
            <Text style={estilos.nombre}>{u.nombre}</Text>
            {/* El estado en texto, no solo en color. */}
            {u.sinActivar ? <Insignia color={colores.advertencia}>Sin activar</Insignia> : null}
            {!u.activo ? <Insignia color={colores.textoTenue}>Inactivo</Insignia> : null}
          </View>
          <Text style={estilos.detalle}>{u.email}</Text>
          <Text style={estilos.detalle}>{ETIQUETA_ROL[u.rol as Rol] ?? u.rol}</Text>
          <Boton
            tipo="fantasma"
            testID={`codigo-${u.id}`}
            onPress={() =>
              void fuentes.nuevoCodigo(u.id).then((r) => {
                if (r.ok) setModo({ tipo: "codigo", nombre: u.nombre, ...r.datos });
                else setError(r.mensaje);
              })
            }
          >
            {u.sinActivar ? "Enviar un código nuevo" : "Código para recuperar la cuenta"}
          </Boton>
        </Tarjeta>
      ))}
    </ScrollView>
  );
}

function FormNuevo({ fuentes, onCancelar, onCreado }: {
  fuentes: FuentesUsuarios;
  onCancelar: () => void;
  onCreado: (nombre: string, c: { codigo: string; expiraEn: string }) => void;
}) {
  const [f, setF] = useState<FormUsuario>({ nombre: "", cedula: "", email: "", telefono: "", rol: "tecnico", sedes: [], clienteId: null });
  const [sedes, setSedes] = useState<{ id: string; nombre: string; codigo: string }[]>([]);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [intentado, setIntentado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fuentes.sedes().then((r) => r.ok && setSedes(r.datos));
    void fuentes.clientes().then(setClientes);
  }, [fuentes]);

  const p = revisarUsuario(f);
  const errorDe = (c: string) => {
    const m = intentado ? p.find((x) => x.campo === c)?.mensaje : undefined;
    return m ? { error: m } : {};
  };
  const alternar = (id: string) =>
    setF({ ...f, sedes: f.sedes.includes(id) ? f.sedes.filter((s) => s !== id) : [...f.sedes, id] });

  return (
    <KeyboardAvoidingView style={estilos.pantalla} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
        <Text style={estilos.titulo}>Nuevo usuario</Text>
        <Campo etiqueta="Nombre completo" value={f.nombre} onChangeText={(v) => setF({ ...f, nombre: v })} {...errorDe("nombre")} />
        <Campo etiqueta="Cédula" value={f.cedula} onChangeText={(v) => setF({ ...f, cedula: v })} keyboardType="number-pad" {...errorDe("cedula")} />
        <Campo etiqueta="Correo" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} autoCapitalize="none" keyboardType="email-address" {...errorDe("email")} />
        <Campo etiqueta="Teléfono" value={f.telefono} onChangeText={(v) => setF({ ...f, telefono: v })} keyboardType="phone-pad" />

        <Text style={estilos.etiqueta}>Rol</Text>
        <View style={estilos.enLinea}>
          {(Object.keys(ETIQUETA_ROL_ASIGNABLE) as (keyof typeof ETIQUETA_ROL_ASIGNABLE)[]).map((r) => (
            <Opcion key={r} activa={f.rol === r} etiqueta={ETIQUETA_ROL_ASIGNABLE[r]} onPress={() => setF({ ...f, rol: r })} />
          ))}
        </View>

        <Text style={estilos.etiqueta}>Sedes en las que trabaja</Text>
        {sedes.map((s) => (
          <Opcion key={s.id} activa={f.sedes.includes(s.id)} etiqueta={`${s.nombre} (${s.codigo})`} onPress={() => alternar(s.id)} casilla />
        ))}
        {intentado && p.find((x) => x.campo === "sedes") ? <Text style={estilos.error}>Elige al menos una sede</Text> : null}

        {f.rol === "cliente" ? (
          <>
            <Text style={estilos.etiqueta}>Cliente al que pertenece</Text>
            {clientes.map((c) => (
              <Opcion key={c.id} activa={f.clienteId === c.id} etiqueta={c.nombre} onPress={() => setF({ ...f, clienteId: c.id })} />
            ))}
            {intentado && p.find((x) => x.campo === "clienteId") ? <Text style={estilos.error}>Elige el cliente</Text> : null}
          </>
        ) : null}

        {error ? <Aviso tono="peligro" titulo="No se creó" detalle={error} /> : null}
        <Boton
          ancho
          testID="crear-usuario"
          cargando={guardando}
          onPress={() => {
            setIntentado(true);
            if (p.length > 0) return;
            setGuardando(true);
            void fuentes.crear(f).then((r) => {
              setGuardando(false);
              if (r.ok) onCreado(f.nombre, r.datos);
              else setError(r.mensaje);
            });
          }}
        >
          Crear y generar código
        </Boton>
        <Boton ancho tipo="fantasma" onPress={onCancelar}>
          Cancelar
        </Boton>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Opcion({ activa, etiqueta, onPress, casilla = false }: { activa: boolean; etiqueta: string; onPress: () => void; casilla?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      role={casilla ? "checkbox" : "radio"}
      aria-checked={activa}
      accessibilityLabel={etiqueta}
      style={[estilos.opcion, activa && estilos.opcionActiva]}
    >
      <Text style={[estilos.textoOpcion, activa && estilos.textoActivo]}>
        {activa ? "✓ " : ""}
        {etiqueta}
      </Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md },
  titulo: { ...texto.subtitulo, color: colores.texto },
  nombre: { ...texto.cuerpoFuerte, color: colores.texto, flexShrink: 1 },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  error: { ...texto.ayuda, color: colores.peligro },
  codigo: { ...texto.codigo, fontSize: 34, letterSpacing: 4, color: colores.primario, textAlign: "center" },
  fila: { flexDirection: "row", alignItems: "center", gap: espacio.sm, flexWrap: "wrap" },
  enLinea: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  opcion: {
    minHeight: tactil.comodo, justifyContent: "center", paddingHorizontal: espacio.md,
    borderRadius: radio.md, borderWidth: 1, borderColor: colores.borde, backgroundColor: colores.superficie,
  },
  opcionActiva: { borderColor: colores.primario, backgroundColor: conOpacidad(colores.primario, 0.12) },
  textoOpcion: { ...texto.cuerpo, color: colores.texto },
  textoActivo: { fontWeight: "700", color: colores.primario },
});
