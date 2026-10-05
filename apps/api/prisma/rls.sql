-- ============================================================================
-- Row Level Security — aislamiento entre empresas
-- ============================================================================
-- Se aplica DESPUÉS de manual.sql, en la misma migración inicial.
--
-- Por qué RLS y no solo un WHERE en cada consulta:
--
-- El aislamiento no puede depender de que el desarrollador recuerde filtrar.
-- Un solo endpoint escrito con prisa, un script de migración o una carga
-- masiva bastan para que una empresa vea los datos de otra. Con RLS la
-- política la aplica el motor: aunque la consulta no filtre, PostgreSQL no
-- devuelve filas ajenas.
--
-- FORCE es indispensable: sin él, el dueño de las tablas —que suele ser el
-- mismo usuario con el que se conecta la aplicación— se salta las políticas.
--
-- Cómo lo usa el backend: al abrir cada transacción ejecuta
--   SET LOCAL app.empresa_id = '<id del token>';
--   SET LOCAL app.rol        = '<rol del token>';
--   SET LOCAL app.usuario_id = '<id del usuario>';
--   SET LOCAL app.cliente_id = '<clienteId, solo si rol = cliente>';
-- LOCAL es importante: el valor muere con la transacción y no se filtra a la
-- siguiente petición que reutilice la conexión del pool.
-- ============================================================================

-- ── Rol de la aplicación ────────────────────────────────────────────────────
-- La API NO se conecta como dueño de las tablas. Un rol aparte hace que FORCE
-- tenga efecto y limita el daño si se filtran las credenciales.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiretrack_app') THEN
    CREATE ROLE tiretrack_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO tiretrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tiretrack_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tiretrack_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tiretrack_app;

-- ════════════════════════════════════════════════════════════════════════════
-- ROL DE AUTENTICACIÓN
-- ════════════════════════════════════════════════════════════════════════════
-- @seccion:acceso
--
-- El login ocurre ANTES de saber la empresa: hay que buscar al usuario por
-- correo sin contexto. Con las políticas de empresa, esa consulta devuelve
-- cero filas y el login respondería "credenciales incorrectas" a todo el
-- mundo.
--
-- Se resuelve con un rol aparte para el módulo de acceso, con permisos
-- ÚNICAMENTE sobre las cinco tablas que la autenticación necesita.
--
-- Se descartó `BYPASSRLS`: saltarse las políticas deja leer TODA la base si
-- hay un fallo en el módulo de acceso. Aquí el rol simplemente no tiene
-- permiso sobre las tablas operativas, así que ni una inyección de SQL en
-- ese módulo alcanzaría una orden de servicio.
--
-- También se descartaron funciones SECURITY DEFINER por operación: serían
-- más estrictas (columna por columna), pero obligan a mantener nueve
-- consultas duplicadas en SQL, que es exactamente el tipo de duplicación que
-- termina desincronizándose.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiretrack_auth') THEN
    CREATE ROLE tiretrack_auth NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO tiretrack_auth;

-- Solo lo que la autenticación hace, y nada más:
GRANT SELECT, UPDATE          ON "Usuario"            TO tiretrack_auth;
GRANT SELECT, INSERT, UPDATE  ON "SesionUsuario"      TO tiretrack_auth;
GRANT SELECT, INSERT, UPDATE  ON "TokenRecuperacion"  TO tiretrack_auth;
GRANT INSERT                  ON "Auditoria"          TO tiretrack_auth;
-- Para decir a qué empresa pertenece cada usuario cuando el correo está en
-- varias y hay que preguntar cuál.
GRANT SELECT                  ON "Empresa"            TO tiretrack_auth;

-- Las tablas nuevas NO le llegan por defecto: el bloque de arriba solo
-- concede a tiretrack_app. Agregar una tabla al módulo de acceso obliga a
-- escribir su GRANT aquí, a la vista.

-- Políticas que le abren esas tablas completas. Son permisivas y se combinan
-- con OR: no tocan el aislamiento del rol de aplicación.
DROP POLICY IF EXISTS acceso_autenticacion ON "Usuario";
CREATE POLICY acceso_autenticacion ON "Usuario"
  FOR ALL TO tiretrack_auth USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS acceso_autenticacion ON "SesionUsuario";
CREATE POLICY acceso_autenticacion ON "SesionUsuario"
  FOR ALL TO tiretrack_auth USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS acceso_autenticacion ON "TokenRecuperacion";
CREATE POLICY acceso_autenticacion ON "TokenRecuperacion"
  FOR ALL TO tiretrack_auth USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS acceso_autenticacion ON "Auditoria";
CREATE POLICY acceso_autenticacion ON "Auditoria"
  FOR INSERT TO tiretrack_auth WITH CHECK (true);
-- @fin:acceso

-- ── Funciones de contexto ───────────────────────────────────────────────────
-- Leen lo que el backend fijó al abrir la transacción. El segundo argumento
-- en true evita que reviente si la variable no está: devuelve NULL, y una
-- política que compara contra NULL no deja pasar nada. Falla cerrado.

