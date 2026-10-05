/**
 * Preparación del entorno de pruebas de componentes.
 *
 * React Native no corre en Node: se sustituye por react-native-web, que
 * expone la misma API sobre el DOM. Sirve para probar comportamiento —qué se
 * muestra, qué pasa al tocar— pero no la apariencia real en el dispositivo:
 * eso se valida en el emulador.
 *
 * `jest-dom` agrega comprobaciones sobre el DOM (`toBeDisabled`,
 * `toHaveAttribute`) que dicen mejor qué falló que un `expect` genérico.
 */
import "@testing-library/jest-dom/vitest";
