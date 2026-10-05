import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Conformidad entre los esquemas de prueba y el esquema real.
 *
 * Cada prueba de integración crea sus tablas a mano, más simples que las de
 * Prisma. El riesgo es que inventen columnas que el esquema real no tiene:
 * el servicio de mediciones filtraba por `"eliminadoEn"`, que NO existe en
 * `OrdenServicio`, y sus 22 pruebas pasaban porque el esquema de prueba
 * también lo inventaba. En producción habría fallado en cada medición.
 *
 * Esta prueba exige que toda tabla escrita a mano sea un SUBCONJUNTO de la
 * real. El razonamiento es transitivo: si una consulta pasa sus pruebas, sus
 * columnas existen en el esquema de prueba; y si ese esquema es subconjunto
 * del real, existen en producción.
 *
 * No verifica tipos ni restricciones, solo existencia de tablas y columnas,
 * que es el error que más fácil pasa inadvertido.
 */

const RAIZ = join(__dirname, "..", "..");

/** Tablas reales y sus columnas, leídas de schema.prisma. */
export function esquemaReal(): Map<string, Set<string>> {
  const texto = readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf-8");
  const modelos = [...texto.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const nombresDeModelo = new Set(modelos.map((m) => m[1] as string));

  const tablas = new Map<string, Set<string>>();
  for (const [, nombre, cuerpo] of modelos) {
    const mapaTabla = /@@map\("([^"]+)"\)/.exec(cuerpo as string)?.[1];
    const columnas = new Set<string>();

    for (const linea of (cuerpo as string).split("\n")) {
      const campo = /^\s+(\w+)\s+(\w+)(\[\])?\??/.exec(linea);
      if (!campo) continue;
      const [, nombreCampo, tipo, esLista] = campo;
      // Un campo cuyo tipo es otro modelo es una RELACIÓN, no una columna;
      // igual que las listas.
      if (nombresDeModelo.has(tipo as string) || esLista) continue;
      const mapa = /@map\("([^"]+)"\)/.exec(linea)?.[1];
      columnas.add(mapa ?? (nombreCampo as string));
    }
    tablas.set(mapaTabla ?? (nombre as string), columnas);
  }
  return tablas;
}

/** Tablas creadas a mano en los archivos de prueba. */
export function tablasDePrueba(): { archivo: string; tabla: string; columnas: string[] }[] {
  const dir = __dirname;
  const resultado: { archivo: string; tabla: string; columnas: string[] }[] = [];

  // Todos los .ts de pruebas, no solo los .test.ts: un helper compartido
  // (esquemas.ts) sería el lugar perfecto para volver a inventar columnas sin
  // que nadie lo notara. Se excluye este archivo, que menciona CREATE TABLE
  // en su propio código.
  const archivos = readdirSync(dir).filter(
    (f) => f.endsWith(".ts") && f !== "conformidad-esquema.test.ts",
  );
  for (const archivo of archivos) {
    const texto = readFileSync(join(dir, archivo), "utf-8");
    for (const m of texto.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?(\w+)"?\s*\(/g)) {
      const inicio = (m.index ?? 0) + m[0].length;
      // Recorre hasta el paréntesis que cierra, respetando los anidados.
      let nivel = 1;
      let i = inicio;
      while (i < texto.length && nivel > 0) {
        if (texto[i] === "(") nivel++;
        else if (texto[i] === ")") nivel--;
        i++;
      }
      const definicion = texto.slice(inicio, i - 1);
      resultado.push({ archivo, tabla: m[1] as string, columnas: columnasDe(definicion) });
    }
  }
  return resultado;
}

function columnasDe(definicion: string): string[] {
  // Divide por comas de primer nivel: las de dentro de paréntesis son de
  // tipos como numeric(6,2) o de restricciones compuestas.
  const partes: string[] = [];
  let nivel = 0;
  let actual = "";
  for (const c of definicion) {
    if (c === "(") nivel++;
    if (c === ")") nivel--;
    if (c === "," && nivel === 0) {
      partes.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  partes.push(actual);

  const columnas: string[] = [];
  for (const parte of partes) {
    // Quita los comentarios SQL de la línea antes de leer el nombre.
    const limpia = parte.replace(/--[^\n]*/g, "").trim();
    if (!limpia) continue;
    if (/^(UNIQUE|PRIMARY|FOREIGN|CONSTRAINT|CHECK|EXCLUDE)\b/i.test(limpia)) continue;
    const nombre = /^"?(\w+)"?/.exec(limpia)?.[1];
    if (nombre) columnas.push(nombre);
  }
  return columnas;
}

describe("conformidad de los esquemas de prueba con el real", () => {
  const real = esquemaReal();
  const deprueba = tablasDePrueba();

  it("encuentra tablas en ambos lados (la prueba no es vacía)", () => {
    // Si el analizador fallara en silencio, la prueba pasaría sin verificar
    // nada. Se exige un mínimo razonable en cada lado.
    expect(real.size).toBeGreaterThan(15);
    expect(deprueba.length).toBeGreaterThan(15);
    expect(real.get("OrdenServicio")?.has("tecnico_id")).toBe(true);
  });

  it("toda tabla de prueba existe en el esquema real", () => {
    const inventadas = deprueba
      .filter((t) => !real.has(t.tabla))
      .map((t) => `${t.archivo}: tabla "${t.tabla}"`);
    expect(inventadas).toEqual([]);
  });

  it("ninguna tabla de prueba tiene columnas que el esquema real no tiene", () => {
    const inventadas: string[] = [];
    for (const t of deprueba) {
      const columnasReales = real.get(t.tabla);
      if (!columnasReales) continue;
      for (const c of t.columnas) {
        if (!columnasReales.has(c)) inventadas.push(`${t.archivo}: "${t.tabla}"."${c}"`);
      }
    }
    expect(inventadas).toEqual([]);
  });
});
