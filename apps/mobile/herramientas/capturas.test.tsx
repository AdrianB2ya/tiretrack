/**
 * Capturas de todas las pantallas, para revisar el diseño sin teléfono.
 *
 * Dibuja cada pantalla con el mismo montaje del recorrido (datos reales en
 * SQLite, cada rol) y guarda un HTML con los estilos que generó
 * react-native-web. `capturas.mjs` lo fotografía con Chrome a tamaño de
 * teléfono. No es una prueba: corre solo con `npm run capturas`.
 *
 * Lo que NO muestra: la barra de título del Stack (aquí no hay navegador
 * nativo) ni las fuentes del sistema Android. Sirve para composición,
 * colores, espaciado, jerarquía y textos cortados.
 */
import { it, vi } from "vitest";
import { useEffect, type ComponentType, type ReactNode } from "react";
import { render, act, cleanup, waitFor } from "@testing-library/react";
import { Text } from "react-native";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { abrirBaseEnMemoria } from "../src/datos/conexionNode";
import { migrar, type Conexion } from "../src/datos/base";
import { RepositorioLocal } from "../src/datos/repositorio";
import { Descargador, type PaqueteDescargado } from "../src/datos/descarga";
import { MotorSincronizacion } from "../src/datos/sincronizacion";
import { ServicioSesion, type UsuarioSesion } from "../src/sesion/servicio";
import { AlmacenSeguroMemoria } from "../src/sesion/almacen";
import { ProveedorSesion, useSesion } from "../src/app/ProveedorSesion";
import { DatosDeLaSesion } from "../src/app/DatosDeLaSesion";
import { ProveedorServicios } from "../src/app/Arranque";
import { datosEnLinea } from "./datosCapturas";

