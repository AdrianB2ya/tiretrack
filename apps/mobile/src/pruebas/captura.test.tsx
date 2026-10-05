import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  capturarFoto,
  prepararFoto,
  MAXIMO_PASADAS,
  PASADAS_ESPERADAS,
  type Camara,
  type ImagenCapturada,
  type Manipulador,
} from "../fotos/captura";
import { GaleriaFotos, MAXIMO_POR_POSICION, type FotoEnPantalla } from "../fotos/GaleriaFotos";
import { OBJETIVO_BYTES } from "../fotos/compresion";

/**
 * Captura de fotos.
 *
 * El hardware no se prueba aquí —eso se valida en el emulador—, pero sí lo
 * que decide: cuántas pasadas de compresión, qué pasa si falla, y qué ve el
 * técnico sobre el estado de su evidencia.
 */

const MB = 1024 * 1024;

const fotoDeCelular: ImagenCapturada = {
  uri: "file:///original.jpg", ancho: 4032, alto: 3024, tamanoBytes: 4 * MB,
};

/** Manipulador falso: cada pasada deja la imagen en el tamaño indicado. */
function manipuladorQueLogra(...tamanos: number[]): Manipulador & { pasadas: number } {
  const m = {
    pasadas: 0,
    comprimir: async (imagen: ImagenCapturada) => {
      const tamano = tamanos[Math.min(m.pasadas, tamanos.length - 1)] ?? 0;
      m.pasadas++;
      return { ...imagen, uri: `file:///comprimida-${m.pasadas}.jpg`, tamanoBytes: tamano };
    },
  };
  return m;
}

describe("preparar la foto", () => {
  it("una foto pequeña no pasa por el manipulador", async () => {
    const m = manipuladorQueLogra(100);
    const pequena: ImagenCapturada = { uri: "f", ancho: 800, alto: 600, tamanoBytes: 90 * 1024 };
    expect(await prepararFoto(pequena, m)).toBe(pequena);
    expect(m.pasadas).toBe(0);
  });

  it("si la primera pasada alcanza el objetivo, no hay más", async () => {
    const m = manipuladorQueLogra(150 * 1024);
    const r = await prepararFoto(fotoDeCelular, m);
    expect(m.pasadas).toBe(1);
    expect(r.tamanoBytes).toBeLessThanOrEqual(OBJETIVO_BYTES);
  });

  it("insiste mientras siga pesando, y para en la calidad mínima", async () => {
    // Lo que detiene el bucle es la calidad mínima legible, no el tope de
    // pasadas: ese es solo una red de seguridad. Se fija el número real para
    // que un cambio en la regla de calidad se note aquí.
    const m = manipuladorQueLogra(3 * MB);
    await prepararFoto(fotoDeCelular, m);
    expect(m.pasadas).toBe(PASADAS_ESPERADAS);
    expect(m.pasadas).toBeLessThan(MAXIMO_PASADAS);
  });

  it("se queda con el mejor resultado, no con el último", async () => {
    // Recomprimir una foto ya optimizada puede dejarla MÁS grande.
    const m = manipuladorQueLogra(500 * 1024, 900 * 1024, 950 * 1024);
    const r = await prepararFoto(fotoDeCelular, m);
    expect(r.tamanoBytes).toBe(500 * 1024);
  });

  it("nunca devuelve algo más grande que el original", async () => {
    const m = manipuladorQueLogra(10 * MB);
    const r = await prepararFoto(fotoDeCelular, m);
    expect(r.tamanoBytes).toBeLessThanOrEqual(fotoDeCelular.tamanoBytes);
  });
});

