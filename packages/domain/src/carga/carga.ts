import { claveIdentificador } from "../llanta/activo";
import { leerDOT } from "../llanta/dot";
import { medidaValida, normalizarMedida } from "../catalogo/ambito";
import { TIPOS_EJE, TIPOS_SERVICIO } from "../tipos";
import { BASE_REPUESTO, MAX_REPUESTOS } from "../llanta/repuestos";
import { fechaEnColombia } from "../tiempo/zona";

/**
 * Carga masiva desde Excel (R12, brecha E).
 *
 * Dar de alta un cliente con 200 vehículos a mano es inviable. Se carga un
 * CSV —en Excel: "Guardar como → CSV"— con las columnas de una plantilla.
 *
 * - **La misma validación en la app y en el servidor**: la app muestra fila
 *   por fila qué está mal ANTES de enviar; el servidor vuelve a validar.
 * - **Todo o nada**: si una fila está mal, no se carga ninguna. Media carga
 *   deja al usuario sin saber qué entró y qué no, y la segunda vuelta
 *   duplicaría lo que sí entró.
 * - Lo que ya existe se reconoce y no se duplica: el cliente por su NIT, la
 *   sede por su nombre, el vehículo por su código, la llanta por su serial o
 *   número interno, la marca por su nombre.
 */

export const TIPOS_CARGA = ["flota", "llantas", "catalogo", "ordenes"] as const;
export type TipoCarga = (typeof TIPOS_CARGA)[number];

export const ETIQUETA_CARGA: Record<TipoCarga, string> = {
  flota: "Clientes y vehículos",
  llantas: "Llantas",
  catalogo: "Catálogo de llantas",
  ordenes: "Órdenes anteriores",
};

interface Columna {
  readonly nombre: string;
  readonly obligatoria: boolean;
  readonly ejemplo: string;
}

export const PLANTILLAS: Record<TipoCarga, readonly Columna[]> = {
  flota: [
    { nombre: "CLIENTE", obligatoria: true, ejemplo: "Transportes Reyna" },
    { nombre: "NIT", obligatoria: true, ejemplo: "800.112.334-1" },
    { nombre: "SEDE", obligatoria: true, ejemplo: "Planta Fundación" },
    { nombre: "CODIGO", obligatoria: true, ejemplo: "CA-12" },
    { nombre: "PLACA", obligatoria: false, ejemplo: "SXK482" },
    { nombre: "DESCRIPCION", obligatoria: true, ejemplo: "Tractocamión Kenworth" },
    { nombre: "PLANTILLA", obligatoria: true, ejemplo: "Tractocamión 6x4" },
    { nombre: "KM", obligatoria: false, ejemplo: "78900" },
  ],
  llantas: [
    { nombre: "NIT CLIENTE", obligatoria: true, ejemplo: "800.112.334-1" },
    { nombre: "SEDE", obligatoria: true, ejemplo: "FUN" },
    { nombre: "NUMERO INTERNO", obligatoria: false, ejemplo: "A-17" },
    { nombre: "SERIAL", obligatoria: false, ejemplo: "MX10023458" },
    { nombre: "CALOR", obligatoria: false, ejemplo: "H2201" },
    { nombre: "DOT", obligatoria: false, ejemplo: "3624" },
    { nombre: "MEDIDA", obligatoria: false, ejemplo: "295/80R22.5" },
    { nombre: "COSTO", obligatoria: false, ejemplo: "1850000" },
  ],
  catalogo: [
    { nombre: "MARCA", obligatoria: true, ejemplo: "Michelin" },
    { nombre: "DISEÑO", obligatoria: true, ejemplo: "XZE" },
    { nombre: "TIPO EJE", obligatoria: true, ejemplo: "direccional" },
    { nombre: "MEDIDA", obligatoria: true, ejemplo: "295/80R22.5" },
    { nombre: "PROF FABRICA", obligatoria: false, ejemplo: "16" },
  ],
  // Órdenes hechas antes de usar la app (2026-10-17): una fila por llanta.
  // Las filas del mismo vehículo, fecha y número anterior son una orden.
  ordenes: [
    { nombre: "NUMERO ANTERIOR", obligatoria: false, ejemplo: "1234" },
    { nombre: "FECHA", obligatoria: true, ejemplo: "2025-03-14" },
    { nombre: "SEDE", obligatoria: true, ejemplo: "FUN" },
    { nombre: "NIT CLIENTE", obligatoria: true, ejemplo: "800.112.334-1" },
    { nombre: "VEHICULO", obligatoria: true, ejemplo: "CA-12" },
    { nombre: "TIPO", obligatoria: false, ejemplo: "preventivo" },
    { nombre: "KM", obligatoria: false, ejemplo: "65400" },
    { nombre: "TECNICO", obligatoria: false, ejemplo: "Carlos Méndez" },
    { nombre: "HALLAZGOS", obligatoria: false, ejemplo: "Desgaste irregular en el eje 2" },
    { nombre: "POSICION", obligatoria: true, ejemplo: "1" },
    { nombre: "MARCA", obligatoria: false, ejemplo: "Michelin" },
    { nombre: "DISEÑO", obligatoria: false, ejemplo: "XZE" },
    { nombre: "MEDIDA", obligatoria: false, ejemplo: "295/80R22.5" },
    { nombre: "SERIAL", obligatoria: false, ejemplo: "MX10023458" },
    { nombre: "DOT", obligatoria: false, ejemplo: "3624" },
    { nombre: "CALOR", obligatoria: false, ejemplo: "H2201" },
    { nombre: "PROF EXT", obligatoria: false, ejemplo: "12,5" },
    { nombre: "PROF CEN", obligatoria: false, ejemplo: "12" },
    { nombre: "PROF INT", obligatoria: false, ejemplo: "11,5" },
    { nombre: "PSI ENCONTRADA", obligatoria: false, ejemplo: "100" },
    { nombre: "PSI CALIBRADA", obligatoria: false, ejemplo: "110" },
    { nombre: "OBSERVACIONES", obligatoria: false, ejemplo: "" },
  ],
};

