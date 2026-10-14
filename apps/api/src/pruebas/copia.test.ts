import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La copia de seguridad semanal (R16) corre en GitHub Actions, donde estas
 * pruebas no llegan. Lo que se puede comprobar aquí es que el flujo conserve
 * las garantías que lo hacen útil: si alguien las quita, falla.
 */

const flujo = readFileSync(join(__dirname, "..", "..", "..", "..", ".github", "workflows", "copia.yml"), "utf-8");

describe("copia de seguridad (R16)", () => {
  it("se cifra antes de salir del runner y el volcado en claro se borra", () => {
    expect(flujo).toMatch(/gpg --batch[\s\S]*--symmetric --cipher-algo AES256/);
    expect(flujo).toContain('shred -u "$f"');
    expect(flujo).toContain("${{ env.ARCHIVO }}");
    expect(flujo).not.toMatch(/path:\s*\S*\.dump\s*$/m);
  });

  it("falla si el rol no ve todas las filas: con RLS forzado la copia saldría vacía", () => {
    expect(flujo).toContain("rolbypassrls");
  });

  it("comprueba que la copia se pueda leer y traiga órdenes y mediciones", () => {
    expect(flujo).toContain("pg_restore --list");
    expect(flujo).toContain('TABLE DATA public "OrdenServicio"');
    expect(flujo).toContain('TABLE DATA public "LlantaRegistro"');
  });

  it("es semanal, se puede lanzar a mano y guarda cinco semanas", () => {
    expect(flujo).toMatch(/cron: "0 8 \* \* 1"/);
    expect(flujo).toContain("workflow_dispatch");
    expect(flujo).toContain("retention-days: 35");
  });
});
