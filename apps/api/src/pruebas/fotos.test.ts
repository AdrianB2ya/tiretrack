import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { hayBaseDeDatos, conectarAislado } from "./base";
import { AlmacenamientoMemoria } from "../fotos/almacenamiento";
import { RepositorioFotosPg, ServicioFotos, type Contexto } from "../fotos/servicio";
import { MAXIMO_POR_POSICION, nuevoId } from "@tiretrack/domain";

/**
 * Fotos contra PostgreSQL real.
 *
 * El almacenamiento se sustituye por un doble en memoria: lo que se prueba
 * aquí es la lógica de permisos, topes y confirmación, no que AWS funcione.
 */

const disponible = await hayBaseDeDatos();

const EMP = "emp-foto";
const TEC1: Contexto = { empresaId: EMP, rol: "tecnico", usuarioId: "u-tec1" };
const TEC2: Contexto = { empresaId: EMP, rol: "tecnico", usuarioId: "u-tec2" };
const COORD: Contexto = { empresaId: EMP, rol: "coordinador", usuarioId: "u-coo" };
const CLIENTE: Contexto = {
  empresaId: EMP,
  rol: "cliente",
  usuarioId: "u-cli",
  vistaCliente: true,
};

const ORDEN = "ord-1";
const LLANTA = "lr-7";

let db: pg.Client;
let almacen: AlmacenamientoMemoria;
let servicio: ServicioFotos;
let contenidoCambiado: string[] = [];

const fotoBase = {
  ordenId: ORDEN,
  nombreArchivo: "posicion-7.jpg",
  tipoMime: "image/jpeg",
  tamanoBytes: 220_000,
};

