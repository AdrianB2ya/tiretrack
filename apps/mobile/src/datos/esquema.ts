/**
 * Esquema local del dispositivo.
 *
 * No es una copia del esquema del servidor: guarda solo lo que el técnico
 * necesita para trabajar sin señal, más la cola de operaciones pendientes.
 *
 * Diferencias deliberadas con PostgreSQL:
 *
 * - **Sin `empresaId` en las tablas.** El dispositivo pertenece a un usuario
 *   de una empresa. Si cambia de empresa, se borra la base local entera: es
 *   más simple y más seguro que filtrar en cada consulta.
 * - **Los catálogos son caché**, se reemplazan enteros al sincronizar.
 * - **Las órdenes y mediciones son propiedad del dispositivo** hasta que se
 *   confirman: son lo único que no se puede perder.
 */

export interface Migracion {
  readonly version: number;
  readonly nombre: string;
  readonly sql: string;
}

/**
 * Las migraciones se aplican en orden y **nunca se editan una vez
 * publicadas**: el dispositivo de un técnico puede llevar semanas sin
 * actualizar, y aplicar una versión distinta de la 1 sobre una base que ya
 * tiene la original deja el esquema en un estado que nadie previó.
 *
 * Para cambiar algo, se agrega una migración nueva.
 */
