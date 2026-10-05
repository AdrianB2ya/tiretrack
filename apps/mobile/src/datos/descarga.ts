import type { OrdenDescargada, RepositorioLocal, SedeLocal } from "./repositorio";

/**
 * Descarga de datos al dispositivo.
 *
 * Sin esto, un técnico que instala la app ingresa y ve una lista vacía para
 * siempre: el motor de sincronización solo envía, nunca trae.
 *
 * La regla que gobierna todo lo demás: **lo descargado no pisa el trabajo sin
 * enviar**. Si el celular tiene cambios en una orden que todavía no llegaron
 * al servidor, la versión del servidor es la vieja; escribirla encima borraría
 * lo que el técnico capturó.
 */

export interface PaqueteDescargado {
  readonly hasta: string;
  readonly incremental: boolean;
  readonly ordenes: OrdenDescargada[];
  readonly mediciones: {
    id: string; ordenId: string; posicion: number;
    marcaId: string | null; disenoId: string | null; medida: string | null;
    serial: string | null; profundidad: number | null;
  }[];
  readonly catalogo: {
    marcas: { id: string; nombre: string; esGlobal: boolean }[];
    disenos: { id: string; marcaId: string; nombre: string; tipoEje: string }[];
    medidas: { id: string; disenoId: string; medida: string; profundidadOriginal: number | null }[];
  };
  readonly flota: {
    clientes: { id: string; nombre: string; nit: string | null }[];
    sedes: { id: string; clienteId: string; nombre: string }[];
    vehiculos: {
      id: string; sedeClienteId: string; configuracionEjeId: string;
      codigo: string; placa: string | null; nombre: string; kmActual: number;
    }[];
  };
  readonly configuraciones: {
    id: string;
    posiciones: {
      numero: number; eje: number; lado: string; esInterna: boolean; tipoEje: string;
      psiObjetivo: number | null; profundidadMinima: number | null;
    }[];
  }[];
  readonly tecnicos: { id: string; nombre: string; sedeId: string; activo: boolean }[];
  /** Opcional: un servidor anterior no las manda, y no por eso falla la descarga. */
  readonly sedes?: SedeLocal[];
}

export interface ClienteDescarga {
  /** null cuando no se pudo llegar al servidor. */
  traer(desde: string | null): Promise<PaqueteDescargado | null>;
}

export interface ResumenDescarga {
  readonly ordenesNuevas: number;
  readonly ordenesActualizadas: number;
  readonly ordenesRespetadas: number;
  readonly cerradas: number;
  readonly sinConexion: boolean;
}

const ESTADOS_CERRADOS = new Set(["cerrada", "anulada"]);

export class Descargador {
  private corriendo = false;

  constructor(private readonly repo: RepositorioLocal) {}

  get ocupado(): boolean {
    return this.corriendo;
  }

  async descargar(cliente: ClienteDescarga): Promise<ResumenDescarga> {
    const vacio: ResumenDescarga = {
      ordenesNuevas: 0, ordenesActualizadas: 0, ordenesRespetadas: 0,
      cerradas: 0, sinConexion: false,
    };
    if (this.corriendo) return vacio;
    this.corriendo = true;

    try {
      const desde = await this.repo.marcaDeDescarga();
      const paquete = await cliente.traer(desde);
      if (!paquete) return { ...vacio, sinConexion: true };

      const resumen = { ...vacio };

      // Catálogo, flota y configuraciones se reemplazan enteros: son datos
      // del servidor, el celular nunca los edita.
      await this.repo.guardarCatalogo({
        marcas: paquete.catalogo.marcas.map((m) => ({ ...m, creadaLocal: false })),
        disenos: paquete.catalogo.disenos.map((d) => ({ ...d, creadaLocal: false })),
        medidas: paquete.catalogo.medidas,
      });
      await this.repo.guardarFlota(paquete.flota);
      await this.repo.guardarTecnicos(paquete.tecnicos);
      if (paquete.sedes) await this.repo.guardarSedes(paquete.sedes);
      for (const c of paquete.configuraciones) {
        await this.repo.guardarPosicionesEje(
          c.id,
          c.posiciones.map((p) => ({ ...p, lado: p.lado as "izquierdo" | "derecho" })),
        );
      }

      for (const orden of paquete.ordenes) {
        const local = await this.repo.buscarOrden(orden.id);

        // Lo que el técnico capturó y todavía no salió del celular manda
        // sobre lo que el servidor cree: su copia es más vieja.
        if (local && !local.sincronizada) {
          resumen.ordenesRespetadas++;
          continue;
        }

        if (ESTADOS_CERRADOS.has(orden.estado)) {
          // Ya no se puede trabajar: se quita para no llenar la lista. Como
          // está sincronizada, no se pierde nada.
          if (local) {
            await this.repo.olvidarOrden(orden.id);
            resumen.cerradas++;
          }
          continue;
        }

        await this.repo.guardarOrdenDescargada(orden);
        if (local) resumen.ordenesActualizadas++;
        else resumen.ordenesNuevas++;
      }

      const ordenesGuardadas = new Set(
        paquete.ordenes.filter((o) => !ESTADOS_CERRADOS.has(o.estado)).map((o) => o.id),
      );
      await this.repo.guardarMedicionesDescargadas(
        paquete.mediciones.filter((m) => ordenesGuardadas.has(m.ordenId)),
      );

      // La marca se guarda al final y solo si todo salió bien: si se guardara
      // antes, un fallo a la mitad haría que la próxima descarga se saltara
      // lo que faltó y esos datos no llegaran nunca.
      await this.repo.guardarMarcaDeDescarga(paquete.hasta);
      return resumen;
    } finally {
      this.corriendo = false;
    }
  }
}
