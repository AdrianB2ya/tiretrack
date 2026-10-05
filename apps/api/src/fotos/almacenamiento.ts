import { S3Client, DeleteObjectCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MINUTOS_URL_LECTURA, MINUTOS_URL_SUBIDA } from "@tiretrack/domain";

/**
 * Almacenamiento de fotos.
 *
 * El archivo NUNCA pasa por la API: el dispositivo recibe una URL firmada y
 * sube directo al bucket. Si pasara por el backend, cada foto ocuparía un
 * proceso del servidor durante toda la subida —que en 4G rural puede ser un
 * minuto— y bastarían unos pocos técnicos para agotarlo.
 *
 * Se declara como interfaz para que las pruebas no necesiten un bucket real.
 */

export interface UrlFirmada {
  readonly url: string;
  readonly expiraEn: number;
}

export interface Almacenamiento {
  /** URL de un solo uso para que el dispositivo suba el archivo. */
  urlDeSubida(ruta: string, tipoMime: string, tamanoBytes: number): Promise<UrlFirmada>;
  /** URL temporal de lectura. Las fotos no son públicas. */
  urlDeLectura(ruta: string): Promise<UrlFirmada>;
  borrar(ruta: string): Promise<void>;
  /** Confirma que el archivo llegó: el cliente puede decir que subió y mentir. */
  existe(ruta: string): Promise<boolean>;
}

export interface ConfigS3 {
  readonly endpoint?: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/**
 * Implementación S3-compatible. Pensada para Cloudflare R2, que no cobra por
 * salida de datos: las fotos se miran muchas más veces de las que se suben.
 */
export class AlmacenamientoS3 implements Almacenamiento {
  private readonly cliente: S3Client;

  constructor(private readonly config: ConfigS3) {
    this.cliente = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async urlDeSubida(ruta: string, tipoMime: string, tamanoBytes: number): Promise<UrlFirmada> {
    const segundos = MINUTOS_URL_SUBIDA * 60;
    const comando = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: ruta,
      ContentType: tipoMime,
      // Firmar el tamaño evita que alguien use la URL para subir un archivo
      // de varios gigas con la excusa de una foto.
      ContentLength: tamanoBytes,
    });
    const url = await getSignedUrl(this.cliente, comando, { expiresIn: segundos });
    return { url, expiraEn: Math.floor(Date.now() / 1000) + segundos };
  }

  async urlDeLectura(ruta: string): Promise<UrlFirmada> {
    const segundos = MINUTOS_URL_LECTURA * 60;
    const comando = new GetObjectCommand({ Bucket: this.config.bucket, Key: ruta });
    const url = await getSignedUrl(this.cliente, comando, { expiresIn: segundos });
    return { url, expiraEn: Math.floor(Date.now() / 1000) + segundos };
  }

  async borrar(ruta: string): Promise<void> {
    await this.cliente.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: ruta }));
  }

  async existe(ruta: string): Promise<boolean> {
    try {
      await this.cliente.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: ruta }));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Doble para pruebas. No sustituye a las pruebas contra un bucket real —esas
 * van en un entorno de staging— pero permite probar toda la lógica de
 * permisos, topes y registro sin red.
 */
export class AlmacenamientoMemoria implements Almacenamiento {
  private readonly objetos = new Map<string, { tipoMime: string; tamanoBytes: number }>();
  /** Las pruebas lo usan para simular una subida que nunca llegó. */
  public simularSubidaFallida = false;

  async urlDeSubida(ruta: string, tipoMime: string, tamanoBytes: number): Promise<UrlFirmada> {
    if (!this.simularSubidaFallida) {
      this.objetos.set(ruta, { tipoMime, tamanoBytes });
    }
    return {
      url: `memoria://subida/${encodeURIComponent(ruta)}`,
      expiraEn: Math.floor(Date.now() / 1000) + MINUTOS_URL_SUBIDA * 60,
    };
  }

  async urlDeLectura(ruta: string): Promise<UrlFirmada> {
    return {
      url: `memoria://lectura/${encodeURIComponent(ruta)}`,
      expiraEn: Math.floor(Date.now() / 1000) + MINUTOS_URL_LECTURA * 60,
    };
  }

  async borrar(ruta: string): Promise<void> {
    this.objetos.delete(ruta);
  }

  async existe(ruta: string): Promise<boolean> {
    return this.objetos.has(ruta);
  }

  get cantidad(): number {
    return this.objetos.size;
  }

  limpiar(): void {
    this.objetos.clear();
    this.simularSubidaFallida = false;
  }
}