let params: Record<string, string> = {};
const router = {
  push: () => undefined, replace: () => undefined, back: () => undefined,
  setParams: () => undefined, dismissAll: () => undefined, canGoBack: () => true,
};
let titulo = "";
vi.mock("expo-router", () => {
  const Stack = ({ children }: { children?: ReactNode }) => <>{children}</>;
  Stack.Screen = ({ options }: { options?: { title?: string } }) => {
    if (options?.title) titulo = options.title;
    return null;
  };
  return {
    useRouter: () => router,
    useLocalSearchParams: () => params,
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
    Redirect: ({ href }: { href: string }) => <Text>{`redirige:${href}`}</Text>,
    Stack,
    Link: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

const SEDE = "sede-fun";
const usuarios: Record<string, UsuarioSesion> = {
  tecnico: { id: "u-tec1", nombre: "Carlos Méndez", email: "c@x.co", rol: "tecnico", empresaId: "emp-1", clienteId: null, sedes: [SEDE], sedePrincipal: SEDE },
  coordinador: { id: "u-coo", nombre: "Jorge Ramírez", email: "j@x.co", rol: "coordinador", empresaId: "emp-1", clienteId: null, sedes: [SEDE], sedePrincipal: SEDE },
  administrador: { id: "u-adm", nombre: "Marcela Ospina", email: "m@x.co", rol: "administrador", empresaId: "emp-1", clienteId: null, sedes: [SEDE], sedePrincipal: SEDE },
  cliente: { id: "u-cli", nombre: "Luis Reyna", email: "l@x.co", rol: "cliente", empresaId: "emp-1", clienteId: "cli-1", sedes: [], sedePrincipal: null },
  superadmin: { id: "u-sup", nombre: "Soporte Plataforma", email: "s@x.co", rol: "superadmin", empresaId: null, clienteId: null, sedes: [], sedePrincipal: null } as unknown as UsuarioSesion,
};

function orden(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, sedeId: SEDE, clienteId: "cli-1", sedeClienteId: "sc-1", vehiculoId: "veh-1", tecnicoId: "u-tec1",
    configuracionEjeId: "cfg-10", folio: `OS-FUN-00001${id.slice(-1)}`, tipo: "preventivo", estado: "en_proceso",
    fecha: "2026-10-06", kilometraje: 78900, hallazgos: null, motivoDevolucion: null, notaCoordinador: null,
    version: 3, versionContenido: 2, codigoReferencia: null, accion: null, firmaNombre: null, firmaCedula: null,
    firmaCargo: null, firmaVersion: null, firmaFechaHora: null, ...extra,
  };
}
const firmada = { firmaNombre: "Luis Reyna", firmaCedula: "77221004", firmaVersion: 2, firmaFechaHora: "2026-10-06T14:00:00.000Z" };

/** Un tractocamión de 10 posiciones: direccional sencillo y dos de tracción duales. */
const POSICIONES = [
  { numero: 1, eje: 1, lado: "izquierdo", esInterna: false, tipoEje: "direccional" },
  { numero: 2, eje: 1, lado: "derecho", esInterna: false, tipoEje: "direccional" },
  { numero: 3, eje: 2, lado: "izquierdo", esInterna: false, tipoEje: "traccion" },
  { numero: 4, eje: 2, lado: "izquierdo", esInterna: true, tipoEje: "traccion" },
  { numero: 5, eje: 2, lado: "derecho", esInterna: true, tipoEje: "traccion" },
  { numero: 6, eje: 2, lado: "derecho", esInterna: false, tipoEje: "traccion" },
  { numero: 7, eje: 3, lado: "izquierdo", esInterna: false, tipoEje: "traccion" },
  { numero: 8, eje: 3, lado: "izquierdo", esInterna: true, tipoEje: "traccion" },
  { numero: 9, eje: 3, lado: "derecho", esInterna: true, tipoEje: "traccion" },
  { numero: 10, eje: 3, lado: "derecho", esInterna: false, tipoEje: "traccion" },
].map((p) => ({ ...p, psiObjetivo: 110, profundidadMinima: p.tipoEje === "direccional" ? 4 : 3 }));

const paquete: PaqueteDescargado = {
  hasta: "2026-10-06T15:00:00.000Z",
  incremental: false,
  ordenes: [
    orden("ord-1", { hallazgos: "Desgaste irregular en el eje 2" }),
    orden("ord-2", { estado: "en_revision", ...firmada, enviadaRevisionEn: "2026-10-03T15:00:00.000Z", tecnicoNombre: "Carlos Méndez" }),
    orden("ord-3", { estado: "pendiente_cliente", ...firmada, limiteCliente: "2026-10-09" }),
    orden("ord-4", { estado: "programada", tipo: "levantamiento", notaCoordinador: "Revisar el repuesto" }),
    orden("ord-5", { motivoDevolucion: "Confirma la profundidad de la posición 3: parece un error de dedo" }),
  ],
  mediciones: [1, 2, 3, 4, 5, 6, 7].map((posicion) => ({
    id: `med-${posicion}`, ordenId: "ord-1", posicion, marcaId: "mar-1", disenoId: "dis-1", medida: "295/80R22.5",
    numCalor: null, serial: `MX10${posicion}23`, dot: "3624", estadoLlanta: "Nueva", psiEncontrada: posicion === 5 ? 80 : 105, psiCalibrado: 110,
    profundidad: posicion === 3 ? 2.8 : posicion === 6 ? 4.5 : 9, observaciones: null, noIdentificada: false, motivoNoIdentificada: null,
    capturadoPorId: "u-tec1", servicios: ["CALI"],
  })),
  catalogo: {
    marcas: [
      { id: "mar-1", nombre: "Michelin", esGlobal: true },
      { id: "mar-2", nombre: "Bridgestone", esGlobal: true },
      { id: "mar-3", nombre: "Goodyear", esGlobal: true },
    ],
    disenos: [{ id: "dis-1", marcaId: "mar-1", nombre: "XDN-2", tipoEje: "traccion" }],
    medidas: [{ id: "med-1", disenoId: "dis-1", medida: "295/80R22.5", profundidadOriginal: 16 }],
  },
  flota: {
    clientes: [
      { id: "cli-1", nombre: "Transportes Reyna", nit: "800123456" },
      { id: "cli-2", nombre: "Cementos del Caribe", nit: "900765432" },
    ],
    sedes: [{ id: "sc-1", clienteId: "cli-1", nombre: "Planta Fundación" }],
    vehiculos: [
      { id: "veh-1", sedeClienteId: "sc-1", configuracionEjeId: "cfg-10", codigo: "CA-12", placa: "SXK482", nombre: "Tractocamión", kmActual: 78900, repuestos: 1 },
      { id: "veh-2", sedeClienteId: "sc-1", configuracionEjeId: "cfg-10", codigo: "CA-15", placa: "TRK903", nombre: "Tractocamión", kmActual: 120400 },
    ],
  },
  configuraciones: [{ id: "cfg-10", nombre: "Tractocamión 6x4", version: 1, vigente: true, posiciones: POSICIONES }],
  tecnicos: [{ id: "u-tec1", nombre: "Carlos Méndez", sedeId: SEDE, activo: true }, { id: "u-tec2", nombre: "Ana Torres", sedeId: SEDE, activo: true }],
  sedes: [{ id: SEDE, nombre: "Fundación", codigo: "FUN", ciudad: null }],
} as unknown as PaqueteDescargado;

const APP = resolve(__dirname, "..", "app");
const TITULOS: Record<string, string> = Object.fromEntries(
  [...readFileSync(join(APP, "(app)", "_layout.tsx"), "utf8").matchAll(/name="([^"]+)" options={{ title: "([^"]+)"/g)].map((m) => [m[1]!, m[2]!]),
);
function pantallas(dir = APP): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    if (statSync(ruta).isDirectory()) return pantallas(ruta);
    return n.endsWith(".tsx") && n !== "_layout.tsx" ? [ruta] : [];
  });
}
const nombre = (f: string) => relative(APP, f).split(sep).join("/");

