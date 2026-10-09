/**
 * Imágenes importadas desde el código. En el teléfono, Metro las convierte en
 * un recurso (número); en las pruebas, Vite en una ruta (texto). Quien las use
 * resuelve las dos formas.
 */
declare module "*.png" {
  const imagen: number | string;
  export default imagen;
}
declare module "*.jpg" {
  const imagen: number | string;
  export default imagen;
}