/** El tope de una carga: más filas, en varias cargas (la transacción no se eterniza). */
export const MAX_FILAS_CARGA = 2000;

/** Marca de orden de bytes: sin ella Excel muestra "DiseÃ±o". */
const BOM = String.fromCharCode(0xfeff);

/** La plantilla vacía para descargar, con una fila de ejemplo. */
export function plantillaCSV(tipo: TipoCarga): string {
  const cols = PLANTILLAS[tipo];
  return `${BOM}${cols.map((c) => c.nombre).join(";")}\n${cols.map((c) => c.ejemplo).join(";")}\n`;
}

/**
 * Lee el CSV que guarda Excel: separador `;` (configuración española) o `,`,
 * comillas dobles con comillas escapadas, BOM al inicio, fin de línea de
 * Windows. Devuelve las filas como objetos por nombre de columna (en
 * mayúsculas, sin tildes en la comparación).
 */
export function leerCSV(texto: string): { columnas: string[]; filas: Record<string, string>[] } {
  const limpio = texto.startsWith(BOM) ? texto.slice(1) : texto;
  const primera = limpio.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primera.match(/;/g)?.length ?? 0) >= (primera.match(/,/g)?.length ?? 0) ? ";" : ",";
  const registros: string[][] = [];
  let campo = "";
  let fila: string[] = [];
  let enComillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (enComillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') enComillas = false;
      else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i++;
      fila.push(campo);
      registros.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    registros.push(fila);
  }
  const noVacias = registros.filter((r) => r.some((x) => x.trim() !== ""));
  const columnas = (noVacias[0] ?? []).map(normalizarColumna);
  const filas = noVacias.slice(1).map((r) => Object.fromEntries(columnas.map((c, i) => [c, (r[i] ?? "").trim()])));
  return { columnas, filas };
}

/** "Diseño" y "DISENO" son la misma columna. */
export function normalizarColumna(c: string): string {
  return c.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}

export interface ErrorFila {
  /** Fila del archivo, contando el encabezado como 1 (como la ve Excel). */
  readonly fila: number;
  readonly mensaje: string;
}

export interface Validacion {
  readonly errores: ErrorFila[];
  readonly filas: number;
}

const numero = (v: string) => {
  const t = v.replace(/\./g, "").replace(",", ".").trim();
  return t === "" ? null : Number(t);
};

