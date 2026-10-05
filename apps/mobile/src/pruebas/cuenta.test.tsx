import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Text } from "react-native";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar, type Conexion } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";
import { MotorSincronizacion, type ClienteSincronizacion } from "../datos/sincronizacion";
import { ServicioSesion, type UsuarioSesion } from "../sesion/servicio";
import { AlmacenSeguroMemoria } from "../sesion/almacen";
import { ProveedorSesion, useSesion } from "../app/ProveedorSesion";
import { DatosDeLaSesion } from "../app/DatosDeLaSesion";
import { useDatos } from "../app/ProveedorDatos";
import { PantallaCuenta, ETIQUETA_ROL } from "../sesion/PantallaCuenta";

/**
 * Cuenta y cierre de sesión.
 *
 * Lo que se protege: que cerrar no pierda trabajo sin avisar, que el siguiente
 * en entrar no vea lo del anterior, y que la app entera se entere de quién
 * entró —antes, el contexto seguía sin usuario después de ingresar—.
 */

const carlos: UsuarioSesion = {
  id: "u-tec1",
  nombre: "Carlos Méndez",
  email: "carlos@aistectire.com",
  rol: "tecnico",
  empresaId: "emp-1",
  clienteId: null,
  sedes: ["sede-fun"],
  sedePrincipal: "sede-fun",
};

const orden = {
  id: "ord-1",
  sedeId: "sede-fun",
  clienteId: "cli-1",
  sedeClienteId: "sc-1",
  vehiculoId: "veh-1",
  tecnicoId: "u-tec1",
  configuracionEjeId: "cfg-1",
  tipo: "preventivo",
  estado: "en_proceso",
  fecha: "2026-09-18",
};

class ServidorSimulado implements ClienteSincronizacion {
  public sinRed = false;
  async enviar() {
    if (this.sinRed) return { tipo: "sin_conexion" as const, mensaje: "sin red" };
    return { tipo: "aplicada" as const, folio: "OS-FUN-000001" };
  }
}

describe("sesión y datos en la app", () => {
  let db: Conexion;
  let repo: RepositorioLocal;
  let servicio: ServicioSesion;
  let traer: ReturnType<typeof vi.fn>;
  let servidor: ServidorSimulado;
  let ctx: ReturnType<typeof useSesion> | null;

  function Sonda() {
    ctx = useSesion();
    const datos = useDatos();
    return (
      <Text>
        {`${ctx.usuario?.nombre ?? "sin-sesion"}|ordenes:${datos.cargando ? "?" : datos.ordenes.length}`}
      </Text>
    );
  }

  function montar() {
    return render(
      <ProveedorSesion servicio={servicio}>
        <DatosDeLaSesion
          db={db}
          sesion={servicio}
          motor={new MotorSincronizacion(repo, servidor)}
          descarga={{ traer }}
          intervaloSincronizacionMs={0}
        >
          <Sonda />
        </DatosDeLaSesion>
      </ProveedorSesion>,
    );
  }

  const ingresar = async () => {
    await act(async () => {
      const r = await ctx!.iniciar({ token: "t", refreshToken: "r", usuario: carlos });
      expect(r.ok).toBe(true);
    });
  };

  beforeEach(async () => {
    db = await abrirBaseEnMemoria();
    await migrar(db);
    repo = new RepositorioLocal(db);
    servicio = new ServicioSesion(new AlmacenSeguroMemoria(), db);
    traer = vi.fn().mockResolvedValue(null);
    servidor = new ServidorSimulado();
    ctx = null;
  });

  afterEach(async () => {
    await db.cerrar();
  });

  it("al ingresar, toda la app sabe quién entró", async () => {
    // Antes la pantalla de ingreso hablaba con el servicio y el contexto no se
    // enteraba: el panel, que exige sesión, fallaba recién ingresado.
    montar();
    await waitFor(() => expect(screen.getByText(/^sin-sesion/)).toBeTruthy());
    await ingresar();
    await waitFor(() => expect(screen.getByText(/^Carlos Méndez/)).toBeTruthy());
  });

  it("al ingresar, descarga enseguida en vez de esperar la vuelta de un minuto", async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/^sin-sesion/)).toBeTruthy());
    expect(traer).not.toHaveBeenCalled();
    await ingresar();
    await waitFor(() => expect(traer).toHaveBeenCalled());
  });

  it("cerrar sin pendientes saca al usuario y vacía la lista en pantalla", async () => {
    await repo.guardarOrden({ ...orden, encolar: false });
    montar();
    await ingresar();
    await waitFor(() => expect(screen.getByText("Carlos Méndez|ordenes:1")).toBeTruthy());

    await act(async () => {
      const r = await ctx!.cerrar(false);
      expect(r.ok).toBe(true);
    });
    // La base ya estaba vacía; lo que se comprueba es la MEMORIA: el siguiente
    // en entrar no debe ver las órdenes del anterior.
    await waitFor(() => expect(screen.getByText("sin-sesion|ordenes:0")).toBeTruthy());
  });

  it("con trabajo sin enviar NO cierra: la sesión y la orden siguen", async () => {
    // Sin señal: si la hubiera, la descarga al ingresar enviaría lo pendiente
    // primero —que es justo lo que debe hacer— y no quedaría nada que proteger.
    servidor.sinRed = true;
    await repo.guardarOrden({ ...orden, encolar: true });
    montar();
    await ingresar();

    await act(async () => {
      const r = await ctx!.cerrar(false);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.veredicto.codigo).toBe("TRABAJO_SIN_ENVIAR");
    });
    expect(screen.getByText(/^Carlos Méndez/)).toBeTruthy();
    expect(await repo.buscarOrden("ord-1")).not.toBeNull();
  });
});

