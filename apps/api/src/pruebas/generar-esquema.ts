import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Genera el esquema de pruebas a partir del `schema.prisma` REAL.
 *
 * Escribir las tablas a mano falló tres veces seguidas, siempre igual: la
 * tabla de prueba era más pobre que la real, el servicio consultaba una
 * columna que allí no estaba, y el error solo aparecía cuando una prueba de
 * integración lo ejecutaba —o peor, habría aparecido en producción—.
 *
 * Generarlas elimina esa clase de error de raíz: si una columna existe en
 * Prisma, existe en las pruebas.
 *
 * Es una traducción **deliberadamente laxa**: no reproduce claves foráneas ni
 * valores por defecto salvo los que hacen falta para insertar. Lo que
 * garantiza es que **las columnas existan y los tipos sean compatibles**, que
 * es donde estaban los errores. Las restricciones que una prueba necesita
 * —un índice único, una foránea— se agregan aparte, explícitas.
 *
 * No se usa `prisma migrate diff` porque su motor se descarga de un dominio
 * que este entorno no alcanza.
 */

const TIPOS: Record<string, string> = {
  String: "text",
  Int: "integer",
  Boolean: "boolean",
  DateTime: "timestamptz",
  Decimal: "numeric",
  Json: "jsonb",
  Float: "double precision",
};

interface Campo {
  readonly columna: string;
  readonly tipo: string;
  readonly obligatorio: boolean;
  readonly porDefecto: string | null;
}

interface Modelo {
  readonly nombre: string;
  readonly tabla: string;
  readonly campos: Campo[];
  readonly clavePrimaria: string[];
}

function rutaEsquema(): string {
  return join(__dirname, "..", "..", "prisma", "schema.prisma");
}

/** Enums de Prisma, que se crean como tipos de PostgreSQL. */
export function enumsDePrisma(texto = readFileSync(rutaEsquema(), "utf-8")): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  for (const [, nombre, cuerpo] of texto.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)) {
    const valores = (cuerpo as string)
      .split("\n")
      .map((l) => l.replace(/\/\/.*/, "").trim())
      .filter((l) => /^\w+$/.test(l));
    enums.set(nombre as string, valores);
  }
  return enums;
}

export function modelosDePrisma(texto = readFileSync(rutaEsquema(), "utf-8")): Modelo[] {
  const enums = enumsDePrisma(texto);
  const bloques = [...texto.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const nombresDeModelo = new Set(bloques.map((m) => m[1] as string));

  return bloques.map(([, nombre, cuerpo]) => {
    const campos: Campo[] = [];
    const clavePrimaria: string[] = [];

    for (const linea of (cuerpo as string).split("\n")) {
      const compuesta = /@@id\(\[([^\]]+)\]\)/.exec(linea);
      if (compuesta) {
        clavePrimaria.push(...(compuesta[1] as string).split(",").map((c) => c.trim()));
        continue;
      }

      const campo = /^\s+(\w+)\s+(\w+)(\[\])?(\?)?/.exec(linea);
      if (!campo) continue;
      const [, nombreCampo, tipo, esLista, opcional] = campo;
      // Las relaciones y las listas no son columnas.
      if (nombresDeModelo.has(tipo as string) || esLista) continue;

      const columna = /@map\("([^"]+)"\)/.exec(linea)?.[1] ?? (nombreCampo as string);
      if (/@id\b/.test(linea)) clavePrimaria.push(columna);

      campos.push({
        columna,
        tipo: tipoSql(tipo as string, linea, enums),
        obligatorio: !opcional,
        porDefecto: valorPorDefecto(linea, tipo as string),
      });
    }

    const mapaTabla = /@@map\("([^"]+)"\)/.exec(cuerpo as string)?.[1];
    return { nombre: nombre as string, tabla: mapaTabla ?? (nombre as string), campos, clavePrimaria };
  });
}

function tipoSql(tipo: string, linea: string, enums: Map<string, string[]>): string {
  if (enums.has(tipo)) return `"${tipo}"`;
  const decimal = /@db\.Decimal\((\d+),\s*(\d+)\)/.exec(linea);
  if (decimal) return `numeric(${decimal[1]},${decimal[2]})`;
  if (/@db\.Date\b/.test(linea)) return "date";
  return TIPOS[tipo] ?? "text";
}

/**
 * Solo los valores por defecto que permiten insertar sin listar la columna.
 * Los generados por Prisma (uuid, cuid) no se reproducen: en este proyecto
 * los identificadores los genera el dispositivo.
 */
function valorPorDefecto(linea: string, tipo: string): string | null {
  // `@updatedAt` no tiene valor por defecto en el esquema: lo pone Prisma al
  // escribir. En SQL directo quedaría vacío y violaría el NOT NULL, así que
  // se le da el mismo valor que Prisma usaría.
  if (/@updatedAt\b/.test(linea)) return "now()";
  // `now()` lleva paréntesis: un patrón que corta en el primer ")" lee
  // "now(" y descarta el valor por defecto sin avisar.
  const d = /@default\((now\(\)|[^)]*)\)/.exec(linea)?.[1];
  if (d === undefined) return null;
  if (d === "now()") return "now()";
  if (d === "true" || d === "false") return d;
  if (/^-?\d+(\.\d+)?$/.test(d)) return d;
  if (/^"(.*)"$/.test(d)) return `'${d.slice(1, -1)}'`;
  if (/^\w+$/.test(d) && tipo !== "String") return `'${d}'`; // valor de enum
  return null;
}

export interface OpcionesEsquema {
  /** Restricciones extra que una prueba necesita, por tabla. */
  readonly extras?: Record<string, string[]>;
}

/** DDL de las tablas indicadas, en orden de dependencia libre (sin foráneas). */
export function ddlDePrueba(tablas: readonly string[], opciones: OpcionesEsquema = {}): string {
  const modelos = modelosDePrisma();
  const enums = enumsDePrisma();
  const porTabla = new Map(modelos.map((m) => [m.tabla, m]));

  const faltantes = tablas.filter((t) => !porTabla.has(t));
  if (faltantes.length > 0) {
    // Mejor fallar aquí que crear una tabla vacía y ver un error críptico.
    throw new Error(`No existen en schema.prisma: ${faltantes.join(", ")}`);
  }

  const partes: string[] = [];
  const entreComillas = tablas.map((t) => `"${t}"`).join(", ");
  partes.push(`DROP TABLE IF EXISTS ${entreComillas} CASCADE;`);
  for (const [nombre] of enums) partes.push(`DROP TYPE IF EXISTS "${nombre}" CASCADE;`);
  for (const [nombre, valores] of enums) {
    partes.push(`CREATE TYPE "${nombre}" AS ENUM (${valores.map((v) => `'${v}'`).join(",")});`);
  }

  for (const tabla of tablas) {
    const m = porTabla.get(tabla) as Modelo;
    const columnas = m.campos.map((c) => {
      const nulo = c.obligatorio && c.porDefecto === null ? " NOT NULL" : "";
      const def = c.porDefecto ? ` DEFAULT ${c.porDefecto}` : "";
      return `  "${c.columna}" ${c.tipo}${nulo}${def}`;
    });
    if (m.clavePrimaria.length > 0) {
      columnas.push(`  PRIMARY KEY (${m.clavePrimaria.map((c) => `"${c}"`).join(", ")})`);
    }
    for (const extra of opciones.extras?.[tabla] ?? []) columnas.push(`  ${extra}`);
    partes.push(`CREATE TABLE "${tabla}" (\n${columnas.join(",\n")}\n);`);
  }

  return partes.join("\n");
}
