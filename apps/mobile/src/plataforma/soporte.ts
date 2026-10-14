/**
 * Sesión de soporte del superadmin en la app (R16).
 *
 * El token de soporte vive SOLO EN MEMORIA: no va al llavero ni a SQLite, y
 * no toca la base local. Cerrar la app termina la vista; la sesión en el
 * servidor vence sola. Así un teléfono perdido no conserva acceso a los datos
 * de una empresa ajena, y la base del teléfono nunca mezcla empresas.
 */

export interface SesionSoporte {
  readonly token: string;
  readonly sesionId: string;
  readonly expiraEn: string;
  readonly empresa: { readonly id: string; readonly nombre: string };
}

let actual: SesionSoporte | null = null;

export const sesionSoporte = {
  actual: (): SesionSoporte | null => actual,
  fijar: (s: SesionSoporte): void => {
    actual = s;
  },
  limpiar: (): void => {
    actual = null;
  },
};

export type RespuestaEnLinea<T> =
  | { ok: true; datos: T }
  | { ok: false; status: number; codigo: string | null; mensaje: string };

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Consultas en línea con el token de soporte (no con el de la sesión del teléfono). */
export function enLineaConToken(apiUrl: string, token: string, http: Fetch = fetch as unknown as Fetch) {
  return async <T>(metodo: "GET" | "POST", ruta: string, cuerpo?: unknown): Promise<RespuestaEnLinea<T>> => {
    try {
      const r = await http(`${apiUrl}${ruta}`, {
        method: metodo,
        headers: { authorization: `Bearer ${token}`, ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}) },
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: { codigo?: string; mensaje?: string } };
      if (r.ok) return { ok: true, datos: j as T };
      return { ok: false, status: r.status, codigo: j.error?.codigo ?? null, mensaje: j.error?.mensaje ?? "No se pudo completar" };
    } catch {
      return { ok: false, status: 0, codigo: null, mensaje: "Sin señal: el soporte se hace en línea" };
    }
  };
}
