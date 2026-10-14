import type pg from "pg";

/**
 * Acceso a datos del catálogo.
 *
 * Las consultas NO llevan filtro de empresa: lo aplica RLS con el contexto
 * que fija la transacción. Escribirlo también aquí daría una falsa sensación
 * de seguridad — el día que alguien lo olvide, el motor sigue protegiendo.
 *
 * La excepción es el ámbito global del catálogo, que sí viaja en la consulta
 * porque no es aislamiento sino visibilidad: las marcas globales las ve todo
 * el mundo a propósito.
 */

export interface Marca {
  readonly id: string;
  readonly empresaId: string | null;
  readonly nombre: string;
  readonly esGlobal: boolean;
  readonly creadaEnCampo: boolean;
  readonly activa: boolean;
}

export interface Diseno {
  readonly id: string;
  readonly empresaId: string | null;
  readonly marcaId: string;
  readonly nombre: string;
  readonly tipoEje: string;
  readonly esGlobal: boolean;
  readonly creadaEnCampo: boolean;
  readonly activo: boolean;
}

export interface Medida {
  readonly id: string;
  readonly disenoId: string;
  readonly medida: string;
  readonly profundidadOriginal: number | null;
  /** null: del catálogo general. */
  readonly empresaId?: string | null;
  readonly creadaEnCampo?: boolean;
}

/** Medida creada en campo, con su diseño y marca para reconocerla. */
export interface MedidaRevisable extends Medida {
  readonly disenoNombre: string;
  readonly marcaNombre: string;
}

export interface RepositorioCatalogo {
  listarMarcas(empresaId: string): Promise<Marca[]>;
  listarMarcasGlobales(): Promise<Marca[]>;
  buscarMarca(id: string): Promise<Marca | null>;
  /** `esGlobal` no viaja: al crear siempre es false. Solo el superadmin promueve. */
  crearMarca(m: Omit<Marca, "activa" | "esGlobal">): Promise<Marca>;
  promoverMarca(id: string): Promise<Marca>;
  desactivarMarca(id: string, ahora: Date): Promise<void>;
  /** Cuántas mediciones referencian la marca. */
  medicionesConMarca(id: string): Promise<number>;

  listarDisenos(marcaId: string, empresaId: string): Promise<Diseno[]>;
  buscarDiseno(id: string): Promise<Diseno | null>;
  crearDiseno(d: Omit<Diseno, "activo" | "esGlobal">): Promise<Diseno>;

  /** Las globales y las de la empresa; nunca las de otra. */
  listarMedidas(disenoId: string, empresaId: string): Promise<Medida[]>;
  crearMedida(m: Medida & { empresaId: string; creadaEnCampo: boolean }): Promise<Medida>;
  buscarMedida(id: string): Promise<Medida | null>;
  fijarProfundidadOriginal(id: string, profundidad: number | null): Promise<void>;

  listarCreadasEnCampo(empresaId: string): Promise<{ marcas: Marca[]; disenos: Diseno[] }>;
  medidasCreadasEnCampo(empresaId: string): Promise<MedidaRevisable[]>;
  marcarRevisada(tipo: "marca" | "diseno" | "medida", id: string): Promise<void>;

  /** Con su alias, para decidir una unificación. */
  revisable(tipo: "marca" | "diseno", id: string): Promise<Revisable | null>;
  /** Todas las vigentes que la empresa ve (propias y globales), para elegir destino. */
  vigentes(tipo: "marca" | "diseno", empresaId: string): Promise<Revisable[]>;
  /** Los diseños vigentes de una marca, sin filtrar por ámbito. */
  disenosDeMarca(marcaId: string): Promise<{ id: string; nombre: string }[]>;
  /** Deja `origen` como alias de `destino`: no se ofrece más, no se borra. */
  unificar(tipo: "marca" | "diseno", origenId: string, destinoId: string, ahora: Date): Promise<void>;
}

