import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Component, useEffect, type ComponentType, type ReactNode } from "react";
import { render, act, cleanup, waitFor } from "@testing-library/react";
import { Text } from "react-native";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar, type Conexion } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";
import { Descargador, type PaqueteDescargado } from "../datos/descarga";
import { MotorSincronizacion } from "../datos/sincronizacion";
import { ServicioSesion, type UsuarioSesion } from "../sesion/servicio";
import { AlmacenSeguroMemoria } from "../sesion/almacen";
import { ProveedorSesion, useSesion } from "../app/ProveedorSesion";
import { DatosDeLaSesion } from "../app/DatosDeLaSesion";
import { ProveedorServicios } from "../app/Arranque";
import { ErrorDePantalla } from "../app/ErrorDePantalla";
import { useDatos } from "../app/ProveedorDatos";
import { readFileSync } from "node:fs";

/**
 * Recorrido de TODAS las pantallas, con cada rol.
 *
 * Auditoría pedida por el usuario tras dos fallos que solo se vieron en el
 * teléfono (la lista dentro de un ScrollView y el error al cerrar sesión).
 * Cada pantalla de app/ se dibuja con datos reales en SQLite, para cada rol,
 * con una orden que existe y con una que no; la prueba falla si alguna
 * revienta, si deja un error sin atrapar o si queda en blanco.
 *
 * Las pantallas se descubren leyendo la carpeta: una pantalla nueva entra al
 * recorrido sin que nadie se acuerde de agregarla.
 */

// ── Enrutador falso: lo justo para que las pantallas se dibujen ─────────────

let params: Record<string, string> = {};
const navegaciones: string[] = [];
const router = {
  push: (r: string) => navegaciones.push(`push ${r}`),
  replace: (r: string) => navegaciones.push(`replace ${r}`),
  back: () => navegaciones.push("back"),
  setParams: () => undefined,
  dismissAll: () => undefined,
  canGoBack: () => true,
};

vi.mock("expo-router", () => {
  const Stack = ({ children }: { children?: ReactNode }) => <>{children}</>;
  Stack.Screen = () => null;
  return {
    useRouter: () => router,
    useLocalSearchParams: () => params,
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
    Redirect: ({ href }: { href: string }) => <Text>{`redirige:${href}`}</Text>,
    Stack,
    Link: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// ── Datos: lo que tendría un celular tras descargar ─────────────────────────

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
    configuracionEjeId: "cfg-4", folio: `OS-FUN-${id}`, tipo: "preventivo", estado: "en_proceso",
    fecha: "2026-10-06", kilometraje: 78900, hallazgos: null, motivoDevolucion: null, notaCoordinador: null,
    version: 3, versionContenido: 2, codigoReferencia: null, accion: null, firmaNombre: null, firmaCedula: null,
    firmaCargo: null, firmaVersion: null, firmaFechaHora: null, ...extra,
  };
}

const firmada = { firmaNombre: "Luis Reyna", firmaCedula: "77221004", firmaVersion: 2, firmaFechaHora: "2026-10-06T14:00:00.000Z" };

const paquete: PaqueteDescargado = {
  hasta: "2026-10-06T15:00:00.000Z",
  incremental: false,
  ordenes: [
    orden("ord-1"),
    orden("ord-2", { estado: "en_revision", ...firmada, enviadaRevisionEn: "2026-10-05T15:00:00.000Z" }),
    orden("ord-3", { estado: "pendiente_cliente", ...firmada, limiteCliente: "2026-10-09" }),
    orden("ord-4", { estado: "programada" }),
    orden("ord-5", { motivoDevolucion: "Confirma la posición 3" }),
  ],
  mediciones: [1, 2, 3].map((posicion) => ({
    id: `med-${posicion}`, ordenId: "ord-1", posicion, marcaId: "mar-1", disenoId: "dis-1", medida: "295/80R22.5",
    numCalor: null, serial: `MX${posicion}`, dot: "3624", estadoLlanta: "Nueva", psiEncontrada: 105, psiCalibrado: 110,
    profundidad: posicion === 3 ? 1.8 : 9, observaciones: null, noIdentificada: false, motivoNoIdentificada: null,
    capturadoPorId: "u-tec1", servicios: ["CALI"],
  })),
  catalogo: {
    marcas: [{ id: "mar-1", nombre: "Michelin", esGlobal: true }],
    disenos: [{ id: "dis-1", marcaId: "mar-1", nombre: "XDN-2", tipoEje: "traccion" }],
    medidas: [{ id: "med-1", disenoId: "dis-1", medida: "295/80R22.5", profundidadOriginal: 16 }],
  },
  flota: {
    clientes: [{ id: "cli-1", nombre: "Transportes Reyna", nit: "800" }],
    sedes: [{ id: "sc-1", clienteId: "cli-1", nombre: "Planta" }],
    vehiculos: [{ id: "veh-1", sedeClienteId: "sc-1", configuracionEjeId: "cfg-4", codigo: "CA-12", placa: "SXK482", nombre: "Tractocamión", kmActual: 78900 }],
  },
  configuraciones: [{
    id: "cfg-4", nombre: "4 posiciones", version: 1, vigente: true,
    posiciones: [1, 2, 3, 4].map((numero) => ({
      numero, eje: numero <= 2 ? 1 : 2, lado: numero % 2 === 1 ? "izquierdo" : "derecho",
      esInterna: false, tipoEje: numero <= 2 ? "direccional" : "traccion", psiObjetivo: 110, profundidadMinima: 3,
    })),
  }],
  tecnicos: [{ id: "u-tec1", nombre: "Carlos Méndez", sedeId: SEDE, activo: true }, { id: "u-tec2", nombre: "Ana Torres", sedeId: SEDE, activo: true }],
  sedes: [{ id: SEDE, nombre: "Fundación", codigo: "FUN", ciudad: null }],
} as unknown as PaqueteDescargado;

// ── Pantallas: se descubren de la carpeta ───────────────────────────────────

const APP = join(__dirname, "..", "..", "app");
function pantallas(dir = APP): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    if (statSync(ruta).isDirectory()) return pantallas(ruta);
    return n.endsWith(".tsx") && n !== "_layout.tsx" ? [ruta] : [];
  });
}
const nombre = (f: string) => relative(APP, f).split(sep).join("/");
const conSesion = (f: string) => nombre(f).startsWith("(app)/");

