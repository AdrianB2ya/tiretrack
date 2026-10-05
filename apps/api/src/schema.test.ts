import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Verificación estructural del esquema.
 *
 * Los binarios de Prisma no se pueden descargar en este entorno, así que
 * `prisma validate` corre en la máquina del desarrollador. Estas pruebas
 * cubren otra cosa, que Prisma no valida: las invariantes de ARQUITECTURA
 * que acordamos y que son fáciles de olvidar al agregar una tabla.
 *
 * Atrapan la clase de error que se cuela sin que nadie lo note: un índice
 * sin empresaId, un Float donde va Decimal, un id con @default(uuid()) que
 * rompería la captura sin conexión.
 */

const aqui = dirname(fileURLToPath(import.meta.url));
let esquema = "";
let sqlManual = "";

interface Modelo {
  nombre: string;
  cuerpo: string;
}

const modelos: Modelo[] = [];

beforeAll(() => {
  esquema = readFileSync(join(aqui, "../prisma/schema.prisma"), "utf8");
  sqlManual = readFileSync(join(aqui, "../prisma/manual.sql"), "utf8");

  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(esquema)) !== null) {
    modelos.push({ nombre: m[1] ?? "", cuerpo: m[2] ?? "" });
  }
});

/** Tablas que guardan datos de una empresa concreta. */
const TABLAS_OPERATIVAS = [
  "Sede",
  "Cliente",
  "ConfiguracionEje",
  "Servicio",
  "TipoParche",
  "OrdenServicio",
  "Recomendacion",
  "ProgramacionRecurrente",
  "Consecutivo",
];

/** Tablas que cuelgan de otra y heredan el aislamiento por su padre. */
const TABLAS_HIJAS = [
  "UsuarioSede",
  "TokenRecuperacion",
  "SesionUsuario",
  "SedeCliente",
  "PosicionEje",
  "Vehiculo",
  "Diseno",
  "DisenoMedida",
  "LlantaRegistro",
  "LlantaServicio",
  "Foto",
  "OrdenServicioVehiculo",
  "OrdenEstadoHistorial",
];

const modelo = (n: string) => modelos.find((x) => x.nombre === n);

describe("el esquema se puede leer y tiene todas las tablas", () => {
  it("declara 24 tablas o más", () => {
    expect(modelos.length).toBeGreaterThanOrEqual(24);
  });

  it("incluye las tablas centrales", () => {
    const esperadas = [
      "Empresa",
      "Sede",
      "Usuario",
      "UsuarioSede",
      "Cliente",
      "SedeCliente",
      "Vehiculo",
      "ConfiguracionEje",
      "PosicionEje",
      "Marca",
      "Diseno",
      "DisenoMedida",
      "Servicio",
      "TipoParche",
      "OrdenServicio",
      "LlantaRegistro",
      "LlantaServicio",
      "Foto",
      "OrdenEstadoHistorial",
      "Recomendacion",
      "ProgramacionRecurrente",
      "Consecutivo",
      "Auditoria",
      "SesionSuplantacion",
    ];
    for (const t of esperadas) {
      expect(modelo(t), `falta la tabla ${t}`).toBeDefined();
    }
  });

  it("apunta a PostgreSQL", () => {
    expect(esquema).toMatch(/provider\s*=\s*"postgresql"/);
  });
});