describe("pantalla de cuenta", () => {
  const ok = { ok: true as const, valor: { descartado: null } };
  const conPendientes = {
    ok: false as const,
    veredicto: {
      permitido: false,
      codigo: "TRABAJO_SIN_ENVIAR",
      mensaje: "Hay 3 cambio(s) y 1 foto(s) sin enviar.",
    },
  };

  function montar(onCerrar = vi.fn().mockResolvedValue(ok)) {
    const props = {
      usuario: carlos,
      onCerrar,
      onSincronizar: vi.fn().mockResolvedValue(null),
      sincronizando: false,
      onCerrada: vi.fn(),
    };
    render(<PantallaCuenta {...props} />);
    return props;
  }

  it("muestra a nombre de quién está la sesión", () => {
    // En un carro taller la tablet se comparte.
    montar();
    expect(screen.getByText("Carlos Méndez")).toBeTruthy();
    expect(screen.getByText("carlos@aistectire.com")).toBeTruthy();
    expect(screen.getByText(ETIQUETA_ROL.tecnico)).toBeTruthy();
  });

  it("avisa ANTES de cerrar que para volver a entrar hace falta señal", () => {
    montar();
    expect(screen.getByText(/necesitar señal/)).toBeTruthy();
  });

  it("sin pendientes, cierra y lleva al ingreso", async () => {
    const p = montar();
    fireEvent.click(screen.getByText("Cerrar sesión"));
    await waitFor(() => expect(p.onCerrada).toHaveBeenCalled());
    expect(p.onCerrar).toHaveBeenCalledWith(false);
  });

  it("con pendientes, explica cuánto se perdería y no sale", async () => {
    const p = montar(vi.fn().mockResolvedValue(conPendientes));
    fireEvent.click(screen.getByText("Cerrar sesión"));
    await waitFor(() => expect(screen.getByText(/3 cambio\(s\) y 1 foto\(s\)/)).toBeTruthy());
    expect(p.onCerrada).not.toHaveBeenCalled();
  });

  it("descartar es una decisión explícita, aparte", async () => {
    const onCerrar = vi.fn().mockResolvedValueOnce(conPendientes).mockResolvedValueOnce(ok);
    const p = montar(onCerrar);
    fireEvent.click(screen.getByText("Cerrar sesión"));
    fireEvent.click(await screen.findByText("Descartar lo pendiente y cerrar sesión"));
    await waitFor(() => expect(p.onCerrada).toHaveBeenCalled());
    expect(onCerrar).toHaveBeenNthCalledWith(2, true);
  });

  it("ofrece enviar lo pendiente antes de salir", async () => {
    const p = montar(vi.fn().mockResolvedValue(conPendientes));
    fireEvent.click(screen.getByText("Cerrar sesión"));
    fireEvent.click(await screen.findByText("Enviar ahora"));
    await waitFor(() => expect(p.onSincronizar).toHaveBeenCalled());
    // Vuelve a la vista normal para intentar cerrar de nuevo.
    await waitFor(() => expect(screen.getByText("Cerrar sesión")).toBeTruthy());
    expect(p.onCerrada).not.toHaveBeenCalled();
  });
});
