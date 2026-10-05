import { describe, it, expect } from "vitest";
import {
  nuevoId,
  uuidRespaldo,
  esUuid,
  codigoReferencia,
  esCodigoReferencia,
  DOMAIN_VERSION,
} from "./index";

describe("dominio", () => {
  it("expone su versión", () => {
    expect(DOMAIN_VERSION).toBe("0.2.0");
  });
});

describe("nuevoId", () => {
  it("genera un UUID válido", () => {
    expect(esUuid(nuevoId())).toBe(true);
  });

  it("no repite entre llamadas", () => {
    // Es la garantía que hace posible capturar sin conexión y sincronizar
    // después sin duplicar registros.
    const ids = new Set(Array.from({ length: 2000 }, () => nuevoId()));
    expect(ids.size).toBe(2000);
  });

  it("rechaza cadenas que no son UUID", () => {
    expect(esUuid("OS-FUN-000123")).toBe(false);
    expect(esUuid("")).toBe(false);
    expect(esUuid("no-es-un-uuid")).toBe(false);
  });
});

describe("codigoReferencia", () => {
  it("usa el código de la sede como prefijo", () => {
    expect(codigoReferencia("FUN")).toMatch(/^FUN-/);
    expect(codigoReferencia("ct01")).toMatch(/^CT01-/);
  });

  it("produce un código con la forma esperada", () => {
    expect(esCodigoReferencia(codigoReferencia("FUN"))).toBe(true);
  });

  it("no se confunde con un folio real", () => {
    // Es deliberado: el técnico debe distinguir a simple vista que ese
    // número todavía no es el consecutivo definitivo.
    const ref = codigoReferencia("FUN");
    expect(ref).not.toMatch(/^OS-/);
    expect(ref).not.toMatch(/\d{6}/);
  });

  it("evita caracteres que se confunden al dictarlos por teléfono", () => {
    // Sin O/0, I/1, S/5, B/8, Z/2: el cliente lee el código en voz alta.
    const codigos = Array.from({ length: 500 }, () => codigoReferencia("FUN").split("-")[1] ?? "");
    const todos = codigos.join("");
    for (const prohibido of ["O", "0", "I", "1", "S", "5", "B", "8", "Z", "2"]) {
      expect(todos).not.toContain(prohibido);
    }
  });

  it("respeta el largo solicitado", () => {
    expect(codigoReferencia("FUN", 6).split("-")[1]).toHaveLength(6);
  });

  it("tiene suficiente variedad para no colisionar en una jornada", () => {
    const generados = new Set(Array.from({ length: 300 }, () => codigoReferencia("FUN")));
    // Con 26^4 combinaciones, 300 códigos casi nunca deberían chocar.
    expect(generados.size).toBeGreaterThan(295);
  });
});

describe("uuidRespaldo", () => {
  it("produce UUID válidos sin depender de crypto nativo", () => {
    // Necesario en WebView de Android antiguos: sin respaldo, la app no
    // podría generar identificadores estando sin conexión.
    expect(esUuid(uuidRespaldo())).toBe(true);
  });

  it("no repite", () => {
    const muchos = new Set(Array.from({ length: 1000 }, () => uuidRespaldo()));
    expect(muchos.size).toBe(1000);
  });

  it("marca la versión 4 y el bit de variante", () => {
    for (let i = 0; i < 50; i++) {
      const partes = uuidRespaldo().split("-");
      expect(partes[2]?.[0]).toBe("4");
      expect(["8", "9", "a", "b"]).toContain(partes[3]?.[0]);
    }
  });
});