export interface Revisable {
  readonly id: string;
  readonly nombre: string;
  readonly empresaId: string | null;
  readonly esGlobal: boolean;
  readonly activa: boolean;
  readonly reemplazadaPorId: string | null;
  readonly marcaId?: string;
  readonly marcaNombre?: string;
}

export class RepositorioCatalogoPg implements RepositorioCatalogo {
  constructor(private readonly db: pg.Client | pg.Pool) {}

  async listarMarcas(empresaId: string): Promise<Marca[]> {
    // El ámbito global sí va explícito: es visibilidad deliberada, no
    // aislamiento. El aislamiento lo garantiza RLS.
    const r = await this.db.query<Marca>(
      `SELECT id, "empresaId", nombre, "esGlobal", "creadaEnCampo", activa
         FROM "Marca"
        WHERE activa = true AND ("esGlobal" = true OR "empresaId" = $1)
        ORDER BY nombre`,
      [empresaId],
    );
    return r.rows;
  }

  async listarMarcasGlobales(): Promise<Marca[]> {
    const r = await this.db.query<Marca>(
      `SELECT id, "empresaId", nombre, "esGlobal", "creadaEnCampo", activa
         FROM "Marca" WHERE "esGlobal" = true AND activa = true ORDER BY nombre`,
    );
    return r.rows;
  }

  async buscarMarca(id: string): Promise<Marca | null> {
    const r = await this.db.query<Marca>(
      `SELECT id, "empresaId", nombre, "esGlobal", "creadaEnCampo", activa
         FROM "Marca" WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async crearMarca(m: Omit<Marca, "activa" | "esGlobal">): Promise<Marca> {
    const r = await this.db.query<Marca>(
      `INSERT INTO "Marca" (id, "empresaId", nombre, "esGlobal", "creadaEnCampo")
       VALUES ($1, $2, $3, false, $4)
       RETURNING id, "empresaId", nombre, "esGlobal", "creadaEnCampo", activa`,
      [m.id, m.empresaId, m.nombre, m.creadaEnCampo],
    );
    return r.rows[0] as Marca;
  }

  /** Promover pasa la marca al ámbito global: deja de pertenecer a una empresa. */
  async promoverMarca(id: string): Promise<Marca> {
    const r = await this.db.query<Marca>(
      `UPDATE "Marca"
          SET "esGlobal" = true, "empresaId" = NULL, "creadaEnCampo" = false
        WHERE id = $1
       RETURNING id, "empresaId", nombre, "esGlobal", "creadaEnCampo", activa`,
      [id],
    );
    return r.rows[0] as Marca;
  }

  /**
   * Se desactiva, no se borra: hay órdenes cerradas que la referencian y un
   * documento cerrado no cambia.
   */
  async desactivarMarca(id: string, ahora: Date): Promise<void> {
    await this.db.query(`UPDATE "Marca" SET activa = false, "desactivadoEn" = $2 WHERE id = $1`, [
      id,
      ahora,
    ]);
  }

  async medicionesConMarca(id: string): Promise<number> {
    const r = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "LlantaRegistro" WHERE "marcaId" = $1`,
      [id],
    );
    return r.rows[0]?.n ?? 0;
  }

  async listarDisenos(marcaId: string, empresaId: string): Promise<Diseno[]> {
    const r = await this.db.query<Diseno>(
      `SELECT id, "empresaId", "marcaId", nombre, "tipoEje", "esGlobal", "creadaEnCampo", activo
         FROM "Diseno"
        WHERE "marcaId" = $1 AND activo = true
          AND ("esGlobal" = true OR "empresaId" = $2)
        ORDER BY nombre`,
      [marcaId, empresaId],
    );
    return r.rows;
  }

