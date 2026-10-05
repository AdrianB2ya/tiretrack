import type pg from "pg";
import {
  nuevoId,
  puedeBorrarFoto,
  puedeEditarMediciones,
  rutaAlmacenamiento,
  validarFoto,
  type EstadoOrden,
  type Rol,
  type Veredicto,
} from "@tiretrack/domain";
import type { Almacenamiento } from "./almacenamiento";

/**
 * Fotos de la orden y de cada posición de llanta.
 *
 * El flujo tiene dos pasos a propósito:
 *   1. El dispositivo pide permiso → recibe una URL firmada.
 *   2. Sube al bucket → confirma → se registra la foto.
 *
 * Se registra DESPUÉS de confirmar, no antes: si se registrara primero y la
 * subida fallara, la orden tendría una foto que al abrirla no existe.
 */

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
  readonly vistaCliente?: boolean;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; veredicto: Veredicto };

const fallo = (codigo: string, mensaje: string): Resultado<never> => ({
  ok: false,
  veredicto: { permitido: false, codigo, mensaje },
});

export interface Foto {
  readonly id: string;
  readonly ordenId: string | null;
  readonly llantaRegistroId: string | null;
  readonly ruta: string;
  readonly nombre: string;
  readonly tamanoBytes: number | null;
  readonly subidaPorId: string | null;
  readonly confirmada: boolean;
}

export interface RepositorioFotos {
  crear(f: Omit<Foto, "confirmada">): Promise<Foto>;
  confirmar(id: string): Promise<Foto | null>;
  buscar(id: string): Promise<Foto | null>;
  borrar(id: string): Promise<void>;
  deOrden(ordenId: string): Promise<Foto[]>;
  deLlanta(llantaRegistroId: string): Promise<Foto[]>;
  contarDeOrden(ordenId: string): Promise<number>;
  contarDeLlanta(llantaRegistroId: string): Promise<number>;
  /** Las que quedaron sin confirmar: subidas que nunca llegaron. */
  sinConfirmarAnterioresA(fecha: Date): Promise<Foto[]>;
  estadoDeOrden(ordenId: string): Promise<{ estado: EstadoOrden; tecnicoId: string } | null>;
  ordenDeLlanta(llantaRegistroId: string): Promise<string | null>;
  posicionDeLlanta(llantaRegistroId: string): Promise<number | null>;
}

export class RepositorioFotosPg implements RepositorioFotos {
  constructor(private readonly db: pg.Client | pg.Pool) {}

  private readonly campos = `
    id, "ordenId", "llantaRegistroId", ruta, nombre, "tamanoBytes",
    "subidaPorId", confirmada
  `;

  async crear(f: Omit<Foto, "confirmada">): Promise<Foto> {
    const r = await this.db.query<Foto>(
      `INSERT INTO "Foto" (id, "ordenId", "llantaRegistroId", ruta, nombre, "tamanoBytes", "subidaPorId")
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${this.campos}`,
      [f.id, f.ordenId, f.llantaRegistroId, f.ruta, f.nombre, f.tamanoBytes, f.subidaPorId],
    );
    return r.rows[0] as Foto;
  }