CREATE OR REPLACE FUNCTION app_empresa_id() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.empresa_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_rol() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.rol', true), '')
$$;

CREATE OR REPLACE FUNCTION app_usuario_id() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.usuario_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_cliente_id() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.cliente_id', true), '')
$$;

-- ── La propia tabla de empresas ─────────────────────────────────────────────
-- Sin política aquí, cualquier empresa podría listar a todas las demás con
-- sus nombres y NIT. La tabla del tenant también es dato del tenant.

ALTER TABLE "Empresa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Empresa" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "Empresa";
CREATE POLICY aislamiento_empresa ON "Empresa"
  USING (id = app_empresa_id())
  WITH CHECK (id = app_empresa_id());

-- ── Tablas con empresaId directo ────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Sede', 'Cliente', 'ConfiguracionEje', 'Servicio', 'TipoParche',
    'OrdenServicio', 'Recomendacion', 'ProgramacionRecurrente', 'Consecutivo',
    -- Sin aislar, una empresa podría ver o bloquear las claves de otra.
    'OperacionAplicada'
  ]
  LOOP
    -- Se salta lo que no exista. Sin esto el bucle es atómico: una sola
    -- tabla faltante —un nombre mal escrito, por ejemplo— haría fallar el
    -- bloque entero y NINGUNA tabla quedaría con RLS, en silencio.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_class
      WHERE relname = t AND relnamespace = 'public'::regnamespace AND relkind = 'r'
    );

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS aislamiento_empresa ON %I', t);
    EXECUTE format($f$
      CREATE POLICY aislamiento_empresa ON %I
        USING ("empresaId" = app_empresa_id())
        WITH CHECK ("empresaId" = app_empresa_id())
    $f$, t);
  END LOOP;
END
$$;

-- ── Usuario: además, el superadmin no pertenece a ninguna empresa ───────────

ALTER TABLE "Usuario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Usuario" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "Usuario";
CREATE POLICY aislamiento_empresa ON "Usuario"
  USING ("empresaId" = app_empresa_id())
  WITH CHECK ("empresaId" = app_empresa_id());

-- ── Tablas hijas: heredan el aislamiento por su padre ───────────────────────
-- No llevan empresaId propio. La política verifica que el padre sea visible,
-- lo que a su vez aplica la política del padre.

ALTER TABLE "SedeCliente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SedeCliente" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "SedeCliente";
CREATE POLICY aislamiento_empresa ON "SedeCliente"
  USING (EXISTS (SELECT 1 FROM "Cliente" c WHERE c.id = "clienteId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Cliente" c WHERE c.id = "clienteId"));

