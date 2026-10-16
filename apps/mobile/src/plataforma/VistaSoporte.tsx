import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { fechaHoraEnColombia } from "@tiretrack/domain";
import { Aviso, Boton, Opcion, Tarjeta, Vacio } from "../diseno/componentes";
import { colores, espacio, texto } from "../diseno/tokens";
import { PantallaAuditoria, type PaginaAuditoria } from "../admin/PantallaAuditoria";
import { PantallaTablero, type FuentesTablero, type Tablero } from "../informe/PantallaTablero";
import type { RespuestaEnLinea, SesionSoporte } from "./soporte";
import { fechaHoraCorta } from "../diseno/formato";

/**
 * Vista de soporte (R16): lo que el superadmin ve dentro de una empresa, en
 * línea y de solo lectura. El aviso de arriba no se puede cerrar: quien mira
 * tiene que saber en todo momento que está en la empresa de otro y que todo
 * queda registrado.
 */

type EnLinea = <T>(metodo: "GET" | "POST", ruta: string, cuerpo?: unknown) => Promise<RespuestaEnLinea<T>>;

interface UsuarioVisto {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
}

type Seccion = "auditoria" | "indicadores" | "usuarios";

export function VistaSoporte({
  sesion,
  enLinea,
  onTerminada,
  ahora = () => new Date(),
}: {
  sesion: SesionSoporte;
  enLinea: EnLinea;
  onTerminada: () => void;
  ahora?: () => Date;
}) {
  const [seccion, setSeccion] = useState<Seccion>("auditoria");
  const [terminando, setTerminando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vencida = new Date(sesion.expiraEn).getTime() <= ahora().getTime();

  const cargarAuditoria = useCallback((consulta: string) => enLinea<PaginaAuditoria>("GET", `/auditoria${consulta}`), [enLinea]);
  const fuentesTablero = useMemo<FuentesTablero>(() => ({ cargar: () => enLinea<Tablero>("GET", "/tablero") }), [enLinea]);

  const terminar = async () => {
    setTerminando(true);
    try {
      const r = await enLinea("POST", "/plataforma/soporte/terminar", {});
      // Terminada o ya vencida en el servidor: en los dos casos se sale.
      if (r.ok || r.status === 401) return onTerminada();
      setError(r.mensaje);
    } finally {
      setTerminando(false);
    }
  };

  return (
    <View style={estilos.pantalla}>
      <View style={estilos.cabecera}>
        <Aviso
          tono="advertencia"
          titulo={`Soporte en ${sesion.empresa.nombre} · solo lectura`}
          detalle={
            vencida
              ? "La sesión de soporte venció. Termínala y abre otra si hace falta."
              : `Vence ${fechaHoraCorta(fechaHoraEnColombia(sesion.expiraEn))}. Todo lo que consultes y descargues queda en la auditoría de la empresa.`
          }
        />
        <View style={estilos.fila}>
          <Opcion etiqueta="Auditoría" activa={seccion === "auditoria"} onPress={() => setSeccion("auditoria")} testID="soporte-auditoria" />
          <Opcion etiqueta="Indicadores" activa={seccion === "indicadores"} onPress={() => setSeccion("indicadores")} testID="soporte-indicadores" />
          <Opcion etiqueta="Usuarios" activa={seccion === "usuarios"} onPress={() => setSeccion("usuarios")} testID="soporte-usuarios" />
        </View>
        <Boton tipo="peligro" ancho testID="terminar-soporte" cargando={terminando} onPress={() => void terminar()}>
          Terminar la sesión de soporte
        </Boton>
        {error ? <Aviso tono="advertencia" titulo="No se terminó" detalle={error} /> : null}
      </View>
      <View style={estilos.cuerpo}>
        {seccion === "auditoria" ? <PantallaAuditoria cargar={cargarAuditoria} /> : null}
        {seccion === "indicadores" ? <PantallaTablero fuentes={fuentesTablero} /> : null}
        {seccion === "usuarios" ? <UsuariosDeSoporte enLinea={enLinea} /> : null}
      </View>
    </View>
  );
}

function UsuariosDeSoporte({ enLinea }: { enLinea: EnLinea }) {
  const [usuarios, setUsuarios] = useState<UsuarioVisto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void enLinea<UsuarioVisto[]>("GET", "/usuarios").then((r) => {
      if (r.ok && Array.isArray(r.datos)) setUsuarios(r.datos);
      else setError(r.ok ? "La respuesta llegó incompleta" : r.mensaje);
    });
  }, [enLinea]);
  if (error) return <Aviso tono="advertencia" titulo="No se pudo cargar" detalle={error} />;
  if (!usuarios) return <Vacio mensaje="Cargando usuarios…" />;
  return (
    <ScrollView contentContainerStyle={estilos.lista}>
      {usuarios.map((u) => (
        <Tarjeta key={u.id} testID={`usuario-${u.id}`}>
          <Text style={estilos.nombre}>{u.nombre}</Text>
          <Text style={estilos.detalle}>
            {u.email} · {u.rol}
            {u.activo === false ? " · desactivado" : ""}
          </Text>
        </Tarjeta>
      ))}
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  cabecera: { padding: espacio.lg, gap: espacio.sm },
  cuerpo: { flex: 1 },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: espacio.sm },
  lista: { padding: espacio.lg, gap: espacio.md },
  nombre: { ...texto.cuerpoFuerte, color: colores.texto },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
});
