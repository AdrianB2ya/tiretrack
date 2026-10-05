import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Text } from "react-native";
import {
  ProveedorSesion,
  destinoInicial,
  useSesion,
  useUsuario,
} from "../app/ProveedorSesion";
import {
  PanelCoordinador,
  calcularIndicadores,
  tarjetasDelPanel,
  type Indicadores,
} from "../coordinador/PanelCoordinador";
import { unaOrden } from "./fabrica";
import type { ServicioSesion, UsuarioSesion } from "../sesion/servicio";

/**
 * Sesión en la interfaz y panel del coordinador.
 *
 * Lo central de la sesión: que ninguna pantalla funcione con un rol
 * inventado. Lo central del panel: que muestre lo que requiere decisión, no
 * métricas que no llevan a ninguna acción.
 */

const usuario = (rol: UsuarioSesion["rol"]): UsuarioSesion => ({
  id: `u-${rol}`,
  nombre: "Jorge Ramírez",
  email: "jorge@aistectire.com",
  rol,
  empresaId: "emp-1",
  clienteId: null,
  sedes: ["sede-fun"],
  sedePrincipal: "sede-fun",
});

function servicioCon(u: UsuarioSesion | null): ServicioSesion {
  return { restaurar: vi.fn().mockResolvedValue(u) } as unknown as ServicioSesion;
}

describe("destino inicial según el rol", () => {
  it("el técnico entra directo a sus órdenes", () => {
    // Es lo único que hace en campo: un panel intermedio sería un toque más
    // con guantes.
    expect(destinoInicial(usuario("tecnico"))).toBe("/ordenes");
  });

  it("el coordinador y el administrador entran a su panel", () => {
    expect(destinoInicial(usuario("coordinador"))).toBe("/panel");
    expect(destinoInicial(usuario("administrador"))).toBe("/panel");
  });

  it("sin sesión va a ingresar", () => {
    expect(destinoInicial(null)).toBe("/ingresar");
  });

  it("el cliente no usa la app de campo", () => {
    expect(destinoInicial(usuario("cliente"))).toBe("/ingresar");
  });
});

describe("proveedor de sesión", () => {
  function Sonda() {
    const { cargando, usuario: u } = useSesion();
    return <Text>{cargando ? "cargando" : (u?.rol ?? "sin-sesion")}</Text>;
  }

  it("restaura la sesión al abrir", async () => {
    render(
      <ProveedorSesion servicio={servicioCon(usuario("coordinador"))}>
        <Sonda />
      </ProveedorSesion>,
    );
    await waitFor(() => expect(screen.getByText("coordinador")).toBeTruthy());
  });

  it("sin sesión guardada queda sin usuario", async () => {
    render(
      <ProveedorSesion servicio={servicioCon(null)}>
        <Sonda />
      </ProveedorSesion>,
    );
    await waitFor(() => expect(screen.getByText("sin-sesion")).toBeTruthy());
  });

  it("una pantalla que exige sesión falla si no la hay", async () => {
    // Un usuario vacío con rol por defecto pasaría las comprobaciones de
    // permiso de forma impredecible. Mejor fallar.
    function Exige() {
      const u = useUsuario();
      return <Text>{u.nombre}</Text>;
    }
    const silenciar = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() =>
        render(
          <ProveedorSesion servicio={servicioCon(null)}>
            <Exige />
          </ProveedorSesion>,
        ),
      ).toThrow(/requiere sesión/);
    } finally {
      silenciar.mockRestore();
    }
  });

  it("fuera del proveedor falla claro", () => {
    const silenciar = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => render(<Sonda />)).toThrow(/ProveedorSesion/);
    } finally {
      silenciar.mockRestore();
    }
  });
});