  async buscarDiseno(id: string): Promise<Diseno | null> {
    const r = await this.db.query<Diseno>(
      `SELECT id, "empresaId", "marcaId", nombre, "tipoEje", "esGlobal", "creadaEnCampo", activo
         FROM "Diseno" WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async crearDiseno(d: Omit<Diseno, "activo" | "esGlobal">): Promise<Diseno> {
    const r = await this.db.query<Diseno>(
      `INSERT INTO "Diseno" (id, "empresaId", "marcaId", nombre, "tipoEje", "esGlobal", "creadaEnCampo")
       VALUES ($1, $2, $3, $4, $5, false, $6)
       RETURNING id, "empresaId", "marcaId", nombre, "tipoEje", "esGlobal", "creadaEnCampo", activo`,
      [d.id, d.empresaId, d.marcaId, d.nombre, d.tipoEje, d.creadaEnCampo],
    );
    return r.rows[0] as Diseno;
  }

  async listarMedidas(disenoId: string, empresaId: string): Promise<Medida[]> {
    // El filtro por empresa repite lo que hace RLS: una medida propia puede
    // colgar de un diseño global y no debe verse desde otra empresa.
    const r = await this.db.query<FilaMedida>(
      `SELECT ${COLUMNAS_MEDIDA} FROM "DisenoMedida"
        WHERE "disenoId" = $1 AND ("empresaId" IS NULL OR "empresaId" = $2)
        ORDER BY medida`,
      [disenoId, empresaId],
    );
    return r.rows.map(aMedida);
  }

  async crearMedida(m: Medida & { empresaId: string; creadaEnCampo: boolean }): Promise<Medida> {
    const r = await this.db.query<FilaMedida>(
      `INSERT INTO "DisenoMedida" (id, "empresaId", "disenoId", medida, "profundidadOriginal", "creadaEnCampo")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNAS_MEDIDA}`,
      [m.id, m.empresaId, m.disenoId, m.medida, m.profundidadOriginal, m.creadaEnCampo],
    );
    return aMedida(r.rows[0] as FilaMedida);
  }

  async buscarMedida(id: string): Promise<Medida | null> {
    const r = await this.db.query<FilaMedida>(`SELECT ${COLUMNAS_MEDIDA} FROM "DisenoMedida" WHERE id = $1`, [id]);
    return r.rows[0] ? aMedida(r.rows[0]) : null;
  }

  async fijarProfundidadOriginal(id: string, profundidad: number | null): Promise<void> {
    await this.db.query(`UPDATE "DisenoMedida" SET "profundidadOriginal" = $2 WHERE id = $1`, [id, profundidad]);
  }

  async medidasCreadasEnCampo(empresaId: string): Promise<MedidaRevisable[]> {
    const r = await this.db.query<FilaMedida & { disenoNombre: string; marcaNombre: string }>(
      `SELECT dm.id, dm."disenoId", dm.medida, dm."profundidadOriginal", dm."empresaId", dm."creadaEnCampo",
              d.nombre AS "disenoNombre", m.nombre AS "marcaNombre"
         FROM "DisenoMedida" dm
         JOIN "Diseno" d ON d.id = dm."disenoId"
         JOIN "Marca" m ON m.id = d."marcaId"
        WHERE dm."creadaEnCampo" = true AND dm."empresaId" = $1 AND d.activo AND m.activa
        ORDER BY m.nombre, d.nombre, dm.medida`,
      [empresaId],
    );
    return r.rows.map((f) => ({ ...aMedida(f), disenoNombre: f.disenoNombre, marcaNombre: f.marcaNombre }));
  }

  async listarCreadasEnCampo(empresaId: string): Promise<{ marcas: Marca[]; disenos: Diseno[] }> {
    const marcas = await this.db.query<Marca>(
      `SELECT id, "empresaId", nombre, "esGlobal", "creadaEnCampo", activa
         FROM "Marca"
        WHERE "creadaEnCampo" = true AND activa = true AND "empresaId" = $1
        ORDER BY nombre`,
      [empresaId],
    );
    const disenos = await this.db.query<Diseno>(
      `SELECT id, "empresaId", "marcaId", nombre, "tipoEje", "esGlobal", "creadaEnCampo", activo
         FROM "Diseno"
        WHERE "creadaEnCampo" = true AND activo = true AND "empresaId" = $1
          AND EXISTS (SELECT 1 FROM "Marca" m WHERE m.id = "Diseno"."marcaId" AND m.activa)
        ORDER BY nombre`,
      [empresaId],
    );
    return { marcas: marcas.rows, disenos: disenos.rows };
  }

  async marcarRevisada(tipo: "marca" | "diseno" | "medida", id: string): Promise<void> {
    const tabla = tipo === "marca" ? "Marca" : tipo === "diseno" ? "Diseno" : "DisenoMedida";
    await this.db.query(`UPDATE "${tabla}" SET "creadaEnCampo" = false WHERE id = $1`, [id]);
  }

  private consultaRevisable(tipo: "marca" | "diseno"): string {
    return tipo === "marca"
      ? `SELECT id, nombre, "empresaId", "esGlobal", activa, "reemplazadaPorId" FROM "Marca"`
      : `SELECT d.id, d.nombre, d."empresaId", d."esGlobal", d.activo AS activa,
                d."reemplazadoPorId" AS "reemplazadaPorId", d."marcaId", m.nombre AS "marcaNombre"
           FROM "Diseno" d JOIN "Marca" m ON m.id = d."marcaId"`;
  }

  async revisable(tipo: "marca" | "diseno", id: string): Promise<Revisable | null> {
    const pref = tipo === "marca" ? "" : "d.";
    const r = await this.db.query<Revisable>(`${this.consultaRevisable(tipo)} WHERE ${pref}id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async vigentes(tipo: "marca" | "diseno", empresaId: string): Promise<Revisable[]> {
    const pref = tipo === "marca" ? "" : "d.";
    const activo = tipo === "marca" ? "activa" : "d.activo";
    const r = await this.db.query<Revisable>(
      `${this.consultaRevisable(tipo)}
        WHERE ${activo} = true AND (${pref}"esGlobal" = true OR ${pref}"empresaId" = $1)
        ORDER BY ${pref}nombre`,
      [empresaId],
    );
    return r.rows;
  }

  async disenosDeMarca(marcaId: string): Promise<{ id: string; nombre: string }[]> {
    const r = await this.db.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM "Diseno" WHERE "marcaId" = $1 AND activo = true`,
      [marcaId],
    );
    return r.rows;
  }

  async unificar(tipo: "marca" | "diseno", origenId: string, destinoId: string, ahora: Date): Promise<void> {
    if (tipo === "marca") {
      await this.db.query(
        `UPDATE "Marca" SET "reemplazadaPorId" = $2, activa = false, "creadaEnCampo" = false, "desactivadoEn" = $3 WHERE id = $1`,
        [origenId, destinoId, ahora],
      );
    } else {
      await this.db.query(
        `UPDATE "Diseno" SET "reemplazadoPorId" = $2, activo = false, "creadaEnCampo" = false, "desactivadoEn" = $3 WHERE id = $1`,
        [origenId, destinoId, ahora],
      );
    }
  }
}

interface FilaMedida {
  id: string;
  disenoId: string;
  medida: string;
  profundidadOriginal: string | null;
  empresaId: string | null;
  creadaEnCampo: boolean;
}

const COLUMNAS_MEDIDA = `id, "disenoId", medida, "profundidadOriginal", "empresaId", "creadaEnCampo"`;

/**
 * Decimal llega como texto desde pg: convertirlo aquí evita que un Number()
 * olvidado más adelante produzca NaN en el cálculo de desgaste.
 */
function aMedida(f: FilaMedida): Medida {
  return {
    id: f.id,
    disenoId: f.disenoId,
    medida: f.medida,
    profundidadOriginal: f.profundidadOriginal === null ? null : Number(f.profundidadOriginal),
    empresaId: f.empresaId,
    creadaEnCampo: f.creadaEnCampo,
  };
}
