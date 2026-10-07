import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Aviso, Boton, Insignia, Tarjeta } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import { describirCambio, situacionDe, type CambioSinEnviar } from "./cambios";

/**
 * Los cambios que siguen en el celular, uno por uno, con qué les pasa.
 *
 * Un rechazado se puede reintentar (después de corregir la causa) o
 * descartar. Descartar pide un segundo toque y dice lo que implica: es
 * trabajo real que no llegará al servidor.
 */
export function CambiosSinEnviar({ fuentes, version }: {
  fuentes: {
    listar(): Promise<CambioSinEnviar[]>;
    reintentar(id: string): Promise<void>;
    descartar(id: string): Promise<void>;
  };
  /** Cambia cuando algo pudo mover la cola (una sincronización): vuelve a leer. */
  version?: unknown;
}) {
  const [cambios, setCambios] = useState<CambioSinEnviar[] | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const cargar = useCallback(async () => setCambios(await fuentes.listar()), [fuentes]);
  useEffect(() => {
    void cargar();
  }, [cargar, version]);

  if (!cambios || cambios.length === 0) return null;

  const apartados = cambios.filter((c) => situacionDe(c).apartado).length;
  return (
    <View style={estilos.bloque}>
      <Text style={estilos.titulo}>
        {cambios.length} {cambios.length === 1 ? "cambio sin enviar" : "cambios sin enviar"}
      </Text>
      {apartados > 0 ? (
        <Aviso
          tono="advertencia"
          titulo={apartados === 1 ? "Uno fue rechazado por el servidor" : `${apartados} fueron rechazados por el servidor`}
          detalle="No se envían solos. Revisa el motivo: reintenta si ya se corrigió, o descártalo si ya no hace falta."
        />
      ) : null}
      {cambios.map((c) => {
        const s = situacionDe(c);
        return (
          <Tarjeta key={c.id} testID={`cambio-${c.id}`}>
            <View style={estilos.fila}>
              <Text style={estilos.nombre}>{describirCambio(c)}</Text>
              <Insignia color={s.apartado ? colores.peligro : colores.advertencia} compacta>
                {s.apartado ? "Rechazado" : "Pendiente"}
              </Insignia>
            </View>
            <Text style={estilos.detalle}>{s.texto}</Text>
            {s.apartado ? (
              <View style={estilos.acciones}>
                <Boton
                  tipo="secundario"
                  testID={`reintentar-${c.id}`}
                  onPress={() => void fuentes.reintentar(c.id).then(cargar)}
                >
                  Reintentar
                </Boton>
                <Boton
                  tipo={confirmando === c.id ? "peligro" : "fantasma"}
                  testID={`descartar-${c.id}`}
                  onPress={() => {
                    if (confirmando !== c.id) return setConfirmando(c.id);
                    setConfirmando(null);
                    void fuentes.descartar(c.id).then(cargar);
                  }}
                >
                  {confirmando === c.id ? "Sí, descartar" : "Descartar"}
                </Boton>
              </View>
            ) : null}
            {confirmando === c.id ? (
              <Text style={estilos.detalle}>
                Este cambio no llegará nunca al servidor. Lo que quedó en el celular no se borra.
              </Text>
            ) : null}
          </Tarjeta>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  bloque: { gap: espacio.sm },
  titulo: { ...texto.subtitulo, color: colores.texto },
  fila: { flexDirection: "row", alignItems: "center", gap: espacio.sm, flexWrap: "wrap" },
  nombre: { ...texto.cuerpoFuerte, color: colores.texto, flexShrink: 1 },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  acciones: { flexDirection: "row", gap: espacio.sm, flexWrap: "wrap" },
});
