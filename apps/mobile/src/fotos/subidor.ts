import type { FotoLocal, RepositorioLocal } from "../datos/repositorio";

/**
 * Subida de fotos.
 *
 * Va **por fuera de la cola ordenada** a propósito: los bytes pesan y la
 * señal rural es mala, así que una foto lenta no puede frenar las mediciones
 * ni la firma. Lo que sí respeta el orden es la operación de *adjuntar*, que
 * es la que cuenta en el contenido de la orden (ver la tarea 5.5).
 *
 * Reglas que la gobiernan:
 *
 * - **Una foto nunca se borra por fallar.** El archivo está en el celular y
 *   es evidencia del servicio; si no sube, queda esperando y a la vista.
 * - **Una foto de a la vez.** Subir veintidós en paralelo por 4G rural hace
 *   que fallen todas por tiempo agotado.
 * - **La URL vencida no es un error de la foto**: se pide otra y se sigue.
 */

/** Minutos de espera tras cada fallo. Se queda en el último valor. */
export const ESPERAS_MINUTOS = [1, 5, 15, 60] as const;

/** Margen para no empezar una subida con una URL a punto de vencer. */
export const MARGEN_VENCIMIENTO_MS = 30_000;

export interface ResultadoSubida {
  readonly subidas: number;
  readonly fallidas: number;
  readonly urlesRenovadas: number;
  readonly interrumpida: boolean;
}

export interface TransporteDeFotos {
  /** Sube el archivo local a la URL firmada. */
  subir(entrada: { uriLocal: string; url: string; tipoMime: string }): Promise<void>;
}

/** Fallo que indica que la URL ya no sirve; se pide otra en vez de reintentar. */
export class UrlVencida extends Error {
  constructor(mensaje = "La URL de subida venció") {
    super(mensaje);
    this.name = "UrlVencida";
  }
}

/** Fallo de red: reintentar sirve, y no tiene sentido seguir con las demás. */
export class SinConexion extends Error {
  constructor(mensaje = "Sin conexión") {
    super(mensaje);
    this.name = "SinConexion";
  }
}

export class SubidorFotos {
  private corriendo = false;

  constructor(
    private readonly repo: RepositorioLocal,
    private readonly transporte: TransporteDeFotos,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  get ocupado(): boolean {
    return this.corriendo;
  }

  async subirPendientes(): Promise<ResultadoSubida> {
    if (this.corriendo) {
      return { subidas: 0, fallidas: 0, urlesRenovadas: 0, interrumpida: true };
    }
    this.corriendo = true;

    const resumen = { subidas: 0, fallidas: 0, urlesRenovadas: 0, interrumpida: false };
    try {
      for (const foto of await this.repo.fotosPorSubir()) {
        if (this.venceEnBreve(foto)) {
          // Empezar con una URL a punto de vencer gasta datos para fallar a
          // mitad de la subida, que es el peor momento.
          await this.repo.pedirNuevaUrlDeSubida(foto.id);
          resumen.urlesRenovadas++;
          continue;
        }

        try {
          await this.transporte.subir({
            uriLocal: foto.uriLocal,
            url: foto.urlSubida as string,
            tipoMime: foto.tipoMime,
          });
          // El servidor sabe que los bytes llegaron por esta confirmación,
          // que sí va en la cola: no cambia el contenido de la orden.
          await this.repo.encolarConfirmacionDeFoto(foto.id, foto.ordenId);
          await this.repo.marcarFotoSubida(foto.id);
          resumen.subidas++;
        } catch (e) {
          if (e instanceof UrlVencida) {
            await this.repo.pedirNuevaUrlDeSubida(foto.id);
            resumen.urlesRenovadas++;
            continue;
          }
          await this.repo.marcarFalloDeSubida(foto.id, (e as Error).message, this.proximoIntento(foto));
          resumen.fallidas++;
          if (e instanceof SinConexion) {
            // Sin señal, las siguientes fallarían igual gastando batería.
            resumen.interrumpida = true;
            break;
          }
        }
      }
      return resumen;
    } finally {
      this.corriendo = false;
    }
  }

  private venceEnBreve(foto: FotoLocal): boolean {
    if (!foto.urlExpiraEn) return false;
    const vence = new Date(foto.urlExpiraEn).getTime();
    if (Number.isNaN(vence)) return true;
    return vence - this.reloj().getTime() < MARGEN_VENCIMIENTO_MS;
  }

  private proximoIntento(foto: FotoLocal): Date {
    const minutos = ESPERAS_MINUTOS[Math.min(foto.intentos, ESPERAS_MINUTOS.length - 1)] ?? 60;
    return new Date(this.reloj().getTime() + minutos * 60_000);
  }
}