/** Las columnas que faltan y las filas imposibles, todas juntas. */
export function validarCarga(
  tipo: TipoCarga,
  csv: { columnas: string[]; filas: Record<string, string>[] },
  hoy: string = fechaEnColombia(),
): Validacion {
  const errores: ErrorFila[] = [];
  const faltan = PLANTILLAS[tipo].filter((c) => c.obligatoria && !csv.columnas.includes(normalizarColumna(c.nombre)));
  if (faltan.length > 0) {
    return { filas: csv.filas.length, errores: [{ fila: 1, mensaje: `Faltan columnas: ${faltan.map((c) => c.nombre).join(", ")}` }] };
  }
  if (csv.filas.length === 0) return { filas: 0, errores: [{ fila: 2, mensaje: "El archivo no tiene filas" }] };
  if (csv.filas.length > MAX_FILAS_CARGA) {
    return { filas: csv.filas.length, errores: [{ fila: 1, mensaje: `Son ${csv.filas.length} filas: carga de a ${MAX_FILAS_CARGA} como máximo` }] };
  }
  const vistos = new Set<string>();
  csv.filas.forEach((f, i) => {
    const n = i + 2;
    const v = (c: string) => f[normalizarColumna(c)] ?? "";
    for (const c of PLANTILLAS[tipo]) {
      if (c.obligatoria && !v(c.nombre)) errores.push({ fila: n, mensaje: `Falta ${c.nombre}` });
    }
    if (tipo === "flota") {
      const km = numero(v("KM"));
      if (km !== null && (!Number.isFinite(km) || km < 0)) errores.push({ fila: n, mensaje: "KM no es un número" });
      const clave = `${v("NIT").replace(/\D/g, "")}|${v("SEDE").toUpperCase()}|${v("CODIGO").toUpperCase()}`;
      if (v("CODIGO") && vistos.has(clave)) errores.push({ fila: n, mensaje: `Vehículo ${v("CODIGO")} repetido en el archivo` });
      vistos.add(clave);
    }
    if (tipo === "llantas") {
      const id = claveIdentificador(v("SERIAL")) ?? claveIdentificador(v("NUMERO INTERNO"));
      if (!id) errores.push({ fila: n, mensaje: "Sin serial ni número interno: la llanta no se puede seguir" });
      if (v("DOT") && !leerDOT(v("DOT"))) errores.push({ fila: n, mensaje: "DOT inválido: son 4 dígitos, semana y año" });
      if (v("MEDIDA") && !medidaValida(normalizarMedida(v("MEDIDA")))) errores.push({ fila: n, mensaje: "Medida inválida (ej. 295/80R22.5)" });
      const costo = numero(v("COSTO"));
      if (costo !== null && (!Number.isFinite(costo) || costo < 0)) errores.push({ fila: n, mensaje: "COSTO no es un número" });
      const clave = `${v("NIT CLIENTE").replace(/\D/g, "")}|${id}`;
      if (id && vistos.has(clave)) errores.push({ fila: n, mensaje: "Llanta repetida en el archivo" });
      vistos.add(clave);
    }
    if (tipo === "ordenes") validarFilaOrden(v, n, hoy, errores, vistos);
    if (tipo === "catalogo") {
      if (v("TIPO EJE") && !TIPOS_EJE.includes(v("TIPO EJE").toLowerCase() as never)) {
        errores.push({ fila: n, mensaje: `TIPO EJE debe ser ${TIPOS_EJE.join(", ")}` });
      }
      if (v("MEDIDA") && !medidaValida(normalizarMedida(v("MEDIDA")))) errores.push({ fila: n, mensaje: "Medida inválida (ej. 295/80R22.5)" });
      const prof = numero(v("PROF FABRICA"));
      if (prof !== null && (!Number.isFinite(prof) || prof <= 0 || prof > 60)) errores.push({ fila: n, mensaje: "PROF FABRICA debe estar entre 0 y 60 mm" });
    }
  });
  return { filas: csv.filas.length, errores };
}

// ── Órdenes anteriores ─────────────────────────────────────────────────────