let db: Conexion;
let sesion: ServicioSesion;

async function preparar(usuario: UsuarioSesion | null) {
  db = await abrirBaseEnMemoria();
  await migrar(db);
  const repo = new RepositorioLocal(db);
  sesion = new ServicioSesion(new AlmacenSeguroMemoria(), db);
  if (usuario) {
    await sesion.iniciar({ token: "t", refreshToken: "r", usuario });
    await new Descargador(repo, { conservarCerradas: usuario.rol === "cliente" }).descargar({ traer: async () => paquete });
  }
  return repo;
}

function TrasLaSesion({ children }: { children: ReactNode }) {
  const { cargando } = useSesion();
  return cargando ? <Text>cargando sesión</Text> : <>{children}</>;
}

/** El CSS que react-native-web insertó con insertRule: no está en el textContent. */
function css(): string {
  return Array.from(document.styleSheets)
    .flatMap((h) => { try { return Array.from(h.cssRules).map((r) => r.cssText); } catch { return []; } })
    .join("\n");
}

const SALIDA = process.env.CAPTURAS_DIR ?? resolve(__dirname, "..", ".capturas");
const RAIZ_REPO = resolve(__dirname, "..");

function guardar(archivo: string, cuerpo: string) {
  // Las imágenes llegan como ruta del módulo: se vuelven file:// para Chrome.
  const html = cuerpo
    .replace(/src="(\/[^"]+\.(png|jpg))"/g, (_m, r: string) => `src="${pathToFileURL(join(RAIZ_REPO, r)).href}"`)
    // react-native-web dibuja la imagen como fondo del div.
    .replace(/url\(&quot;(\/[^&]+\.(png|jpg))&quot;\)/g, (_m, r: string) => `url(&quot;${pathToFileURL(join(RAIZ_REPO, r)).href}&quot;)`);
  writeFileSync(join(SALIDA, archivo), `<!doctype html><html><head><meta charset="utf-8">
<style>${css()}</style>
<style>html,body{margin:0;background:#090706;font-family:Roboto,"Segoe UI",Arial,sans-serif}
#marco{width:412px;min-height:200px;display:flex;flex-direction:column}
.cabecera{height:56px;display:flex;align-items:center;padding:0 16px;background:#141211;color:#F2F0EF;font:700 20px Roboto,"Segoe UI",sans-serif;border-bottom:1px solid #37312F}</style>
</head><body><div id="marco">${titulo === "(sin barra)" ? "" : `<div class="cabecera">${titulo || "«sin título»"}</div>`}${html}</div></body></html>`);
}

