import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { zCrearSede, zUsuarioBase } from "@tiretrack/contracts";
import { DURACION_SOPORTE, OPCIONES_DURACION_SOPORTE, validarSoporte } from "@tiretrack/domain";
import { Aviso, Boton, Campo, Insignia, Tarjeta, Vacio } from "../diseno/componentes";
import { ElegirUno } from "../diseno/ListaBuscable";
import type { SesionSoporte } from "./soporte";
import { colores, espacio, texto } from "../diseno/tokens";
import { mensajeActivacion } from "../admin/reglasAdmin";

/**
 * Empresas de la plataforma (R16): el superadmin las lista y da de alta una
 * nueva sin scripts. El alta crea la empresa, su primera sede, los servicios
 * del catálogo y su administrador; el administrador recibe un código de
 * activación que se muestra UNA vez, listo para WhatsApp. Lo demás lo hace él
 * desde su cuenta. En línea.
 */

type R<T> = { ok: true; datos: T } | { ok: false; mensaje: string };

export interface EmpresaListada {
  id: string;
  nombre: string;
  nit: string;
  activa: boolean;
  creadaEn: string;
}

export interface FormEmpresa {
  nombre: string;
  nit: string;
  sedeNombre: string;
  sedeCodigo: string;
  sedeCiudad: string;
  adminNombre: string;
  adminCedula: string;
  adminEmail: string;
  adminTelefono: string;
}

export interface FuentesEmpresas {
  empresas(): Promise<R<EmpresaListada[]>>;
  crear(f: FormEmpresa): Promise<R<{ codigo: string | null; expiraEn: string | null }>>;
  compartir(mensaje: string): void;
  /** Sesión de soporte (R16): motivo, ticket y duración, en esa empresa. */
  abrirSoporte?(empresaId: string, d: { motivo: string; ticket: string; minutos: number }): Promise<R<SesionSoporte>>;
  onSoporteAbierto?(s: SesionSoporte): void;
}

const VACIO: FormEmpresa = {
  nombre: "", nit: "", sedeNombre: "", sedeCodigo: "", sedeCiudad: "",
  adminNombre: "", adminCedula: "", adminEmail: "", adminTelefono: "",
};

/** Las mismas reglas del servidor, antes de gastar señal. */
export function revisarEmpresa(f: FormEmpresa): string[] {
  const p: string[] = [];
  if (f.nombre.trim().length < 2) p.push("Nombre de la empresa");
  if (f.nit.trim().length < 5) p.push("NIT");
  const sede = zCrearSede.pick({ nombre: true, codigo: true }).safeParse({ nombre: f.sedeNombre, codigo: f.sedeCodigo });
  if (!sede.success) p.push(...sede.error.issues.map((i) => `Sede: ${String(i.path[0])}`));
  const admin = zUsuarioBase
    .pick({ nombre: true, cedula: true, email: true })
    .safeParse({ nombre: f.adminNombre, cedula: f.adminCedula, email: f.adminEmail });
  if (!admin.success) p.push(...admin.error.issues.map((i) => `Administrador: ${String(i.path[0])}`));
  return p;
}

type Modo =
  | { tipo: "lista" }
  | { tipo: "nueva" }
  | { tipo: "codigo"; nombre: string; codigo: string; expiraEn: string }
  | { tipo: "soporte"; empresa: EmpresaListada };