/** Atrapa lo que reviente al dibujar. */
class Atrapa extends Component<{ children: ReactNode; onError: (e: Error) => void }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  override render() {
    return this.state.error ? <Text>{`REVENTÓ: ${this.state.error.message}`}</Text> : this.props.children;
  }
}

/**
 * Lo mismo que hace la guardia de (app): no dibujar la pantalla hasta que la
 * sesión terminó de restaurarse. Las públicas se dibujan siempre.
 */
function TrasLaSesion({ exige, children }: { exige: boolean; children: ReactNode }) {
  const { cargando, usuario } = useSesion();
  if (cargando) return <Text>cargando sesión</Text>;
  if (exige && !usuario) return <Text>sin sesión</Text>;
  return <>{children}</>;
}

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

const enLinea = vi.fn(async (_metodo: string, ruta: string) => {
  if (ruta.startsWith("/informe/resumen")) return { ok: true, datos: { registros: 0, ordenes: 0, sinCerrar: 0, filas: [] } };
  return { ok: true, datos: [] };
});

function montar(Pantalla: ComponentType, repo: RepositorioLocal, onError: (e: Error) => void, exige = true) {
  return render(
    <ProveedorServicios value={{ sesion, apiUrl: "http://x", enLinea: enLinea as never, descargarTexto: vi.fn() as never, descargarArchivo: (async () => ({ ok: false, status: 0, mensaje: "sin señal" })) as never }}>
      <ProveedorSesion servicio={sesion}>
        <DatosDeLaSesion db={db} sesion={sesion} motor={new MotorSincronizacion(repo, { enviar: async () => ({ tipo: "sin_conexion" as const, mensaje: "sin red" }) })} descarga={{ traer: async () => null }} intervaloSincronizacionMs={0}>
          <Atrapa onError={onError}>
            <TrasLaSesion exige={exige}>
              <Pantalla />
            </TrasLaSesion>
          </Atrapa>
        </DatosDeLaSesion>
      </ProveedorSesion>
    </ProveedorServicios>,
  );
}

/** Deja correr los efectos y las promesas de la pantalla. */
const asentar = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });

/**
 * Espera a que la sesión termine de restaurarse y la pantalla se asiente.
 * Con un tiempo fijo, la suite completa —más cargada— la encontraba todavía
 * restaurando y fallaba a ratos.
 */
async function esperarPantalla(container: HTMLElement) {
  await waitFor(() => expect(container.textContent ?? "").not.toBe("cargando sesión"), { timeout: 15_000 });
  await asentar();
}