describe("indicadores", () => {
  const HOY = "2026-09-21";

  it("cuenta lo que espera revisión", () => {
    const i = calcularIndicadores(
      [unaOrden({ id: "a", estado: "en_revision" }), unaOrden({ id: "b", estado: "en_revision" })],
      HOY,
      0,
    );
    expect(i.porRevisar).toBe(2);
  });

  it("separa las devueltas de las que están en curso", () => {
    // Las devueltas pueden requerir que el coordinador le insista al técnico.
    const i = calcularIndicadores(
      [
        unaOrden({ id: "a", estado: "en_proceso", motivoDevolucion: "Corregir la posición 6" }),
        unaOrden({ id: "b", estado: "en_proceso" }),
      ],
      HOY,
      0,
    );
    expect(i.devueltas).toBe(1);
    expect(i.enCurso).toBe(1);
  });

  it("detecta las que el cliente está por dejar vencer", () => {
    // Llamarlo ahora evita un cierre tácito que después puede disputar.
    const i = calcularIndicadores(
      [
        unaOrden({ id: "a", estado: "pendiente_cliente", limiteCliente: "2026-09-22" }),
        unaOrden({ id: "b", estado: "pendiente_cliente", limiteCliente: "2026-09-30" }),
      ],
      HOY,
      0,
    );
    expect(i.esperandoCliente).toBe(2);
    expect(i.clienteVencePronto).toBe(1);
  });

  it("una orden ya vencida también cuenta como urgente", () => {
    const i = calcularIndicadores(
      [unaOrden({ estado: "pendiente_cliente", limiteCliente: "2026-09-15" })],
      HOY,
      0,
    );
    expect(i.clienteVencePronto).toBe(1);
  });

  it("sin plazo definido no se considera por vencer", () => {
    const i = calcularIndicadores(
      [unaOrden({ estado: "pendiente_cliente", limiteCliente: null })],
      HOY,
      0,
    );
    expect(i.clienteVencePronto).toBe(0);
  });
});

describe("tarjetas del panel", () => {
  const vacio: Indicadores = {
    porRevisar: 0, devueltas: 0, esperandoCliente: 0,
    clienteVencePronto: 0, enCurso: 0, sinEnviar: 0,
  };

  it("lo urgente va primero", () => {
    const t = tarjetasDelPanel({ ...vacio, enCurso: 5, esperandoCliente: 2, clienteVencePronto: 1 });
    expect(t[0]?.accion).toBe("cliente");
  });

  it("las que están en cero van al final pero se muestran", () => {
    // Ver "0 por revisar" también informa: puede dedicarse a otra cosa. Y
    // ocultarla haría dudar si el panel cargó.
    const t = tarjetasDelPanel({ ...vacio, enCurso: 3 });
    expect(t).toHaveLength(4);
    expect(t[0]?.accion).toBe("en_curso");
  });

  it("el plazo por vencer va como detalle", () => {
    const t = tarjetasDelPanel({ ...vacio, esperandoCliente: 3, clienteVencePronto: 2 });
    expect(t.find((x) => x.accion === "cliente")?.detalle).toBe("2 vencen pronto");
  });

  it("usa el singular con una sola", () => {
    const t = tarjetasDelPanel({ ...vacio, esperandoCliente: 1, clienteVencePronto: 1 });
    expect(t.find((x) => x.accion === "cliente")?.detalle).toBe("1 vence pronto");
  });
});

describe("panel", () => {
  const ind: Indicadores = {
    porRevisar: 4, devueltas: 1, esperandoCliente: 2,
    clienteVencePronto: 0, enCurso: 6, sinEnviar: 0,
  };

  it("saluda por el nombre de pila", () => {
    render(<PanelCoordinador indicadores={ind} nombre="Jorge Ramírez" onAbrir={vi.fn()} />);
    expect(screen.getByText("Hola, Jorge")).toBeTruthy();
  });

  it("cada indicador lleva a su lista", () => {
    const abrir = vi.fn();
    render(<PanelCoordinador indicadores={ind} nombre="Jorge" onAbrir={abrir} />);
    fireEvent.click(screen.getByTestId("indicador-revisar"));
    expect(abrir).toHaveBeenCalledWith("revisar");
  });

  it("el lector de pantalla dice el número con su nombre", () => {
    render(<PanelCoordinador indicadores={ind} nombre="Jorge" onAbrir={vi.fn()} />);
    expect(screen.getByLabelText("Por revisar: 4")).toBeTruthy();
  });

  it("avisa de los cambios propios sin enviar", () => {
    render(
      <PanelCoordinador indicadores={{ ...ind, sinEnviar: 2 }} nombre="Jorge" onAbrir={vi.fn()} />,
    );
    expect(screen.getByText(/2 cambios tuyos sin enviar/)).toBeTruthy();
  });

  it("sin pendientes no muestra ese aviso", () => {
    render(<PanelCoordinador indicadores={ind} nombre="Jorge" onAbrir={vi.fn()} />);
    expect(screen.queryByText(/sin enviar/)).toBeNull();
  });
});