export function EmpresasPlataforma({ fuentes }: { fuentes: FuentesEmpresas }) {
  const [empresas, setEmpresas] = useState<EmpresaListada[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>({ tipo: "lista" });
  const [f, setF] = useState<FormEmpresa>(VACIO);
  const [enviando, setEnviando] = useState(false);
  const [intento, setIntento] = useState(false);

  const recargar = useCallback(async () => {
    const r = await fuentes.empresas();
    if (r.ok && Array.isArray(r.datos)) {
      setEmpresas(r.datos);
      setError(null);
    } else setError(r.ok ? "La respuesta llegó incompleta" : r.mensaje);
  }, [fuentes]);
  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (modo.tipo === "codigo") {
    const mensaje = mensajeActivacion(modo.nombre, modo.codigo, modo.expiraEn);
    return (
      <View style={estilos.bloque}>
        <Text style={estilos.subtitulo}>Código de activación de {modo.nombre}</Text>
        <Text style={estilos.codigo} selectable testID="codigo-activacion">
          {modo.codigo}
        </Text>
        <Aviso tono="advertencia" titulo="Se muestra una sola vez" detalle="Envíalo ahora. Si se pierde, el administrador de la empresa no podrá entrar hasta que se le genere otro." />
        <Boton ancho testID="compartir-codigo" onPress={() => fuentes.compartir(mensaje)}>
          Enviar por WhatsApp u otra app
        </Boton>
        <Boton ancho tipo="fantasma" testID="listo" onPress={() => setModo({ tipo: "lista" })}>
          Listo
        </Boton>
      </View>
    );
  }

  if (modo.tipo === "soporte") {
    return <AbrirSoporte empresa={modo.empresa} fuentes={fuentes} onCancelar={() => setModo({ tipo: "lista" })} />;
  }

  if (modo.tipo === "nueva") {
    const problemas = revisarEmpresa(f);
    const campo = (k: keyof FormEmpresa, etiqueta: string, extra: object = {}) => (
      <Campo etiqueta={etiqueta} value={f[k]} onChangeText={(v: string) => setF({ ...f, [k]: v })} testID={`empresa-${k}`} {...extra} />
    );
    const crear = async () => {
      setIntento(true);
      if (problemas.length > 0) return;
      setEnviando(true);
      try {
        const r = await fuentes.crear(f);
        if (!r.ok) return setError(r.mensaje);
        setError(null);
        await recargar();
        if (r.datos.codigo && r.datos.expiraEn) {
          setModo({ tipo: "codigo", nombre: f.adminNombre.trim(), codigo: r.datos.codigo, expiraEn: r.datos.expiraEn });
        } else setModo({ tipo: "lista" });
        setF(VACIO);
        setIntento(false);
      } finally {
        setEnviando(false);
      }
    };
    return (
      <View style={estilos.bloque}>
        <Text style={estilos.subtitulo}>Nueva empresa</Text>
        {campo("nombre", "Nombre de la empresa")}
        {campo("nit", "NIT", { keyboardType: "numeric" })}
        <Text style={estilos.etiqueta}>Primera sede</Text>
        {campo("sedeNombre", "Nombre de la sede")}
        {campo("sedeCodigo", "Código de la sede (va en el folio, ej. FUN)")}
        {campo("sedeCiudad", "Ciudad (opcional)")}
        <Text style={estilos.etiqueta}>Administrador de la empresa</Text>
        {campo("adminNombre", "Nombre")}
        {campo("adminCedula", "Cédula", { keyboardType: "numeric" })}
        {campo("adminEmail", "Correo", { keyboardType: "email-address", autoCapitalize: "none" })}
        {campo("adminTelefono", "Teléfono (opcional)", { keyboardType: "phone-pad" })}
        {intento && problemas.length > 0 ? <Aviso tono="advertencia" titulo="Revisa estos datos" detalle={problemas.join(" · ")} /> : null}
        {error ? <Aviso tono="advertencia" titulo="No se creó" detalle={error} /> : null}
        <Boton ancho testID="crear-empresa" cargando={enviando} onPress={() => void crear()}>
          Crear la empresa
        </Boton>
        <Boton ancho tipo="fantasma" onPress={() => setModo({ tipo: "lista" })}>
          Cancelar
        </Boton>
      </View>
    );
  }

  return (
    <View style={estilos.bloque}>
      <Text style={estilos.subtitulo}>Empresas</Text>
      <Boton ancho tipo="secundario" testID="nueva-empresa" onPress={() => setModo({ tipo: "nueva" })}>
        Dar de alta una empresa
      </Boton>
      {error ? <Aviso tono="advertencia" titulo="No se pudo cargar" detalle={error} /> : null}
      {empresas === null && !error ? <Vacio mensaje="Cargando empresas…" /> : null}
      {empresas?.map((e) => (
        <Tarjeta key={e.id} testID={`empresa-${e.id}`}>
          <View style={estilos.fila}>
            <Text style={estilos.nombre}>{e.nombre}</Text>
            {!e.activa ? <Insignia color={colores.advertencia}>Inactiva</Insignia> : null}
          </View>
          <Text style={estilos.detalle}>
            NIT {e.nit} · desde {e.creadaEn}
          </Text>
          {fuentes.abrirSoporte && e.activa ? (
            <Boton tipo="fantasma" testID={`soporte-${e.id}`} onPress={() => setModo({ tipo: "soporte", empresa: e })}>
              Abrir sesión de soporte
            </Boton>
          ) : null}
        </Tarjeta>
      ))}
    </View>
  );
}

/**
 * Abrir una sesión de soporte: por qué, qué ticket y por cuánto tiempo. Lo
 * que se escribe queda en la auditoría de la empresa, que ve su
 * administrador.
 */
function AbrirSoporte({ empresa, fuentes, onCancelar }: { empresa: EmpresaListada; fuentes: FuentesEmpresas; onCancelar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [ticket, setTicket] = useState("");
  const [minutos, setMinutos] = useState<number>(DURACION_SOPORTE.porDefecto);
  const [intento, setIntento] = useState(false);
  const [abriendo, setAbriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = validarSoporte({ motivo, ticket, minutos });

  const abrir = async () => {
    setIntento(true);
    if (!v.permitido || !fuentes.abrirSoporte) return;
    setAbriendo(true);
    try {
      const r = await fuentes.abrirSoporte(empresa.id, { motivo: motivo.trim(), ticket: ticket.trim(), minutos });
      if (!r.ok) return setError(r.mensaje);
      fuentes.onSoporteAbierto?.(r.datos);
    } finally {
      setAbriendo(false);
    }
  };

  return (
    <View style={estilos.bloque}>
      <Text style={estilos.subtitulo}>Soporte en {empresa.nombre}</Text>
      <Text style={estilos.detalle}>
        Solo lectura: podrás ver y descargar, no modificar. El motivo, el ticket y todo lo que consultes quedan en la
        auditoría de la empresa.
      </Text>
      <Campo etiqueta="Motivo" value={motivo} onChangeText={setMotivo} multiline testID="soporte-motivo" />
      <Campo etiqueta="Número de ticket" value={ticket} onChangeText={setTicket} autoCapitalize="characters" testID="soporte-ticket" />
      <ElegirUno
        enLinea
        etiqueta="Duración"
        testID="duracion"
        opciones={OPCIONES_DURACION_SOPORTE.map((n) => ({ id: String(n), texto: n < 60 ? `${n} min` : `${n / 60} h`, testID: `duracion-${n}` }))}
        seleccionado={String(minutos)}
        onElegir={(id) => setMinutos(Number(id) as typeof minutos)}
      />
      {intento && !v.permitido ? <Aviso tono="advertencia" titulo="Falta información" detalle={v.mensaje ?? ""} /> : null}
      {error ? <Aviso tono="advertencia" titulo="No se abrió" detalle={error} /> : null}
      <Boton ancho testID="abrir-soporte" cargando={abriendo} onPress={() => void abrir()}>
        Abrir la sesión
      </Boton>
      <Boton ancho tipo="fantasma" onPress={onCancelar}>
        Cancelar
      </Boton>
    </View>
  );
}

const estilos = StyleSheet.create({
  bloque: { gap: espacio.md },
  fila: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: espacio.sm },
  subtitulo: { ...texto.subtitulo, color: colores.texto },
  etiqueta: { ...texto.etiqueta, color: colores.texto },
  nombre: { ...texto.cuerpoFuerte, color: colores.texto, flexShrink: 1 },
  detalle: { ...texto.ayuda, color: colores.textoTenue },
  codigo: { ...texto.codigo, fontSize: 34, letterSpacing: 4, color: colores.primario, textAlign: "center" },
});
