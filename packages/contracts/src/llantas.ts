import { z } from "zod";
import { ESTADOS_ACTIVO, MOVIMIENTOS_MANUALES } from "@tiretrack/domain";
import { zFechaISO, zId, zProfundidad, zTextoCorto } from "./comunes";

/**
 * La llanta como activo (R8). Los vocabularios salen del dominio.
 */

const zDinero = z.number().min(0).max(1_000_000_000);

/** Alta de una llanta en bodega (compra o ingreso de una que ya existía). */
export const zCrearLlanta = z
  .object({
    id: zId,
    clienteId: zId,
    sedeId: zId,
    serial: zTextoCorto.optional(),
    numeroInterno: zTextoCorto.optional(),
    numCalor: zTextoCorto.optional(),
    dot: zTextoCorto.optional(),
    marcaId: zId.optional(),
    disenoId: zId.optional(),
    medida: zTextoCorto.optional(),
    /** Costo de compra: con él se calcula el costo por kilómetro. */
    costo: zDinero.optional(),
    profundidadInicial: zProfundidad.optional(),
  })
  .refine((l) => Boolean(l.serial?.trim() || l.numeroInterno?.trim()), {
    message: "Escribe el serial o el número interno: sin ninguno, la llanta no se puede seguir",
    path: ["serial"],
  });

/** Un movimiento registrado por la oficina (montar y desmontar salen de las órdenes). */
export const zMovimientoLlanta = z
  .object({
    tipo: z.enum(MOVIMIENTOS_MANUALES as unknown as [string, ...string[]]),
    fecha: zFechaISO.optional(),
    /** Traslado: la sede de destino. */
    sedeId: zId.optional(),
    detalle: z.string().trim().max(300).optional(),
    /** Retorno del reencauche: la vida nueva. */
    banda: zTextoCorto.optional(),
    reencauchadora: zTextoCorto.optional(),
    costo: zDinero.optional(),
    profundidadInicial: zProfundidad.optional(),
  })
  .refine((m) => m.tipo !== "traslado" || Boolean(m.sedeId), {
    message: "Elige la sede a la que se traslada",
    path: ["sedeId"],
  });

export const zFiltroLlantas = z.object({
  estado: z.enum(ESTADOS_ACTIVO).optional(),
  clienteId: zId.optional(),
  sedeId: zId.optional(),
  vehiculoId: zId.optional(),
  /** Serial, número interno o número de calor, por parte del texto. */
  buscar: z.string().trim().max(60).optional(),
});

export const zStockMinimo = z.object({
  sedeId: zId,
  medida: zTextoCorto,
  cantidad: z.number().int().min(0).max(100_000),
});
