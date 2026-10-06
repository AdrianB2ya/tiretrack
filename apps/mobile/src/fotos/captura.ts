import { planDeCompresion, siguienteIntento, type PlanDeCompresion } from "./compresion";

/**
 * Captura de una foto: tomarla, comprimirla y dejarla lista para subir.
 *
 * La orquestación vive aquí, separada del hardware, porque es donde está la
 * decisión: cuántas veces reintentar la compresión y cuándo parar. Los
 * adaptadores al final del archivo tocan la cámara y el sistema de archivos
 * del dispositivo, y solo se validan en el emulador.
 */

export interface ImagenCapturada {
  readonly uri: string;
  readonly ancho: number;
  readonly alto: number;
  readonly tamanoBytes: number;
}

/** Aplica un plan de compresión y devuelve el resultado. */
export interface Manipulador {
  comprimir(imagen: ImagenCapturada, plan: PlanDeCompresion): Promise<ImagenCapturada>;
}

export interface Camara {
  /** null si la persona canceló. */
  tomarFoto(): Promise<ImagenCapturada | null>;
  /** Pide permiso de cámara. false si lo negó. */
  pedirPermiso(): Promise<boolean>;
}

export type ResultadoCaptura =
  | { tipo: "lista"; imagen: ImagenCapturada; original: ImagenCapturada }
  | { tipo: "cancelada" }
  | { tipo: "sin_permiso" }
  | { tipo: "error"; mensaje: string };

/**
 * Red de seguridad, no el mecanismo.
 *
 * Quien detiene las pasadas es la calidad mínima legible: bajando de 0.1 en
 * 0.1 desde 0.7, el tope real son tres. Este número es mayor a propósito para
 * que se note si alguien cambia esa regla y el bucle empieza a alargarse; si
 * valiera lo mismo, parecería que lo detiene este tope cuando no es así.
 */
export const MAXIMO_PASADAS = 6;

/** Pasadas que produce hoy la calidad mínima. Lo fija la prueba. */
export const PASADAS_ESPERADAS = 3;

/**
 * Comprime hasta alcanzar el objetivo o hasta que no se pueda más.
 *
 * Si una pasada deja la imagen MÁS grande —pasa con fotos ya optimizadas— se
 * conserva la anterior: recomprimir nunca debe empeorar el resultado.
 */
export async function prepararFoto(
  original: ImagenCapturada,
  manipulador: Manipulador,
): Promise<ImagenCapturada> {
  let plan = planDeCompresion(original);
  if (!plan) return original;

  let mejor = original;
  for (let pasada = 0; pasada < MAXIMO_PASADAS && plan; pasada++) {
    const resultado = await manipulador.comprimir(original, plan);
    if (resultado.tamanoBytes < mejor.tamanoBytes) mejor = resultado;
    plan = siguienteIntento(plan, resultado.tamanoBytes);
  }
  return mejor;
}

/**
 * Toma una foto y la deja lista.
 *
 * Un fallo al comprimir NO pierde la foto: se devuelve la original. Vale más
 * subir cuatro megabytes lentamente que perder la evidencia del servicio.
 */
export async function capturarFoto(
  camara: Camara,
  manipulador: Manipulador,
): Promise<ResultadoCaptura> {
  // Pedir el permiso también puede fallar (módulo nativo ausente, sistema
  // que lo niega con error): se informa en vez de escaparse sin atrapar.
  let permitido: boolean;
  try {
    permitido = await camara.pedirPermiso();
  } catch (e) {
    return { tipo: "error", mensaje: (e as Error).message };
  }
  if (!permitido) return { tipo: "sin_permiso" };

  let original: ImagenCapturada | null;
  try {
    original = await camara.tomarFoto();
  } catch (e) {
    return { tipo: "error", mensaje: (e as Error).message };
  }
  if (!original) return { tipo: "cancelada" };

  try {
    return { tipo: "lista", imagen: await prepararFoto(original, manipulador), original };
  } catch {
    return { tipo: "lista", imagen: original, original };
  }
}

// ── Adaptadores al dispositivo ──────────────────────────────────────────────
//
// Se importan de forma diferida: así el resto del módulo corre en Node, donde
// estas librerías no existen. Lo que hacen es mecánico; lo que decide está
// arriba y sí está probado.

export const camaraDelDispositivo: Camara = {
  async pedirPermiso() {
    const picker = await import("expo-image-picker");
    const permiso = await picker.requestCameraPermissionsAsync();
    return permiso.granted;
  },

  async tomarFoto() {
    const picker = await import("expo-image-picker");
    const sistema = await import("expo-file-system");

    const r = await picker.launchCameraAsync({
      mediaTypes: ["images"],
      // Sin edición: el técnico tiene guantes y el camión no espera.
      allowsEditing: false,
      // La compresión real la decide `prepararFoto`; aquí se pide la mejor
      // calidad para no degradar dos veces.
      quality: 1,
      exif: false,
    });
    if (r.canceled || !r.assets[0]) return null;

    const activo = r.assets[0];
    const info = await sistema.getInfoAsync(activo.uri);
    return {
      uri: activo.uri,
      ancho: activo.width,
      alto: activo.height,
      tamanoBytes: info.exists && "size" in info ? info.size : 0,
    };
  },
};

export const manipuladorDelDispositivo: Manipulador = {
  async comprimir(imagen, plan) {
    const manipulate = await import("expo-image-manipulator");
    const sistema = await import("expo-file-system");

    const acciones = plan.redimensionarA
      ? [
          {
            resize:
              imagen.ancho >= imagen.alto
                ? { width: plan.redimensionarA }
                : { height: plan.redimensionarA },
          },
        ]
      : [];

    const r = await manipulate.manipulateAsync(imagen.uri, acciones, {
      compress: plan.calidad,
      format: manipulate.SaveFormat.JPEG,
    });
    const info = await sistema.getInfoAsync(r.uri);
    return {
      uri: r.uri,
      ancho: r.width,
      alto: r.height,
      tamanoBytes: info.exists && "size" in info ? info.size : imagen.tamanoBytes,
    };
  },
};
