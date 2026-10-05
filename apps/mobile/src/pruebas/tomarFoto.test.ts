import { describe, it, expect, vi } from "vitest";
import { tomarYAdjuntar, type DependenciasFoto } from "../fotos/tomarFoto";
import { crearTransporte, interpretarRespuesta } from "../fotos/transporte";
import { SinConexion, UrlVencida } from "../fotos/subidor";

const imagen = { uri: "file:///f.jpg", ancho: 800, alto: 600, tamanoBytes: 120_000 };

function deps(camara: Partial<DependenciasFoto["camara"]> = {}): DependenciasFoto & { adjuntar: ReturnType<typeof vi.fn> } {
  return {
    camara: { pedirPermiso: async () => true, tomarFoto: async () => imagen, ...camara },
    manipulador: { comprimir: async (i) => i },
    adjuntar: vi.fn().mockResolvedValue("foto-1"),
    ahora: () => new Date("2026-10-05T12:00:00Z"),
  };
}
const destino = { ordenId: "ord-1", medicionId: "med-7", posicion: 7 };

describe("tomar y adjuntar", () => {
  it("adjunta a la posición con nombre y tamaño reales", async () => {
    const d = deps();
    expect(await tomarYAdjuntar(d, destino)).toEqual({ tipo: "adjuntada", id: "foto-1" });
    expect(d.adjuntar).toHaveBeenCalledWith(expect.objectContaining({
      ordenId: "ord-1", medicionId: "med-7", uriLocal: "file:///f.jpg", tamanoBytes: 120_000, tipoMime: "image/jpeg",
    }));
    expect(d.adjuntar.mock.calls[0]?.[0].nombre).toMatch(/^posicion-7-/);
  });

  it("cancelar no es un error ni adjunta nada", async () => {
    const d = deps({ tomarFoto: async () => null });
    expect(await tomarYAdjuntar(d, destino)).toEqual({ tipo: "cancelada" });
    expect(d.adjuntar).not.toHaveBeenCalled();
  });

  it("sin permiso explica dónde activarlo", async () => {
    const r = await tomarYAdjuntar(deps({ pedirPermiso: async () => false }), destino);
    expect(r.tipo).toBe("aviso");
  });
});

describe("transporte de fotos", () => {
  it("interpreta las respuestas del almacenamiento", () => {
    expect(interpretarRespuesta(200).tipo).toBe("ok");
    expect(interpretarRespuesta(403).tipo).toBe("url_vencida");
    expect(interpretarRespuesta(500).tipo).toBe("error");
  });

  it("URL vencida y falta de red se distinguen", async () => {
    const vencida = crearTransporte(async () => ({ status: 403 }));
    await expect(vencida.subir({ uriLocal: "u", url: "x", tipoMime: "image/jpeg" })).rejects.toBeInstanceOf(UrlVencida);
    const sinRed = crearTransporte(async () => { throw new Error("red"); });
    await expect(sinRed.subir({ uriLocal: "u", url: "x", tipoMime: "image/jpeg" })).rejects.toBeInstanceOf(SinConexion);
  });
});

describe("fotos en el repositorio", () => {
  it("lista por orden o posición, con su estado, y cuenta las que faltan por subir", async () => {
    const { abrirBaseEnMemoria } = await import("../datos/conexionNode");
    const { migrar } = await import("../datos/base");
    const { RepositorioLocal } = await import("../datos/repositorio");
    const db = await abrirBaseEnMemoria();
    await migrar(db);
    const repo = new RepositorioLocal(db);
    await repo.guardarOrden({
      id: "ord-1", sedeId: "s", clienteId: "c", sedeClienteId: "sc", vehiculoId: "v",
      tecnicoId: "t", configuracionEjeId: "cfg", tipo: "preventivo", estado: "en_proceso",
      fecha: "2026-10-05", encolar: false,
    });
    const base = { ordenId: "ord-1", nombre: "f.jpg", tipoMime: "image/jpeg" as const, tamanoBytes: 1000 };
    const deOrden = await repo.adjuntarFoto({ ...base, uriLocal: "file:///a.jpg" });
    await repo.adjuntarFoto({ ...base, medicionId: "med-7", uriLocal: "file:///b.jpg" });

    expect((await repo.fotosDe("ord-1", null)).map((f) => f.uriLocal)).toEqual(["file:///a.jpg"]);
    expect((await repo.fotosDe("ord-1", "med-7")).map((f) => f.uriLocal)).toEqual(["file:///b.jpg"]);
    expect(await repo.contarFotosSinSubir("ord-1")).toBe(2);

    await repo.marcarFotoSubida(deOrden);
    expect((await repo.fotosDe("ord-1", null))[0]?.estado).toBe("subida");
    expect(await repo.contarFotosSinSubir("ord-1")).toBe(1);
    await db.cerrar();
  });
});