/** "2025-03-14" o "14/03/2025" → "2025-03-14". Fecha imposible: null. */
export function fechaDeCarga(v: string): string | null {
  const t = v.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const dma = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  const [a, m, d] = iso ? [iso[1], iso[2], iso[3]] : dma ? [dma[3], dma[2], dma[1]] : [];
  if (!a || !m || !d) return null;
  const f = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d)));
  if (f.getUTCFullYear() !== Number(a) || f.getUTCMonth() !== Number(m) - 1 || f.getUTCDate() !== Number(d)) return null;
  return f.toISOString().slice(0, 10);
}

/** "3" → 3; "R1" → 101 (el repuesto 1). Lo que no es una posición: null. */
export function posicionDeCarga(v: string): number | null {
  const t = v.trim().toUpperCase();
  const r = /^R(\d{1,2})$/.exec(t);
  if (r) {
    const n = Number(r[1]);
    return n >= 1 && n <= MAX_REPUESTOS ? BASE_REPUESTO + n : null;
  }
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 60 ? n : null;
}

/** Las filas del mismo vehículo, fecha y número anterior son una sola orden. */
export function claveOrdenHistorica(v: (c: string) => string): string {
  return [
    v("SEDE").toUpperCase(),
    v("NIT CLIENTE").replace(/\D/g, ""),
    v("VEHICULO").toUpperCase().replace(/[\s-]/g, ""),
    fechaDeCarga(v("FECHA")) ?? v("FECHA"),
    v("NUMERO ANTERIOR").trim().toUpperCase(),
  ].join("|");
}

function validarFilaOrden(
  v: (c: string) => string,
  n: number,
  hoy: string,
  errores: ErrorFila[],
  vistos: Set<string>,
): void {
  const fecha = fechaDeCarga(v("FECHA"));
  if (v("FECHA") && !fecha) errores.push({ fila: n, mensaje: "FECHA inválida: AAAA-MM-DD o DD/MM/AAAA" });
  if (fecha && fecha > hoy) errores.push({ fila: n, mensaje: "FECHA en el futuro: aquí van órdenes ya hechas" });
  const posicion = posicionDeCarga(v("POSICION"));
  if (v("POSICION") && posicion === null) errores.push({ fila: n, mensaje: "POSICION inválida: un número (1, 2…) o R1 para el repuesto 1" });
  if (v("TIPO") && !(TIPOS_SERVICIO as readonly string[]).includes(v("TIPO").toLowerCase())) {
    errores.push({ fila: n, mensaje: `TIPO debe ser ${TIPOS_SERVICIO.join(", ")}` });
  }
  const km = numero(v("KM"));
  if (km !== null && (!Number.isFinite(km) || km < 0)) errores.push({ fila: n, mensaje: "KM no es un número" });
  if (v("DOT") && !leerDOT(v("DOT"))) errores.push({ fila: n, mensaje: "DOT inválido: son 4 dígitos, semana y año" });
  if (v("MEDIDA") && !medidaValida(normalizarMedida(v("MEDIDA")))) errores.push({ fila: n, mensaje: "Medida inválida (ej. 295/80R22.5)" });
  if ((v("DISEÑO") || v("MEDIDA")) && !v("MARCA")) errores.push({ fila: n, mensaje: "Hay diseño o medida sin MARCA" });
  for (const c of ["PROF EXT", "PROF CEN", "PROF INT"]) {
    const p = numero(v(c));
    if (p !== null && (!Number.isFinite(p) || p < 0 || p > 60)) errores.push({ fila: n, mensaje: `${c} debe estar entre 0 y 60 mm` });
  }
  for (const c of ["PSI ENCONTRADA", "PSI CALIBRADA"]) {
    const p = numero(v(c));
    if (p !== null && (!Number.isFinite(p) || p < 0 || p > 250)) errores.push({ fila: n, mensaje: `${c} debe estar entre 0 y 250` });
  }
  if (posicion !== null) {
    const clave = `${claveOrdenHistorica(v)}|${posicion}`;
    if (vistos.has(clave)) errores.push({ fila: n, mensaje: `Posición ${v("POSICION")} repetida en la misma orden` });
    vistos.add(clave);
  }
}

/** Número del archivo a número: acepta "1.850.000" y "16,5". */
export function numeroDeCarga(v: string | undefined): number | null {
  const n = numero(v ?? "");
  return n === null || !Number.isFinite(n) ? null : n;
}
