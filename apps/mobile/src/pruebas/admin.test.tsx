import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { mensajeActivacion, revisarSedeEmpresa, revisarUsuario } from "../admin/reglasAdmin";
import { PantallaUsuarios, type FuentesUsuarios } from "../admin/PantallaUsuarios";
import { PantallaSedes } from "../admin/PantallaSedes";
import { ClienteHttp } from "../datos/clienteHttp";

const SEDE = "00000000-0000-4000-8000-0000000000b1";

describe("reglas", () => {
  const base = { nombre: "Pedro Ruiz", cedula: "1082999111", email: "pedro@asistectire.com", telefono: "", rol: "tecnico" as const, sedes: [SEDE], clienteId: null };

  it("un usuario completo pasa el contrato del servidor", () => {
    expect(revisarUsuario(base)).toEqual([]);
  });

  it("sin sede o un cliente sin su cliente no pasan", () => {
    expect(revisarUsuario({ ...base, sedes: [] }).map((p) => p.campo)).toContain("sedes");
    expect(revisarUsuario({ ...base, rol: "cliente", sedes: [] }).map((p) => p.campo)).toContain("clienteId");
  });

  it("un usuario cliente no lleva sedes de la empresa: solo su cliente", () => {
    const CLI = "00000000-0000-4000-8000-0000000000c1";
    expect(revisarUsuario({ ...base, rol: "cliente", sedes: [], clienteId: CLI })).toEqual([]);
    expect(revisarUsuario({ ...base, rol: "cliente", sedes: [SEDE], clienteId: CLI }).map((p) => p.campo)).toContain("sedes");
  });

  it("el código de sede solo letras y números, 2 a 6", () => {
    expect(revisarSedeEmpresa({ nombre: "Ciénaga", codigo: "CNG", ciudad: "" })).toEqual([]);
    expect(revisarSedeEmpresa({ nombre: "Ciénaga", codigo: "C N", ciudad: "" }).map((p) => p.campo)).toContain("codigo");
  });

  it("el mensaje dice qué hacer, con el código y el vencimiento", () => {
    const m = mensajeActivacion("Pedro Ruiz", "K7M2-X9QP", "2026-10-08T12:00:00Z");
    expect(m).toMatch(/^Hola Pedro\./);
    expect(m).toContain("K7M2-X9QP");
    expect(m).toContain("Tengo un código de activación");
    expect(m).toMatch(/Vence el/);
  });
});

