import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

/** Solo para `npm run capturas`: dibuja las pantallas y guarda su HTML. */
// Se reemplaza la lista de archivos (mergeConfig la sumaría a la de las pruebas).
const config = mergeConfig(base, defineConfig({}));
config.test = { ...config.test, include: ["herramientas/capturas.test.tsx"] };
export default config;
