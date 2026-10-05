import {
  codigoReferencia,
  nuevoId,
  puedeAprobar,
  type Prioridad,
  type Rol,
  type TipoServicio,
} from "@tiretrack/domain";
import { zFechaISO } from "@tiretrack/contracts";

/**
 * Orden nueva: reglas del formulario y armado de la orden.
 *
 * Dos entradas, una sola lógica:
 * - **Coordinador o administrador**: la programa para un técnico de su sede.
 *   Nace `programada`; el folio lo asigna el servidor al sincronizar.
 * - **Técnico**: la imprevista que encuentra en campo, para sí mismo. Nace
 *   `en_proceso`, quizá sin señal.
 *
 * Toda orden nace con un código de referencia (FUN-K7M2): sin señal es lo
 * único que la identifica hasta que llega el folio, y después queda como
 * referencia secundaria para poder buscarla.
 */

export interface FormularioOrden {
  readonly sedeId: string | null;
  readonly clienteId: string | null;
  readonly sedeClienteId: string | null;
  readonly vehiculoId: string | null;
  readonly tecnicoId: string | null;
  readonly tipo: TipoServicio;
  readonly prioridad: Prioridad;
  readonly fecha: string;
  readonly sinConductor: boolean;
  readonly conductorNombre: string;
  readonly nota: string;
}

export interface QuienCrea {
  readonly usuarioId: string;
  readonly rol: Rol;
  /** Sedes de la empresa a las que pertenece (de la sesión). */
  readonly sedes: readonly string[];
}

export type CampoOrden = keyof FormularioOrden;
export type ProblemaOrden = { campo: CampoOrden; mensaje: string };

export function formularioVacio(hoy: string, quien: QuienCrea): FormularioOrden {
  return {
    // Con una sola sede no hay nada que elegir.
    sedeId: quien.sedes.length === 1 ? (quien.sedes[0] ?? null) : null,
    clienteId: null,
    sedeClienteId: null,
    vehiculoId: null,
    // El técnico se asigna la imprevista a sí mismo.
    tecnicoId: quien.rol === "tecnico" ? quien.usuarioId : null,
    tipo: quien.rol === "tecnico" ? "correctivo" : "preventivo",
    prioridad: "normal",
    fecha: hoy,
    sinConductor: false,
    conductorNombre: "",
    nota: "",
  };
}

/** ¿Quién puede crear órdenes? Todos menos el cliente. */
export function puedeCrearOrden(rol: Rol): boolean {
  return rol === "tecnico" || puedeAprobar(rol);
}

/**
 * Cambiar un nivel de la cascada limpia los que dependen de él: un vehículo
 * de otro cliente sería una orden imposible (y el servidor la rechazaría).
 */
export function cambiar<K extends CampoOrden>(
  f: FormularioOrden,
  campo: K,
  valor: FormularioOrden[K],
  quien: QuienCrea,
): FormularioOrden {
  const n = { ...f, [campo]: valor };
  if (campo === "clienteId") return { ...n, sedeClienteId: null, vehiculoId: null };
  if (campo === "sedeClienteId") return { ...n, vehiculoId: null };
  // El técnico elegido puede no pertenecer a la sede nueva: se limpia. El
  // técnico que crea la suya sigue asignado a sí mismo.
  if (campo === "sedeId" && f.sedeId !== valor && quien.rol !== "tecnico") return { ...n, tecnicoId: null };
  return n;
}

export function revisarOrden(f: FormularioOrden, quien: QuienCrea): ProblemaOrden[] {
  const p: ProblemaOrden[] = [];
  if (!f.sedeId) p.push({ campo: "sedeId", mensaje: "Elige la sede que atiende" });
  else if (!quien.sedes.includes(f.sedeId)) {
    p.push({ campo: "sedeId", mensaje: "Solo puedes crear órdenes en tus sedes" });
  }
  if (!f.clienteId) p.push({ campo: "clienteId", mensaje: "Elige el cliente" });
  if (!f.sedeClienteId) p.push({ campo: "sedeClienteId", mensaje: "Elige la sede del cliente" });
  if (!f.vehiculoId) p.push({ campo: "vehiculoId", mensaje: "Elige el vehículo" });
  if (!f.tecnicoId) p.push({ campo: "tecnicoId", mensaje: "Elige el técnico" });
  // Lo exige el contrato: quién entrega el vehículo, o constancia de que no hubo nadie.
  if (!f.sinConductor && !f.conductorNombre.trim()) {
    p.push({ campo: "conductorNombre", mensaje: "Escribe quién entrega el vehículo, o marca que está sin conductor" });
  }
  // La misma validación que el servidor: 2026-02-31 no existe.
  if (!zFechaISO.safeParse(f.fecha).success) p.push({ campo: "fecha", mensaje: "Fecha inválida: usa AAAA-MM-DD" });
  if (f.nota.length > 2000) p.push({ campo: "nota", mensaje: "Máximo 2000 caracteres" });
  return p;
}

export interface VehiculoElegido {
  readonly id: string;
  readonly configuracionEjeId: string;
  readonly kmActual: number;
}

/** Lo que se guarda en el celular y se encola para el servidor. */
export function armarOrden(
  f: FormularioOrden,
  quien: QuienCrea,
  vehiculo: VehiculoElegido,
  codigoSede: string,
  generarId: () => string = nuevoId,
) {
  const tecnico = quien.rol === "tecnico";
  const id = generarId();
  return {
    id,
    clientRequestId: generarId(),
    codigoReferencia: codigoReferencia(codigoSede),
    sedeId: f.sedeId as string,
    clienteId: f.clienteId as string,
    sedeClienteId: f.sedeClienteId as string,
    vehiculoId: vehiculo.id,
    // El técnico solo se asigna órdenes a sí mismo, diga lo que diga el formulario.
    tecnicoId: tecnico ? quien.usuarioId : (f.tecnicoId as string),
    // La plantilla del vehículo se congela en la orden.
    configuracionEjeId: vehiculo.configuracionEjeId,
    tipo: f.tipo,
    prioridad: f.prioridad,
    // Así la nombra el servidor: el técnico la ejecuta ya; el coordinador la programa.
    estado: tecnico ? "en_proceso" : "programada",
    fecha: f.fecha,
    sinConductor: f.sinConductor,
    conductorNombre: f.sinConductor ? null : f.conductorNombre.trim(),
    notaCoordinador: tecnico ? null : f.nota.trim() || null,
  };
}
