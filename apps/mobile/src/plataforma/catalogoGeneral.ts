import { nuevoId } from "@tiretrack/domain";
import type { AccionesCatalogo } from "../app/ProveedorDatos";
import type { DisenoLocal, MarcaLocal, MedidaLocal } from "../datos/repositorio";

/**
 * El catálogo GENERAL de la plataforma (superadmin), en línea: es la misma
 * pantalla del catálogo de una empresa, con otra fuente. No pasa por la base
 * del teléfono (el superadmin no tiene empresa ni descarga) ni por la cola:
 * cada alta se confirma con el servidor, y si falla se dice.
 */

type R<T> = { ok: true; datos: T } | { ok: false; status: number; mensaje: string };
type EnLinea = <T>(metodo: "GET" | "POST", ruta: string, cuerpo?: unknown) => Promise<R<T>>;

interface MarcaServidor { id: string; nombre: string }
interface DisenoServidor { id: string; marcaId: string; nombre: string; tipoEje: string }
interface MedidaServidor { id: string; disenoId: string; medida: string; profundidadOriginal: number | null }

const exigir = <T>(r: R<T>): T => {
  if (!r.ok) throw new Error(r.status === 0 ? "Sin señal: el catálogo general se administra en línea" : r.mensaje);
  return r.datos;
};
const lista = <T>(r: R<T[]>): T[] => (r.ok && Array.isArray(r.datos) ? r.datos : []);

const aMarca = (m: MarcaServidor): MarcaLocal => ({ id: m.id, nombre: m.nombre, esGlobal: true, creadaLocal: false });
const aDiseno = (d: DisenoServidor): DisenoLocal => ({ id: d.id, marcaId: d.marcaId, nombre: d.nombre, tipoEje: d.tipoEje, creadaLocal: false });
const aMedida = (m: MedidaServidor): MedidaLocal => ({
  id: m.id, disenoId: m.disenoId, medida: m.medida, profundidadOriginal: m.profundidadOriginal,
});

export function accionesCatalogoGeneral(enLinea: EnLinea): AccionesCatalogo {
  return {
    marcas: async () => lista(await enLinea<MarcaServidor[]>("GET", "/plataforma/catalogo/marcas")).map(aMarca),
    disenosDe: async (marcaId) => lista(await enLinea<DisenoServidor[]>("GET", `/plataforma/catalogo/marcas/${marcaId}/disenos`)).map(aDiseno),
    medidasDe: async (disenoId) => lista(await enLinea<MedidaServidor[]>("GET", `/plataforma/catalogo/disenos/${disenoId}/medidas`)).map(aMedida),
    crearMarca: async (nombre) => aMarca(exigir(await enLinea<MarcaServidor>("POST", "/plataforma/catalogo/marcas", { id: nuevoId(), nombre }))),
    crearDiseno: async (marcaId, nombre, tipoEje) =>
      aDiseno(exigir(await enLinea<DisenoServidor>("POST", "/plataforma/catalogo/disenos", { id: nuevoId(), marcaId, nombre, tipoEje }))),
    crearMedida: async (disenoId, medida, profundidadOriginal) =>
      aMedida(
        exigir(
          await enLinea<MedidaServidor>("POST", "/plataforma/catalogo/medidas", {
            id: nuevoId(), disenoId, medida, ...(profundidadOriginal !== null ? { profundidadOriginal } : {}),
          }),
        ),
      ),
    // Nada que reflejar en el teléfono: no guarda el catálogo general.
    fijarProfundidadLocal: async () => undefined,
  };
}
