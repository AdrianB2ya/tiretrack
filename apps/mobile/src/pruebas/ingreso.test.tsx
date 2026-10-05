import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ingresar, revisarFormulario, validarCorreo } from "../sesion/ingreso";
import { PantallaIngreso } from "../sesion/PantallaIngreso";
import { ServicioSesion, type UsuarioSesion } from "../sesion/servicio";
import { AlmacenSeguroMemoria } from "../sesion/almacen";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar, type Conexion } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";

/**
 * Ingreso.
 *
 * Es la única pantalla que no funciona sin señal, y la única donde dos
 * personas pueden pisarse: en un carro taller comparten la tablet.
 */

describe("validación del formulario", () => {
  it("acepta un correo normal", () => {
    expect(validarCorreo("carlos@asistectire.com")).toBe(true);
  });

  it("rechaza lo que claramente no es un correo", () => {
    expect(validarCorreo("carlos")).toBe(false);
    expect(validarCorreo("carlos@")).toBe(false);
  });

  it("es laxa a propósito: el servidor decide", () => {
    // Una validación estricta dejaría fuera correos válidos raros.
    expect(validarCorreo("c+taller@sub.dominio.co")).toBe(true);
  });

  it("pide los dos campos", () => {
    const p = revisarFormulario({ email: "", password: "" });
    expect(p.map((x) => x.campo)).toEqual(["email", "password"]);
  });

  it("no se queja si está todo", () => {
    expect(revisarFormulario({ email: "c@t.com", password: "x" })).toEqual([]);
  });
});