describe("aislamiento entre empresas", () => {
  it("toda tabla operativa lleva empresaId", () => {
    for (const t of TABLAS_OPERATIVAS) {
      expect(modelo(t)?.cuerpo, `${t} debería llevar empresaId`).toMatch(/empresaId\s+String/);
    }
  });

  it("los índices de tablas operativas empiezan por empresaId", () => {
    // empresaId es el primer filtro de toda consulta: un índice que no
    // empiece por él no se usa.
    for (const t of TABLAS_OPERATIVAS) {
      const cuerpo = modelo(t)?.cuerpo ?? "";
      const indices = [...cuerpo.matchAll(/@@index\(\[([^\]]+)\]/g)].map((m) => m[1] ?? "");
      for (const idx of indices) {
        const primera = idx.split(",")[0]?.trim();
        expect(primera, `índice [${idx}] de ${t} no empieza por empresaId`).toBe("empresaId");
      }
    }
  });

  it("las anclas de las llaves compuestas están declaradas", () => {
    // Sin @@unique([id, empresaId]) la FK compuesta no se puede crear.
    expect(modelo("Cliente")?.cuerpo).toMatch(/@@unique\(\[id,\s*empresaId\]\)/);
    expect(modelo("Sede")?.cuerpo).toMatch(/@@unique\(\[id,\s*empresaId\]\)/);
    expect(modelo("ConfiguracionEje")?.cuerpo).toMatch(/@@unique\(\[id,\s*empresaId\]\)/);
    expect(modelo("SedeCliente")?.cuerpo).toMatch(/@@unique\(\[id,\s*clienteId\]\)/);
    expect(modelo("OrdenServicio")?.cuerpo).toMatch(
      /@@unique\(\[id,\s*configuracionEjeId\]\)/,
    );
  });

  it("el NIT del cliente es único por empresa, no global", () => {
    // Dos empresas pueden atender al mismo cliente: cada una tiene su
    // propio registro y no se comparten.
    const cuerpo = modelo("Cliente")?.cuerpo ?? "";
    expect(cuerpo).toMatch(/@@unique\(\[empresaId,\s*nit\]\)/);
    expect(cuerpo).not.toMatch(/nit\s+String\s+@unique/);
  });

  it("las tablas hijas heredan el aislamiento por su padre", () => {
    // No llevan empresaId propio, pero deben tener una FK al padre que sí
    // lo tiene. Sin eso quedarían huérfanas del aislamiento.
    for (const t of TABLAS_HIJAS) {
      const cuerpo = modelo(t)?.cuerpo ?? "";
      expect(cuerpo, `${t} no existe`).not.toBe("");
      const tieneRelacion = /@relation\(/.test(cuerpo) || /@@id\(\[/.test(cuerpo);
      expect(tieneRelacion, `${t} debe colgar de una tabla padre`).toBe(true);
    }
  });

  it("toda tabla del esquema tiene su política en rls.sql", () => {
    // El rol de aplicación recibe permisos sobre TODA tabla nueva por defecto:
    // una tabla que rls.sql no nombra queda legible para cualquier empresa.
    // Así quedó SesionSuplantacion hasta que se aplicó la migración real.
    const rls = readFileSync(join(aqui, "../prisma/rls.sql"), "utf8");
    for (const m of modelos) {
      expect(rls, `${m.nombre} no aparece en rls.sql`).toMatch(
        new RegExp(`["']${m.nombre}["']`),
      );
    }
  });

  it("el correo del usuario es único por empresa", () => {
    // La misma persona puede trabajar para dos empresas suscritas.
    expect(modelo("Usuario")?.cuerpo).toMatch(/@@unique\(\[empresaId,\s*email\]\)/);
  });
});

describe("captura sin conexión", () => {
  it("los ids no se generan en la base de datos", () => {
    // El UUID lo genera el dispositivo: es lo que permite capturar sin señal
    // y sincronizar después sin duplicar.
    for (const t of ["OrdenServicio", "LlantaRegistro", "Cliente", "Vehiculo", "Recomendacion"]) {
      const cuerpo = modelo(t)?.cuerpo ?? "";
      expect(cuerpo, `${t} no debe usar @default(uuid())`).not.toMatch(
        /id\s+String\s+@id\s+@default\(uuid\(\)\)/,
      );
      expect(cuerpo, `${t} debe declarar id String @id`).toMatch(/id\s+String\s+@id/);
    }
  });

  it("la orden tiene clave de idempotencia única por empresa", () => {
    // Reintentar el envío no puede crear una orden duplicada.
    const cuerpo = modelo("OrdenServicio")?.cuerpo ?? "";
    expect(cuerpo).toMatch(/clientRequestId\s+String\?/);
    expect(cuerpo).toMatch(/@@unique\(\[empresaId,\s*clientRequestId\]\)/);
  });

  it("la orden admite folio nulo", () => {
    // Las imprevistas nacen sin folio y lo reciben al sincronizar.
    expect(modelo("OrdenServicio")?.cuerpo).toMatch(/folio\s+String\?/);
    expect(modelo("OrdenServicio")?.cuerpo).toMatch(/codigoReferencia\s+String\?/);
  });

  it("la orden y la medición llevan versión para el bloqueo optimista", () => {
    expect(modelo("OrdenServicio")?.cuerpo).toMatch(/version\s+Int\s+@default\(0\)/);
    expect(modelo("LlantaRegistro")?.cuerpo).toMatch(/version\s+Int\s+@default\(0\)/);
  });

  it("la medición es tabla propia, no un campo de la orden", () => {
    // El técnico sincroniza posición por posición: si se cae la señal a
    // mitad de captura no puede perder lo anterior.
    expect(modelo("LlantaRegistro")).toBeDefined();
    expect(modelo("OrdenServicio")?.cuerpo).not.toMatch(/llantas\s+Json/);
  });
});

describe("precisión numérica", () => {
  it("no hay Float en ninguna tabla", () => {
    // Float produce errores de redondeo que terminan en una factura.
    for (const m of modelos) {
      expect(m.cuerpo, `${m.nombre} usa Float`).not.toMatch(/\s+Float\b/);
    }
  });

  it("presiones y profundidades son Decimal con escala explícita", () => {
    const cuerpo = modelo("LlantaRegistro")?.cuerpo ?? "";
    expect(cuerpo).toMatch(/psiEncontrada\s+Decimal\?\s+@db\.Decimal\(6,\s*2\)/);
    expect(cuerpo).toMatch(/profundidad\s+Decimal\?\s+@db\.Decimal\(5,\s*2\)/);
  });

  it("los umbrales del eje también son Decimal", () => {
    const cuerpo = modelo("PosicionEje")?.cuerpo ?? "";
    expect(cuerpo).toMatch(/psiObjetivo\s+Decimal\?/);
    expect(cuerpo).toMatch(/profundidadMinima\s+Decimal\?/);
  });
});

describe("nada se borra", () => {
  it("las tablas maestras tienen columna de desactivación", () => {
    for (const t of ["Empresa", "Sede", "Usuario", "Cliente", "SedeCliente", "Vehiculo"]) {
      expect(modelo(t)?.cuerpo, `${t} necesita desactivación`).toMatch(
        /desactivad[oa]En\s+DateTime\?/,
      );
    }
  });

  it("la orden se anula, no se elimina", () => {
    expect(modelo("OrdenServicio")?.cuerpo).toMatch(/anuladaEn\s+DateTime\?/);
    expect(esquema).toMatch(/enum EstadoOrden[\s\S]*?anulada/);
  });
});

describe("firma y congelado", () => {
  it("la firma guarda la versión que ampara", () => {
    // Si el contenido cambia después de firmar, la firma deja de valer.
    expect(modelo("OrdenServicio")?.cuerpo).toMatch(/firmaVersion\s+Int\?/);
  });

  it("la orden tiene todos los campos congelados", () => {
    const cuerpo = modelo("OrdenServicio")?.cuerpo ?? "";
    for (const campo of [
      "clienteNombre",
      "clienteNit",
      "sedeClienteNombre",
      "vehiculoCodigo",
      "vehiculoPlaca",
      "tecnicoNombre",
      "tecnicoCedula",
      "congeladoEn",
    ]) {
      expect(cuerpo, `falta el campo congelado ${campo}`).toContain(campo);
    }
  });

  it("la autoría de la medición vive en la llanta, no en la orden", () => {
    // Reasignar la orden no puede borrar quién midió cada posición.
    expect(modelo("LlantaRegistro")?.cuerpo).toMatch(/capturadoPorId\s+String/);
    expect(modelo("LlantaRegistro")?.cuerpo).toMatch(/capturadoEn\s+DateTime/);
  });
});

describe("catálogo de llantas", () => {
  it("la profundidad de fábrica vive en la medida, no en el diseño", () => {
    // Un XZY-3 en 295/80R22.5 trae 16 mm y en 11R22.5 trae 14.5.
    expect(modelo("DisenoMedida")?.cuerpo).toMatch(/profundidadOriginal\s+Decimal\?/);
    expect(modelo("Diseno")?.cuerpo).not.toMatch(/profundidadOriginal/);
  });

  it("marca y diseño distinguen lo global de lo propio de la empresa", () => {
    expect(modelo("Marca")?.cuerpo).toMatch(/esGlobal\s+Boolean/);
    expect(modelo("Marca")?.cuerpo).toMatch(/creadaEnCampo\s+Boolean/);
    expect(modelo("Diseno")?.cuerpo).toMatch(/creadaEnCampo\s+Boolean/);
  });

  it("la configuración de ejes es versionada", () => {
    // Editar crea una versión nueva: las órdenes viejas conservan la suya.
    const cuerpo = modelo("ConfiguracionEje")?.cuerpo ?? "";
    expect(cuerpo).toMatch(/version\s+Int/);
    expect(cuerpo).toMatch(/vigente\s+Boolean/);
    expect(cuerpo).toMatch(/reemplazadaPorId\s+String\?/);
    expect(cuerpo).toMatch(/@@unique\(\[empresaId,\s*nombre,\s*version\]\)/);
  });
});

describe("restricciones del SQL manual", () => {
  it("encadena el aislamiento entre empresas", () => {
    expect(sqlManual).toContain("orden_cliente_empresa_fk");
    expect(sqlManual).toContain("orden_sede_empresa_fk");
    expect(sqlManual).toContain("orden_configuracion_empresa_fk");
  });

  it("amarra la sede del cliente a su cliente", () => {
    expect(sqlManual).toContain("orden_sedecliente_cliente_fk");
  });

  it("obliga a que el técnico pertenezca a la sede", () => {
    expect(sqlManual).toContain("orden_tecnico_sede_fk");
    expect(sqlManual).toContain('REFERENCES "UsuarioSede"');
  });

  it("valida la posición contra la configuración congelada", () => {
    expect(sqlManual).toContain("llanta_orden_configuracion_fk");
  });

  it("impide cerrar sin firma ni identidad estampada", () => {
    expect(sqlManual).toContain("orden_cerrada_requiere_firma");
    expect(sqlManual).toContain("orden_cerrada_requiere_congelado");
  });

  it("exige motivo cuando la llanta no se identificó", () => {
    expect(sqlManual).toContain("llanta_no_identificada_sin_marca");
  });

  it("la foto referencia exactamente una entidad", () => {
    expect(sqlManual).toContain("num_nonnulls");
  });

  it("solo el superadmin puede no tener empresa", () => {
    expect(sqlManual).toContain("usuario_empresa_segun_rol");
    expect(sqlManual).toContain("usuario_cliente_requiere_vinculo");
  });

  it("crea los índices parciales de las consultas frecuentes", () => {
    expect(sqlManual).toContain("orden_abierta_por_vehiculo");
    expect(sqlManual).toContain("orden_pendiente_cliente_limite");
    expect(sqlManual).toContain("recomendacion_abierta_por_vehiculo");
  });
});