describe("pantalla de usuarios", () => {
  function fuentes(extra: Partial<FuentesUsuarios> = {}): FuentesUsuarios & Record<string, ReturnType<typeof vi.fn>> {
    return {
      usuarios: vi.fn().mockResolvedValue({ ok: true, datos: [
        { id: "u-1", nombre: "Carlos Méndez", email: "carlos@asistectire.com", rol: "tecnico", activo: true, sedes: [SEDE], sinActivar: false },
        { id: "u-2", nombre: "Ana Torres", email: "ana@asistectire.com", rol: "tecnico", activo: true, sedes: [SEDE], sinActivar: true },
      ] }),
      sedes: vi.fn().mockResolvedValue({ ok: true, datos: [{ id: SEDE, nombre: "Fundación", codigo: "FUN" }] }),
      clientes: vi.fn().mockResolvedValue([]),
      crear: vi.fn().mockResolvedValue({ ok: true, datos: { codigo: "K7M2-X9QP", expiraEn: "2026-10-08T12:00:00Z" } }),
      nuevoCodigo: vi.fn().mockResolvedValue({ ok: true, datos: { codigo: "AAAA-CCCC", expiraEn: "2026-10-08T12:00:00Z" } }),
      cambiarActivo: vi.fn().mockResolvedValue({ ok: true, datos: {} }),
      compartir: vi.fn(),
      ...extra,
    } as never;
  }
  const escribir = (etiqueta: string, valor: string) => fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });

  it("desactivar pide un segundo toque, y después recarga la lista", async () => {
    const f = fuentes();
    render(<PantallaUsuarios fuentes={f} />);
    const boton = await screen.findByTestId("activo-u-1");
    await act(async () => { fireEvent.click(boton); });
    expect(f.cambiarActivo).not.toHaveBeenCalled();
    expect(screen.getByText("¿Desactivar a Carlos Méndez?")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText("Sí, desactivar")); });
    expect(f.cambiarActivo).toHaveBeenCalledWith("u-1", false);
    expect(f.usuarios).toHaveBeenCalledTimes(2);
  });

  it("si tiene trabajo abierto, dice el motivo del servidor", async () => {
    const f = fuentes({ cambiarActivo: vi.fn().mockResolvedValue({ ok: false, mensaje: "Tiene 2 órdenes abiertas: reasígnalas primero" }) });
    render(<PantallaUsuarios fuentes={f} />);
    const boton = await screen.findByTestId("activo-u-1");
    await act(async () => { fireEvent.click(boton); });
    await act(async () => { fireEvent.click(screen.getByTestId("activo-u-1")); });
    expect(await screen.findByText(/reasígnalas primero/)).toBeTruthy();
  });

  it("marca quién no ha activado su cuenta, en texto", async () => {
    render(<PantallaUsuarios fuentes={fuentes()} />);
    expect(await screen.findByText("Sin activar")).toBeTruthy();
  });

  it("crea el usuario y muestra el código una vez, listo para compartir", async () => {
    const f = fuentes();
    render(<PantallaUsuarios fuentes={f} />);
    fireEvent.click(await screen.findByTestId("nuevo-usuario"));
    escribir("Nombre completo", "Pedro Ruiz");
    escribir("Cédula", "1082999111");
    escribir("Correo", "pedro@asistectire.com");
    fireEvent.click(await screen.findByLabelText("Fundación (FUN)"));
    fireEvent.click(screen.getByTestId("crear-usuario"));
    expect((await screen.findByTestId("codigo-activacion")).textContent).toBe("K7M2-X9QP");
    fireEvent.click(screen.getByTestId("compartir"));
    expect(f.compartir).toHaveBeenCalledWith(expect.stringContaining("K7M2-X9QP"));
  });

  it("para un usuario cliente pide su cliente, no sedes de la empresa, y muestra las sedes del cliente", async () => {
    const f = fuentes({
      clientes: vi.fn().mockResolvedValue([{ id: "00000000-0000-4000-8000-0000000000c1", nombre: "Transportes Reyna" }]),
      sedesDeCliente: vi.fn().mockResolvedValue([{ id: "sc-1", nombre: "Planta Fundación" }, { id: "sc-2", nombre: "Patio Valledupar" }]),
    });
    render(<PantallaUsuarios fuentes={f} />);
    fireEvent.click(await screen.findByTestId("nuevo-usuario"));
    escribir("Nombre completo", "Luis Reyna");
    escribir("Cédula", "77221004");
    escribir("Correo", "luis@transportesreyna.com");
    fireEvent.click(screen.getByLabelText("Cliente (portal)"));
    expect(screen.queryByLabelText("Fundación (FUN)")).toBeNull();
    fireEvent.click(await screen.findByLabelText("Transportes Reyna"));
    expect(await screen.findByText("Sedes: Planta Fundación, Patio Valledupar.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("crear-usuario"));
    expect(await screen.findByTestId("codigo-activacion")).toBeTruthy();
    expect(f.crear).toHaveBeenCalledWith(expect.objectContaining({ rol: "cliente", sedes: [], clienteId: "00000000-0000-4000-8000-0000000000c1" }));
  });

  it("sin sede no crea", async () => {
    const f = fuentes();
    render(<PantallaUsuarios fuentes={f} />);
    fireEvent.click(await screen.findByTestId("nuevo-usuario"));
    escribir("Nombre completo", "Pedro Ruiz");
    escribir("Cédula", "1082999111");
    escribir("Correo", "pedro@asistectire.com");
    fireEvent.click(screen.getByTestId("crear-usuario"));
    expect(f.crear).not.toHaveBeenCalled();
    expect(screen.getByText("Elige al menos una sede")).toBeTruthy();
  });

  it("un código nuevo para quien no activó", async () => {
    const f = fuentes();
    render(<PantallaUsuarios fuentes={f} />);
    fireEvent.click(await screen.findByTestId("codigo-u-2"));
    expect((await screen.findByTestId("codigo-activacion")).textContent).toBe("AAAA-CCCC");
    expect(f.nuevoCodigo).toHaveBeenCalledWith("u-2");
  });

  it("si el servidor rechaza, lo dice", async () => {
    render(<PantallaUsuarios fuentes={fuentes({ crear: vi.fn().mockResolvedValue({ ok: false, mensaje: "Ya hay un usuario con ese correo en la empresa" }) })} />);
    fireEvent.click(await screen.findByTestId("nuevo-usuario"));
    escribir("Nombre completo", "Pedro Ruiz");
    escribir("Cédula", "1082999111");
    escribir("Correo", "pedro@asistectire.com");
    fireEvent.click(await screen.findByLabelText("Fundación (FUN)"));
    fireEvent.click(screen.getByTestId("crear-usuario"));
    expect(await screen.findByText(/Ya hay un usuario con ese correo/)).toBeTruthy();
  });
});

describe("pantalla de sedes", () => {
  it("crea una sede con su código en mayúsculas", async () => {
    const crear = vi.fn().mockResolvedValue({ ok: true, datos: {} });
    render(<PantallaSedes fuentes={{ sedes: vi.fn().mockResolvedValue({ ok: true, datos: [] }), crear }} />);
    fireEvent.click(await screen.findByTestId("nueva-sede-empresa"));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Sede Ciénaga" } });
    fireEvent.change(screen.getByLabelText("Código (va en el folio)"), { target: { value: "cng" } });
    fireEvent.click(screen.getByTestId("crear-sede"));
    await waitFor(() => expect(crear).toHaveBeenCalledWith({ nombre: "Sede Ciénaga", codigo: "CNG" }));
  });
});

describe("petición en línea", () => {
  it("renueva la sesión una vez ante un 401 y reintenta", async () => {
    let token = "viejo";
    const fetchFalso = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: "u-1" }] });
    const c = new ClienteHttp({
      baseUrl: "https://api/v1",
      obtenerToken: async () => token,
      renovarSesion: async () => { token = "nuevo"; return true; },
      fetch: fetchFalso as unknown as typeof fetch,
    });
    const r = await c.enLinea<{ id: string }[]>("GET", "/usuarios");
    expect(r.ok && r.datos[0]?.id).toBe("u-1");
    expect((fetchFalso.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer nuevo" });
  });

  it("sin señal lo distingue de un rechazo", async () => {
    const c = new ClienteHttp({
      baseUrl: "x", obtenerToken: async () => "t",
      fetch: vi.fn().mockRejectedValue(new Error("red")) as unknown as typeof fetch,
    });
    const r = await c.enLinea("GET", "/usuarios");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(0);
  });
});
