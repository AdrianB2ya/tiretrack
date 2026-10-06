import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { DiagramaLlantas, ResumenDiagrama } from "../../../../src/ordenes/DiagramaLlantas";
import { Aviso, Boton, Insignia } from "../../../../src/diseno/componentes";
import { useDatos, type DatosOrden } from "../../../../src/app/ProveedorDatos";
import { useUsuario } from "../../../../src/app/ProveedorSesion";
import { accionesDisponibles, requisitosParaEnviar, resumirFirma } from "../../../../src/ordenes/detalle";
import { siguienteSinCapturar } from "../../../../src/ordenes/diagrama";
import { FotosDe } from "../../../../src/fotos/FotosDe";
import { DecisionCliente } from "../../../../src/cliente/DecisionCliente";
import { camaraDelDispositivo, manipuladorDelDispositivo } from "../../../../src/fotos/captura";
import { estaAbierta, fechaEnColombia, MAXIMO_POR_ORDEN, puedeAprobar, puedeGestionarRecomendaciones, type EstadoOrden } from "@tiretrack/domain";
import { colores, espacio, estadosOrden, texto } from "../../../../src/diseno/tokens";
import { OrdenNoDisponible } from "../../../../src/ordenes/OrdenNoDisponible";
import { Recomendaciones } from "../../../../src/ordenes/Recomendaciones";
import type { RecomendacionLocal } from "../../../../src/datos/repositorio";
import { BotonPdf } from "../../../../src/ordenes/BotonPdf";
import { bajarACache, compartirUri } from "../../../../src/informe/compartirArchivo";
import { useServicios } from "../../../../src/app/Arranque";

/**
 * Detalle de la orden con su diagrama.
 *
 * Al volver del editor se recarga: el diagrama tiene que reflejar la posición
 * que se acaba de guardar, o el técnico no sabe si quedó.
 */