export const MIGRACIONES: readonly Migracion[] = [
  {
    version: 1,
    nombre: "esquema inicial",
    sql: `
      -- ── Sesión del dispositivo ────────────────────────────────────────
      CREATE TABLE sesion (
        id                INTEGER PRIMARY KEY CHECK (id = 1),
        usuario_id        TEXT NOT NULL,
        empresa_id        TEXT NOT NULL,
        rol               TEXT NOT NULL,
        nombre            TEXT NOT NULL,
        cliente_id        TEXT,
        sede_principal_id TEXT,
        sincronizado_en   TEXT
      );

      -- ── Caché de catálogos ────────────────────────────────────────────
      -- Se reemplaza entera al sincronizar: no hay edición local.
      CREATE TABLE marca (
        id            TEXT PRIMARY KEY,
        nombre        TEXT NOT NULL,
        es_global     INTEGER NOT NULL DEFAULT 0,
        creada_local  INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE diseno (
        id            TEXT PRIMARY KEY,
        marca_id      TEXT NOT NULL,
        nombre        TEXT NOT NULL,
        tipo_eje      TEXT NOT NULL DEFAULT 'multiuso',
        creada_local  INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_diseno_marca ON diseno (marca_id);

      CREATE TABLE medida (
        id                    TEXT PRIMARY KEY,
        diseno_id             TEXT NOT NULL,
        medida                TEXT NOT NULL,
        profundidad_original  REAL
      );
      CREATE INDEX idx_medida_diseno ON medida (diseno_id);

      CREATE TABLE servicio (
        id          TEXT PRIMARY KEY,
        nombre      TEXT NOT NULL,
        por_llanta  INTEGER NOT NULL DEFAULT 1,
        orden       INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE tipo_parche (
        id     TEXT PRIMARY KEY,
        nombre TEXT NOT NULL
      );

      -- ── Flota ─────────────────────────────────────────────────────────
      CREATE TABLE cliente (
        id     TEXT PRIMARY KEY,
        nombre TEXT NOT NULL,
        nit    TEXT
      );

      CREATE TABLE sede_cliente (
        id         TEXT PRIMARY KEY,
        cliente_id TEXT NOT NULL,
        nombre     TEXT NOT NULL
      );
      CREATE INDEX idx_sede_cliente ON sede_cliente (cliente_id);

      CREATE TABLE vehiculo (
        id                    TEXT PRIMARY KEY,
        sede_cliente_id       TEXT NOT NULL,
        configuracion_eje_id  TEXT NOT NULL,
        codigo                TEXT NOT NULL,
        placa                 TEXT,
        nombre                TEXT NOT NULL,
        km_actual             INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_vehiculo_sede ON vehiculo (sede_cliente_id);

      -- La configuración se guarda completa porque el diagrama debe poder
      -- dibujarse sin señal.
      CREATE TABLE posicion_eje (
        configuracion_eje_id  TEXT NOT NULL,
        numero                INTEGER NOT NULL,
        eje                   INTEGER NOT NULL,
        lado                  TEXT NOT NULL,
        es_interna            INTEGER NOT NULL DEFAULT 0,
        tipo_eje              TEXT NOT NULL DEFAULT 'multiuso',
        psi_objetivo          REAL,
        profundidad_minima    REAL,
        PRIMARY KEY (configuracion_eje_id, numero)
      );

      -- ── Órdenes ───────────────────────────────────────────────────────
      -- Lo único que no se puede perder: nace aquí y vive aquí hasta que
      -- el servidor confirma.
      CREATE TABLE orden (
        id                    TEXT PRIMARY KEY,
        folio                 TEXT,
        codigo_referencia     TEXT,
        sede_id               TEXT NOT NULL,
        cliente_id            TEXT NOT NULL,
        sede_cliente_id       TEXT NOT NULL,
        vehiculo_id           TEXT NOT NULL,
        tecnico_id            TEXT NOT NULL,
        configuracion_eje_id  TEXT NOT NULL,
        tipo                  TEXT NOT NULL,
        prioridad             TEXT NOT NULL DEFAULT 'normal',
        estado                TEXT NOT NULL,
        fecha                 TEXT NOT NULL,
        kilometraje           INTEGER,
        hallazgos             TEXT,
        accion                TEXT,
        nota_coordinador      TEXT,
        motivo_devolucion     TEXT,
        sin_conductor         INTEGER NOT NULL DEFAULT 0,
        conductor_nombre      TEXT,
        firma_nombre          TEXT,
        firma_cedula          TEXT,
        firma_version         INTEGER,
        version               INTEGER NOT NULL DEFAULT 0,
        version_contenido     INTEGER NOT NULL DEFAULT 0,
        client_request_id     TEXT,
        -- 0 mientras tenga cambios sin enviar
        sincronizada          INTEGER NOT NULL DEFAULT 0,
        actualizada_en        TEXT NOT NULL
      );
      CREATE INDEX idx_orden_estado ON orden (estado);
      CREATE INDEX idx_orden_sync ON orden (sincronizada);

      CREATE TABLE medicion (
        id                  TEXT PRIMARY KEY,
        orden_id            TEXT NOT NULL,
        posicion            INTEGER NOT NULL,
        marca_id            TEXT,
        diseno_id           TEXT,
        medida              TEXT,
        num_calor           TEXT,
        serial              TEXT,
        dot                 TEXT,
        estado_llanta       TEXT,
        num_parche          TEXT,
        tipo_parche_id      TEXT,
        psi_encontrada      REAL,
        psi_calibrado       REAL,
        profundidad         REAL,
        observaciones       TEXT,
        no_identificada     INTEGER NOT NULL DEFAULT 0,
        motivo_no_id        TEXT,
        des_posicion        INTEGER,
        des_num_calor       TEXT,
        des_serial          TEXT,
        des_dot             TEXT,
        des_medida          TEXT,
        des_profundidad     REAL,
        des_marca_id        TEXT,
        des_diseno_id       TEXT,
        des_destino         TEXT,
        des_detalle         TEXT,
        capturado_por_id    TEXT NOT NULL,
        actualizada_en      TEXT NOT NULL,
        UNIQUE (orden_id, posicion)
      );
      CREATE INDEX idx_medicion_orden ON medicion (orden_id);

      CREATE TABLE medicion_servicio (
        medicion_id TEXT NOT NULL,
        servicio_id TEXT NOT NULL,
        PRIMARY KEY (medicion_id, servicio_id)
      );

      -- ── Fotos pendientes de subir ─────────────────────────────────────
      CREATE TABLE foto (
        id            TEXT PRIMARY KEY,
        orden_id      TEXT NOT NULL,
        medicion_id   TEXT,
        -- Ruta en el sistema de archivos del dispositivo
        uri_local     TEXT NOT NULL,
        nombre        TEXT NOT NULL,
        tamano_bytes  INTEGER,
        tipo_mime     TEXT NOT NULL,
        subida        INTEGER NOT NULL DEFAULT 0,
        url_remota    TEXT,
        creada_en     TEXT NOT NULL
      );
      CREATE INDEX idx_foto_subida ON foto (subida);

      -- ── Cola de sincronización ────────────────────────────────────────
      -- Se sincronizan OPERACIONES, no registros: cada acción es un evento
      -- con id propio, así reintentar no duplica nada.
      CREATE TABLE operacion (
        id            TEXT PRIMARY KEY,
        tipo          TEXT NOT NULL,
        recurso_id    TEXT NOT NULL,
        orden_id      TEXT,
        datos         TEXT NOT NULL,
        intentos      INTEGER NOT NULL DEFAULT 0,
        ultimo_error  TEXT,
        -- Momento a partir del cual se puede reintentar
        reintentar_en TEXT,
        creada_en     TEXT NOT NULL
      );
      CREATE INDEX idx_operacion_orden ON operacion (creada_en);

      -- ── Folios reservados ─────────────────────────────────────────────
      -- Preparado para el caso de órdenes imprevistas sin señal.
      CREATE TABLE reserva_folio (
        folio     TEXT PRIMARY KEY,
        sede_id   TEXT NOT NULL,
        usado_por TEXT
      );
    `,
  },
  {
    version: 2,
    nombre: "firma con trazo y consentimiento",
    sql: `
      -- El trazo es un dato biométrico: la Ley 1581 exige consentimiento
      -- informado antes de capturarlo, y dejar constancia de que se dio.
      ALTER TABLE orden ADD COLUMN firma_trazo TEXT;
      ALTER TABLE orden ADD COLUMN firma_cargo TEXT;
      ALTER TABLE orden ADD COLUMN firma_fecha_hora TEXT;
      -- Versión del texto de consentimiento aceptado: si cambia la política,
      -- hay que poder saber cuál aceptó cada persona.
      ALTER TABLE orden ADD COLUMN firma_consentimiento TEXT;
    `,
  },
  {
    version: 3,
    nombre: "técnicos de la sede y estado de revisión",
    sql: `
      -- El coordinador reasigna sin señal: necesita la lista de técnicos de
      -- su sede en el dispositivo.
      CREATE TABLE tecnico (
        id              TEXT PRIMARY KEY,
        nombre          TEXT NOT NULL,
        sede_id         TEXT NOT NULL,
        activo          INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX idx_tecnico_sede ON tecnico (sede_id);

      -- Nombre del técnico congelado en la orden: si se reasigna o se da de
      -- baja, la bandeja debe seguir mostrando quién la ejecutó.
      ALTER TABLE orden ADD COLUMN tecnico_nombre TEXT;
      -- Momento en que entró a revisión, para contar los días de espera.
      ALTER TABLE orden ADD COLUMN enviada_revision_en TEXT;
    `,
  },
  {
    version: 4,
    nombre: "plazo de aprobación del cliente",
    sql: `
      -- Lo calcula el servidor al aprobar (días hábiles). Se guarda para que
      -- el coordinador vea sin señal qué órdenes está por dejar vencer el
      -- cliente, y lo llame antes del cierre tácito.
      ALTER TABLE orden ADD COLUMN limite_cliente TEXT;
    `,
  },
  {
    version: 5,
    nombre: "operaciones rechazadas se apartan, no se borran",
    sql: `
      -- Un rechazo del servidor sacaba la operación de la cola. Mientras el
      -- contrato entre la app y el servidor no esté asentado, un campo mal
      -- nombrado produce un 400 y eso borraba mediciones del celular. Ahora
      -- se apartan con su motivo, para revisarlas o reintentarlas tras
      -- corregir el problema.
      ALTER TABLE operacion ADD COLUMN rechazada_en TEXT;
      ALTER TABLE operacion ADD COLUMN motivo_rechazo TEXT;
    `,
  },
  {
    version: 6,
    nombre: "servicios por código del catálogo fijo",
    sql: `
      -- Los servicios son un catálogo FIJO del dominio: se identifican por
      -- código (CALI, RETO…), no por un id descargado. La columna guardaba el
      -- id de la tabla servicio; con otro contenido y el mismo nombre
      -- habría mentido a quien la leyera después.
      ALTER TABLE medicion_servicio RENAME COLUMN servicio_id TO servicio_codigo;

      -- Convierte lo que ya esté en los teléfonos. Los ids del servidor
      -- siguen el patrón srv-<código en minúsculas>.
      UPDATE medicion_servicio
         SET servicio_codigo = upper(substr(servicio_codigo, 5))
       WHERE servicio_codigo LIKE 'srv-%';

      -- La tabla servicio queda sin uso: el catálogo sale del dominio.
      -- No se borra, para no depender de su ausencia si una versión vieja
      -- de la app convive un tiempo con la nueva.
    `,
  },
  {
    version: 7,
    nombre: "subida de fotos con URL firmada y reintentos",
    sql: `
      -- La URL firmada que devuelve el servidor al adjuntar. Vence en
      -- minutos; si eso pasa antes de subir, se pide otra reenviando la
      -- operación de adjuntar, que es idempotente por el id de la foto.
      ALTER TABLE foto ADD COLUMN url_subida TEXT;
      ALTER TABLE foto ADD COLUMN url_expira_en TEXT;
      -- Los intentos no borran la foto: el archivo está en el celular y es
      -- evidencia del servicio.
      ALTER TABLE foto ADD COLUMN intentos_subida INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE foto ADD COLUMN ultimo_error_subida TEXT;
      ALTER TABLE foto ADD COLUMN reintentar_en TEXT;
      -- Tamaño original, para saber cuánto ahorró la compresión.
      ALTER TABLE foto ADD COLUMN tamano_original INTEGER;
    `,
  },
  {
    version: 8,
    nombre: "marca de la última descarga",
    sql: `
      -- Hasta dónde llegó la última descarga. Con esto la siguiente pide solo
      -- lo que cambió, en vez de traer todo cada vez por señal de 4G rural.
      CREATE TABLE ajuste (
        clave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
      );
    `,
  },
  {
    version: 9,
    nombre: "técnico por sede y sedes de la empresa",
    sql: `
      -- La clave era solo el id: un técnico en dos sedes chocaba al guardar
      -- ("UNIQUE constraint failed"), y como la descarga es todo o nada, el
      -- celular de un coordinador con dos sedes no descargaba nunca.
      CREATE TABLE tecnico_nuevo (
        id       TEXT NOT NULL,
        nombre   TEXT NOT NULL,
        sede_id  TEXT NOT NULL,
        activo   INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (id, sede_id)
      );
      INSERT INTO tecnico_nuevo (id, nombre, sede_id, activo)
        SELECT id, nombre, sede_id, activo FROM tecnico;
      DROP TABLE tecnico;
      ALTER TABLE tecnico_nuevo RENAME TO tecnico;
      CREATE INDEX idx_tecnico_sede ON tecnico (sede_id);

      -- Sedes de la empresa (FUN, VDP…): una orden nueva necesita la sede, y
      -- la creada sin señal necesita su código para la referencia FUN-K7M2.
      CREATE TABLE sede (
        id      TEXT PRIMARY KEY,
        nombre  TEXT NOT NULL,
        codigo  TEXT NOT NULL
      );
    `,
  },
  {
    version: 10,
    nombre: "flota creada en campo y nombre de las plantillas",
    sql: `
      -- La descarga reemplazaba clientes, sedes y vehículos enteros: lo creado
      -- en el celular sin señal desaparecía en la siguiente descarga, y las
      -- órdenes que lo usaban quedaban huérfanas. Lo marcado aquí no se borra
      -- hasta que el servidor lo devuelva como suyo.
      ALTER TABLE cliente ADD COLUMN creada_local INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sede_cliente ADD COLUMN creada_local INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vehiculo ADD COLUMN creada_local INTEGER NOT NULL DEFAULT 0;

      -- Las plantillas tenían posiciones pero no nombre: no había cómo elegir
      -- "Tractocamión 6x4" al registrar un vehículo.
      CREATE TABLE configuracion_eje (
        id       TEXT PRIMARY KEY,
        nombre   TEXT NOT NULL,
        version  INTEGER NOT NULL DEFAULT 1,
        vigente  INTEGER NOT NULL DEFAULT 1
      );
    `,
  },
  {
    version: 11,
    nombre: "sesión sin empresa (superadmin)",
    sql: `
      -- El superadmin no pertenece a ninguna empresa, y la tabla exigía una:
      -- guardar su sesión fallaba y no podía entrar a la app. El contrato del
      -- servidor (zUsuarioSesion) ya la declaraba opcional. Lo encontró el
      -- recorrido de pantallas de la auditoría.
      --
      -- SQLite no cambia la nulidad de una columna: se rehace la tabla,
      -- conservando la sesión que hubiera.
      CREATE TABLE sesion_nueva (
        id                INTEGER PRIMARY KEY CHECK (id = 1),
        usuario_id        TEXT NOT NULL,
        empresa_id        TEXT,
        rol               TEXT NOT NULL,
        nombre            TEXT NOT NULL,
        cliente_id        TEXT,
        sede_principal_id TEXT,
        sincronizado_en   TEXT
      );
      INSERT INTO sesion_nueva
        SELECT id, usuario_id, empresa_id, rol, nombre, cliente_id, sede_principal_id, sincronizado_en FROM sesion;
      DROP TABLE sesion;
      ALTER TABLE sesion_nueva RENAME TO sesion;
    `,
  },
];

export const VERSION_ESQUEMA = MIGRACIONES[MIGRACIONES.length - 1]?.version ?? 0;

/** SQL que prepara la base antes de aplicar migraciones. */
export const SQL_PREPARACION = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS migracion_aplicada (
    version   INTEGER PRIMARY KEY,
    nombre    TEXT NOT NULL,
    aplicada_en TEXT NOT NULL
  );
`;

/** Tablas que se vacían al cerrar sesión o cambiar de empresa. */
export const TABLAS_DE_DATOS = [
  "medicion_servicio",
  "medicion",
  "foto",
  "operacion",
  "orden",
  "vehiculo",
  "sede_cliente",
  "cliente",
  "posicion_eje",
  "medida",
  "diseno",
  "marca",
  "servicio",
  "tipo_parche",
  "reserva_folio",
  "sesion",
] as const;
