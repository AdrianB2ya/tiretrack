import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * Configuración de arranque que solo se nota en el dispositivo.
 *
 * Expo Router busca las pantallas en `src/app` si esa carpeta existe, antes
 * que en `app`. Aquí `src/app` existe —tiene el arranque y los proveedores—
 * y las pantallas viven en `app`: sin fijar la raíz, la app abría sin
 * ninguna de sus pantallas y tomaba los proveedores como rutas. Ninguna
 * prueba lo veía porque las pruebas no pasan por el enrutador.
 */

const raiz = join(__dirname, "..", "..");
const appJson = JSON.parse(readFileSync(join(raiz, "app.json"), "utf8")) as {
  expo: { plugins: (string | [string, Record<string, unknown>])[] };
};

function opcionesDe(plugin: string): Record<string, unknown> | undefined {
  for (const p of appJson.expo.plugins) {
    if (p === plugin) return {};
    if (Array.isArray(p) && p[0] === plugin) return p[1];
  }
  return undefined;
}

/** Archivos .ts/.tsx bajo una carpeta, recursivo. */
function fuentes(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(carpeta, e.name);
    if (e.isDirectory()) return fuentes(ruta);
    return /\.tsx?$/.test(e.name) ? [ruta] : [];
  });
}

describe("lo que se empaqueta en la app", () => {
  it("ningún módulo de la app importa código que solo existe en Node", () => {
    // Metro resuelve también los import() dinámicos: cuando la conexión de
    // pruebas compartía archivo con la del dispositivo, el paquete para
    // Android no se podía construir ("Unable to resolve module fs").
    const soloNode = /from\s+["'](better-sqlite3|node:[^"']+|fs|path|child_process)["']|import\(\s*["'](better-sqlite3|node:[^"']+|fs|path)["']\s*\)/;
    const deLaApp = [...fuentes(join(raiz, "app")), ...fuentes(join(raiz, "src"))].filter(
      (f) => !f.includes(`${sep}pruebas${sep}`) && !f.endsWith("conexionNode.ts"),
    );
    const culpables = deLaApp.filter((f) => soloNode.test(readFileSync(f, "utf8")));
    expect(culpables).toEqual([]);
  });
});

describe("pantallas construidas y conectadas", () => {
  const rutas = () => fuentes(join(raiz, "app")).map((f) => readFileSync(f, "utf8")).join("\n");

  it("cada pantalla construida está montada en alguna ruta", () => {
    // Pasó tres veces: firma, decisión del coordinador y galería existían,
    // probadas, y ninguna ruta las montaba. En el teléfono no había forma de
    // firmar, aprobar ni devolver.
    const pantallas = [
      "CapturaFirma", "DecisionRevision", "FormularioDatosOrden", "PantallaCuenta",
      "PantallaEnvio", "PantallaIngreso", "BandejaRevision", "ListaOrdenes", "FotosDe",
      "FormularioNuevaOrden", "PantallaFlota", "PortalCliente", "DecisionCliente", "PantallaActivacion",
      "PantallaUsuarios", "PantallaSedes",
    ];
    const codigo = rutas();
    expect(pantallas.filter((p) => !new RegExp(`<${p}\\b`).test(codigo))).toEqual([]);
  });

  it("cada destino de navegación tiene su archivo de ruta", () => {
    // Un push a una ruta inexistente no falla al compilar: se descubre en el
    // teléfono, con una pantalla de "no encontrado".
    const codigo = [...fuentes(join(raiz, "app")), ...fuentes(join(raiz, "src"))]
      .filter((f) => !f.includes(`${sep}pruebas${sep}`))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const destinos = [...codigo.matchAll(/router\.(?:push|replace)\(\s*[`"]([^`"]+)[`"]/g)].map((m) => m[1] as string);
    expect(destinos.length).toBeGreaterThan(5);
    const faltantes = destinos.filter((d) => {
      const ruta = d.replace(/\$\{[^}]+\}/g, "[x]").replace(/^\//, "");
      const partes = ruta.split("/").map((s) => (s === "[x]" ? null : s));
      // /orden/[x]/datos → app/orden/[id]/datos.tsx o .../datos/index.tsx
      const candidatas = [partes, [...partes, "index"]].map((ps) => {
        let dir = join(raiz, "app");
        for (const [i, p] of ps.entries()) {
          const final = i === ps.length - 1;
          if (p === null) {
            // Segmento dinámico: carpeta [id]/ en medio, archivo [numero].tsx al final.
            const patron = final ? /^\[.+\]\.tsx$/ : /^\[.+\]$/;
            const dinamico = readdirSync(dir).find((n) => patron.test(n));
            if (!dinamico) return null;
            if (final) return join(dir, dinamico);
            dir = join(dir, dinamico);
          } else if (final) {
            return join(dir, `${p}.tsx`);
          } else {
            dir = join(dir, p);
            if (!existsSync(dir)) return null;
          }
        }
        return null;
      });
      return !candidatas.some((c) => c !== null && existsSync(c));
    });
    expect(faltantes).toEqual([]);
  });
});

describe("cabecera nativa", () => {
  it("no lleva botones: en Android con la arquitectura nueva no reciben los toques", () => {
    // react-native-screens 4.4 (SDK 52): "Cuenta" en headerRight se veía y no
    // respondía. Las acciones van dentro de la pantalla (BarraSesion).
    const disposicion = readFileSync(join(raiz, "app", "_layout.tsx"), "utf8");
    expect(disposicion).not.toMatch(/headerRight|headerLeft/);
  });
});

describe("raíz de las pantallas", () => {
  it("si existe src/app, la raíz del enrutador está fijada a ./app", () => {
    if (!existsSync(join(raiz, "src", "app"))) return;
    expect(opcionesDe("expo-router")?.["root"]).toBe("./app");
  });

  it("la raíz fijada contiene las pantallas de entrada", () => {
    const carpeta = String(opcionesDe("expo-router")?.["root"] ?? "./app");
    for (const pantalla of ["_layout.tsx", "index.tsx", "ingresar.tsx", "ordenes.tsx"]) {
      expect(existsSync(join(raiz, carpeta, pantalla)), `falta ${pantalla} en ${carpeta}`).toBe(true);
    }
  });
});
