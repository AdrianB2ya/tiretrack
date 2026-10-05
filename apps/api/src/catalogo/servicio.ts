import {
  clave,
  evaluarNombreNuevo,
  evaluarPromocion,
  jerarquiaCoherente,
  medidaValida,
  normalizarMedida,
  nuevoId,
  puedeCrearEntrada,
  puedeModificar,
  puedePromoverAGlobal,
  type EntradaConAmbito,
  type Rol,
  type Veredicto,
} from "@tiretrack/domain";
import type { RepositorioCatalogo, Marca, Diseno, Medida } from "./repositorio";

/**
 * Catálogo de llantas.
 *
 * La validación de duplicados se repite aquí aunque la app ya la haga: la
 * app puede estar desactualizada, sin conexión con un catálogo viejo en
 * caché, o simplemente no ser la app. El servidor es el único punto por el
 * que pasa todo.
 */

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; veredicto: Veredicto };

const fallo = (codigo: string, mensaje: string): Resultado<never> => ({
  ok: false,
  veredicto: { permitido: false, codigo, mensaje },
});

export class ServicioCatalogo {
  constructor(
    private readonly repo: RepositorioCatalogo,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  // ── Consulta ──────────────────────────────────────────────────────────────

  /** Lo global más lo propio de la empresa. Nunca lo propio de otra. */
  async marcasVisibles(ctx: Contexto): Promise<Marca[]> {
    return this.repo.listarMarcas(ctx.empresaId);
  }

  async disenosDeMarca(ctx: Contexto, marcaId: string): Promise<Diseno[]> {
    const marca = await this.repo.buscarMarca(marcaId);
    if (!marca || !this.visible(marca, ctx.empresaId)) return [];
    return this.repo.listarDisenos(marcaId, ctx.empresaId);
  }

  async medidasDeDiseno(ctx: Contexto, disenoId: string): Promise<Medida[]> {
    const diseno = await this.repo.buscarDiseno(disenoId);
    if (!diseno) return [];
    const marca = await this.repo.buscarMarca(diseno.marcaId);
    if (!marca || !this.visible(marca, ctx.empresaId)) return [];
    return this.repo.listarMedidas(disenoId);
  }

  private visible(e: EntradaConAmbito, empresaId: string): boolean {
    return e.esGlobal || e.empresaId === empresaId;
  }

  // ── Creación ──────────────────────────────────────────────────────────────

  /**
   * Antes de crear, se busca. El duplicado exacto se bloquea; el parecido se
   * devuelve para que quien crea decida, porque "Michelin" y "Michelim"
   * podrían ser marcas distintas de verdad.
   */
  async crearMarca(
    ctx: Contexto,
    entrada: { nombre: string; id?: string; forzar?: boolean },
  ): Promise<Resultado<{ marca: Marca; parecidas: Marca[] }>> {
    const permiso = puedeCrearEntrada(ctx.rol);
    if (!permiso.permitido) return { ok: false, veredicto: permiso };

    const nombre = entrada.nombre.trim();
    const existentes = await this.repo.listarMarcas(ctx.empresaId);
    const evaluacion = evaluarNombreNuevo(nombre, existentes);

    if (evaluacion.duplicado) {
      return fallo(
        "YA_EXISTE",
        `Ya existe "${evaluacion.duplicado.nombre}". Selecciónala en vez de crearla`,
      );
    }
    if (!evaluacion.puedeCrear) {
      return fallo("NOMBRE_INVALIDO", "El nombre es demasiado corto");
    }

    // Si hay parecidas y no se confirmó, se devuelven para que el usuario
    // decida en vez de crear una variante por error de tipeo.
    if (evaluacion.parecidas.length > 0 && !entrada.forzar) {
      return {
        ok: false,
        veredicto: {
          permitido: false,
          codigo: "REQUIERE_CONFIRMACION",
          mensaje: `Se parece a: ${evaluacion.parecidas.map((p) => p.nombre).join(", ")}`,
        },
      };
    }

    const marca = await this.repo.crearMarca({
      id: entrada.id ?? nuevoId(),
      empresaId: ctx.empresaId,
      nombre,
      // Lo que crea el técnico en campo queda marcado para revisión
      creadaEnCampo: ctx.rol === "tecnico",
    });

    return { ok: true, valor: { marca, parecidas: [...evaluacion.parecidas] } };
  }

  async crearDiseno(
    ctx: Contexto,
    entrada: { marcaId: string; nombre: string; tipoEje?: string; id?: string; forzar?: boolean },
  ): Promise<Resultado<{ diseno: Diseno; parecidas: Diseno[] }>> {
    const permiso = puedeCrearEntrada(ctx.rol);
    if (!permiso.permitido) return { ok: false, veredicto: permiso };

    const marca = await this.repo.buscarMarca(entrada.marcaId);
    if (!marca || !this.visible(marca, ctx.empresaId)) {
      return fallo("MARCA_NO_ENCONTRADA", "La marca no existe o no es visible");
    }

    const nombre = entrada.nombre.trim();
    const existentes = await this.repo.listarDisenos(entrada.marcaId, ctx.empresaId);
    const evaluacion = evaluarNombreNuevo(nombre, existentes);

    if (evaluacion.duplicado) {
      return fallo("YA_EXISTE", `"${evaluacion.duplicado.nombre}" ya existe en esta marca`);
    }
    if (!evaluacion.puedeCrear) {
      return fallo("NOMBRE_INVALIDO", "El nombre es demasiado corto");
    }
    if (evaluacion.parecidas.length > 0 && !entrada.forzar) {
      return {
        ok: false,
        veredicto: {
          permitido: false,
          codigo: "REQUIERE_CONFIRMACION",
          mensaje: `Se parece a: ${evaluacion.parecidas.map((p) => p.nombre).join(", ")}`,
        },
      };
    }

    const diseno = await this.repo.crearDiseno({
      id: entrada.id ?? nuevoId(),
      marcaId: entrada.marcaId,
      empresaId: ctx.empresaId,
      nombre,
      tipoEje: entrada.tipoEje ?? "multiuso",
      creadaEnCampo: ctx.rol === "tecnico",
    });

    return { ok: true, valor: { diseno, parecidas: [...evaluacion.parecidas] } };
  }

  /**
   * La profundidad de fábrica va en la MEDIDA, no en el diseño: un XZY-3 en
   * 295/80R22.5 trae 16 mm y en 11R22.5 trae 14.5.
   */
  async agregarMedida(
    ctx: Contexto,
    entrada: { disenoId: string; medida: string; profundidadOriginal?: number },
  ): Promise<Resultado<Medida>> {
    const permiso = puedeCrearEntrada(ctx.rol);
    if (!permiso.permitido) return { ok: false, veredicto: permiso };

    const diseno = await this.repo.buscarDiseno(entrada.disenoId);
    if (!diseno) return fallo("DISENO_NO_ENCONTRADO", "El diseño no existe");

    const marca = await this.repo.buscarMarca(diseno.marcaId);
    if (!marca || !this.visible(marca, ctx.empresaId)) {
      return fallo("DISENO_NO_ENCONTRADO", "El diseño no existe");
    }

    const medida = normalizarMedida(entrada.medida);
    if (!medidaValida(medida)) {
      return fallo("MEDIDA_INVALIDA", "Formato esperado: 295/80R22.5");
    }

    const existentes = await this.repo.listarMedidas(entrada.disenoId);
    if (existentes.some((m) => clave(m.medida) === clave(medida))) {
      return fallo("YA_EXISTE", `La medida ${medida} ya está registrada en este diseño`);
    }

    const creada = await this.repo.crearMedida({
      id: nuevoId(),
      disenoId: entrada.disenoId,
      medida,
      profundidadOriginal: entrada.profundidadOriginal ?? null,
    });
    return { ok: true, valor: creada };
  }

  // ── Gobierno ──────────────────────────────────────────────────────────────

  /** Lo creado en campo, pendiente de que un administrador lo verifique. */
  async pendientesDeRevision(ctx: Contexto): Promise<{ marcas: Marca[]; disenos: Diseno[] }> {
    return this.repo.listarCreadasEnCampo(ctx.empresaId);
  }

  async marcarRevisada(ctx: Contexto, tipo: "marca" | "diseno", id: string): Promise<Resultado<void>> {
    if (ctx.rol !== "administrador" && ctx.rol !== "superadmin") {
      return fallo("SIN_PERMISO", "Solo el administrador revisa el catálogo creado en campo");
    }
    await this.repo.marcarRevisada(tipo, id);
    return { ok: true, valor: undefined };
  }

  /**
   * Convierte una marca propia en global. Se comprueba antes que no exista
   * ya una global equivalente: promover un duplicado partiría el análisis
   * en dos marcas para lo mismo.
   */
  async promoverMarca(ctx: Contexto, marcaId: string): Promise<Resultado<Marca>> {
    const permiso = puedePromoverAGlobal(ctx.rol);
    if (!permiso.permitido) return { ok: false, veredicto: permiso };

    const marca = await this.repo.buscarMarca(marcaId);
    if (!marca) return fallo("NO_ENCONTRADA", "La marca no existe");

    const globales = await this.repo.listarMarcasGlobales();
    const evaluacion = evaluarPromocion(marca, globales);
    if (!evaluacion.permitido) return { ok: false, veredicto: evaluacion };

    return { ok: true, valor: await this.repo.promoverMarca(marcaId) };
  }

  async desactivarMarca(ctx: Contexto, marcaId: string): Promise<Resultado<void>> {
    const marca = await this.repo.buscarMarca(marcaId);
    if (!marca) return fallo("NO_ENCONTRADA", "La marca no existe");

    const permiso = puedeModificar(marca, ctx.rol, ctx.empresaId);
    if (!permiso.permitido) return { ok: false, veredicto: permiso };

    // Nada se borra: se deshabilita. Y no se deshabilita algo en uso.
    // `mediciones` es una cuenta: antes era un booleano comparado como número,
    // y el mensaje decía literalmente "hay true mediciones".
    const mediciones = await this.repo.medicionesConMarca(marcaId);
    if (mediciones > 0) {
      return fallo(
        "EN_USO",
        `No se puede deshabilitar: hay ${mediciones} ${mediciones === 1 ? "medición" : "mediciones"} que la referencian`,
      );
    }

    // Con la fecha: antes se llamaba sin ella y desactivadoEn quedaba vacío,
    // perdiendo cuándo se desactivó cada marca.
    await this.repo.desactivarMarca(marcaId, this.reloj());
    return { ok: true, valor: undefined };
  }

  /** Comprobación de coherencia antes de guardar una medición. */
  validarSeleccion(sel: {
    marcaId?: string | null;
    disenoId?: string | null;
    medida?: string | null;
  }): Veredicto {
    return jerarquiaCoherente(sel);
  }
}
