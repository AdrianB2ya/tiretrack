import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/api/**/*.test.ts", "e2e/**/*.test.ts"],
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
