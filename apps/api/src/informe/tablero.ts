import {
  fechaEnColombia,
  proyeccionDeCompras,
  rendimientoPor,
  ultimaPorLlanta,
  type FilaTablero,
} from "@tiretrack/domain";
import type { ServicioInforme, Contexto } from "./servicio";

/**
 * Tablero de la flota (R11): rendimiento por marca, diseño y posición, y la
 * proyección de compras. Sale de las mismas filas del informe —con sus
 * indicadores ya calculados— para que una cifra del tablero se pueda
 * rastrear hasta su fila en el CSV.
 *
 * El alcance es el del informe: la oficina, sus órdenes; el técnico, las
 * suyas; el cliente, lo aprobado o cerrado de su flota (RLS).
 */
export async function tableroDeFlota(
  informe: ServicioInforme,
  ctx: Contexto,
  filtro: { desde?: string; hasta?: string; clienteId?: string },
  hoy: Date,
) {
  const filas = await informe.consultar(ctx, filtro);
  const tablero: FilaTablero[] = filas
    .filter((f) => !f.noIdentificada)
    .map((f) => ({
      llantaId: (f as { llantaActivoId?: string | null }).llantaActivoId ?? null,
      vehiculo: f.vehiculoCodigo,
      posicion: f.posicion,
      fecha: f.fecha,
      marca: f.marca,
      diseno: f.diseno,
      medida: f.medida,
      remanente: f.profundidad,
      profBaja: f.indicadores?.profBaja ?? null,
      mmDesgaste: f.indicadores?.mmDesgaste ?? null,
      kmPorMm: f.indicadores?.kmPorMm ?? null,
      proyeccionKm: f.indicadores?.proyeccionKm ?? null,
      cpk: f.indicadores?.cpk ?? null,
      fechaMontaje: f.indicadores?.fechaMontaje ?? null,
    }));
  const ultimas = ultimaPorLlanta(tablero);
  return {
    llantas: ultimas.length,
    porMarca: rendimientoPor(ultimas, (f) => f.marca),
    porDiseno: rendimientoPor(ultimas, (f) => (f.diseno ? `${f.marca ?? ""} ${f.diseno}`.trim() : null)),
    porPosicion: rendimientoPor(ultimas, (f) => String(f.posicion)),
    compras: proyeccionDeCompras(ultimas, fechaEnColombia(hoy)),
  };
}