/**
 * Avisos de React y React Native en la consola. Son errores también: el de
 * "VirtualizedLists should never be nested" era un aviso, y en el teléfono
 * salió como pantalla roja.
 */
let avisos: string[] = [];

beforeEach(() => {
  params = {};
  navegaciones.length = 0;
  avisos = [];
  for (const nivel of ["error", "warn"] as const) {
    vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => {
      avisos.push(a.map(String).join(" ").slice(0, 300));
    });
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  cleanup();
  await db?.cerrar();
});

const LISTA = pantallas();

// La suite completa corre en paralelo y es mucho más lenta que este archivo
// solo: con el tiempo por defecto (5 s) las primeras pruebas vencían.
vi.setConfig({ testTimeout: 60_000 });

describe("recorrido de pantallas", () => {
  it("encuentra las pantallas de la app", () => {
    expect(LISTA.length).toBeGreaterThan(20);
  });

  for (const rol of ["tecnico", "coordinador", "administrador", "cliente", "superadmin"] as const) {
    for (const archivo of LISTA.filter(conSesion)) {
      for (const id of ["ord-1", "ord-2", "no-existe"]) {
        const dinamica = nombre(archivo).includes("[id]");
        if (!dinamica && id !== "ord-1") continue;
        it(`${rol} · ${nombre(archivo)}${dinamica ? ` · ${id}` : ""}`, async () => {
          const repo = await preparar(usuarios[rol] ?? null);
          params = { id, numero: "1" };
          const errores: Error[] = [];
          const { default: Pantalla } = (await import(archivo)) as { default: ComponentType };
          const { container } = montar(Pantalla, repo, (e) => errores.push(e));
          await esperarPantalla(container);
          expect(errores.map((e) => e.message)).toEqual([]);
          expect(avisos).toEqual([]);
          // Una pantalla en blanco también es un fallo: el usuario no sabe qué pasó.
          expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
        });
      }
    }
  }

  for (const archivo of LISTA.filter((f) => !conSesion(f))) {
    it(`sin sesión · ${nombre(archivo)}`, async () => {
      const repo = await preparar(null);
      const errores: Error[] = [];
      const { default: Pantalla } = (await import(archivo)) as { default: ComponentType };
      const { container } = montar(Pantalla, repo, (e) => errores.push(e), false);
      await esperarPantalla(container);
      expect(errores.map((e) => e.message)).toEqual([]);
      expect(avisos).toEqual([]);
      expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
    });
  }
});

/**
 * Tocar todo: cada botón, pestaña y opción de cada pantalla, con cada rol.
 * Lo que se rompe al tocar no se ve con solo dibujar. Lo que abre hardware
 * (cámara, compartir) no existe aquí: debe fallar con un mensaje, no
 * reventar.
 */
describe("tocar todo", () => {
  const tocables = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('[role="button"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"]')) as HTMLElement[];

  for (const rol of ["tecnico", "coordinador", "administrador", "cliente", "superadmin"] as const) {
    for (const archivo of LISTA.filter(conSesion)) {
      for (const id of nombre(archivo).includes("[id]") ? ["ord-1", "ord-2", "ord-3", "ord-5"] : ["ord-1"]) {
        it(`${rol} · ${nombre(archivo)}${nombre(archivo).includes("[id]") ? ` · ${id}` : ""}`, async () => {
          const repo = await preparar(usuarios[rol] ?? null);
          params = { id, numero: "1" };
          const errores: Error[] = [];
          const { default: Pantalla } = (await import(archivo)) as { default: ComponentType };
          const { container } = montar(Pantalla, repo, (e) => errores.push(e));
          await esperarPantalla(container);
          // Se toca por posición en la lista de lo tocable, volviendo a
          // buscar cada vez: tocar puede cambiar lo que hay en pantalla.
          for (let i = 0; i < 40; i++) {
            const t = tocables(container)[i];
            if (!t) break;
            await act(async () => { t.click(); });
            await asentar();
            if (errores.length > 0) break;
          }
          expect(errores.map((e) => e.message)).toEqual([]);
          expect(avisos).toEqual([]);
        }, 30_000);
      }
    }
  }
});

