/**
 * Avisos y envío de informes por correo (R13, brecha E).
 *
 * Lo que dicen los correos vive aquí, una sola vez: el servidor los envía y
 * las pruebas verifican que digan lo que tienen que decir —en particular,
 * que el aviso al cliente explique el cierre tácito con todas las letras—.
 */

/** Más destinatarios en un envío manual: es una lista de correo, no un aviso. */
export const MAX_DESTINATARIOS = 10;

const PATRON_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function correoValido(c: string): boolean {
  return PATRON_CORREO.test(c.trim());
}

/**
 * Lo que la persona escribe en el campo "Para": separados por coma, punto y
 * coma, espacio o salto de línea. Devuelve los válidos (sin repetir, en
 * minúsculas) y los que no se entienden, para decirlos.
 */
export function revisarDestinatarios(texto: string | readonly string[]): { validos: string[]; invalidos: string[] } {
  const partes = (typeof texto === "string" ? texto.split(/[\s,;]+/) : [...texto]).map((p) => p.trim()).filter(Boolean);
  const validos: string[] = [];
  const invalidos: string[] = [];
  for (const p of partes) {
    const c = p.toLowerCase();
    if (!correoValido(c)) invalidos.push(p);
    else if (!validos.includes(c)) validos.push(c);
  }
  return { validos, invalidos };
}

export interface Correo {
  readonly asunto: string;
  readonly texto: string;
}

const pie = (empresa: string) =>
  `\n\n—\n${empresa}\nEste correo lo envió Asistectire. Si no esperaba recibirlo, puede ignorarlo.`;

const conMensaje = (mensaje: string | undefined) => (mensaje?.trim() ? `${mensaje.trim()}\n\n` : "");

/** PDF de una orden enviado a mano desde la app. */
export function correoOrden(d: { empresa: string; folio: string; vehiculo: string; quien: string; mensaje?: string }): Correo {
  return {
    asunto: `Orden de servicio ${d.folio} · ${d.vehiculo}`,
    texto: `${conMensaje(d.mensaje)}Adjuntamos la orden de servicio ${d.folio} del vehículo ${d.vehiculo}.\n\nEnviada por ${d.quien}.${pie(d.empresa)}`,
  };
}

/** Informe (CSV o PDF de varias órdenes) enviado a mano. */
export function correoInforme(d: {
  empresa: string;
  formato: "csv" | "pdf";
  ordenes: number;
  sinCerrar: number;
  quien: string;
  mensaje?: string;
}): Correo {
  const que = d.formato === "csv" ? "el informe de llantas (CSV, para Excel)" : `${d.ordenes === 1 ? "la orden" : `las ${d.ordenes} órdenes`} en PDF`;
  // Lo preliminar se dice también en el correo: quien lo recibe puede no
  // abrir el archivo antes de reenviarlo.
  const aviso = d.sinCerrar > 0 ? `\n\nAtención: ${d.sinCerrar} de las órdenes no están cerradas; sus datos pueden cambiar.` : "";
  return {
    asunto: `${d.formato === "csv" ? "Informe de llantas" : "Órdenes de servicio"} · ${d.empresa}`,
    texto: `${conMensaje(d.mensaje)}Adjuntamos ${que}.${aviso}\n\nEnviado por ${d.quien}.${pie(d.empresa)}`,
  };
}

/**
 * Aviso automático al cliente: una orden espera su aprobación. Dice el plazo
 * y qué pasa si vence — el cierre tácito no puede ser una sorpresa, y nunca
 * debe parecer que el cliente aprobó.
 */
export function avisoPorAprobar(d: { empresa: string; folio: string; vehiculo: string; limite: string | null }): Correo {
  const plazo = d.limite
    ? `Tiene hasta el ${d.limite} para aprobarla u objetarla. Si no responde, la orden se cerrará por vencimiento del plazo (cierre tácito), y así quedará registrado: no como aprobada por usted.`
    : "Puede aprobarla u objetarla desde la aplicación.";
  return {
    asunto: `Orden ${d.folio} espera su aprobación`,
    texto: `La orden de servicio ${d.folio} del vehículo ${d.vehiculo} está lista para su revisión.\n\n${plazo}\n\nÁbrala en la aplicación Asistectire, en "Mis servicios".${pie(d.empresa)}`,
  };
}

export interface LlantaParaAviso {
  readonly vehiculo: string;
  readonly cliente: string;
  readonly posicion: number;
  readonly motivo: string;
}

/** Resumen diario a la oficina: lo que hay que cambiar ya. */
export function avisoCambios(d: { empresa: string; fecha: string; llantas: readonly LlantaParaAviso[] }): Correo {
  const g = porVehiculo(d.llantas);
  const n = d.llantas.length;
  return {
    asunto: `${n} ${n === 1 ? "llanta" : "llantas"} para cambio inmediato · ${d.fecha}`,
    texto: `Llantas para cambiar ya, en ${g.vehiculos} ${g.vehiculos === 1 ? "vehículo" : "vehículos"} de sus sedes:\n\n${g.texto}\n\nEl detalle está en la aplicación, en "Llantas para cambiar".${pie(d.empresa)}`,
  };
}

function porVehiculo(llantas: readonly LlantaParaAviso[]): { vehiculos: number; texto: string } {
  const grupos = new Map<string, LlantaParaAviso[]>();
  for (const l of llantas) {
    const k = `${l.vehiculo} · ${l.cliente}`;
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  const texto = [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([v, ls]) => `${v}\n${[...ls].sort((a, b) => a.posicion - b.posicion).map((l) => `  · Posición ${l.posicion}: ${l.motivo}`).join("\n")}`)
    .join("\n\n");
  return { vehiculos: grupos.size, texto };
}

/** "Llantas para cambiar" enviado a mano desde la app: todos los niveles. */
export function correoLlantasParaCambio(d: {
  empresa: string;
  fecha: string;
  llantas: readonly LlantaParaAviso[];
  quien: string;
  mensaje?: string;
}): Correo {
  const g = porVehiculo(d.llantas);
  const n = d.llantas.length;
  return {
    asunto: `Llantas para cambiar · ${d.fecha}`,
    texto: `${conMensaje(d.mensaje)}${n} ${n === 1 ? "llanta" : "llantas"} para cambiar en ${g.vehiculos} ${g.vehiculos === 1 ? "vehículo" : "vehículos"}:\n\n${g.texto}\n\nEnviado por ${d.quien}.${pie(d.empresa)}`,
  };
}

/** Cotización enviada a mano: el PDF adjunto, con los valores por definir. */
export function correoCotizacion(d: { empresa: string; cliente: string | null; quien: string; mensaje?: string }): Correo {
  return {
    asunto: `Cotización${d.cliente ? ` · ${d.cliente}` : ""} · ${d.empresa}`,
    texto: `${conMensaje(d.mensaje)}Adjuntamos la cotización de los cambios recomendados según el último levantamiento${d.cliente ? ` de ${d.cliente}` : ""}. Los valores se acuerdan aparte.\n\nEnviada por ${d.quien}.${pie(d.empresa)}`,
  };
}
