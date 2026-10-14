import {
  claveIdentificador,
  clave,
  leerCSV,
  normalizarColumna,
  normalizarMedida,
  nuevoId,
  numeroDeCarga,
  validarCarga,
  type ErrorFila,
  type Rol,
  type TipoCarga,
} from "@tiretrack/domain";
import type { ServicioFlota } from "../flota/servicio";
import type { ServicioCatalogo } from "../catalogo/servicio";
import type { ServicioLlantas } from "../llantas/servicio";

/**
 * Carga masiva desde Excel (R12).
 *
 * El servidor lee el MISMO CSV con las MISMAS reglas que la vista previa de
 * la app (dominio `carga`): lo que la app mostró como válido es lo que se
 * carga. Y crea con los servicios de siempre, no con SQL aparte, para que
 * una carga respete las mismas reglas que un alta a mano (NIT único por
 * empresa, plantilla vigente, serial único por cliente, duplicados del
 * catálogo).
 *
 * Todo o nada: la ruta corre en una transacción y con un solo error se
 * deshace entera.
 */

interface Consultable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Contexto {
  readonly empresaId: string;
  readonly rol: Rol;
  readonly usuarioId: string;
}

export interface ResultadoCarga {
  readonly filas: number;
  readonly creados: Record<string, number>;
  /** Lo que ya existía y se reconoció (no se duplica). */
  readonly existentes: number;
  readonly errores: ErrorFila[];
}

export class ServicioCarga {
  constructor(
    private readonly db: Consultable,
    private readonly flota: ServicioFlota,
    private readonly catalogo: ServicioCatalogo,
    private readonly llantas: ServicioLlantas,
  ) {}

  async cargar(ctx: Contexto, tipo: TipoCarga, texto: string): Promise<ResultadoCarga> {
    const csv = leerCSV(texto);
    const v = validarCarga(tipo, csv);
    const base = { filas: csv.filas.length, creados: {}, existentes: 0 };
    if (ctx.rol !== "administrador" && ctx.rol !== "coordinador") {
      return { ...base, errores: [{ fila: 1, mensaje: "La carga masiva la hace la oficina" }] };
    }
    if (v.errores.length > 0) return { ...base, errores: v.errores };
    const col = (f: Record<string, string>, c: string) => f[normalizarColumna(c)] ?? "";
    if (tipo === "flota") return this.flotaDe(ctx, csv.filas, col);
    if (tipo === "llantas") return this.llantasDe(ctx, csv.filas, col);
    return this.catalogoDe(ctx, csv.filas, col);
  }

  private async flotaDe(ctx: Contexto, filas: Record<string, string>[], col: (f: Record<string, string>, c: string) => string): Promise<ResultadoCarga> {
    const creados = { clientes: 0, sedes: 0, vehiculos: 0 };
    let existentes = 0;
    const errores: ErrorFila[] = [];
    for (const [i, f] of filas.entries()) {
      const fila = i + 2;
      const nit = col(f, "NIT");
      let clienteId = (await this.db.query<{ id: string }>(
        `SELECT id FROM "Cliente" WHERE regexp_replace(nit, '\\D', '', 'g') = $1 LIMIT 1`,
        [nit.replace(/\D/g, "")],
      )).rows[0]?.id;
      if (!clienteId) {
        const r = await this.flota.crearCliente(ctx, { nombre: col(f, "CLIENTE"), nit });
        if (!r.ok) { errores.push({ fila, mensaje: r.veredicto.mensaje ?? "Cliente inválido" }); continue; }
        clienteId = r.valor.id;
        creados.clientes++;
      }
      let sedeId = (await this.db.query<{ id: string }>(
        `SELECT id FROM "SedeCliente" WHERE "clienteId" = $1 AND lower(nombre) = lower($2) LIMIT 1`,
        [clienteId, col(f, "SEDE")],
      )).rows[0]?.id;
      if (!sedeId) {
        const r = await this.flota.crearSedeCliente(ctx, { clienteId, nombre: col(f, "SEDE") });
        if (!r.ok) { errores.push({ fila, mensaje: r.veredicto.mensaje ?? "Sede inválida" }); continue; }
        sedeId = r.valor.id;
        creados.sedes++;
      }
      const cfg = (await this.db.query<{ id: string }>(
        `SELECT id FROM "ConfiguracionEje" WHERE lower(nombre) = lower($1) AND vigente LIMIT 1`,
        [col(f, "PLANTILLA")],
      )).rows[0]?.id;
      if (!cfg) { errores.push({ fila, mensaje: `No hay una plantilla de ejes vigente llamada "${col(f, "PLANTILLA")}"` }); continue; }
      const codigo = col(f, "CODIGO").toUpperCase();
      const yaEsta = await this.db.query(`SELECT 1 FROM "Vehiculo" WHERE "sedeClienteId" = $1 AND upper(codigo) = $2`, [sedeId, codigo]);
      if (yaEsta.rows.length > 0) { existentes++; continue; }
      const km = numeroDeCarga(col(f, "KM"));
      const r = await this.flota.crearVehiculo(ctx, {
        sedeClienteId: sedeId, configuracionEjeId: cfg, codigo, nombre: col(f, "DESCRIPCION"),
        tipo: col(f, "PLANTILLA"), ...(col(f, "PLACA") ? { placa: col(f, "PLACA") } : {}), ...(km !== null ? { kmActual: km } : {}),
      });
      if (!r.ok) { errores.push({ fila, mensaje: r.veredicto.mensaje ?? "Vehículo inválido" }); continue; }
      creados.vehiculos++;
    }
    return { filas: filas.length, creados, existentes, errores };
  }