ALTER TABLE "Vehiculo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vehiculo" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "Vehiculo";
CREATE POLICY aislamiento_empresa ON "Vehiculo"
  USING (EXISTS (SELECT 1 FROM "SedeCliente" s WHERE s.id = "sedeClienteId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "SedeCliente" s WHERE s.id = "sedeClienteId"));

ALTER TABLE "PosicionEje" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosicionEje" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "PosicionEje";
CREATE POLICY aislamiento_empresa ON "PosicionEje"
  USING (EXISTS (SELECT 1 FROM "ConfiguracionEje" c WHERE c.id = "configuracionEjeId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "ConfiguracionEje" c WHERE c.id = "configuracionEjeId"));

ALTER TABLE "LlantaRegistro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LlantaRegistro" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "LlantaRegistro";
CREATE POLICY aislamiento_empresa ON "LlantaRegistro"
  USING (EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"));

ALTER TABLE "LlantaServicio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LlantaServicio" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "LlantaServicio";
CREATE POLICY aislamiento_empresa ON "LlantaServicio"
  USING (EXISTS (SELECT 1 FROM "LlantaRegistro" l WHERE l.id = "llantaRegistroId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "LlantaRegistro" l WHERE l.id = "llantaRegistroId"));

ALTER TABLE "OrdenServicioVehiculo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrdenServicioVehiculo" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "OrdenServicioVehiculo";
CREATE POLICY aislamiento_empresa ON "OrdenServicioVehiculo"
  USING (EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"));

ALTER TABLE "OrdenEstadoHistorial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrdenEstadoHistorial" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "OrdenEstadoHistorial";
CREATE POLICY aislamiento_empresa ON "OrdenEstadoHistorial"
  USING (EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"));

ALTER TABLE "Foto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Foto" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "Foto";
CREATE POLICY aislamiento_empresa ON "Foto"
  USING (
    ("ordenId" IS NOT NULL AND EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"))
    OR ("llantaRegistroId" IS NOT NULL AND EXISTS (SELECT 1 FROM "LlantaRegistro" l WHERE l.id = "llantaRegistroId"))
  )
  WITH CHECK (
    ("ordenId" IS NOT NULL AND EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"))
    OR ("llantaRegistroId" IS NOT NULL AND EXISTS (SELECT 1 FROM "LlantaRegistro" l WHERE l.id = "llantaRegistroId"))
  );

ALTER TABLE "UsuarioSede" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsuarioSede" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "UsuarioSede";
CREATE POLICY aislamiento_empresa ON "UsuarioSede"
  USING (EXISTS (SELECT 1 FROM "Sede" s WHERE s.id = "sedeId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Sede" s WHERE s.id = "sedeId"));

-- ── Catálogo: lo global lo ve todo el mundo, lo propio solo su empresa ──────

ALTER TABLE "Marca" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Marca" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "Marca";
CREATE POLICY aislamiento_empresa ON "Marca"
  USING ("esGlobal" = true OR "empresaId" = app_empresa_id())
  -- Una empresa no puede crear marcas globales ni marcas de otra empresa
  WITH CHECK ("empresaId" = app_empresa_id());

ALTER TABLE "Diseno" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Diseno" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "Diseno";
CREATE POLICY aislamiento_empresa ON "Diseno"
  USING (EXISTS (SELECT 1 FROM "Marca" m WHERE m.id = "marcaId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Marca" m WHERE m.id = "marcaId"));

ALTER TABLE "DisenoMedida" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DisenoMedida" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "DisenoMedida";
CREATE POLICY aislamiento_empresa ON "DisenoMedida"
  USING (EXISTS (SELECT 1 FROM "Diseno" d WHERE d.id = "disenoId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Diseno" d WHERE d.id = "disenoId"));

-- ── Auditoría: se lee de la propia empresa, y NO se modifica ni se borra ────
-- Un registro de auditoría que se puede alterar no sirve como evidencia.

ALTER TABLE "Auditoria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Auditoria" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auditoria_lectura ON "Auditoria";
DROP POLICY IF EXISTS auditoria_escritura ON "Auditoria";
CREATE POLICY auditoria_lectura ON "Auditoria"
  FOR SELECT USING ("empresaId" = app_empresa_id());
CREATE POLICY auditoria_escritura ON "Auditoria"
  FOR INSERT WITH CHECK ("empresaId" = app_empresa_id());

REVOKE UPDATE, DELETE ON "Auditoria" FROM tiretrack_app;

-- ── Sesiones y tokens: cada usuario solo los suyos ──────────────────────────

ALTER TABLE "SesionUsuario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SesionUsuario" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sesion_propia ON "SesionUsuario";
CREATE POLICY sesion_propia ON "SesionUsuario"
  USING ("usuarioId" = app_usuario_id())
  WITH CHECK ("usuarioId" = app_usuario_id());

ALTER TABLE "TokenRecuperacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TokenRecuperacion" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS token_propio ON "TokenRecuperacion";
CREATE POLICY token_propio ON "TokenRecuperacion"
  USING ("usuarioId" = app_usuario_id())
  WITH CHECK ("usuarioId" = app_usuario_id());

-- ── Portal del cliente ──────────────────────────────────────────────────────
-- El usuario cliente es el único que entra desde FUERA de la empresa. Su
-- aislamiento no puede depender de un filtro en la consulta: si se olvida
-- en un endpoint, un cliente ve la flota de otro.
--
-- La política se suma a la de empresa (en PostgreSQL las políticas
-- permisivas se combinan con OR, así que esta va como RESTRICTIVE para que
-- se aplique en AND).

DROP POLICY IF EXISTS cliente_solo_lo_suyo ON "OrdenServicio";
CREATE POLICY cliente_solo_lo_suyo ON "OrdenServicio"
  AS RESTRICTIVE
  USING (app_rol() <> 'cliente' OR "clienteId" = app_cliente_id());

DROP POLICY IF EXISTS cliente_solo_lo_suyo ON "Cliente";
CREATE POLICY cliente_solo_lo_suyo ON "Cliente"
  AS RESTRICTIVE
  USING (app_rol() <> 'cliente' OR id = app_cliente_id());

DROP POLICY IF EXISTS cliente_solo_lo_suyo ON "SedeCliente";
CREATE POLICY cliente_solo_lo_suyo ON "SedeCliente"
  AS RESTRICTIVE
  USING (app_rol() <> 'cliente' OR "clienteId" = app_cliente_id());

-- El cliente nunca escribe datos operativos: solo aprueba u objeta, y eso
-- pasa por la API con sus propias reglas.
DROP POLICY IF EXISTS cliente_no_escribe ON "LlantaRegistro";
CREATE POLICY cliente_no_escribe ON "LlantaRegistro"
  AS RESTRICTIVE
  FOR ALL
  USING (true)
  WITH CHECK (app_rol() <> 'cliente');

-- ── El técnico solo ve sus órdenes asignadas ────────────────────────────────
-- Decisión tomada: el técnico ve los CLIENTES de la empresa, pero solo las
-- ÓRDENES asignadas a él.

DROP POLICY IF EXISTS tecnico_solo_asignadas ON "OrdenServicio";
CREATE POLICY tecnico_solo_asignadas ON "OrdenServicio"
  AS RESTRICTIVE
  USING (app_rol() <> 'tecnico' OR tecnico_id = app_usuario_id());
