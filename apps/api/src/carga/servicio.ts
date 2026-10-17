import {
  claveIdentificador,
  claveOrdenHistorica,
  clave,
  esRepuesto,
  fechaDeCarga,
  PREFIJO_HISTORICA,
  posicionDeCarga,
  profundidadDeReferencia,
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
import { siguienteFolioDe } from "../ordenes/repositorio";

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
    if (tipo === "ordenes") return this.ordenesDe(ctx, csv.filas, col);
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

  /**
   * Órdenes anteriores al sistema (2026-10-17, decisiones del usuario): desde
   * Excel, una fila por llanta; entran CERRADAS y marcadas históricas (sin
   * firma digital, y el PDF lo dice), con folio de la serie HIS y el número
   * anterior como referencia; y cuentan para todo: arman la historia de las
   * llantas, los km, los indicadores y las alertas.
   *
   * - Se procesan de la más vieja a la más nueva, para que la historia de las
   *   llantas quede en el orden en que pasó.
   * - Volver a subir el mismo archivo no duplica: una orden histórica del
   *   mismo vehículo, fecha y número anterior ya cargada se reconoce.
   * - La orden queda a nombre de quien la carga (la base exige un usuario de
   *   la sede); quien hizo el trabajo va escrito, como dato congelado.
   */
  private async ordenesDe(ctx: Contexto, filas: Record<string, string>[], col: (f: Record<string, string>, c: string) => string): Promise<ResultadoCarga> {
    const creados = { ordenes: 0, mediciones: 0 };
    let existentes = 0;
    const errores: ErrorFila[] = [];

    // Agrupar en órdenes, recordando el número de fila de Excel de cada una.
    const grupos = new Map<string, { fila: number; f: Record<string, string> }[]>();
    filas.forEach((f, i) => {
      const k = claveOrdenHistorica((c) => col(f, c));
      grupos.set(k, [...(grupos.get(k) ?? []), { fila: i + 2, f }]);
    });
    const ordenadas = [...grupos.values()].sort((a, b) =>
      (fechaDeCarga(col(a[0]!.f, "FECHA")) ?? "").localeCompare(fechaDeCarga(col(b[0]!.f, "FECHA")) ?? ""),
    );
    const marcas = await this.catalogo.marcasVisibles(ctx);

    for (const grupo of ordenadas) {
      const primera = grupo[0]!;
      const v = (c: string) => col(primera.f, c);
      const fila = primera.fila;
      const fecha = fechaDeCarga(v("FECHA")) as string;

      const sede = (await this.db.query<{ id: string; codigo: string }>(
        `SELECT id, codigo FROM "Sede" WHERE upper(codigo) = upper($1) OR lower(nombre) = lower($1) LIMIT 1`, [v("SEDE")],
      )).rows[0];
      if (!sede) { errores.push({ fila, mensaje: `No hay una sede "${v("SEDE")}" en la empresa` }); continue; }
      const enSede = await this.db.query(`SELECT 1 FROM "UsuarioSede" WHERE "usuarioId" = $1 AND "sedeId" = $2`, [ctx.usuarioId, sede.id]);
      if (enSede.rows.length === 0) {
        errores.push({ fila, mensaje: `Para cargar órdenes de la sede ${sede.codigo} tienes que pertenecer a ella (Usuarios → tus sedes)` });
        continue;
      }
      const cliente = (await this.db.query<{ id: string; nombre: string; nit: string }>(
        `SELECT id, nombre, nit FROM "Cliente" WHERE regexp_replace(nit, '\\D', '', 'g') = $1 LIMIT 1`, [v("NIT CLIENTE").replace(/\D/g, "")],
      )).rows[0];
      if (!cliente) { errores.push({ fila, mensaje: `No hay un cliente con NIT ${v("NIT CLIENTE")}` }); continue; }
      const codigoVehiculo = v("VEHICULO").toUpperCase().replace(/[\s-]/g, "");
      const vehiculo = (await this.db.query<{ id: string; sedeClienteId: string; sedeNombre: string; codigo: string; placa: string | null; configuracionEjeId: string }>(
        `SELECT v.id, v."sedeClienteId", sc.nombre AS "sedeNombre", v.codigo, v.placa, v."configuracionEjeId"
           FROM "Vehiculo" v JOIN "SedeCliente" sc ON sc.id = v."sedeClienteId"
          WHERE sc."clienteId" = $1
            AND ($2 = upper(regexp_replace(v.codigo, '[\\s-]', '', 'g')) OR $2 = upper(regexp_replace(coalesce(v.placa, ''), '[\\s-]', '', 'g')))
          LIMIT 1`,
        [cliente.id, codigoVehiculo],
      )).rows[0];
      if (!vehiculo) { errores.push({ fila, mensaje: `${cliente.nombre} no tiene un vehículo "${v("VEHICULO")}" (código o placa)` }); continue; }

      const referencia = v("NUMERO ANTERIOR").trim() || null;
      const ya = await this.db.query(
        `SELECT 1 FROM "OrdenServicio" WHERE historica AND "vehiculoId" = $1 AND fecha = $2::date AND coalesce("referenciaAnterior", '') = $3`,
        [vehiculo.id, fecha, referencia ?? ""],
      );
      if (ya.rows.length > 0) { existentes++; continue; }

      // Las posiciones tienen que existir en la plantilla del vehículo.
      const posiciones = new Set((await this.db.query<{ numero: number }>(
        `SELECT numero FROM "PosicionEje" WHERE "configuracionEjeId" = $1`, [vehiculo.configuracionEjeId],
      )).rows.map((r) => Number(r.numero)));
      const medidas: { fila: number; f: Record<string, string>; posicion: number; marcaId: string | null; disenoId: string | null }[] = [];
      for (const { fila: n, f } of grupo) {
        const c = (x: string) => col(f, x);
        const posicion = posicionDeCarga(c("POSICION")) as number;
        if (!esRepuesto(posicion) && !posiciones.has(posicion)) {
          errores.push({ fila: n, mensaje: `El vehículo ${vehiculo.codigo} no tiene la posición ${c("POSICION")}` });
          continue;
        }
        let marcaId: string | null = null;
        let disenoId: string | null = null;
        if (c("MARCA")) {
          const marca = marcas.find((m) => clave(m.nombre) === clave(c("MARCA")));
          if (!marca) { errores.push({ fila: n, mensaje: `La marca "${c("MARCA")}" no está en el catálogo: cárgala primero en "Catálogo de llantas"` }); continue; }
          marcaId = marca.id;
          if (c("DISEÑO")) {
            const diseno = (await this.catalogo.disenosDeMarca(ctx, marca.id)).find((d) => clave(d.nombre) === clave(c("DISEÑO")));
            if (!diseno) { errores.push({ fila: n, mensaje: `El diseño "${c("DISEÑO")}" de ${marca.nombre} no está en el catálogo` }); continue; }
            disenoId = diseno.id;
          }
        }
        medidas.push({ fila: n, f, posicion, marcaId, disenoId });
      }
      if (errores.length > 0) continue;

      const kms = grupo.map(({ f }) => numeroDeCarga(col(f, "KM"))).filter((k): k is number => k !== null);
      if (new Set(kms).size > 1) { errores.push({ fila, mensaje: "La misma orden trae dos KM distintos" }); continue; }
      const folio = await siguienteFolioDe(this.db, ctx.empresaId, sede.id, sede.codigo, PREFIJO_HISTORICA);
      const ordenId = nuevoId();
      const hallazgos = grupo.map(({ f }) => col(f, "HALLAZGOS")).find((h) => h.trim() !== "") ?? null;
      await this.db.query(
        `INSERT INTO "OrdenServicio"
           (id, "empresaId", "sedeId", "clienteId", "sedeClienteId", "vehiculoId", tecnico_id, "configuracionEjeId",
            folio, tipo, estado, fecha, kilometraje, hallazgos, historica, "referenciaAnterior",
            "clienteNombre", "clienteNit", "sedeClienteNombre", "vehiculoCodigo", "vehiculoPlaca", "tecnicoNombre",
            "congeladoEn", "motivoCierre", "creadoPorId", "actualizadoEn")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::"TipoServicio",'cerrada',$11::date,$12,$13,true,$14,
                 $15,$16,$17,$18,$19,$20, now(), $21, $7, now())`,
        [ordenId, ctx.empresaId, sede.id, cliente.id, vehiculo.sedeClienteId, vehiculo.id, ctx.usuarioId, vehiculo.configuracionEjeId,
         folio, (v("TIPO") || "preventivo").toLowerCase(), fecha, kms[0] ?? null, hallazgos, referencia,
         cliente.nombre, cliente.nit, vehiculo.sedeNombre, vehiculo.codigo, vehiculo.placa, v("TECNICO").trim() || "No registrado",
         "Orden anterior al sistema, cargada desde Excel sin firma digital"],
      );
      for (const m of medidas) {
        const c = (x: string) => col(m.f, x);
        const prof = { exterior: numeroDeCarga(c("PROF EXT")), centro: numeroDeCarga(c("PROF CEN")), interior: numeroDeCarga(c("PROF INT")) };
        // El serial se guarda como se escribió, igual que en una captura; la
        // llanta como activo lo normaliza al armarse.
        const serial = c("SERIAL").trim() || null;
        // Sin marca ni serial no se sabe qué llanta era: no se inventa.
        const noIdentificada = !m.marcaId && !claveIdentificador(serial);
        await this.db.query(
          `INSERT INTO "LlantaRegistro"
             (id, "ordenId", "configuracionEjeId", posicion, "posicionEnEje", "marcaId", "disenoId", medida, "numCalor", serial, dot,
              "psiEncontrada", "psiCalibrado", profundidad, "profExterior", "profCentro", "profInterior", observaciones,
              "noIdentificada", "motivoNoIdentificada", "capturadoPorId", "capturadoEn", "actualizadoEn")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::date,now())`,
          [nuevoId(), ordenId, vehiculo.configuracionEjeId, m.posicion, esRepuesto(m.posicion) ? null : m.posicion,
           m.marcaId, m.disenoId, c("MEDIDA") ? normalizarMedida(c("MEDIDA")) : null, c("CALOR") || null, serial, c("DOT") || null,
           numeroDeCarga(c("PSI ENCONTRADA")), numeroDeCarga(c("PSI CALIBRADA")), profundidadDeReferencia(prof),
           prof.exterior, prof.centro, prof.interior, c("OBSERVACIONES") || null,
           noIdentificada, noIdentificada ? "otro" : null, ctx.usuarioId, fecha],
        );
        creados.mediciones++;
      }
      await this.db.query(
        `INSERT INTO "OrdenEstadoHistorial" (id, "ordenId", "estadoAnterior", "estadoNuevo", "usuarioId", motivo, "creadoEn")
         VALUES ($1,$2,NULL,'cerrada',$3,$4,now())`,
        [nuevoId(), ordenId, ctx.usuarioId, referencia ? `Cargada desde Excel (número anterior ${referencia})` : "Cargada desde Excel"],
      );
      await this.llantas.procesarOrden(ctx, ordenId, { historica: true });
      creados.ordenes++;
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
