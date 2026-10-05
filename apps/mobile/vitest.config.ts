import { defineConfig } from "vitest/config";

/**
 * Las pruebas de componentes necesitan un entorno de navegador simulado y el
 * preset de React Native, que resuelve los módulos nativos a sus dobles.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["./src/pruebas/preparar.ts"],
  },
  resolve: {
    // React Native publica código sin transpilar; este alias hace que Vitest
    // use la versión web, que es equivalente para probar comportamiento.
    alias: {
      "react-native": "react-native-web",
      // La librería real trae sintaxis Flow sin transpilar; el dibujo se
      // valida en el dispositivo, la lógica de la ruta en el dominio.
      "react-native-svg": new URL("./src/pruebas/dobles/react-native-svg.tsx", import.meta.url)
        .pathname,
    },
  },
});
