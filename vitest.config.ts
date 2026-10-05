import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/api/**/*.test.ts", "e2e/**/*.test.ts"],
    // Las pruebas de integración abren conexiones reales. PostgreSQL en
    // Windows tarda ~100 ms por conexión y el postmaster las acepta de a una:
    // la prueba de 50 folios simultáneos encola ~5 s, y cualquier otra que
    // abra una conexión en ese momento espera detrás. Con los 5 s por defecto
    // fallaban por turnos pruebas sin ningún defecto (medido: 0,9–5,2 s la
    // misma prueba). En el CI, sobre Linux, la conexión cuesta ~5 ms.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
      // El dominio concentra las reglas de negocio: se exige cobertura alta.
      thresholds: {
        "packages/domain/src/**": { lines: 90, functions: 90, branches: 85, statements: 90 },
      },
    },
  },
});