describe("llamada al servidor", () => {
  function clienteCon(status: number, cuerpo: unknown = {}) {
    const fetchFalso = vi.fn().mockResolvedValue({
      ok: status < 300, status, json: async () => cuerpo,
    } as Response);
    return { fetchFalso, config: { baseUrl: "https://api.test/v1", fetch: fetchFalso as unknown as typeof globalThis.fetch } };
  }
  const credenciales = { email: " Carlos@Aistectire.COM ", password: "clave" };

  it("entrega los tokens al entrar", async () => {
    const { config } = clienteCon(200, { token: "t", refreshToken: "r", usuario: { id: "u1" } });
    const r = await ingresar(config, credenciales);
    expect(r.tipo).toBe("ok");
  });

  it("normaliza el correo: sin espacios ni mayúsculas", async () => {
    // El técnico lo escribe con el teclado del celular, que capitaliza solo.
    const { fetchFalso, config } = clienteCon(200, { token: "t", refreshToken: "r", usuario: {} });
    await ingresar(config, credenciales);
    const cuerpo = JSON.parse((fetchFalso.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(cuerpo.email).toBe("carlos@asistectire.com");
  });

  it("no toca la contraseña", async () => {
    // Recortarla o pasarla a minúsculas cambiaría una clave legítima.
    const { fetchFalso, config } = clienteCon(200, { token: "t", refreshToken: "r", usuario: {} });
    await ingresar(config, { email: "c@t.com", password: "  Clave Con Espacios  " });
    const cuerpo = JSON.parse((fetchFalso.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(cuerpo.password).toBe("  Clave Con Espacios  ");
  });

  it("credenciales incorrectas se distinguen de un problema de red", async () => {
    const { config } = clienteCon(401, { error: { mensaje: "Correo o contraseña incorrectos" } });
    expect((await ingresar(config, credenciales)).tipo).toBe("credenciales");
  });

  it("sin red dice que es la señal, no la contraseña", async () => {
    // Confundirlos hace que alguien sin cobertura cambie su clave creyendo
    // que la olvidó.
    const fetchFalso = vi.fn().mockRejectedValue(new Error("network"));
    const r = await ingresar(
      { baseUrl: "https://api.test/v1", fetch: fetchFalso as unknown as typeof globalThis.fetch },
      credenciales,
    );
    expect(r.tipo).toBe("sin_conexion");
    expect(r.tipo === "sin_conexion" && r.mensaje).toContain("señal");
  });

  it("un servidor caído también es 'sin conexión', no credenciales", async () => {
    const { config } = clienteCon(500);
    expect((await ingresar(config, credenciales)).tipo).toBe("sin_conexion");
  });

  it("si el correo está en dos empresas, devuelve la lista", async () => {
    const { config } = clienteCon(409, { empresas: [{ id: "e1", nombre: "A" }, { id: "e2", nombre: "B" }] });
    const r = await ingresar(config, credenciales);
    expect(r.tipo === "elegir_empresa" && r.empresas).toHaveLength(2);
  });

  it("al elegir empresa la envía", async () => {
    const { fetchFalso, config } = clienteCon(200, { token: "t", refreshToken: "r", usuario: {} });
    await ingresar(config, { ...credenciales, empresaId: "e2" });
    const cuerpo = JSON.parse((fetchFalso.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(cuerpo.empresaId).toBe("e2");
  });
});

describe("entrar con otro usuario en el mismo equipo", () => {
  let db: Conexion;
  let sesion: ServicioSesion;
  let repo: RepositorioLocal;

  const carlos: UsuarioSesion = {
    id: "u-tec1", nombre: "Carlos Méndez", email: "c@t.com", rol: "tecnico",
    empresaId: "emp-1", clienteId: null, sedes: ["sede-fun"], sedePrincipal: "sede-fun",
  };
  const ana: UsuarioSesion = { ...carlos, id: "u-tec2", nombre: "Ana Torres", email: "a@t.com" };

  beforeEach(async () => {
    db = await abrirBaseEnMemoria();
    await migrar(db);
    sesion = new ServicioSesion(new AlmacenSeguroMemoria(), db);
    repo = new RepositorioLocal(db);
    await sesion.iniciar({ token: "t", refreshToken: "r", usuario: carlos });
  });

  afterEach(async () => {
    await db.cerrar();
  });

  async function dejarTrabajoSinEnviar() {
    await repo.guardarOrden({
      id: "ord-1", sedeId: "sede-fun", clienteId: "cli-1", sedeClienteId: "sc-1",
      vehiculoId: "veh-1", tecnicoId: "u-tec1", configuracionEjeId: "cfg-1",
      tipo: "preventivo", estado: "en_proceso", fecha: "2026-09-21",
    });
  }

  it("con trabajo sin enviar, NO deja entrar a otro", async () => {
    // En un carro taller comparten la tablet: el segundo en entrar habría
    // borrado la jornada del primero sin que nadie se enterara.
    await dejarTrabajoSinEnviar();
    const r = await sesion.iniciar({ token: "t2", refreshToken: "r2", usuario: ana });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.veredicto.codigo).toBe("TRABAJO_DE_OTRO_SIN_ENVIAR");
    expect(r.veredicto.mensaje).toContain("Carlos");
  });

  it("el trabajo sigue intacto tras el intento", async () => {
    await dejarTrabajoSinEnviar();
    await sesion.iniciar({ token: "t2", refreshToken: "r2", usuario: ana });
    expect(await repo.buscarOrden("ord-1")).not.toBeNull();
    expect((await sesion.restaurar())?.id).toBe("u-tec1");
  });

  it("confirmando, entra y se descarta lo del anterior", async () => {
    await dejarTrabajoSinEnviar();
    const r = await sesion.iniciar({ token: "t2", refreshToken: "r2", usuario: ana }, true);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.descartado?.operaciones).toBeGreaterThan(0);
    expect(await repo.buscarOrden("ord-1")).toBeNull();
  });

  it("sin trabajo pendiente, otro usuario entra sin preguntar", async () => {
    const r = await sesion.iniciar({ token: "t2", refreshToken: "r2", usuario: ana });
    expect(r.ok).toBe(true);
    expect((await sesion.restaurar())?.id).toBe("u-tec2");
  });

  it("el MISMO usuario entra de nuevo sin perder su trabajo", async () => {
    // Renovar la sesión no puede costarle la jornada.
    await dejarTrabajoSinEnviar();
    const r = await sesion.iniciar({ token: "t3", refreshToken: "r3", usuario: carlos });
    expect(r.ok).toBe(true);
    expect(await repo.buscarOrden("ord-1")).not.toBeNull();
  });
});

describe("pantalla", () => {
  function montar(respuesta: unknown = { tipo: "ok" }) {
    const onIngresar = vi.fn().mockResolvedValue(respuesta);
    const onDescartarYEntrar = vi.fn();
    render(<PantallaIngreso onIngresar={onIngresar} onDescartarYEntrar={onDescartarYEntrar} />);
    return { onIngresar, onDescartarYEntrar };
  }

  const escribir = (etiqueta: string, valor: string) =>
    fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });

  it("no envía nada con el formulario vacío", () => {
    const { onIngresar } = montar();
    fireEvent.click(screen.getByTestId("entrar"));
    expect(onIngresar).not.toHaveBeenCalled();
    expect(screen.getByText("Escribe tu correo")).toBeTruthy();
  });

  it("entra con correo y contraseña", async () => {
    const { onIngresar } = montar();
    escribir("Correo", "carlos@asistectire.com");
    escribir("Contraseña", "clave");
    fireEvent.click(screen.getByTestId("entrar"));
    await waitFor(() =>
      expect(onIngresar).toHaveBeenCalledWith({ email: "carlos@asistectire.com", password: "clave" }),
    );
  });

  it("deja ver la contraseña escrita", () => {
    // Con guantes y bajo el sol se escribe mal; tres intentos bloquean la
    // cuenta.
    montar();
    expect(screen.getByTestId("ver-clave").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByTestId("ver-clave"));
    expect(screen.getByTestId("ver-clave").getAttribute("aria-checked")).toBe("true");
  });

  it("avisa que la primera vez hace falta señal", () => {
    montar();
    expect(screen.getByText(/primera vez necesitas señal/)).toBeTruthy();
  });

  it("un problema de red se muestra distinto de una clave mala", async () => {
    const { onIngresar } = montar({ tipo: "sin_conexion", mensaje: "No hay señal" });
    escribir("Correo", "c@t.com");
    escribir("Contraseña", "x");
    fireEvent.click(screen.getByTestId("entrar"));
    await waitFor(() => expect(screen.getByText("No se pudo conectar")).toBeTruthy());
    expect(onIngresar).toHaveBeenCalled();
  });

  it("una clave incorrecta lo dice sin culpar a la red", async () => {
    montar({ tipo: "credenciales", mensaje: "Correo o contraseña incorrectos" });
    escribir("Correo", "c@t.com");
    escribir("Contraseña", "x");
    fireEvent.click(screen.getByTestId("entrar"));
    await waitFor(() => expect(screen.getByText("No pudimos entrar")).toBeTruthy());
  });

  it("si el correo está en dos empresas, pregunta cuál", async () => {
    const { onIngresar } = montar({
      tipo: "elegir_empresa",
      empresas: [{ id: "e1", nombre: "Aistectire" }, { id: "e2", nombre: "Otra" }],
    });
    escribir("Correo", "ana@dos.com");
    escribir("Contraseña", "x");
    fireEvent.click(screen.getByTestId("entrar"));

    await waitFor(() => expect(screen.getByText("¿Con cuál empresa entras?")).toBeTruthy());
    fireEvent.click(screen.getByTestId("empresa-e2"));
    await waitFor(() => expect(onIngresar).toHaveBeenLastCalledWith(expect.objectContaining({ empresaId: "e2" })));
  });

  it("no entra encima del trabajo de un compañero sin confirmarlo", async () => {
    const { onDescartarYEntrar } = montar({
      tipo: "trabajo_de_otro",
      mensaje: "Carlos Méndez tiene 8 cambio(s) sin enviar",
    });
    escribir("Correo", "ana@t.com");
    escribir("Contraseña", "x");
    fireEvent.click(screen.getByTestId("entrar"));

    await waitFor(() => expect(screen.getByText(/8 cambio/)).toBeTruthy());
    expect(onDescartarYEntrar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("descartar-y-entrar"));
    expect(onDescartarYEntrar).toHaveBeenCalledOnce();
  });
});
