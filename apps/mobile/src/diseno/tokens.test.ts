import { describe, it, expect } from "vitest";
import { colores } from "./tokens";

/**
 * Contraste de la paleta de Asistectire.
 *
 * La app se lee bajo el sol: el texto pide más que el mínimo de las guías
 * (4,5:1). Y el rojo de la marca no puede volverse el color de los botones,
 * o "peligro" deja de distinguirse.
 */

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

describe("paleta de Asistectire", () => {
  it("las capas se distinguen: cada una sube un escalón sobre la anterior", () => {
    // Antes la barra y las tarjetas eran casi del color del fondo (1,08 y 1,17).
    const capas = [colores.fondo, colores.superficie, colores.tarjeta, colores.campo, colores.elevado];
    for (let i = 1; i < capas.length; i++) expect(luminancia(capas[i]!)).toBeGreaterThan(luminancia(capas[i - 1]!));
    expect(contraste(colores.tarjeta, colores.fondo)).toBeGreaterThanOrEqual(1.2);
    // Y el fondo no es negro puro: el texto blanco "brillaba" borroso.
    expect(luminancia(colores.fondo)).toBeGreaterThan(0.005);
  });

  it("los colores de estado se leen como texto sobre tarjetas y campos", () => {
    for (const c of [colores.exito, colores.advertencia, colores.peligro, colores.secundario, colores.morado]) {
      for (const f of [colores.fondo, colores.tarjeta, colores.campo]) expect(contraste(c, f)).toBeGreaterThanOrEqual(4.5);
      // Y lleno, con texto oscuro encima (botón de peligro, casilla de cambio inmediato).
      expect(contraste(colores.sobrePrimario, c)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("el texto se lee también sobre los campos y las listas abiertas", () => {
    for (const f of [colores.campo, colores.elevado]) {
      expect(contraste(colores.texto, f)).toBeGreaterThanOrEqual(7);
      expect(contraste(colores.textoTenue, f)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("el texto se lee sobre el fondo, la superficie y las tarjetas con holgura", () => {
    for (const f of [colores.fondo, colores.superficie, colores.tarjeta]) {
      expect(contraste(colores.texto, f)).toBeGreaterThanOrEqual(7);
      expect(contraste(colores.textoTenue, f)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("el botón principal (blanco con texto negro) se lee", () => {
    expect(contraste(colores.sobrePrimario, colores.primario)).toBeGreaterThanOrEqual(7);
  });

  it("el rojo de la marca se distingue sobre el fondo, como acento", () => {
    expect(contraste(colores.marca, colores.fondo)).toBeGreaterThanOrEqual(3);
  });

  it("el rojo de la marca no es el color de lo interactivo", () => {
    // Si lo fuera, botones y "peligro" se confundirían bajo el sol.
    expect(colores.primario).not.toBe(colores.marca);
    expect(colores.primario).not.toBe(colores.peligro);
  });
});