  private async llantasDe(ctx: Contexto, filas: Record<string, string>[], col: (f: Record<string, string>, c: string) => string): Promise<ResultadoCarga> {
    const creados = { llantas: 0 };
    let existentes = 0;
    const errores: ErrorFila[] = [];
    for (const [i, f] of filas.entries()) {
      const fila = i + 2;
      const clienteId = (await this.db.query<{ id: string }>(
        `SELECT id FROM "Cliente" WHERE regexp_replace(nit, '\\D', '', 'g') = $1 LIMIT 1`,
        [col(f, "NIT CLIENTE").replace(/\D/g, "")],
      )).rows[0]?.id;
      if (!clienteId) { errores.push({ fila, mensaje: `No hay un cliente con NIT ${col(f, "NIT CLIENTE")}` }); continue; }
      const sedeId = (await this.db.query<{ id: string }>(
        `SELECT id FROM "Sede" WHERE upper(codigo) = upper($1) OR lower(nombre) = lower($1) LIMIT 1`,
        [col(f, "SEDE")],
      )).rows[0]?.id;
      if (!sedeId) { errores.push({ fila, mensaje: `No hay una sede "${col(f, "SEDE")}" en la empresa` }); continue; }
      const serial = claveIdentificador(col(f, "SERIAL"));
      const interno = col(f, "NUMERO INTERNO") || null;
      const ya = await this.db.query(`SELECT 1 FROM "Llanta" WHERE "clienteId" = $1 AND (serial = $2 OR "numeroInterno" = $3)`, [clienteId, serial, interno]);
      if (ya.rows.length > 0) { existentes++; continue; }
      const costo = numeroDeCarga(col(f, "COSTO"));
      const r = await this.llantas.crear(ctx, {
        id: nuevoId(), clienteId, sedeId,
        ...(serial ? { serial } : {}), ...(interno ? { numeroInterno: interno } : {}),
        ...(col(f, "CALOR") ? { numCalor: col(f, "CALOR") } : {}), ...(col(f, "DOT") ? { dot: col(f, "DOT") } : {}),
        ...(col(f, "MEDIDA") ? { medida: normalizarMedida(col(f, "MEDIDA")) } : {}), ...(costo !== null ? { costo } : {}),
      });
      if (!r.ok) { errores.push({ fila, mensaje: r.veredicto.mensaje ?? "Llanta inválida" }); continue; }
      creados.llantas++;
    }
    return { filas: filas.length, creados, existentes, errores };
  }

  private async catalogoDe(ctx: Contexto, filas: Record<string, string>[], col: (f: Record<string, string>, c: string) => string): Promise<ResultadoCarga> {
    const creados = { marcas: 0, disenos: 0, medidas: 0 };
    let existentes = 0;
    const errores: ErrorFila[] = [];
    for (const [i, f] of filas.entries()) {
      const fila = i + 2;
      const marcas = await this.catalogo.marcasVisibles(ctx);
      let marca = marcas.find((m) => clave(m.nombre) === clave(col(f, "MARCA")));
      if (!marca) {
        // Lo que el administrador sube es deliberado: lo parecido no se pregunta.
        const r = await this.catalogo.crearMarca(ctx, { nombre: col(f, "MARCA"), forzar: true });
        if (!r.ok) { errores.push({ fila, mensaje: r.veredicto.mensaje ?? "Marca inválida" }); continue; }
        marca = r.valor.marca;
        creados.marcas++;
      }
      const disenos = await this.catalogo.disenosDeMarca(ctx, marca.id);
      let diseno = disenos.find((d) => clave(d.nombre) === clave(col(f, "DISEÑO")));
      if (!diseno) {
        const r = await this.catalogo.crearDiseno(ctx, { marcaId: marca.id, nombre: col(f, "DISEÑO"), tipoEje: col(f, "TIPO EJE").toLowerCase(), forzar: true });
        if (!r.ok) { errores.push({ fila, mensaje: r.veredicto.mensaje ?? "Diseño inválido" }); continue; }
        diseno = r.valor.diseno;
        creados.disenos++;
      }
      const medidas = await this.catalogo.medidasDeDiseno(ctx, diseno.id);
      const medida = normalizarMedida(col(f, "MEDIDA"));
      if (medidas.some((m) => clave(m.medida) === clave(medida))) { existentes++; continue; }
      const prof = numeroDeCarga(col(f, "PROF FABRICA"));
      const r = await this.catalogo.agregarMedida(ctx, { disenoId: diseno.id, medida, profundidadOriginal: prof });
      if (!r.ok) { errores.push({ fila, mensaje: r.veredicto.mensaje ?? "Medida inválida" }); continue; }
      creados.medidas++;
    }
    return { filas: filas.length, creados, existentes, errores };
  }
}
