import { type Veredicto, PERMITIDO, negar } from "../tipos";

/**
 * Congelado de identidad al cerrar.
 *
 * Una orden cerrada es un documento, y un documento no cambia solo. Si el
 * cliente cambia de razón social o el vehículo se traslada de sede, las
 * órdenes viejas deben seguir diciendo lo que decían ese día.
 *
 * Nunca reconstruir un hecho histórico consultando el estado vigente: es la
 * causa más común de que un reporte cambie sin que nadie lo haya tocado.
 */

export interface DatosVivos {
  readonly clienteNombre: string;
  readonly clienteNit: string;
  readonly sedeClienteNombre: string;
  readonly vehiculoCodigo: string;
  readonly vehiculoPlaca?: string | null;
  readonly tecnicoNombre: string;
  readonly tecnicoCedula: string;
}

export type DatosCongelados = DatosVivos & { readonly congeladoEn: string };

export function congelar(datos: DatosVivos, fechaISO: string): DatosCongelados {
  return { ...datos, congeladoEn: fechaISO };
}

/**
 * Al mostrar una orden, los datos congelados mandan sobre los vivos.
 * Mientras la orden está abierta todavía no hay congelado y se usa lo vivo.
 */
export function resolverDatos(
  congelado: DatosCongelados | null | undefined,
  vivos: DatosVivos,
): DatosVivos {
  return congelado ?? vivos;
}

export interface RequisitosCierre {
  readonly tieneFirmaVigente: boolean;
  readonly tieneCongelado: boolean;
  readonly posicionesCapturadas: number;
}

/**
 * Requisitos duros para cerrar. En la base de datos van además como CHECK:
 * una validación de aplicación se puede saltar con un script de migración.
 */
export function puedeCerrarse(r: RequisitosCierre): Veredicto {
  if (!r.tieneFirmaVigente) {
    return negar("SIN_FIRMA", "No se puede cerrar sin firma vigente de quien recibe");
  }
  if (!r.tieneCongelado) {
    return negar("SIN_CONGELADO", "Falta estampar los datos del cliente, vehículo y técnico");
  }
  if (r.posicionesCapturadas === 0) {
    return negar("SIN_MEDICIONES", "La orden no tiene ninguna posición capturada");
  }
  return PERMITIDO;
}
