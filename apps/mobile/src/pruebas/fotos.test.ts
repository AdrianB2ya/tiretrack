import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  planDeCompresion,
  siguienteIntento,
  ahorro,
  LADO_MAXIMO,
  OBJETIVO_BYTES,
  CALIDAD_MINIMA,
} from "../fotos/compresion";
import { SubidorFotos, SinConexion, UrlVencida, type TransporteDeFotos } from "../fotos/subidor";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar, type Conexion } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";

/**
 * Fotos: qué se comprime y cómo se sube.
 *
 * Veintidós fotos de 4 MB son cien megabytes por orden. La señal de una vía
 * rural no los sube, y la foto se queda esperando para siempre sin que el
 * técnico sepa por qué.
 */

const MB = 1024 * 1024;

describe("plan de compresión", () => {
  it("una foto de celular se reduce", () => {
    const p = planDeCompresion({ ancho: 4032, alto: 3024, tamanoBytes: 4 * MB });
    expect(p?.redimensionarA).toBe(LADO_MAXIMO);
    expect(p?.calidad).toBeLessThan(1);
  });

  it("una foto ya pequeña NO se toca", () => {
    // Recomprimir lo que ya es pequeño pierde calidad sin ganar nada, y el
    // serial de la llanta se lee una sola vez.
    expect(planDeCompresion({ ancho: 1200, alto: 900, tamanoBytes: 150 * 1024 })).toBeNull();
  });

  it("una foto pesada pero de lado pequeño se recomprime sin redimensionar", () => {
    const p = planDeCompresion({ ancho: 1200, alto: 900, tamanoBytes: 2 * MB });
    expect(p?.redimensionarA).toBeNull();
    expect(p?.calidad).toBeLessThan(1);
  });

  it("una foto liviana pero enorme se redimensiona", () => {
    const p = planDeCompresion({ ancho: 6000, alto: 4000, tamanoBytes: 100 * 1024 });
    expect(p?.redimensionarA).toBe(LADO_MAXIMO);
  });

  it("el lado máximo deja legible el flanco de una llanta", () => {
    // Bajar de aquí empieza a comerse los números del serial.
    expect(LADO_MAXIMO).toBeGreaterThanOrEqual(1280);
  });
});

describe("intentos sucesivos de compresión", () => {
  const plan = { redimensionarA: LADO_MAXIMO, calidad: 0.7 };

  it("si ya se alcanzó el objetivo, no hay otro intento", () => {
    expect(siguienteIntento(plan, OBJETIVO_BYTES - 1)).toBeNull();
  });

  it("si sigue pesando, baja la calidad", () => {
    const s = siguienteIntento(plan, 1 * MB);
    expect(s?.calidad).toBeLessThan(plan.calidad);
  });

  it("nunca baja de la calidad mínima legible", () => {
    // Una foto ilegible no demuestra nada: es peor que una foto grande.
    let actual: { redimensionarA: number | null; calidad: number } | null = plan;
    for (let i = 0; i < 20 && actual; i++) {
      const siguiente = siguienteIntento(actual, 5 * MB);
      if (!siguiente) break;
      expect(siguiente.calidad).toBeGreaterThanOrEqual(CALIDAD_MINIMA);
      actual = siguiente;
    }
  });

  it("termina: no se queda bajando para siempre", () => {
    let actual: { redimensionarA: number | null; calidad: number } | null = plan;
    let vueltas = 0;
    while (actual && vueltas < 50) {
      actual = siguienteIntento(actual, 5 * MB);
      vueltas++;
    }
    expect(actual).toBeNull();
  });

  it("calcula cuánto se ahorró", () => {
    expect(ahorro(4 * MB, 200 * 1024)).toBe(95);
    expect(ahorro(0, 0)).toBe(0);
  });
});

