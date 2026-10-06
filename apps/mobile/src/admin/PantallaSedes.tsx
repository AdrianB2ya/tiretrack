import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { Aviso, Boton, Campo, Tarjeta } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import { revisarSedeEmpresa } from "./reglasAdmin";

/** Sedes de la empresa (solo administrador). El código entra en el folio. */

type Resultado<T> = { ok: true; datos: T } | { ok: false; mensaje: string };
export interface FuentesSedes {
  sedes(): Promise<Resultado<{ id: string; nombre: string; codigo: string; ciudad: string | null }[]>>;
  crear(s: { nombre: string; codigo: string; ciudad?: string }): Promise<Resultado<unknown>>;
}

export function PantallaSedes({ fuentes }: { fuentes: FuentesSedes }) {
  const [lista, setLista] = useState<{ id: string; nombre: string; codigo: string; ciudad: string | null }[]>([]);
  const [nueva, setNueva] = useState<{ nombre: string; codigo: string; ciudad: string } | null>(null);
  const [intentado, setIntentado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    const r = await fuentes.sedes();
    if (r.ok) setLista(r.datos);
    else setError(r.mensaje);
  }, [fuentes]);
  useEffect(() => {
    void recargar();
  }, [recargar]);

  const p = nueva ? revisarSedeEmpresa(nueva) : [];
  const errorDe = (c: string) => {
    const m = intentado ? p.find((x) => x.campo === c)?.mensaje : undefined;
    return m ? { error: m } : {};
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      {error ? <Aviso tono="advertencia" titulo="No se pudo completar" detalle={error} /> : null}
      {nueva ? (
        <>
          <Text style={estilos.titulo}>Nueva sede</Text>
          <Campo etiqueta="Nombre" value={nueva.nombre} onChangeText={(v) => setNueva({ ...nueva, nombre: v })} placeholder="Sede Ciénaga" {...errorDe("nombre")} />
          <Campo
            etiqueta="Código (va en el folio)"
            value={nueva.codigo}
            onChangeText={(v) => setNueva({ ...nueva, codigo: v.toUpperCase() })}
            autoCapitalize="characters"
            maxLength={6}
            placeholder="CNG"
            {...errorDe("codigo")}
          />
          <Text style={estilos.detalle}>Los folios saldrán como OS-{nueva.codigo || "CNG"}-000001. No se puede cambiar después.</Text>
          <Campo etiqueta="Ciudad" value={nueva.ciudad} onChangeText={(v) => setNueva({ ...nueva, ciudad: v })} />
          <Boton
            ancho
            testID="crear-sede"
            onPress={() => {
              setIntentado(true);
              if (p.length > 0) return;
              void fuentes
                .crear({ nombre: nueva.nombre, codigo: nueva.codigo, ...(nueva.ciudad.trim() ? { ciudad: nueva.ciudad } : {}) })
                .then((r) => {
                  if (!r.ok) return setError(r.mensaje);
                  setNueva(null);
                  setError(null);
                  void recargar();
                });
            }}
          >
            Crear sede
          </Boton>
          <Boton ancho tipo="fantasma" onPress={() => setNueva(null)}>
            Cancelar
          </Boton>
        </>
      ) : (
        <Boton ancho testID="nueva-sede-empresa" onPress={() => { setIntentado(false); setNueva({ nombre: "", codigo: "", ciudad: "" }); }}>
          Nueva sede
        </Boton>
      )}
      {lista.map((s) => (
        <Tarjeta key={s.id}>
          <Text style={estilos.nombre}>{s.nombre}</Text>
          <Text style={estilos.codigo}>{s.codigo}</Text>
          {s.ciudad ? <Text style={estilos.detalle}>{s.ciudad}</Text> : null}
        </Tarjeta>
      ))}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md },
  titulo: { ...texto.subtitulo, color: colores.texto },
  nombre: { ...texto.cuerpoFuerte, color: colores.texto },
  codigo: { ...texto.codigo, color: colores.primario },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