describe.skipIf(!disponible)("fotos", () => {
  beforeAll(async () => {
    db = await conectarAislado(import.meta.url);

    await db.query(`
      DROP TABLE IF EXISTS "Foto", "LlantaRegistro", "OrdenServicio" CASCADE;
      DROP TYPE IF EXISTS "EstadoOrden" CASCADE;

      CREATE TYPE "EstadoOrden" AS ENUM
        ('borrador','programada','en_proceso','en_revision','pendiente_cliente','cerrada','anulada');

      CREATE TABLE "OrdenServicio" (
        id text PRIMARY KEY,
        "empresaId" text NOT NULL,
        tecnico_id text NOT NULL,
        estado "EstadoOrden" NOT NULL DEFAULT 'en_proceso'
      );

      CREATE TABLE "LlantaRegistro" (
        id text PRIMARY KEY,
        "ordenId" text NOT NULL REFERENCES "OrdenServicio"(id) ON DELETE CASCADE,
        posicion integer NOT NULL
      );

      CREATE TABLE "Foto" (
        id text PRIMARY KEY,
        "ordenId" text REFERENCES "OrdenServicio"(id) ON DELETE CASCADE,
        "llantaRegistroId" text REFERENCES "LlantaRegistro"(id) ON DELETE CASCADE,
        ruta text NOT NULL,
        nombre text NOT NULL,
        "tamanoBytes" integer,
        "subidaPorId" text,
        confirmada boolean NOT NULL DEFAULT false,
        "creadoEn" timestamptz NOT NULL DEFAULT now(),
        "subidaEn" timestamptz,
        CONSTRAINT foto_una_sola_referencia
          CHECK (num_nonnulls("ordenId", "llantaRegistroId") = 1)
      );
    `);

    almacen = new AlmacenamientoMemoria();
  }, 60_000);

  afterAll(async () => {
    if (db) await db.end();
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE "Foto", "LlantaRegistro", "OrdenServicio" CASCADE`);
    await db.query(
      `INSERT INTO "OrdenServicio" (id,"empresaId",tecnico_id,estado) VALUES ($1,$2,'u-tec1','en_proceso')`,
      [ORDEN, EMP],
    );
    await db.query(`INSERT INTO "LlantaRegistro" (id,"ordenId",posicion) VALUES ($1,$2,7)`, [
      LLANTA,
      ORDEN,
    ]);

    almacen.limpiar();
    contenidoCambiado = [];
    servicio = new ServicioFotos(
      new RepositorioFotosPg(db),
      almacen,
      async (ordenId) => {
        contenidoCambiado.push(ordenId);
      },
    );
  });

  /** Sube una foto completa: pide permiso y confirma. */
  async function subir(ctx = TEC1, extra: Record<string, unknown> = {}) {
    const permiso = await servicio.adjuntarFoto(ctx, { ...fotoBase, ...extra });
    if (!permiso.ok) throw new Error(permiso.veredicto.mensaje);
    const conf = await servicio.confirmarSubida(ctx, permiso.valor.fotoId);
    if (!conf.ok) throw new Error(conf.veredicto.mensaje);
    return conf.valor;
  }

  describe("el archivo no pasa por la API", () => {
    it("entrega una URL firmada en vez de recibir el archivo", async () => {
      const r = await servicio.adjuntarFoto(TEC1, fotoBase);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.url).toBeTruthy();
      expect(r.valor.expiraEn).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it("la ruta empieza por la empresa", async () => {
      const r = await servicio.adjuntarFoto(TEC1, fotoBase);
      if (!r.ok) throw new Error();
      expect(r.valor.ruta.startsWith(`${EMP}/`)).toBe(true);
      expect(r.valor.ruta).toContain(ORDEN);
    });

    it("las fotos de una posición van en su propia carpeta", async () => {
      const r = await servicio.adjuntarFoto(TEC1, {
        ...fotoBase,
        llantaRegistroId: LLANTA,
      });
      if (!r.ok) throw new Error();
      expect(r.valor.ruta).toContain("posicion-7");
    });
  });

  describe("confirmación en dos pasos", () => {
    it("la foto no existe hasta que se confirma", async () => {
      const permiso = await servicio.adjuntarFoto(TEC1, fotoBase);
      if (!permiso.ok) throw new Error();

      // Existe la reserva, no la foto
      const antes = await servicio.urlsDeOrden(TEC1, ORDEN);
      expect(antes).toHaveLength(0);

      await servicio.confirmarSubida(TEC1, permiso.valor.fotoId);
      const despues = await servicio.urlsDeOrden(TEC1, ORDEN);
      expect(despues).toHaveLength(1);
    });

    it("no confirma si el archivo nunca llegó al bucket", async () => {
      // El cliente puede decir que subió sin haberlo hecho: la orden
      // quedaría con una foto que al abrirla no existe.
      almacen.simularSubidaFallida = true;
      const permiso = await servicio.adjuntarFoto(TEC1, fotoBase);
      if (!permiso.ok) throw new Error();

      const r = await servicio.confirmarSubida(TEC1, permiso.valor.fotoId);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("ARCHIVO_NO_LLEGO");
    });

    it("confirmar dos veces es inofensivo", async () => {
      const permiso = await servicio.adjuntarFoto(TEC1, fotoBase);
      if (!permiso.ok) throw new Error();
      const a = await servicio.confirmarSubida(TEC1, permiso.valor.fotoId);
      const b = await servicio.confirmarSubida(TEC1, permiso.valor.fotoId);
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
    });

    it("otro usuario no confirma una subida ajena", async () => {
      const permiso = await servicio.adjuntarFoto(TEC1, fotoBase);
      if (!permiso.ok) throw new Error();
      const r = await servicio.confirmarSubida(TEC2, permiso.valor.fotoId);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("NO_ES_AUTOR");
    });
  });

  describe("validación antes de gastar datos móviles", () => {
    it("rechaza una foto sin comprimir sin entregar URL", async () => {
      const r = await servicio.adjuntarFoto(TEC1, {
        ...fotoBase,
        tamanoBytes: 4_000_000,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("ARCHIVO_MUY_GRANDE");
      // No se creó ninguna reserva
      const filas = await db.query(`SELECT count(*)::int AS n FROM "Foto"`);
      expect(filas.rows[0].n).toBe(0);
    });

    it("rechaza lo que no es imagen", async () => {
      const r = await servicio.adjuntarFoto(TEC1, {
        ...fotoBase,
        tipoMime: "application/pdf",
      });
      expect(r.ok).toBe(false);
    });

    it("respeta el tope por posición", async () => {
      for (let i = 0; i < MAXIMO_POR_POSICION; i++) {
        await subir(TEC1, { llantaRegistroId: LLANTA, nombreArchivo: `f${i}.jpg` });
      }
      const r = await servicio.adjuntarFoto(TEC1, {
        ...fotoBase,
        llantaRegistroId: LLANTA,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("DEMASIADAS_FOTOS");
    });

    it("no acepta una posición de otra orden", async () => {
      await db.query(
        `INSERT INTO "OrdenServicio" (id,"empresaId",tecnico_id) VALUES ('ord-2',$1,'u-tec1')`,
        [EMP],
      );
      await db.query(`INSERT INTO "LlantaRegistro" (id,"ordenId",posicion) VALUES ('lr-otra','ord-2',3)`);

      const r = await servicio.adjuntarFoto(TEC1, {
        ...fotoBase,
        llantaRegistroId: "lr-otra",
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("LLANTA_DE_OTRA_ORDEN");
    });
  });

  describe("permisos", () => {
    it("solo el técnico asignado sube fotos", async () => {
      const r = await servicio.adjuntarFoto(TEC2, fotoBase);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("SOLO_ASIGNADO");
    });

    it("el coordinador tampoco sube: devuelve la orden", async () => {
      const r = await servicio.adjuntarFoto(COORD, fotoBase);
      expect(r.ok).toBe(false);
    });

    it("no se suben fotos a una orden cerrada", async () => {
      await db.query(`UPDATE "OrdenServicio" SET estado = 'cerrada' WHERE id = $1`, [ORDEN]);
      const r = await servicio.adjuntarFoto(TEC1, fotoBase);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("ORDEN_CERRADA");
    });

    it("el cliente puede verlas pero no subirlas", async () => {
      await subir();
      const r = await servicio.adjuntarFoto(CLIENTE, fotoBase);
      expect(r.ok).toBe(false);

      const vistas = await servicio.urlsDeOrden(CLIENTE, ORDEN);
      expect(vistas).toHaveLength(1);
    });
  });

  describe("las fotos no son públicas", () => {
    it("se entregan con URL temporal", async () => {
      await subir();
      const r = await servicio.urlsDeOrden(TEC1, ORDEN);
      expect(r[0]?.url).toBeTruthy();
      // La URL no es la ruta cruda del bucket
      expect(r[0]?.url).not.toBe(r[0]?.foto.ruta);
    });
  });

  describe("la foto es contenido de la orden", () => {
    it("agregar una invalida la firma anterior", async () => {
      // Una foto nueva cambia el documento que el cliente firmaría. Se cuenta
      // al adjuntarla, en el orden de la cola.
      await subir();
      expect(contenidoCambiado).toContain(ORDEN);
    });

    it("borrar una también", async () => {
      const foto = await subir();
      contenidoCambiado = [];
      await servicio.borrar(TEC1, foto.id);
      expect(contenidoCambiado).toContain(ORDEN);
    });
  });

  describe("borrado", () => {
    it("el autor borra mientras la orden admite cambios", async () => {
      const foto = await subir();
      const r = await servicio.borrar(TEC1, foto.id);
      expect(r.ok).toBe(true);
      expect(await servicio.urlsDeOrden(TEC1, ORDEN)).toHaveLength(0);
    });

    it("borra también el archivo del bucket", async () => {
      const foto = await subir();
      expect(almacen.cantidad).toBe(1);
      await servicio.borrar(TEC1, foto.id);
      expect(almacen.cantidad).toBe(0);
    });

    it("no se borra una foto de una orden aprobada", async () => {
      // Después de aprobar, la evidencia es parte del expediente.
      const foto = await subir();
      await db.query(`UPDATE "OrdenServicio" SET estado = 'pendiente_cliente' WHERE id = $1`, [
        ORDEN,
      ]);
      const r = await servicio.borrar(TEC1, foto.id);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("ORDEN_NO_EDITABLE");
    });

    it("otro técnico no borra fotos ajenas", async () => {
      const foto = await subir();
      await db.query(`UPDATE "OrdenServicio" SET tecnico_id = 'u-tec2' WHERE id = $1`, [ORDEN]);
      const r = await servicio.borrar(TEC2, foto.id);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("NO_ES_AUTOR");
    });
  });

  describe("fotos sin archivo", () => {
    it("se reportan, no se borran", async () => {
      // Adjuntar ya cambió el contenido, que el cliente pudo firmar. Borrar la
      // reserva cambiaría en silencio un documento firmado, y el archivo casi
      // siempre sigue en el celular esperando señal.
      almacen.simularSubidaFallida = true;
      await servicio.adjuntarFoto(TEC1, fotoBase);
      almacen.simularSubidaFallida = false;
      await db.query(`UPDATE "Foto" SET "creadoEn" = now() - interval '2 hours'`);

      const r = await servicio.revisarSubidasPendientes(60);
      expect(r.sinArchivo).toHaveLength(1);
      const filas = await db.query(`SELECT count(*)::int AS n FROM "Foto"`);
      expect(filas.rows[0].n).toBe(1);
    });

    it("confirma las que sí llegaron tarde", async () => {
      const permiso = await servicio.adjuntarFoto(TEC1, fotoBase);
      if (!permiso.ok) throw new Error();
      await db.query(`UPDATE "Foto" SET "creadoEn" = now() - interval '2 hours'`);

      const r = await servicio.revisarSubidasPendientes(60);
      expect(r.confirmadas).toBe(1);
      const f = await db.query(`SELECT confirmada FROM "Foto" WHERE id = $1`, [permiso.valor.fotoId]);
      expect(f.rows[0].confirmada).toBe(true);
    });

    it("no toca las recientes", async () => {
      almacen.simularSubidaFallida = true;
      await servicio.adjuntarFoto(TEC1, fotoBase);
      const r = await servicio.revisarSubidasPendientes(60);
      expect(r.sinArchivo).toHaveLength(0);
      expect(r.confirmadas).toBe(0);
    });
  });

  describe("el contenido cambia al adjuntar, no al llegar los bytes", () => {
    it("adjuntar cuenta la foto en el contenido", async () => {
      await servicio.adjuntarFoto(TEC1, fotoBase);
      expect(contenidoCambiado).toContain(ORDEN);
    });

    it("confirmar los bytes NO cambia el contenido", async () => {
      // Los bytes pueden llegar después de la firma. Si confirmarlos cambiara
      // el contenido, invalidaría una firma hecha con la foto ya tomada.
      const permiso = await servicio.adjuntarFoto(TEC1, fotoBase);
      if (!permiso.ok) throw new Error();
      contenidoCambiado = [];
      await servicio.confirmarSubida(TEC1, permiso.valor.fotoId);
      expect(contenidoCambiado).toEqual([]);
    });

    it("reintentar la misma foto no la cuenta dos veces", async () => {
      // La operación puede reenviarse; con el id del dispositivo, la segunda
      // vez devuelve la misma reserva.
      const id = nuevoId();
      const a = await servicio.adjuntarFoto(TEC1, { ...fotoBase, id });
      const b = await servicio.adjuntarFoto(TEC1, { ...fotoBase, id });
      if (!a.ok || !b.ok) throw new Error();
      expect(b.valor.fotoId).toBe(a.valor.fotoId);
      expect(contenidoCambiado.filter((o) => o === ORDEN)).toHaveLength(1);
      const filas = await db.query(`SELECT count(*)::int AS n FROM "Foto"`);
      expect(filas.rows[0].n).toBe(1);
    });
  });

  describe("integridad", () => {
    it("una foto no puede ser de la orden y de una llanta a la vez", async () => {
      // Polimorfismo débil: lo garantiza un CHECK, no la aplicación.
      await expect(
        db.query(
          `INSERT INTO "Foto" (id,"ordenId","llantaRegistroId",ruta,nombre)
           VALUES ($1,$2,$3,'x','y')`,
          [nuevoId(), ORDEN, LLANTA],
        ),
      ).rejects.toThrow();
    });

    it("tampoco puede no ser de ninguna", async () => {
      await expect(
        db.query(`INSERT INTO "Foto" (id,ruta,nombre) VALUES ($1,'x','y')`, [nuevoId()]),
      ).rejects.toThrow();
    });
  });
});

describe.skipIf(disponible)("fotos", () => {
  it("omitidas: falta PostgreSQL", () => {
    expect(disponible).toBe(false);
  });
});