describe("subida de fotos", () => {
  let db: Conexion;
  let repo: RepositorioLocal;
  let subidor: SubidorFotos;
  let ahora = new Date("2026-09-21T08:00:00.000Z");
  let transporte: TransporteDeFotos & { subidas: string[]; fallarCon: Error | null };

  const ORDEN = "ord-1";

  beforeEach(async () => {
    db = await abrirBaseEnMemoria();
    await migrar(db);
    ahora = new Date("2026-09-21T08:00:00.000Z");
    repo = new RepositorioLocal(db, () => ahora);
    transporte = {
      subidas: [],
      fallarCon: null,
      subir: async ({ url }) => {
        if (transporte.fallarCon) throw transporte.fallarCon;
        transporte.subidas.push(url);
      },
    };
    subidor = new SubidorFotos(repo, transporte, () => ahora);

    await repo.guardarOrden({
      id: ORDEN, sedeId: "sede-fun", clienteId: "cli-1", sedeClienteId: "sc-1",
      vehiculoId: "veh-1", tecnicoId: "u-tec1", configuracionEjeId: "cfg-1",
      tipo: "preventivo", estado: "en_proceso", fecha: "2026-09-21", encolar: false,
    });
  });

  afterEach(async () => {
    await db.cerrar();
  });

  async function unaFotoConDestino(expiraEnSegundos = 600) {
    const id = await repo.adjuntarFoto({
      ordenId: ORDEN, uriLocal: "file:///f.jpg", nombre: "f.jpg",
      tipoMime: "image/jpeg", tamanoBytes: 200_000,
    });
    await repo.guardarDestinoDeFoto(id, { url: `https://subir.test/${id}`, expiraEn: expiraEnSegundos });
    return id;
  }

  it("sube las que tienen destino", async () => {
    const id = await unaFotoConDestino();
    const r = await subidor.subirPendientes();
    expect(r.subidas).toBe(1);
    expect(transporte.subidas[0]).toContain(id);
  });

  it("no intenta las que todavía no tienen destino", async () => {
    // Su operación de adjuntar aún no llegó al servidor.
    await repo.adjuntarFoto({
      ordenId: ORDEN, uriLocal: "file:///g.jpg", nombre: "g.jpg",
      tipoMime: "image/jpeg", tamanoBytes: 1000,
    });
    const r = await subidor.subirPendientes();
    expect(r.subidas).toBe(0);
    expect(transporte.subidas).toEqual([]);
  });

  it("al subir, encola la confirmación para el servidor", async () => {
    await unaFotoConDestino();
    await subidor.subirPendientes();
    const tipos = (await repo.operacionesPendientes()).map((o) => o.tipo);
    expect(tipos).toContain("subir_foto");
  });

  it("una foto subida no se vuelve a subir", async () => {
    await unaFotoConDestino();
    await subidor.subirPendientes();
    await subidor.subirPendientes();
    expect(transporte.subidas).toHaveLength(1);
  });

  describe("cuando falla", () => {
    it("la foto NO se borra: el archivo es evidencia", async () => {
      const id = await unaFotoConDestino();
      transporte.fallarCon = new Error("500 del almacenamiento");
      await subidor.subirPendientes();

      const filas = await db.consultar<{ n: number }>(`SELECT count(*) AS n FROM foto WHERE id = ?`, [id]);
      expect(filas[0]?.n).toBe(1);
    });

    it("espera antes de reintentar, y cada vez un poco más", async () => {
      await unaFotoConDestino();
      transporte.fallarCon = new Error("falló");
      await subidor.subirPendientes();

      // Inmediatamente después no se reintenta.
      expect((await repo.fotosPorSubir())).toHaveLength(0);

      ahora = new Date(ahora.getTime() + 2 * 60_000);
      expect((await repo.fotosPorSubir())).toHaveLength(1);
    });

    it("guarda el motivo para poder mirarlo", async () => {
      await unaFotoConDestino();
      transporte.fallarCon = new Error("almacenamiento sin espacio");
      await subidor.subirPendientes();

      ahora = new Date(ahora.getTime() + 2 * 60_000);
      const [f] = await repo.fotosPorSubir();
      expect(f?.ultimoError).toContain("sin espacio");
      expect(f?.intentos).toBe(1);
    });

    it("sin señal se detiene: las demás fallarían igual", async () => {
      await unaFotoConDestino();
      await unaFotoConDestino();
      transporte.fallarCon = new SinConexion();
      const r = await subidor.subirPendientes();

      expect(r.interrumpida).toBe(true);
      expect(r.fallidas).toBe(1);
    });

    it("con otro tipo de fallo sigue con las demás", async () => {
      // Un archivo corrupto no dice nada sobre el siguiente.
      await unaFotoConDestino();
      await unaFotoConDestino();
      transporte.fallarCon = new Error("archivo ilegible");
      const r = await subidor.subirPendientes();
      expect(r.fallidas).toBe(2);
    });
  });

  describe("URL vencida", () => {
    it("no se empieza una subida con una URL a punto de vencer", async () => {
      // Gastar datos para fallar a mitad de la subida es el peor resultado.
      await unaFotoConDestino(10);
      const r = await subidor.subirPendientes();
      expect(r.urlesRenovadas).toBe(1);
      expect(transporte.subidas).toEqual([]);
    });

    it("pedir otra URL reenvía la operación de adjuntar", async () => {
      // El servidor la identifica por el id de la foto: devuelve la misma
      // reserva con una URL nueva, sin contarla dos veces en el contenido.
      const id = await unaFotoConDestino(10);
      await subidor.subirPendientes();

      const ops = (await repo.operacionesPendientes()).filter((o) => o.tipo === "adjuntar_foto");
      expect(ops.filter((o) => o.recursoId === id)).toHaveLength(2);
    });

    it("si el almacenamiento la rechaza por vencida, tampoco cuenta como fallo", async () => {
      await unaFotoConDestino();
      transporte.fallarCon = new UrlVencida();
      const r = await subidor.subirPendientes();
      expect(r.urlesRenovadas).toBe(1);
      expect(r.fallidas).toBe(0);
    });

    it("renovar no suma un intento fallido", async () => {
      // Una URL vencida no es culpa de la foto: no debe acercarla al límite.
      const id = await unaFotoConDestino(10);
      await subidor.subirPendientes();
      const filas = await db.consultar<{ n: number }>(
        `SELECT intentos_subida AS n FROM foto WHERE id = ?`, [id],
      );
      expect(filas[0]?.n).toBe(0);
    });
  });

  it("no corre dos veces a la vez", async () => {
    await unaFotoConDestino();
    const [a, b] = await Promise.all([subidor.subirPendientes(), subidor.subirPendientes()]);
    expect([a.subidas, b.subidas].sort()).toEqual([0, 1]);
  });

  it("una foto de a la vez: no las sube en paralelo", async () => {
    // Veintidós subidas simultáneas por 4G rural fallan todas por tiempo.
    await unaFotoConDestino();
    await unaFotoConDestino();
    let simultaneas = 0;
    let maximo = 0;
    transporte.subir = async () => {
      simultaneas++;
      maximo = Math.max(maximo, simultaneas);
      await new Promise((r) => setTimeout(r, 5));
      simultaneas--;
    };
    await subidor.subirPendientes();
    expect(maximo).toBe(1);
  });

  it("la subida va por fuera de la cola ordenada", async () => {
    // Una foto lenta no puede frenar las mediciones ni la firma.
    await unaFotoConDestino();
    const antes = await repo.contarPendientes();
    transporte.fallarCon = new SinConexion();
    await subidor.subirPendientes();
    expect(await repo.contarPendientes()).toBe(antes);
  });
});

/** Silencia el aviso de vi no usado cuando se corre el archivo aislado. */
void vi;