describe("lo que no está en el teléfono", () => {
  it("una orden o una posición que no existen lo dicen y ofrecen salir, en vez de cargar para siempre", async () => {
    const repo = await preparar(usuarios["tecnico"] ?? null);
    const editor = LISTA.find((f) => nombre(f).endsWith("posicion/[numero].tsx")) as string;
    const { default: Pantalla } = (await import(editor)) as { default: ComponentType };
    for (const [id, numero, esperado] of [["no-existe", "1", "ya no está en el teléfono"], ["ord-1", "99", "no tiene la posición 99"]] as const) {
      params = { id, numero };
      const { container, unmount } = montar(Pantalla, repo, () => undefined);
      await asentar();
      expect(container.textContent).toContain(esperado);
      expect(container.textContent).toContain("Volver al inicio");
      unmount();
    }
  });
});

describe("cerrar sesión", () => {
  it("la guardia lleva al ingreso en vez de dibujar pantallas sin usuario", async () => {
    // Era el "Render error: Esta pantalla requiere sesión iniciada".
    const repo = await preparar(usuarios["coordinador"] ?? null);
    const { default: Guardia } = (await import(join(APP, "(app)", "_layout.tsx"))) as { default: ComponentType };
    let cerrar: (() => Promise<unknown>) | null = null;
    function Sonda() {
      const s = useSesion();
      cerrar = () => s.cerrar(true);
      return null;
    }
    const errores: Error[] = [];
    const { container } = render(
      <ProveedorServicios value={{ sesion, apiUrl: "http://x", enLinea: enLinea as never, descargarTexto: vi.fn() as never, descargarArchivo: (async () => ({ ok: false, status: 0, mensaje: "sin señal" })) as never }}>
        <ProveedorSesion servicio={sesion}>
          <DatosDeLaSesion db={db} sesion={sesion} motor={new MotorSincronizacion(repo, { enviar: async () => ({ tipo: "sin_conexion" as const, mensaje: "x" }) })} descarga={{ traer: async () => null }} intervaloSincronizacionMs={0}>
            <Atrapa onError={(e) => errores.push(e)}>
              <Sonda />
              <Guardia />
            </Atrapa>
          </DatosDeLaSesion>
        </ProveedorSesion>
      </ProveedorServicios>,
    );
    await asentar();
    expect(container.textContent).not.toContain("redirige");
    await act(async () => { await cerrar?.(); });
    await asentar();
    expect(container.textContent).toContain("redirige:/ingresar");
    expect(errores).toEqual([]);
  });
});

describe("redes de seguridad", () => {
  it("las dos disposiciones atrapan los errores de sus pantallas", () => {
    // Sin ErrorBoundary, un error al dibujar es la pantalla roja en desarrollo
    // y una app cerrada en producción.
    for (const d of [join(APP, "_layout.tsx"), join(APP, "(app)", "_layout.tsx")]) {
      expect(readFileSync(d, "utf8")).toMatch(/export { ErrorDePantalla as ErrorBoundary }/);
    }
  });

  it("la pantalla de error explica, deja reintentar y volver, y muestra el detalle", async () => {
    const retry = vi.fn(async () => undefined);
    const { container, getByTestId } = render(<ErrorDePantalla error={new Error("posición sin eje")} retry={retry} />);
    expect(container.textContent).toContain("Algo falló en esta pantalla");
    expect(container.textContent).toContain("Detalle: posición sin eje");
    await act(async () => { getByTestId("reintentar").click(); });
    expect(retry).toHaveBeenCalled();
    await act(async () => { getByTestId("volver-inicio").click(); });
    expect(navegaciones).toContain("replace /");
  });

  it("si enviar revienta, la sincronización lo informa en vez de dejar un error suelto", async () => {
    const repo = await preparar(usuarios["tecnico"] ?? null);
    const ref: { datos: ReturnType<typeof useDatos> | null } = { datos: null };
    function Sonda() {
      ref.datos = useDatos();
      return <Text>sonda</Text>;
    }
    const motor = new MotorSincronizacion(repo, { enviar: async () => ({ tipo: "sin_conexion" as const, mensaje: "x" }) });
    vi.spyOn(motor, "sincronizar").mockRejectedValue(new Error("database is locked"));
    render(
      <ProveedorSesion servicio={sesion}>
        <DatosDeLaSesion db={db} sesion={sesion} motor={motor} descarga={{ traer: async () => null }} intervaloSincronizacionMs={0}>
          <Sonda />
        </DatosDeLaSesion>
      </ProveedorSesion>,
    );
    await asentar();
    let r: unknown = "sin llamar";
    await act(async () => { r = await ref.datos?.sincronizar(); });
    expect(r).toBeNull();
    expect(ref.datos?.errorDescarga).toMatch(/database is locked/);
  });
});
