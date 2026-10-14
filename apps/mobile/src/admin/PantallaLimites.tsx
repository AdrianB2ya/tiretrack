import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ETIQUETA_NIVEL_CAMBIO, validarLimites, type LimitesEmpresa } from "@tiretrack/domain";
import { Aviso, Boton, CampoDecimal, Vacio } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";

/**
 * Límites de cambio de llanta de la empresa (R2).
 *
 * Mueven las alertas, el diagrama y los informes de toda la flota, así que
 * se cambian en línea y quedan en la auditoría. Antes de guardar se ve qué
 * significan, en las mismas palabras que va a leer la oficina.
 */

type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string };

export interface FuentesLimites {
  cargar(): Promise<R<LimitesEmpresa>>;
  guardar(l: LimitesEmpresa): Promise<R<LimitesEmpresa>>;
}

const mm = (n: number) => `${String(n).replace(".", ",")} mm`;

export function PantallaLimites({ fuentes }: { fuentes: FuentesLimites }) {
  const [inmediato, setInmediato] = useState<number | null>(null);
  const [programar, setProgramar] = useState<number | null>(null);
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fuentes.cargar();
    if (!r.ok) return setError(r.status === 0 ? "Sin señal: los límites se consultan en línea." : r.mensaje);
    setInmediato(r.datos.cambioInmediato);
    setProgramar(r.datos.programarCambio);
    setCargado(true);
    setError(null);
  }, [fuentes]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!cargado) {
    return error ? (
      <View style={estilos.centrado}>
        <Aviso tono="advertencia" titulo="No se pudieron cargar" detalle={error} />
        <Boton tipo="secundario" testID="reintentar-limites" onPress={() => void cargar()}>
          Reintentar
        </Boton>
      </View>
    ) : (
      <Vacio mensaje="Cargando los límites…" />
    );
  }

  const completos = inmediato !== null && programar !== null;
  const veredicto = completos ? validarLimites({ cambioInmediato: inmediato, programarCambio: programar }) : null;

  const guardar = async () => {
    if (!completos || !veredicto?.permitido) return;
    setGuardando(true);
    try {
      const r = await fuentes.guardar({ cambioInmediato: inmediato, programarCambio: programar });
      if (!r.ok) {
        setError(r.status === 0 ? "Sin señal: los límites se cambian en línea." : r.mensaje);
        return;
      }
      setError(null);
      setGuardado(true);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      <Text style={estilos.detalle}>
        Con qué profundidad una llanta pide cambio en tu empresa. Si un eje de la plantilla tiene su propio mínimo (el
        direccional suele exigir más), ese manda en ese eje.
      </Text>

      <CampoDecimal
        etiqueta={`${ETIQUETA_NIVEL_CAMBIO.cambio_inmediato} a esta profundidad o menos (mm)`}
        ayuda="Es también la profundidad baja con la que se calcula el % rodado."
        valor={inmediato}
        onCambio={(n) => {
          setInmediato(n);
          setGuardado(false);
        }}
        testID="limite-inmediato"
      />
      <CampoDecimal
        etiqueta={`${ETIQUETA_NIVEL_CAMBIO.programar_cambio} hasta esta profundidad (mm)`}
        ayuda="Todavía rueda, pero hay que comprarla y agendar la visita."
        valor={programar}
        onCambio={(n) => {
          setProgramar(n);
          setGuardado(false);
        }}
        testID="limite-programar"
      />

      {completos && veredicto?.permitido ? (
        <View style={estilos.resumen} testID="resumen-limites">
          <Text style={[estilos.linea, { color: colores.peligro }]}>
            {mm(inmediato)} o menos: {ETIQUETA_NIVEL_CAMBIO.cambio_inmediato}
          </Text>
          <Text style={[estilos.linea, { color: colores.advertencia }]}>
            Más de {mm(inmediato)} y hasta {mm(programar)}: {ETIQUETA_NIVEL_CAMBIO.programar_cambio}
          </Text>
          <Text style={estilos.linea}>Más de {mm(programar)}: sin aviso</Text>
        </View>
      ) : null}
      {veredicto && !veredicto.permitido ? <Aviso tono="advertencia" titulo={veredicto.mensaje ?? "Límites incoherentes"} /> : null}
      {error ? <Aviso tono="advertencia" titulo="No se pudo" detalle={error} /> : null}
      {guardado ? (
        <Aviso tono="exito" titulo="Límites guardados" detalle="Los teléfonos los reciben en la próxima sincronización." />
      ) : null}

      <Boton
        testID="guardar-limites"
        cargando={guardando}
        deshabilitado={!completos || !veredicto?.permitido}
        onPress={() => void guardar()}
      >
        Guardar límites
      </Boton>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.md, paddingBottom: espacio.xxl },
  centrado: { flex: 1, justifyContent: "center", padding: espacio.lg, gap: espacio.md, backgroundColor: colores.fondo },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  resumen: { gap: espacio.xs, padding: espacio.md, borderRadius: 8, borderWidth: 1, borderColor: colores.borde },
  linea: { ...texto.cuerpo, color: colores.texto },
});
