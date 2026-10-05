import { zCrearCliente, zCrearSedeCliente, zCrearVehiculo } from "@tiretrack/contracts";
import { normalizar, puedeGestionarFlota, type Rol } from "@tiretrack/domain";

/**
 * Reglas de los formularios de flota.
 *
 * Se validan con los MISMOS contratos que el servidor: lo que aquí pasa, allá
 * pasa. Si el celular dejara pasar algo que el servidor rechaza, la operación
 * quedaría apartada y el cliente nunca llegaría.
 */

/** El técnico crea clientes y sedes: llega a una sede no registrada y tiene que trabajar. */
export function puedeCrearCliente(rol: Rol): boolean {
  return puedeGestionarFlota(rol) || rol === "tecnico";
}

/** Los vehículos son estructura: solo administrador y coordinador. */
export function puedeCrearVehiculo(rol: Rol): boolean {
  return puedeGestionarFlota(rol);
}

const ID_DE_PRUEBA = "00000000-0000-4000-8000-000000000000";
type Issues = { issues: { path: (string | number)[]; message: string }[] };
const problemas = (r: { success: boolean; error?: Issues }) =>
  r.success ? [] : (r.error?.issues ?? []).map((i) => ({ campo: String(i.path[0] ?? ""), mensaje: i.message }));

export type Problema = { campo: string; mensaje: string };

/** Solo los dígitos: "900.555.111-2" y "9005551112" son el mismo NIT. */
export const nitNormalizado = (nit: string) => nit.replace(/[^0-9]/g, "");

export function revisarCliente(
  c: { nombre: string; nit: string; contacto: string; telefono: string },
  existentes: readonly { nombre: string; nit: string | null }[],
): { problemas: Problema[]; aviso: string | null } {
  const p: Problema[] = problemas(
    zCrearCliente.safeParse({
      id: ID_DE_PRUEBA,
      nombre: c.nombre,
      nit: c.nit,
      ...(c.contacto.trim() ? { contacto: c.contacto } : {}),
      ...(c.telefono.trim() ? { telefono: c.telefono } : {}),
    }),
  );
  // El NIT es único por empresa: el servidor lo rechazaría y quedaría apartado.
  const nit = nitNormalizado(c.nit);
  if (nit && existentes.some((e) => e.nit && nitNormalizado(e.nit) === nit)) {
    p.push({ campo: "nit", mensaje: "Ya hay un cliente con ese NIT" });
  }
  // Un nombre igual con otro NIT puede ser legítimo: se avisa, no se bloquea.
  const nombre = normalizar(c.nombre);
  const parecido = existentes.find((e) => normalizar(e.nombre) === nombre);
  return { problemas: p, aviso: parecido ? `Ya existe "${parecido.nombre}". Revisa que no sea el mismo.` : null };
}

export function revisarSede(s: { clienteId: string; nombre: string; ciudad: string }): Problema[] {
  return problemas(
    zCrearSedeCliente.safeParse({
      id: ID_DE_PRUEBA,
      clienteId: s.clienteId,
      nombre: s.nombre,
      ...(s.ciudad.trim() ? { ciudad: s.ciudad } : {}),
    }),
  );
}

export function revisarVehiculo(
  v: { sedeClienteId: string; configuracionEjeId: string | null; codigo: string; placa: string; nombre: string; tipo: string; km: string },
  codigosExistentes: readonly string[],
): Problema[] {
  const km = v.km.replace(/[.\s]/g, "");
  const p: Problema[] = problemas(
    zCrearVehiculo.safeParse({
      id: ID_DE_PRUEBA,
      sedeClienteId: v.sedeClienteId,
      configuracionEjeId: v.configuracionEjeId ?? "",
      codigo: v.codigo,
      nombre: v.nombre,
      tipo: v.tipo,
      ...(v.placa.trim() ? { placa: v.placa } : {}),
      kmActual: km ? Number(km) : 0,
    }),
  ).map((x) => (x.campo === "configuracionEjeId" ? { ...x, mensaje: "Elige la plantilla de ejes" } : x));
  if (km && !/^[0-9]+$/.test(km)) p.push({ campo: "kmActual", mensaje: "Kilometraje en números enteros" });
  // Dos vehículos con el mismo código en la misma sede se confunden al dictarlos.
  if (v.codigo.trim() && codigosExistentes.some((c) => normalizar(c) === normalizar(v.codigo))) {
    p.push({ campo: "codigo", mensaje: "Ya hay un vehículo con ese código en esta sede" });
  }
  return p;
}