describe("tomar una foto", () => {
  function camaraQue(resultado: ImagenCapturada | null, permiso = true): Camara {
    return {
      pedirPermiso: async () => permiso,
      tomarFoto: async () => resultado,
    };
  }

  it("entrega la foto lista para subir", async () => {
    const r = await capturarFoto(camaraQue(fotoDeCelular), manipuladorQueLogra(180 * 1024));
    expect(r.tipo).toBe("lista");
    expect(r.tipo === "lista" && r.imagen.tamanoBytes).toBe(180 * 1024);
  });

  it("conserva la original, para saber cuánto se ahorró", async () => {
    const r = await capturarFoto(camaraQue(fotoDeCelular), manipuladorQueLogra(180 * 1024));
    expect(r.tipo === "lista" && r.original.tamanoBytes).toBe(4 * MB);
  });

  it("sin permiso de cámara lo dice, no falla", async () => {
    const r = await capturarFoto(camaraQue(fotoDeCelular, false), manipuladorQueLogra(1));
    expect(r.tipo).toBe("sin_permiso");
  });

  it("cancelar no es un error", async () => {
    expect((await capturarFoto(camaraQue(null), manipuladorQueLogra(1))).tipo).toBe("cancelada");
  });

  it("si la compresión falla, se usa la foto ORIGINAL", async () => {
    // Vale más subir cuatro megabytes lentamente que perder la evidencia.
    const roto: Manipulador = { comprimir: async () => { throw new Error("sin memoria"); } };
    const r = await capturarFoto(camaraQue(fotoDeCelular), roto);
    expect(r.tipo).toBe("lista");
    expect(r.tipo === "lista" && r.imagen.uri).toBe("file:///original.jpg");
  });

  it("un fallo de la cámara sí se reporta", async () => {
    const camara: Camara = {
      pedirPermiso: async () => true,
      tomarFoto: async () => { throw new Error("cámara ocupada"); },
    };
    const r = await capturarFoto(camara, manipuladorQueLogra(1));
    expect(r.tipo).toBe("error");
    expect(r.tipo === "error" && r.mensaje).toContain("ocupada");
  });
});

describe("galería", () => {
  const foto = (id: string, estado: FotoEnPantalla["estado"]): FotoEnPantalla => ({
    id, uriLocal: `file:///${id}.jpg`, estado,
  });

  function montar(fotos: FotoEnPantalla[], props: Record<string, unknown> = {}) {
    const onTomarFoto = vi.fn();
    const onQuitar = vi.fn();
    render(<GaleriaFotos fotos={fotos} onTomarFoto={onTomarFoto} onQuitar={onQuitar} {...props} />);
    return { onTomarFoto, onQuitar };
  }

  it("muestra el estado de cada foto en texto, no solo en color", () => {
    // Bajo el sol los colores se confunden, y distinguirlos es el punto.
    montar([foto("a", "esperando"), foto("b", "subida")]);
    expect(screen.getByText("Sin enviar")).toBeTruthy();
    expect(screen.getByText("Enviada")).toBeTruthy();
  });

  it("avisa cuántas quedan sin enviar", () => {
    // Es lo que el técnico necesita saber antes de irse del vehículo.
    montar([foto("a", "esperando"), foto("b", "fallida"), foto("c", "subida")]);
    expect(screen.getByTestId("fotos-sin-enviar").textContent).toContain("2");
  });

  it("con todas enviadas no muestra el aviso", () => {
    montar([foto("a", "subida")]);
    expect(screen.queryByTestId("fotos-sin-enviar")).toBeNull();
  });

  it("sin fotos lo dice en vez de quedar en blanco", () => {
    montar([]);
    expect(screen.getByText("Sin fotos en esta posición")).toBeTruthy();
  });

  it("toma una foto", () => {
    const { onTomarFoto } = montar([]);
    fireEvent.click(screen.getByTestId("tomar-foto"));
    expect(onTomarFoto).toHaveBeenCalledOnce();
  });

  it("no deja pasar del máximo por posición", () => {
    // Más fotos no aportan y llenan el almacenamiento del celular.
    const muchas = Array.from({ length: MAXIMO_POR_POSICION }, (_, i) => foto(`f${i}`, "esperando"));
    const { onTomarFoto } = montar(muchas);
    fireEvent.click(screen.getByTestId("tomar-foto"));
    expect(onTomarFoto).not.toHaveBeenCalled();
    expect(screen.getByText(`Máximo ${MAXIMO_POR_POSICION} fotos`)).toBeTruthy();
  });

  it("una foto ya enviada NO se puede quitar", () => {
    // Está en el servidor y cuenta en el contenido firmado: quitarla del
    // celular daría una falsa sensación de haberla borrado.
    montar([foto("a", "subida")]);
    expect(screen.queryByTestId("quitar-a")).toBeNull();
  });

  it("una que no se ha enviado sí", () => {
    const { onQuitar } = montar([foto("a", "esperando")]);
    fireEvent.click(screen.getByTestId("quitar-a"));
    expect(onQuitar).toHaveBeenCalledWith("a");
  });

  it("con la orden cerrada no se toman ni se quitan fotos", () => {
    const { onTomarFoto } = montar([foto("a", "esperando")], { deshabilitada: true });
    fireEvent.click(screen.getByTestId("tomar-foto"));
    expect(onTomarFoto).not.toHaveBeenCalled();
    expect(screen.queryByTestId("quitar-a")).toBeNull();
  });
});
