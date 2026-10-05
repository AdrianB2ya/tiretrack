import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { hayBaseDeDatos, conectarAislado } from "./base";
import { RepositorioCatalogoPg } from "../catalogo/repositorio";
import { ServicioCatalogo, type Contexto } from "../catalogo/servicio";

/**
 * Catálogo contra PostgreSQL real.
 *
 * Lo que se prueba aquí no es la detección de parecidos —eso ya está probado
 * en el dominio— sino que la validación se sostenga del lado del servidor y
 * que el ámbito global no se filtre entre empresas.
 */

const disponible = await hayBaseDeDatos();

const EMP_A = "emp-cat-a";
const EMP_B = "emp-cat-b";

const ADMIN_A: Contexto = { empresaId: EMP_A, rol: "administrador", usuarioId: "u-adm-a" };
const TECNICO_A: Contexto = { empresaId: EMP_A, rol: "tecnico", usuarioId: "u-tec-a" };
const ADMIN_B: Contexto = { empresaId: EMP_B, rol: "administrador", usuarioId: "u-adm-b" };
const SUPER: Contexto = { empresaId: EMP_A, rol: "superadmin", usuarioId: "u-super" };

let db: pg.Client;
let servicio: ServicioCatalogo;

describe.skipIf(!disponible)("catálogo", () => {
  beforeAll(async () => {
    db = await conectarAislado(import.meta.url);

    await db.query(`
      DROP TABLE IF EXISTS "LlantaRegistro", "DisenoMedida", "Diseno", "Marca" CASCADE;

      CREATE TABLE "Marca" (
        id text PRIMARY KEY,
        "empresaId" text,
        nombre text NOT NULL,
        "esGlobal" boolean NOT NULL DEFAULT false,
        "creadaEnCampo" boolean NOT NULL DEFAULT false,
        activa boolean NOT NULL DEFAULT true,
        "desactivadoEn" timestamptz,
        UNIQUE ("empresaId", nombre)
      );

      CREATE TABLE "Diseno" (
        id text PRIMARY KEY,
        "empresaId" text,
        "marcaId" text NOT NULL REFERENCES "Marca"(id),
        nombre text NOT NULL,
        "tipoEje" text NOT NULL DEFAULT 'multiuso',
        "esGlobal" boolean NOT NULL DEFAULT false,
        "creadaEnCampo" boolean NOT NULL DEFAULT false,
        activo boolean NOT NULL DEFAULT true,
        "desactivadoEn" timestamptz,
        UNIQUE ("marcaId", nombre)
      );

      CREATE TABLE "DisenoMedida" (
        id text PRIMARY KEY,
        "disenoId" text NOT NULL REFERENCES "Diseno"(id) ON DELETE CASCADE,
        medida text NOT NULL,
        "profundidadOriginal" numeric(5,2),
        UNIQUE ("disenoId", medida)
      );

      CREATE TABLE "LlantaRegistro" (
        id text PRIMARY KEY,
        "marcaId" text
      );
    `);

    servicio = new ServicioCatalogo(new RepositorioCatalogoPg(db));
  }, 60_000);

  afterAll(async () => {
    if (db) await db.end();
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE "LlantaRegistro", "DisenoMedida", "Diseno", "Marca" CASCADE`);

    // Marca global mantenida por la plataforma
    await db.query(
      `INSERT INTO "Marca" (id, "empresaId", nombre, "esGlobal") VALUES ('m-glob', NULL, 'Michelin', true)`,
    );
    await db.query(
      `INSERT INTO "Diseno" (id, "empresaId", "marcaId", nombre, "tipoEje", "esGlobal")
       VALUES ('d-glob', NULL, 'm-glob', 'XZY-3', 'direccional', true)`,
    );
    await db.query(
      `INSERT INTO "DisenoMedida" (id, "disenoId", medida, "profundidadOriginal")
       VALUES ('me-1', 'd-glob', '295/80R22.5', 16.0), ('me-2', 'd-glob', '11R22.5', 14.5)`,
    );
    // Marca propia de cada empresa
    await db.query(
      `INSERT INTO "Marca" (id, "empresaId", nombre) VALUES ('m-a', $1, 'Reencauchadora del Norte')`,
      [EMP_A],
    );
    await db.query(`INSERT INTO "Marca" (id, "empresaId", nombre) VALUES ('m-b', $1, 'Llantas Sur')`, [
      EMP_B,
    ]);
  });

  describe("visibilidad por ámbito", () => {
    it("cada empresa ve lo global más lo suyo", async () => {
      const a = await servicio.marcasVisibles(ADMIN_A);
      expect(a.map((m) => m.id).sort()).toEqual(["m-a", "m-glob"]);
    });

    it("no ve lo propio de otra empresa", async () => {
      const a = await servicio.marcasVisibles(ADMIN_A);
      expect(a.map((m) => m.id)).not.toContain("m-b");
    });

    it("los diseños de una marca ajena no se listan", async () => {
      await db.query(
        `INSERT INTO "Diseno" (id, "empresaId", "marcaId", nombre) VALUES ('d-b', $1, 'm-b', 'Propio B')`,
        [EMP_B],
      );
      expect(await servicio.disenosDeMarca(ADMIN_A, "m-b")).toEqual([]);
    });

    it("las medidas de un diseño ajeno tampoco", async () => {
      await db.query(
        `INSERT INTO "Diseno" (id, "empresaId", "marcaId", nombre) VALUES ('d-b', $1, 'm-b', 'Propio B')`,
        [EMP_B],
      );
      await db.query(
        `INSERT INTO "DisenoMedida" (id, "disenoId", medida) VALUES ('me-b', 'd-b', '11R22.5')`,
      );
      expect(await servicio.medidasDeDiseno(ADMIN_A, "d-b")).toEqual([]);
    });

    it("la marca global se ve desde cualquier empresa", async () => {
      const b = await servicio.marcasVisibles(ADMIN_B);
      expect(b.map((m) => m.id)).toContain("m-glob");
    });
  });

  describe("creación con validación en el servidor", () => {
    it("crea una marca nueva", async () => {
      const r = await servicio.crearMarca(ADMIN_A, { nombre: "Continental" });
      expect(r.ok).toBe(true);
    });

    it("bloquea el duplicado exacto ignorando tildes y mayúsculas", async () => {
      // La app ya lo valida, pero puede estar desactualizada o no ser la app.
      const r = await servicio.crearMarca(ADMIN_A, { nombre: "michelín" });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("YA_EXISTE");
    });

    it("el duplicado se detecta también contra una marca global", async () => {
      const r = await servicio.crearMarca(ADMIN_A, { nombre: "MICHELIN" });
      expect(r.ok).toBe(false);
    });

    it("una marca igual a la de OTRA empresa sí se puede crear", async () => {
      // No es duplicado: los catálogos propios son independientes.
      const r = await servicio.crearMarca(ADMIN_A, { nombre: "Llantas Sur" });
      expect(r.ok).toBe(true);
    });

    it("avisa de parecidas antes de crear", async () => {
      const r = await servicio.crearMarca(ADMIN_A, { nombre: "Michelim" });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("REQUIERE_CONFIRMACION");
    });

    it("si el técnico confirma, la crea", async () => {
      // Michelin y Michelim podrían ser marcas distintas de verdad.
      const r = await servicio.crearMarca(ADMIN_A, { nombre: "Michelim", forzar: true });
      expect(r.ok).toBe(true);
    });

    it("el duplicado exacto NO se puede forzar", async () => {
      const r = await servicio.crearMarca(ADMIN_A, { nombre: "Michelin", forzar: true });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("YA_EXISTE");
    });

    it("lo creado en campo queda marcado para revisión", async () => {
      await servicio.crearMarca(TECNICO_A, { nombre: "Recauchadora Local" });
      const p = await servicio.pendientesDeRevision(ADMIN_A);
      expect(p.marcas.map((m) => m.nombre)).toContain("Recauchadora Local");
    });

    it("lo que crea el administrador no entra a la bandeja", async () => {
      await servicio.crearMarca(ADMIN_A, { nombre: "Continental" });
      const p = await servicio.pendientesDeRevision(ADMIN_A);
      expect(p.marcas.map((m) => m.nombre)).not.toContain("Continental");
    });
  });

  describe("jerarquía marca → diseño → medida", () => {
    it("crea un diseño dentro de una marca visible", async () => {
      const r = await servicio.crearDiseno(ADMIN_A, {
        marcaId: "m-a",
        nombre: "Reencauche Directo",
        tipoEje: "traccion",
      });
      expect(r.ok).toBe(true);
    });

    it("no crea diseños en una marca de otra empresa", async () => {
      const r = await servicio.crearDiseno(ADMIN_A, { marcaId: "m-b", nombre: "Infiltrado" });
      expect(r.ok).toBe(false);
    });

    it("bloquea un diseño duplicado dentro de la misma marca", async () => {
      const r = await servicio.crearDiseno(ADMIN_A, { marcaId: "m-glob", nombre: "xzy3" });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("YA_EXISTE");
    });

    it("el mismo nombre de diseño en otra marca sí se permite", async () => {
      const r = await servicio.crearDiseno(ADMIN_A, { marcaId: "m-a", nombre: "XZY-3" });
      expect(r.ok).toBe(true);
    });
  });

  describe("medidas y profundidad de fábrica", () => {
    it("la profundidad viene de la medida, no del diseño", async () => {
      // Un XZY-3 en 295/80R22.5 trae 16 mm y en 11R22.5 trae 14.5: guardar
      // un solo valor por diseño haría mal el cálculo de desgaste.
      const medidas = await servicio.medidasDeDiseno(ADMIN_A, "d-glob");
      const por = Object.fromEntries(medidas.map((m) => [m.medida, m.profundidadOriginal]));
      expect(por["295/80R22.5"]).toBe(16);
      expect(por["11R22.5"]).toBe(14.5);
    });

    it("la profundidad llega como número, no como texto", async () => {
      // pg devuelve numeric como string: si no se convierte, el cálculo de
      // desgaste produce NaN sin avisar.
      const medidas = await servicio.medidasDeDiseno(ADMIN_A, "d-glob");
      expect(typeof medidas[0]?.profundidadOriginal).toBe("number");
    });

    it("agrega una medida nueva", async () => {
      const r = await servicio.agregarMedida(ADMIN_A, {
        disenoId: "d-glob",
        medida: "315/80R22.5",
        profundidadOriginal: 16.5,
      });
      expect(r.ok).toBe(true);
    });

    it("no repite una medida del mismo diseño", async () => {
      const r = await servicio.agregarMedida(ADMIN_A, {
        disenoId: "d-glob",
        medida: "295/80R22.5",
      });
      expect(r.ok).toBe(false);
    });

    it("rechaza un formato de medida que no lo es", async () => {
      const r = await servicio.agregarMedida(ADMIN_A, { disenoId: "d-glob", medida: "grande" });
      expect(r.ok).toBe(false);
    });
  });

  describe("revisión y promoción", () => {
    it("el administrador marca como revisada una entrada de campo", async () => {
      const creada = await servicio.crearMarca(TECNICO_A, { nombre: "Recauchadora Local" });
      if (!creada.ok) throw new Error("debió crearse");

      await servicio.marcarRevisada(ADMIN_A, "marca", creada.valor.marca.id);
      const p = await servicio.pendientesDeRevision(ADMIN_A);
      expect(p.marcas.map((m) => m.id)).not.toContain(creada.valor.marca.id);
    });

    it("solo el superadmin promueve una marca a global", async () => {
      const creada = await servicio.crearMarca(ADMIN_A, { nombre: "Continental" });
      if (!creada.ok) throw new Error();

      const porAdmin = await servicio.promoverMarca(ADMIN_A, creada.valor.marca.id);
      expect(porAdmin.ok).toBe(false);

      const porSuper = await servicio.promoverMarca(SUPER, creada.valor.marca.id);
      expect(porSuper.ok).toBe(true);
    });

    it("al promoverla deja de pertenecer a una empresa", async () => {
      const creada = await servicio.crearMarca(ADMIN_A, { nombre: "Continental" });
      if (!creada.ok) throw new Error();
      await servicio.promoverMarca(SUPER, creada.valor.marca.id);

      // Ahora la ve también la otra empresa
      const desdeB = await servicio.marcasVisibles(ADMIN_B);
      expect(desdeB.map((m) => m.nombre)).toContain("Continental");
    });

    it("el técnico no promueve nada", async () => {
      const r = await servicio.promoverMarca(TECNICO_A, "m-a");
      expect(r.ok).toBe(false);
    });
  });

  describe("desactivación", () => {
    it("desactiva una marca sin uso", async () => {
      const r = await servicio.desactivarMarca(ADMIN_A, "m-a");
      expect(r.ok).toBe(true);
      const visibles = await servicio.marcasVisibles(ADMIN_A);
      expect(visibles.map((m) => m.id)).not.toContain("m-a");
    });

    it("no desactiva una marca que ya se usó en mediciones", async () => {
      // Hay órdenes cerradas que la referencian: un documento cerrado no
      // cambia porque alguien limpie el catálogo.
      await db.query(`INSERT INTO "LlantaRegistro" (id, "marcaId") VALUES ('lr-1', 'm-a')`);
      const r = await servicio.desactivarMarca(ADMIN_A, "m-a");
      expect(r.ok).toBe(false);
    });

    it("guarda cuándo se desactivó", async () => {
      // Antes se llamaba sin la fecha y desactivadoEn quedaba vacío.
      await servicio.desactivarMarca(ADMIN_A, "m-a");
      const r = await db.query(`SELECT "desactivadoEn" FROM "Marca" WHERE id = 'm-a'`);
      expect(r.rows[0].desactivadoEn).not.toBeNull();
    });

    it("el mensaje dice cuántas mediciones la usan, no 'true'", async () => {
      // El repositorio devolvía un booleano y el mensaje decía "hay true
      // mediciones que la referencian".
      await db.query(`INSERT INTO "LlantaRegistro" (id, "marcaId") VALUES ('lr-1','m-a'), ('lr-2','m-a')`);
      const r = await servicio.desactivarMarca(ADMIN_A, "m-a");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.mensaje).toContain("hay 2 mediciones");
      expect(r.veredicto.mensaje).not.toContain("true");
    });

    it("con una sola medición usa el singular", async () => {
      await db.query(`INSERT INTO "LlantaRegistro" (id, "marcaId") VALUES ('lr-1','m-a')`);
      const r = await servicio.desactivarMarca(ADMIN_A, "m-a");
      if (r.ok) throw new Error();
      expect(r.veredicto.mensaje).toContain("hay 1 medición");
    });

    it("el técnico no desactiva marcas", async () => {
      const r = await servicio.desactivarMarca(TECNICO_A, "m-a");
      expect(r.ok).toBe(false);
    });
  });
});

// Solo existe sin base: con base, un "omitido" haría fallar la guarda del CI.
if (!disponible) describe("catálogo", () => {
  it("omitido: falta PostgreSQL", () => {
    expect(disponible).toBe(false);
  });
});