export default function PantallaDetalle() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { cargarOrden, ordenes, fotosSinSubir, fotosDe, adjuntarFoto, cambiarEstado, recomendacionesDe, crearRecomendacion, resolverRecomendacion } = useDatos();
  const [recomendaciones, setRecomendaciones] = useState<RecomendacionLocal[]>([]);
  const { descargarArchivo } = useServicios();

  // Aprobar cierra la orden; objetar la devuelve al técnico con el motivo.
  const decidirCliente = async (estado: "cerrada" | "en_proceso", motivo?: string) => {
    if (!id) return;
    setDecidiendo(true);
    try {
      await cambiarEstado(id, estado, motivo);
      router.replace("/cliente" as never);
    } finally {
      setDecidiendo(false);
    }
  };
  const usuario = useUsuario();
  const [datos, setDatos] = useState<DatosOrden | null | undefined>(undefined);
  const [sinSubir, setSinSubir] = useState(0);
  const [decidiendo, setDecidiendo] = useState(false);

  const recargar = useCallback(async () => {
    if (!id) return;
    const d = await cargarOrden(id);
    setDatos(d);
    // Antes era un 0 fijo: el aviso de fotos sin enviar nunca aparecía.
    setSinSubir(await fotosSinSubir(id));
    if (d) setRecomendaciones(await recomendacionesDe(d.orden.id, d.orden.vehiculoId));
  }, [id, cargarOrden, fotosSinSubir, recomendacionesDe]);

  // `ordenes` cambia tras cada guardado: recargar entonces mantiene el
  // diagrama al día sin tener que avisar manualmente desde el editor.
  useEffect(() => {
    void recargar();
  }, [recargar, ordenes]);

  // null: no está en el teléfono. Antes la rueda giraba para siempre.
  if (datos === null) return <OrdenNoDisponible />;
  if (!datos) {
    return (
      <View style={estilos.centrado}>
        <ActivityIndicator color={colores.primario} />
      </View>
    );
  }

  const { orden, diagrama } = datos;
  const estado = estadosOrden[orden.estado as keyof typeof estadosOrden];

  // Los nombres de la flota; si aún no se descargó, el identificador, que al
  // menos se puede buscar y dictar por teléfono.
  const ctx = datos.contexto;
  const detalle = {
    orden,
    vehiculoCodigo: ctx?.vehiculoCodigo ?? orden.vehiculoId,
    vehiculoPlaca: ctx?.vehiculoPlaca ?? null,
    clienteNombre: ctx?.clienteNombre ?? orden.clienteId,
    sedeClienteNombre: ctx?.sedeClienteNombre ?? "",
    mediciones: datos.mediciones,
    posicionesTotales: diagrama.totalPosiciones,
    fotosSinSubir: sinSubir,
  };
  const acciones = accionesDisponibles(detalle, { usuarioId: usuario.id, rol: usuario.rol });
  const capturar = acciones.find((a) => a.accion === "capturar");
  const firmar = acciones.find((a) => a.accion === "firmar");
  const enviar = acciones.find((a) => a.accion === "enviar");
  const firma = resumirFirma(orden);
  // Continuar donde quedó: la primera posición sin capturar.
  const siguiente = siguienteSinCapturar(diagrama, 0);
  // El coordinador no captura: decide. Sin estos accesos no podía aprobar,
  // devolver ni reasignar desde la app.
  const gestor = puedeAprobar(usuario.rol);
  const esCliente = usuario.rol === "cliente";
  const abierta = estaAbierta(orden.estado as EstadoOrden);

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <View style={estilos.cabecera}>
        <Text style={estilos.folio}>{orden.folio ?? orden.codigoReferencia ?? "Sin folio"}</Text>
        {estado ? <Insignia color={estado.color}>{estado.etiqueta}</Insignia> : null}
      </View>
      <Text style={estilos.vehiculo}>
        {detalle.vehiculoCodigo}
        {detalle.vehiculoPlaca ? ` · ${detalle.vehiculoPlaca}` : ""}
      </Text>
      <Text style={estilos.cliente}>
        {detalle.clienteNombre}
        {detalle.sedeClienteNombre ? ` · ${detalle.sedeClienteNombre}` : ""}
      </Text>

      {orden.motivoDevolucion ? (
        <Aviso tono="peligro" titulo="Devuelta para corregir" detalle={orden.motivoDevolucion} />
      ) : null}
      {orden.notaCoordinador ? (
        <Aviso tono="info" titulo="Instrucciones" detalle={orden.notaCoordinador} />
      ) : null}

      <ResumenDiagrama diagrama={diagrama} />
      <DiagramaLlantas
        diagrama={diagrama}
        // El cliente consulta; no abre el editor de una posición.
        onTocarPosicion={(n) => !esCliente && router.push(`/orden/${orden.id}/posicion/${n}` as never)}
      />

      {/* Fotos de la orden en general (placa, odómetro, estado del vehículo);
          las de cada llanta se toman en su posición. */}
      <FotosDe
        destino={{ ordenId: orden.id, medicionId: null, posicion: null }}
        cargar={() => fotosDe(orden.id, null)}
        dependencias={{ camara: camaraDelDispositivo, manipulador: manipuladorDelDispositivo, adjuntar: adjuntarFoto }}
        maximo={MAXIMO_POR_ORDEN}
        deshabilitada={!capturar?.habilitada}
      />
      {/* La evidencia que está en el servidor, la haya tomado quien sea: antes
          cada teléfono veía solo las suyas. */}
      <Boton tipo="secundario" ancho testID="ver-evidencia" onPress={() => router.push(`/orden/${orden.id}/fotos` as never)}>
        Ver la evidencia en el servidor
      </Boton>
      <BotonPdf
        descargar={() => descargarArchivo(`/ordenes/${orden.id}/pdf`, bajarACache(`${orden.folio ?? orden.codigoReferencia ?? "orden"}.pdf`))}
        compartir={(uri) => compartirUri(uri, "application/pdf")}
      />

      <Recomendaciones
        ordenId={orden.id}
        recomendaciones={recomendaciones}
        bloqueo={(() => {
          // Quién: el usuario de la SESIÓN, nunca el de la orden (4.4).
          const v = puedeGestionarRecomendaciones({ rol: usuario.rol, esTecnicoAsignado: orden.tecnicoId === usuario.id, estadoOrden: orden.estado });
          return v.permitido ? null : (v.mensaje ?? "No se pueden registrar recomendaciones aquí");
        })()}
        onCrear={async (r) => {
          await crearRecomendacion({ ordenId: orden.id, vehiculoId: orden.vehiculoId, ...r });
          await recargar();
        }}
        onResolver={async (rid, estado) => {
          await resolverRecomendacion(rid, estado, orden.id);
          await recargar();
        }}
      />

      {esCliente ? (
        <View style={estilos.requisitos}>
          {orden.kilometraje !== null ? <Text style={estilos.cliente}>Kilometraje: {orden.kilometraje.toLocaleString("es-CO")}</Text> : null}
          {orden.hallazgos ? <Text style={estilos.cliente}>Hallazgos: {orden.hallazgos}</Text> : null}
          {orden.accion ? <Text style={estilos.cliente}>Acción: {orden.accion}</Text> : null}
          {orden.firmaNombre ? <Text style={estilos.cliente}>Recibió: {orden.firmaNombre}</Text> : null}
        </View>
      ) : null}
      {esCliente && orden.estado === "pendiente_cliente" ? (
        <DecisionCliente
          limiteCliente={orden.limiteCliente}
          hoy={fechaEnColombia()}
          procesando={decidiendo}
          onAprobar={() => void decidirCliente("cerrada")}
          onObjetar={(motivo) => void decidirCliente("en_proceso", motivo)}
        />
      ) : null}

      {!esCliente ? (
      <>
      <View style={estilos.requisitos}>
        {requisitosParaEnviar(detalle).map((r) => (
          <Text key={r.clave} style={[estilos.requisito, r.cumplido && estilos.cumplido]}>
            {r.cumplido ? "✓" : "○"} {r.texto}
          </Text>
        ))}
      </View>

      {/* El motivo del bloqueo se muestra: un botón gris sin explicación en
          el patio termina en una llamada al coordinador. */}
      {enviar && !enviar.habilitada && enviar.motivo ? (
        <Aviso tono="advertencia" titulo="Falta para poder enviar" detalle={enviar.motivo} />
      ) : null}

      {/* Antes este botón no hacía nada: onPress={() => undefined}. */}
      <Boton
        ancho
        testID="continuar-captura"
        deshabilitado={!capturar?.habilitada || siguiente === null}
        onPress={() => siguiente !== null && router.push(`/orden/${orden.id}/posicion/${siguiente}` as never)}
      >
        {siguiente === null ? "Todas las posiciones capturadas" : `Continuar captura (posición ${siguiente})`}
      </Boton>

      <Boton
        ancho
        tipo="secundario"
        testID="datos-servicio"
        onPress={() => router.push(`/orden/${orden.id}/datos` as never)}
      >
        Kilometraje y hallazgos
      </Boton>

      {firmar && !firmar.habilitada && firmar.motivo && capturar?.habilitada ? (
        <Text style={estilos.motivo}>{firmar.motivo}</Text>
      ) : null}
      <Boton
        ancho
        tipo="secundario"
        testID="firmar"
        deshabilitado={!firmar?.habilitada}
        onPress={() => router.push(`/orden/${orden.id}/firma` as never)}
      >
        {firma.estado === "sin_firmar" ? "Firma de quien recibe" : "Volver a firmar"}
      </Boton>

      <Boton
        ancho
        tipo="secundario"
        deshabilitado={!capturar?.habilitada}
        onPress={() => router.push(`/orden/${orden.id}/enviar` as never)}
      >
        Revisar y enviar
      </Boton>
      </>
      ) : null}

      {gestor && orden.estado === "en_revision" ? (
        <Boton ancho testID="decidir" onPress={() => router.push(`/orden/${orden.id}/decidir` as never)}>
          Aprobar o devolver
        </Boton>
      ) : null}
      {gestor && abierta ? (
        <Boton ancho tipo="fantasma" testID="reasignar" onPress={() => router.push(`/orden/${orden.id}/reasignar` as never)}>
          Reasignar a otro técnico
        </Boton>
      ) : null}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.lg, gap: espacio.lg },
  centrado: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
  cabecera: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  folio: { ...texto.codigo, color: colores.primario },
  vehiculo: { ...texto.subtitulo, color: colores.texto },
  cliente: { ...texto.cuerpo, color: colores.textoTenue },
  motivo: { ...texto.ayuda, color: colores.advertencia },
  requisitos: { gap: espacio.sm },
  requisito: { ...texto.cuerpo, color: colores.textoTenue },
  cumplido: { color: colores.exito },
});
