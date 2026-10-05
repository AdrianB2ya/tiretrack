import { type Rol, type Veredicto, PERMITIDO, negar } from "../tipos";
import { clave, distancia, DISTANCIA_SIMILITUD } from "./normalizacion";

/**
 * Ámbito y gobierno del catálogo de llantas.
 *
 * El catálogo es híbrido: hay marcas y diseños GLOBALES que mantiene la
 * plataforma, y PROPIOS que cada empresa crea y solo ella ve. El técnico
 * puede crear en campo, porque bloquearlo haría que invente datos para poder
 * guardar, pero lo que crea queda marcado para que alguien lo revise.
 */

export interface EntradaConAmbito {
  readonly id: string;
  readonly nombre: string;
  readonly esGlobal: boolean;
  readonly empresaId: string | null;
  readonly creadaEnCampo?: boolean;
  readonly activa?: boolean;
}

/** Una empresa ve lo global más lo suyo. Nunca lo propio de otra empresa. */
export function visiblePara(entrada: EntradaConAmbito, empresaId: string): boolean {
  return entrada.esGlobal || entrada.empresaId === empresaId;
}

export function filtrarVisibles<T extends EntradaConAmbito>(
  entradas: readonly T[],
  empresaId: string,
): T[] {
  return entradas.filter((e) => visiblePara(e, empresaId));
}

/**
 * Quién puede crear entradas de catálogo.
 *
 * El técnico sí puede: si se le bloquea, va a escribir la marca en el campo
 * de observaciones o a elegir una cualquiera con tal de guardar. Lo que crea
 * queda marcado como creado en campo.
 */
export function puedeCrearEntrada(rol: Rol): Veredicto {
  if (rol === "cliente") {
    return negar("SIN_PERMISO", "El portal del cliente es de solo lectura");
  }
  return PERMITIDO;
}

/** Solo el superadministrador convierte una entrada propia en global. */
export function puedePromoverAGlobal(rol: Rol): Veredicto {
  if (rol !== "superadmin") {
    return negar("SOLO_SUPERADMIN", "Solo la plataforma promueve entradas a globales");
  }
  return PERMITIDO;
}

/** Quién revisa lo que el técnico creó en campo, antes de darlo por bueno. */
export function puedeRevisarCreadasEnCampo(rol: Rol): boolean {
  return rol === "administrador" || rol === "superadmin";
}

/**
 * Una entrada global no se edita ni se desactiva desde una empresa: la
 * comparten todas, y cambiarla afectaría a los demás suscriptores.
 */
export function puedeModificar(entrada: EntradaConAmbito, rol: Rol, empresaId: string): Veredicto {
  if (entrada.esGlobal) {
    if (rol !== "superadmin") {
      return negar("ENTRADA_GLOBAL", "Las entradas globales solo las modifica la plataforma");
    }
    return PERMITIDO;
  }
  if (entrada.empresaId !== empresaId) {
    return negar("OTRA_EMPRESA", "Esta entrada pertenece a otra empresa");
  }
  if (rol === "cliente" || rol === "tecnico") {
    return negar("SIN_PERMISO", "No tienes permiso para modificar el catálogo");
  }
  return PERMITIDO;
}

/**
 * Antes de promover, hay que descartar que ya exista una global equivalente.
 * Promover un duplicado sería peor que dejarla propia: quedarían dos marcas
 * globales para lo mismo y el análisis se partiría en dos.
 */
export function evaluarPromocion(
  candidata: EntradaConAmbito,
  globales: readonly EntradaConAmbito[],
): Veredicto {
  if (candidata.esGlobal) {
    return negar("YA_ES_GLOBAL", "Esta entrada ya es global");
  }

  const claveCandidata = clave(candidata.nombre);
  const identica = globales.find((g) => clave(g.nombre) === claveCandidata);
  if (identica) {
    return negar(
      "YA_EXISTE_GLOBAL",
      `Ya existe como "${identica.nombre}". Fusiona en vez de promover`,
    );
  }

  const parecida = globales.find(
    (g) => distancia(clave(g.nombre), claveCandidata) <= DISTANCIA_SIMILITUD,
  );
  if (parecida) {
    return negar(
      "PARECIDA_A_GLOBAL",
      `Se parece a "${parecida.nombre}". Verifica antes de promover`,
    );
  }

  return PERMITIDO;
}

/**
 * La medida solo tiene sentido dentro de un diseño, y el diseño dentro de
 * una marca. Romper la jerarquía deja datos que no se pueden analizar.
 */
export function jerarquiaCoherente(sel: {
  marcaId?: string | null;
  disenoId?: string | null;
  medida?: string | null;
}): Veredicto {
  if (sel.disenoId && !sel.marcaId) {
    return negar("FALTA_MARCA", "El diseño depende de la marca");
  }
  if (sel.medida && !sel.disenoId) {
    return negar("FALTA_DISENO", "La medida depende del diseño");
  }
  return PERMITIDO;
}

/** Formato de medida: 295/80R22.5, 11R22.5, 385/65R22.5 */
const FORMATO_MEDIDA = /^(\d{2,3}\/\d{2,3}R\d{2}(\.\d)?|\d{2}(\.\d)?R\d{2}(\.\d)?)$/i;

export function medidaValida(medida: string): boolean {
  return FORMATO_MEDIDA.test(medida.trim());
}

/**
 * Normaliza la escritura de una medida para que 295/80r22.5 y 295/80R22.5
 * no queden como dos medidas distintas.
 */
export function normalizarMedida(medida: string): string {
  return medida.trim().toUpperCase().replace(/\s+/g, "");
}
