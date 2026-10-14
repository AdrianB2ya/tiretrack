/**
 * Envío de correo (R13). Una interfaz, como el almacenamiento de fotos:
 *
 * - `CorreoResend`: el proveedor real (plan gratuito de 3.000 correos al
 *   mes). Por HTTP, sin SDK: una dependencia menos que mantener.
 * - `CorreoDesactivado`: sin cuenta configurada. Los avisos automáticos no
 *   corren y el envío manual responde que no está activado — el teléfono
 *   sigue pudiendo compartir el archivo por WhatsApp.
 * - `CorreoMemoria`: pruebas.
 */

export interface Adjunto {
  readonly nombre: string;
  readonly contenido: Buffer;
  readonly tipo: string;
}

export interface Mensaje {
  readonly para: readonly string[];
  readonly asunto: string;
  readonly texto: string;
  readonly adjuntos?: readonly Adjunto[];
}

export type ResultadoEnvio = { ok: true } | { ok: false; mensaje: string };

export interface Correo {
  readonly configurado: boolean;
  enviar(m: Mensaje): Promise<ResultadoEnvio>;
}

export class CorreoDesactivado implements Correo {
  readonly configurado = false;
  async enviar(): Promise<ResultadoEnvio> {
    return { ok: false, mensaje: "El envío por correo no está activado en el servidor" };
  }
}

export class CorreoMemoria implements Correo {
  readonly configurado = true;
  readonly enviados: Mensaje[] = [];
  /** Para probar el fallo del proveedor. */
  fallar = false;
  async enviar(m: Mensaje): Promise<ResultadoEnvio> {
    if (this.fallar) return { ok: false, mensaje: "proveedor caído" };
    this.enviados.push(m);
    return { ok: true };
  }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export class CorreoResend implements Correo {
  readonly configurado = true;
  constructor(
    private readonly llave: string,
    /** "Asistectire <avisos@dominio.co>": el dominio debe estar verificado en Resend. */
    private readonly remitente: string,
    private readonly http: Fetch = fetch as unknown as Fetch,
  ) {}

  async enviar(m: Mensaje): Promise<ResultadoEnvio> {
    // Un proveedor colgado no puede dejar esperando a quien envía.
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), 20_000);
    try {
      const r = await this.http("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${this.llave}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: this.remitente,
          to: m.para,
          subject: m.asunto,
          text: m.texto,
          ...(m.adjuntos?.length
            ? { attachments: m.adjuntos.map((a) => ({ filename: a.nombre, content: a.contenido.toString("base64"), content_type: a.tipo })) }
            : {}),
        }),
        signal: corte.signal,
      });
      if (r.ok) return { ok: true };
      // El detalle del proveedor va al registro; a la persona, algo que entienda.
      return { ok: false, mensaje: `El proveedor de correo rechazó el envío (${r.status})` };
    } catch {
      return { ok: false, mensaje: "No se pudo contactar al proveedor de correo" };
    } finally {
      clearTimeout(reloj);
    }
  }
}
