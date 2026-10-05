/**
 * Almacenamiento seguro de credenciales.
 *
 * Los tokens van al llavero del sistema —Keystore en Android— no a SQLite ni
 * a AsyncStorage. La diferencia importa: un celular de trabajo se pierde, se
 * presta y a veces se revende. Un token en texto plano en el sistema de
 * archivos lo lee cualquiera con acceso al dispositivo, y ese token abre la
 * cartera completa de clientes de la empresa.
 *
 * Se define como interfaz porque `expo-secure-store` no existe fuera de la
 * app, y porque en pruebas hace falta poder inspeccionar qué se guardó.
 */

export interface AlmacenSeguro {
  guardar(clave: string, valor: string): Promise<void>;
  leer(clave: string): Promise<string | null>;
  borrar(clave: string): Promise<void>;
}

/** Claves usadas. Se centralizan para poder borrarlas todas al salir. */
export const CLAVES = {
  token: "tiretrack.token",
  refresh: "tiretrack.refresh",
  usuario: "tiretrack.usuario",
} as const;

// ── Dispositivo ─────────────────────────────────────────────────────────────

interface ModuloSecureStore {
  setItemAsync(clave: string, valor: string, opciones?: unknown): Promise<void>;
  getItemAsync(clave: string, opciones?: unknown): Promise<string | null>;
  deleteItemAsync(clave: string, opciones?: unknown): Promise<void>;
}

export class AlmacenSeguroDispositivo implements AlmacenSeguro {
  constructor(private readonly modulo: ModuloSecureStore) {}

  async guardar(clave: string, valor: string): Promise<void> {
    await this.modulo.setItemAsync(clave, valor, {
      // No se exige autenticación biométrica para leerlo: el técnico abre la
      // app decenas de veces al día con guantes, y pedir huella cada vez
      // haría que anote la contraseña en un papel.
      keychainAccessible: undefined,
    });
  }

  async leer(clave: string): Promise<string | null> {
    return this.modulo.getItemAsync(clave);
  }

  async borrar(clave: string): Promise<void> {
    await this.modulo.deleteItemAsync(clave);
  }
}

/** La importación es dinámica: el módulo nativo no existe en Node. */
export async function abrirAlmacenSeguro(): Promise<AlmacenSeguro> {
  const modulo = (await import("expo-secure-store")) as unknown as ModuloSecureStore;
  return new AlmacenSeguroDispositivo(modulo);
}

// ── Pruebas ─────────────────────────────────────────────────────────────────

/**
 * Doble en memoria. Permite además comprobar que un valor concreto **no**
 * quedó guardado, que es la mitad de lo que hay que verificar aquí.
 */
export class AlmacenSeguroMemoria implements AlmacenSeguro {
  private readonly valores = new Map<string, string>();

  async guardar(clave: string, valor: string): Promise<void> {
    this.valores.set(clave, valor);
  }

  async leer(clave: string): Promise<string | null> {
    return this.valores.get(clave) ?? null;
  }

  async borrar(clave: string): Promise<void> {
    this.valores.delete(clave);
  }

  get claves(): string[] {
    return [...this.valores.keys()];
  }

  contiene(fragmento: string): boolean {
    return [...this.valores.values()].some((v) => v.includes(fragmento));
  }

  limpiar(): void {
    this.valores.clear();
  }
}
