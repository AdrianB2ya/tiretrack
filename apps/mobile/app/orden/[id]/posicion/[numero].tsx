import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { EditorPosicion, type CatalogoEditor } from "../../../../src/ordenes/EditorPosicion";
import {
  borradorDesde,
  borradorNuevo,
  copiarDeHermana,
  type BorradorMedicion,
} from "../../../../src/ordenes/reglasEditorPosicion";
import { hermanaCapturada } from "../../../../src/ordenes/diagrama";
import { useDatos, type DatosOrden } from "../../../../src/app/ProveedorDatos";
import { useUsuario } from "../../../../src/app/ProveedorSesion";
import { Vacio } from "../../../../src/diseno/componentes";
import { colores } from "../../../../src/diseno/tokens";

/**
 * Captura de una posición.
 *
 * Al guardar, lleva directo a la siguiente posición sin capturar en vez de
 * volver al diagrama. Con 22 posiciones eso son 22 vueltas evitadas, y el
 * técnico captura de corrido como trabaja.
 */
export default function PantallaPosicion() {
  const { id, numero } = useLocalSearchParams<{ id: string; numero: string }>();
  const router = useRouter();
  const { cargarOrden, guardarMedicion, catalogoPara } = useDatos();
  const usuario = useUsuario();

  const posicion = Number(numero);
  const [datos, setDatos] = useState<DatosOrden | null>(null);
  const [borrador, setBorrador] = useState<BorradorMedicion | null>(null);
  const [catalogo, setCatalogo] = useState<CatalogoEditor | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Carga inicial: la orden y el borrador de esta posición.
  useEffect(() => {
    let vigente = true;
    void (async () => {
      if (!id) return;
      const d = await cargarOrden(id);
      if (!vigente || !d) return;

      const casilla = [...d.diagrama.ejes]
        .flatMap((e) => [...e.izquierda, ...e.derecha])
        .find((c) => c.numero === posicion);
      if (!casilla) return;

      const previa = d.mediciones.find((m) => m.posicion === posicion);
      setDatos(d);
      // Si ya se capturó, se reanuda con lo que había en vez de empezar de
      // cero: el técnico entra a corregir un dato, no a rehacer la posición.
      setBorrador(previa ? borradorDesde(previa) : borradorNuevo(casilla));
    })();
    return () => {
      vigente = false;
    };
  }, [id, posicion, cargarOrden]);

  // El catálogo se recarga al cambiar marca o diseño: solo entonces hacen
  // falta los niveles siguientes.
  useEffect(() => {
    let vigente = true;
    void (async () => {
      if (!datos || !borrador) return;
      const casilla = [...datos.diagrama.ejes]
        .flatMap((e) => [...e.izquierda, ...e.derecha])
        .find((c) => c.numero === posicion);

      const c = await catalogoPara(borrador.marcaId, borrador.disenoId, casilla?.tipoEje ?? "multiuso");
      if (vigente) setCatalogo(c);
    })();
    return () => {
      vigente = false;
    };
  }, [datos, borrador?.marcaId, borrador?.disenoId, posicion, catalogoPara, borrador]);

  const guardar = useCallback(async () => {
    if (!datos || !borrador || !id) return;
    setGuardando(true);
    try {
      await guardarMedicion({
        ordenId: id,
        posicion: borrador.posicion,
        marcaId: borrador.marcaId,
        disenoId: borrador.disenoId,
        medida: borrador.medida,
        numCalor: borrador.numCalor,
        serial: borrador.serial,
        dot: borrador.dot,
        estadoLlanta: borrador.estadoLlanta,
        psiEncontrada: borrador.psiEncontrada,
        psiCalibrado: borrador.psiCalibrado,
        profundidad: borrador.profundidad,
        observaciones: borrador.observaciones,
        noIdentificada: borrador.noIdentificada,
        motivoNoId: borrador.motivoNoId,
        // Quien mide sale de la sesión. Antes iba el id de la ORDEN: toda
        // medición quedaba atribuida a un usuario inexistente y se perdía
        // la trazabilidad de quién midió qué.
        capturadoPorId: usuario.id,
        servicios: borrador.servicios,
      });

      // El diagrama recién guardado todavía no incluye esta posición, así que
      // se calcula la siguiente descontándola.
      const faltantes = datos.diagrama.faltantes.filter((n) => n !== posicion);
      const siguiente = faltantes.find((n) => n > posicion) ?? faltantes[0];

      if (siguiente !== undefined) {
        router.replace(`/orden/${id}/posicion/${siguiente}` as never);
      } else {
        // No queda ninguna: se vuelve al diagrama, que es donde se cierra.
        router.back();
      }
    } finally {
      setGuardando(false);
    }
  }, [datos, borrador, id, guardarMedicion, posicion, router, usuario.id]);

  const copiar = useCallback(() => {
    if (!datos || !borrador) return;
    const numeroHermana = hermanaCapturada(datos.diagrama, posicion);
    const origen = datos.mediciones.find((m) => m.posicion === numeroHermana);
    if (origen) setBorrador(copiarDeHermana(borrador, origen));
  }, [datos, borrador, posicion]);

  if (!datos || !borrador || !catalogo) {
    return (
      <View style={estilos.centrado}>
        <ActivityIndicator color={colores.primario} />
      </View>
    );
  }

  const casilla = [...datos.diagrama.ejes]
    .flatMap((e) => [...e.izquierda, ...e.derecha])
    .find((c) => c.numero === posicion);

  if (!casilla) {
    return <Vacio mensaje={`La posición ${posicion} no existe en este vehículo`} />;
  }

  const numeroHermana = hermanaCapturada(datos.diagrama, posicion);

  return (
    <EditorPosicion
      casilla={casilla}
      borrador={borrador}
      catalogo={catalogo}
      onCambiar={setBorrador}
      onGuardar={() => void guardar()}
      onCancelar={() => router.back()}
      guardando={guardando}
      hermanaCapturada={numeroHermana}
      onCopiarHermana={numeroHermana ? copiar : undefined}
    />
  );
}

const estilos = StyleSheet.create({
  centrado: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colores.fondo,
  },
});
