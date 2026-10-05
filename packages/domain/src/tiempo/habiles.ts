/**
 * Fechas hábiles y plazo de aprobación tácita.
 *
 * El cliente aprueba en línea, pero si no entra a la aplicación la orden
 * quedaría colgada y la facturación paralizada. Por eso hay un plazo: vencido,
 * la orden cierra sola y queda marcada como cierre por vencimiento —nunca
 * disfrazado de aprobación expresa.
 */

export const DIAS_APROBACION_CLIENTE = 5;

const MS_DIA = 24 * 60 * 60 * 1000;

function aFecha(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function aISO(d: Date): string {
  return d.toISOString().split("T")[0] ?? "";
}

export function esFinDeSemana(iso: string): boolean {
  const dia = aFecha(iso).getUTCDay();
  return dia === 0 || dia === 6;
}

/** Suma días calendario. */
export function sumarDias(iso: string, dias: number): string {
  return aISO(new Date(aFecha(iso).getTime() + dias * MS_DIA));
}

/** Suma días hábiles, saltando sábados y domingos. */
export function sumarDiasHabiles(iso: string, dias: number): string {
  if (dias === 0) return iso;
  const paso = dias > 0 ? 1 : -1;
  let restantes = Math.abs(dias);
  let actual = aFecha(iso);

  while (restantes > 0) {
    actual = new Date(actual.getTime() + paso * MS_DIA);
    const dia = actual.getUTCDay();
    if (dia !== 0 && dia !== 6) restantes--;
  }
  return aISO(actual);
}

/** Si cae en fin de semana, corre al siguiente día hábil. */
export function siguienteHabil(iso: string): string {
  let actual = iso;
  while (esFinDeSemana(actual)) {
    actual = sumarDias(actual, 1);
  }
  return actual;
}

/** Días hábiles entre dos fechas, sin contar la inicial. */
export function diasHabilesEntre(desdeISO: string, hastaISO: string): number {
  if (hastaISO <= desdeISO) return 0;
  let cuenta = 0;
  let actual = desdeISO;
  while (actual < hastaISO) {
    actual = sumarDias(actual, 1);
    if (!esFinDeSemana(actual)) cuenta++;
  }
  return cuenta;
}

export interface PlazoCliente {
  readonly enviadoEn: string;
  readonly limite: string;
  readonly diasRestantes: number;
  readonly vencido: boolean;
}

/** Calcula el plazo que tiene el cliente para responder. */
export function plazoAprobacion(
  enviadoISO: string,
  hoyISO: string,
  diasHabiles: number = DIAS_APROBACION_CLIENTE,
): PlazoCliente {
  const limite = sumarDiasHabiles(enviadoISO, diasHabiles);
  const restantes = diasHabilesEntre(hoyISO, limite);
  return {
    enviadoEn: enviadoISO,
    limite,
    diasRestantes: hoyISO >= limite ? 0 : restantes,
    vencido: hoyISO >= limite,
  };
}

export const FRECUENCIAS = [
  "dias_habiles",
  "dias_calendario",
  "semanal",
  "quincenal",
  "mensual",
] as const;
export type Frecuencia = (typeof FRECUENCIAS)[number];

/**
 * Próxima ejecución de un servicio recurrente. Si el resultado cae en fin de
 * semana se corre al siguiente hábil: nadie atiende el sábado.
 */
export function proximaEjecucion(desdeISO: string, frecuencia: Frecuencia, cada = 1): string {
  switch (frecuencia) {
    case "dias_habiles":
      return sumarDiasHabiles(desdeISO, cada);
    case "dias_calendario":
      return siguienteHabil(sumarDias(desdeISO, cada));
    case "semanal":
      return siguienteHabil(sumarDias(desdeISO, 7));
    case "quincenal":
      return siguienteHabil(sumarDias(desdeISO, 15));
    case "mensual": {
      const d = aFecha(desdeISO);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return siguienteHabil(aISO(d));
    }
  }
}