  async confirmar(id: string): Promise<Foto | null> {
    const r = await this.db.query<Foto>(
      `UPDATE "Foto" SET confirmada = true, "subidaEn" = now() WHERE id = $1 RETURNING ${this.campos}`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async buscar(id: string): Promise<Foto | null> {
    const r = await this.db.query<Foto>(`SELECT ${this.campos} FROM "Foto" WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async borrar(id: string): Promise<void> {
    await this.db.query(`DELETE FROM "Foto" WHERE id = $1`, [id]);
  }

  /** Solo las confirmadas: una foto sin confirmar no existe para el usuario. */
  async deOrden(ordenId: string): Promise<Foto[]> {
    const r = await this.db.query<Foto>(
      `SELECT ${this.campos} FROM "Foto"
        WHERE "ordenId" = $1 AND confirmada = true ORDER BY "subidaEn"`,
      [ordenId],
    );
    return r.rows;
  }

  async deLlanta(llantaRegistroId: string): Promise<Foto[]> {
    const r = await this.db.query<Foto>(
      `SELECT ${this.campos} FROM "Foto"
        WHERE "llantaRegistroId" = $1 AND confirmada = true ORDER BY "subidaEn"`,
      [llantaRegistroId],
    );
    return r.rows;
  }

  async contarDeOrden(ordenId: string): Promise<number> {
    const r = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "Foto" WHERE "ordenId" = $1 AND confirmada = true`,
      [ordenId],
    );
    return r.rows[0]?.n ?? 0;
  }

  async contarDeLlanta(llantaRegistroId: string): Promise<number> {
    const r = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "Foto" WHERE "llantaRegistroId" = $1 AND confirmada = true`,
      [llantaRegistroId],
    );
    return r.rows[0]?.n ?? 0;
  }

  async sinConfirmarAnterioresA(fecha: Date): Promise<Foto[]> {
    const r = await this.db.query<Foto>(
      `SELECT ${this.campos} FROM "Foto" WHERE confirmada = false AND "creadoEn" < $1`,
      [fecha],
    );
    return r.rows;
  }

  async estadoDeOrden(ordenId: string): Promise<{ estado: EstadoOrden; tecnicoId: string } | null> {
    const r = await this.db.query<{ estado: EstadoOrden; tecnicoId: string }>(
      `SELECT estado::text AS estado, tecnico_id AS "tecnicoId" FROM "OrdenServicio" WHERE id = $1`,
      [ordenId],
    );
    return r.rows[0] ?? null;
  }

  async ordenDeLlanta(llantaRegistroId: string): Promise<string | null> {
    const r = await this.db.query<{ ordenId: string }>(
      `SELECT "ordenId" FROM "LlantaRegistro" WHERE id = $1`,
      [llantaRegistroId],
    );
    return r.rows[0]?.ordenId ?? null;
  }

  async posicionDeLlanta(llantaRegistroId: string): Promise<number | null> {
    const r = await this.db.query<{ posicion: number }>(
      `SELECT posicion FROM "LlantaRegistro" WHERE id = $1`,
      [llantaRegistroId],
    );
    return r.rows[0]?.posicion ?? null;
  }
}

// ════════════════════════════════════════════════════════════════════════════

export interface PermisoSubida {
  readonly fotoId: string;
  readonly url: string;
  readonly expiraEn: number;
  readonly ruta: string;
}

export class ServicioFotos {
  constructor(
    private readonly repo: RepositorioFotos,
    private readonly almacen: Almacenamiento,
    /** Avisa a la orden que su contenido cambió, para invalidar la firma. */
    private readonly alCambiarContenido: (ordenId: string) => Promise<void>,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  /**
   * Paso 1: el dispositivo pide permiso. Aquí se valida todo —tipo, tamaño,
   * topes, permisos— antes de entregar la URL. Validar después de que el
   * técnico gastó sus datos móviles subiendo sería inútil.
   */
  async adjuntarFoto(
    ctx: Contexto,
    entrada: {
      /** Generado en el dispositivo: reintentar no crea una segunda foto. */
      id?: string;
      ordenId: string;
      llantaRegistroId?: string;
      nombreArchivo: string;
      tipoMime: string;
      tamanoBytes: number;
    },
  ): Promise<Resultado<PermisoSubida>> {
    const orden = await this.repo.estadoDeOrden(entrada.ordenId);
    if (!orden) return fallo("NO_EXISTE", "La orden no existe");

    const permiso = puedeEditarMediciones({
      estado: orden.estado,
      rol: ctx.rol,
      esTecnicoAsignado: orden.tecnicoId === ctx.usuarioId,
      vistaCliente: ctx.vistaCliente ?? false,
    });
    if (!permiso.permitido) return { ok: false, veredicto: permiso };

    let posicion: number | null = null;
    let existentes: number;

    if (entrada.llantaRegistroId) {
      const ordenDeLaLlanta = await this.repo.ordenDeLlanta(entrada.llantaRegistroId);
      if (ordenDeLaLlanta !== entrada.ordenId) {
        return fallo("LLANTA_DE_OTRA_ORDEN", "Esa posición no pertenece a esta orden");
      }
      posicion = await this.repo.posicionDeLlanta(entrada.llantaRegistroId);
      existentes = await this.repo.contarDeLlanta(entrada.llantaRegistroId);
    } else {
      existentes = await this.repo.contarDeOrden(entrada.ordenId);
    }

    const validez = validarFoto({
      tipoMime: entrada.tipoMime,
      tamanoBytes: entrada.tamanoBytes,
      nombreArchivo: entrada.nombreArchivo,
      existentes,
      posicion,
    });
    if (!validez.permitido) return { ok: false, veredicto: validez };

    // Reintentar la misma operación devuelve la reserva existente, sin volver
    // a contar la foto en el contenido.
    if (entrada.id) {
      const previa = await this.repo.buscar(entrada.id);
      if (previa) {
        const firmada = await this.almacen.urlDeSubida(
          previa.ruta, entrada.tipoMime, entrada.tamanoBytes,
        );
        return {
          ok: true,
          valor: { fotoId: previa.id, url: firmada.url, expiraEn: firmada.expiraEn, ruta: previa.ruta },
        };
      }
    }
    const fotoId = entrada.id ?? nuevoId();
    const ruta = rutaAlmacenamiento({
      empresaId: ctx.empresaId,
      ordenId: entrada.ordenId,
      fotoId,
      posicion,
      tipoMime: entrada.tipoMime,
    });

    // Se registra como NO confirmada: existe la reserva, no la foto.
    await this.repo.crear({
      id: fotoId,
      ordenId: entrada.llantaRegistroId ? null : entrada.ordenId,
      llantaRegistroId: entrada.llantaRegistroId ?? null,
      ruta,
      nombre: entrada.nombreArchivo.trim(),
      tamanoBytes: entrada.tamanoBytes,
      subidaPorId: ctx.usuarioId,
    });

    // AQUÍ cambia el contenido, no al confirmar los bytes. Esta operación
    // viaja en la cola ordenada junto con las mediciones y la firma, así que
    // respeta el orden en que el técnico trabajó. Antes lo hacía la
    // confirmación, que podía llegar DESPUÉS de la firma e invalidarla aunque
    // la foto se hubiera tomado antes de firmar.
    await this.alCambiarContenido(entrada.ordenId);

    const firmada = await this.almacen.urlDeSubida(ruta, entrada.tipoMime, entrada.tamanoBytes);
    return { ok: true, valor: { fotoId, url: firmada.url, expiraEn: firmada.expiraEn, ruta } };
  }

  /**
   * Paso 2: el dispositivo avisa que terminó. Se comprueba contra el bucket
   * en vez de creerle: el cliente puede decir que subió sin haberlo hecho, y
   * la orden quedaría con una foto fantasma.
   */
  async confirmarSubida(ctx: Contexto, fotoId: string): Promise<Resultado<Foto>> {
    const foto = await this.repo.buscar(fotoId);
    if (!foto) return fallo("NO_EXISTE", "La foto no existe");
    if (foto.subidaPorId !== ctx.usuarioId) {
      return fallo("NO_ES_AUTOR", "Esa subida la inició otro usuario");
    }
    if (foto.confirmada) return { ok: true, valor: foto };

    const llego = await this.almacen.existe(foto.ruta);
    if (!llego) {
      return fallo("ARCHIVO_NO_LLEGO", "El archivo no está en el servidor. Reintenta la subida");
    }

    const confirmada = await this.repo.confirmar(fotoId);
    if (!confirmada) return fallo("NO_EXISTE", "La foto no existe");

    // No toca el contenido: la foto ya contó al adjuntarse. Confirmar solo
    // certifica que los bytes llegaron, y puede ocurrir en cualquier momento.
    return { ok: true, valor: confirmada };
  }

  /** Las fotos no son públicas: se entregan con URL temporal. */
  async urlsDeOrden(_ctx: Contexto, ordenId: string): Promise<{ foto: Foto; url: string }[]> {
    const fotos = await this.repo.deOrden(ordenId);
    return Promise.all(
      fotos.map(async (foto) => ({
        foto,
        url: (await this.almacen.urlDeLectura(foto.ruta)).url,
      })),
    );
  }

  async urlsDeLlanta(
    _ctx: Contexto,
    llantaRegistroId: string,
  ): Promise<{ foto: Foto; url: string }[]> {
    const fotos = await this.repo.deLlanta(llantaRegistroId);
    return Promise.all(
      fotos.map(async (foto) => ({
        foto,
        url: (await this.almacen.urlDeLectura(foto.ruta)).url,
      })),
    );
  }

  async borrar(ctx: Contexto, fotoId: string): Promise<Resultado<void>> {
    const foto = await this.repo.buscar(fotoId);
    if (!foto) return fallo("NO_EXISTE", "La foto no existe");

    const ordenId = foto.ordenId ?? (await this.repo.ordenDeLlanta(foto.llantaRegistroId ?? ""));
    if (!ordenId) return fallo("NO_EXISTE", "La foto no pertenece a ninguna orden");

    const orden = await this.repo.estadoDeOrden(ordenId);
    if (!orden) return fallo("NO_EXISTE", "La orden no existe");

    const editable = puedeEditarMediciones({
      estado: orden.estado,
      rol: ctx.rol,
      esTecnicoAsignado: orden.tecnicoId === ctx.usuarioId,
      vistaCliente: ctx.vistaCliente ?? false,
    });

    const v = puedeBorrarFoto({
      esAutor: foto.subidaPorId === ctx.usuarioId,
      ordenEditable: editable.permitido,
    });
    if (!v.permitido) return { ok: false, veredicto: v };

    // Primero el registro, después el archivo: si falla el borrado en el
    // bucket queda un objeto huérfano, que es barato. Al revés quedaría una
    // foto listada que al abrirla no existe.
    await this.repo.borrar(fotoId);
    await this.almacen.borrar(foto.ruta);
    await this.alCambiarContenido(ordenId);

    return { ok: true, valor: undefined };
  }

  /**
   * Limpieza de reservas que nunca se confirmaron: el técnico pidió la URL,
   * perdió la señal y nunca subió. Sin esto, esas filas cuentan para los
   * topes y bloquean al técnico al día siguiente.
   */
  /**
   * Revisa las fotos adjuntadas cuyo archivo no ha llegado.
   *
   * Las que llegaron tarde se confirman. Las que siguen sin archivo **se
   * reportan, no se borran**: adjuntar una foto ya cambió el contenido de la
   * orden, que el cliente pudo haber firmado. Borrarla cambiaría en silencio
   * un documento firmado; y el archivo casi siempre sigue en el celular,
   * esperando señal para subir.
   */
  async revisarSubidasPendientes(
    minutosDeGracia = 60,
  ): Promise<{ confirmadas: number; sinArchivo: Foto[] }> {
    const limite = new Date(this.reloj().getTime() - minutosDeGracia * 60_000);
    const pendientes = await this.repo.sinConfirmarAnterioresA(limite);

    let confirmadas = 0;
    const sinArchivo: Foto[] = [];
    for (const foto of pendientes) {
      if (await this.almacen.existe(foto.ruta)) {
        await this.repo.confirmar(foto.id);
        confirmadas++;
      } else {
        sinArchivo.push(foto);
      }
    }
    return { confirmadas, sinArchivo };
  }
}