/** Qué rol ve mejor cada pantalla (el que la usa en el día). */
function rolesDe(n: string): (keyof typeof usuarios)[] {
  if (n === "cliente.tsx") return ["cliente"];
  if (["plataforma.tsx", "catalogo-general.tsx", "soporte.tsx"].includes(n)) return ["superadmin"];
  if (n.startsWith("orden/") || ["ordenes.tsx", "escanear.tsx", "vehiculo/[id].tsx"].includes(n)) return ["tecnico", "coordinador"];
  if (["mas.tsx", "llantas.tsx", "informe.tsx", "tablero.tsx"].includes(n)) return ["tecnico", "coordinador", "administrador", "cliente"];
  return ["administrador"];
}

vi.setConfig({ testTimeout: 600_000 });

it("capturas de todas las pantallas", async () => {
  mkdirSync(SALIDA, { recursive: true });
  const filtro = process.env.CAPTURAS_FILTRO;
  for (const archivo of pantallas()) {
    const n = nombre(archivo);
    const conSesion = n.startsWith("(app)/");
    const corto = n.replace("(app)/", "");
    if (filtro && !corto.includes(filtro)) continue;
    const roles = conSesion ? rolesDe(corto) : [null];
    const ids = corto.startsWith("orden/") ? ["ord-1", "ord-2", "ord-5"] : ["ord-1"];
    for (const rol of roles) {
      for (const id of ids) {
        const repo = await preparar(rol ? usuarios[rol]! : null);
        params = { id: corto.startsWith("llanta/") ? "ll-1" : corto.startsWith("vehiculo/") ? "veh-1" : id, numero: "3" };
        // El título que pone la disposición (o la pantalla misma, al dibujarse).
        titulo = TITULOS[corto.replace(/.tsx$/, "")] ?? (conSesion ? "" : "(sin barra)");
        const { default: Pantalla } = (await import(archivo)) as { default: ComponentType };
        const { container } = render(
          <ProveedorServicios value={{ sesion, apiUrl: "http://x", enLinea: datosEnLinea as never, descargarTexto: vi.fn() as never, descargarArchivo: (async () => ({ ok: false, status: 0, mensaje: "sin señal" })) as never }}>
            <ProveedorSesion servicio={sesion}>
              <DatosDeLaSesion db={db} sesion={sesion} motor={new MotorSincronizacion(repo, { enviar: async () => ({ tipo: "sin_conexion" as const, mensaje: "sin red" }) })} descarga={{ traer: async () => null }} intervaloSincronizacionMs={0}>
                <TrasLaSesion><Pantalla /></TrasLaSesion>
              </DatosDeLaSesion>
            </ProveedorSesion>
          </ProveedorServicios>,
        );
        await waitFor(() => { if ((container.textContent ?? "") === "cargando sesión") throw new Error("espera"); }, { timeout: 15_000 });
        await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
        const archivoHtml = `${corto.replace(/[/[\]().]/g, "_")}${rol ? `__${rol}` : ""}${ids.length > 1 ? `__${id}` : ""}.html`;
        guardar(archivoHtml, container.innerHTML);
        cleanup();
        await db.cerrar();
      }
    }
  }
});
