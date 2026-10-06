-- Programación recurrente con técnico fijo y autor; acciones automáticas a
-- nombre de "Sistema". Decisiones del usuario, 2026-10-06.
--
-- Las migraciones publicadas no se editan: esto va en una nueva.

-- El historial admite usuario vacío: el cierre tácito y la orden recurrente
-- los hace el sistema, y atribuírselos a una persona sería falso.
ALTER TABLE "OrdenEstadoHistorial" ALTER COLUMN "usuarioId" DROP NOT NULL;

-- NOT NULL sin valor por defecto, a propósito: no había forma de crear
-- programaciones antes de esta versión. Si alguna existiera, la migración
-- falla en vez de inventarle un técnico.
ALTER TABLE "ProgramacionRecurrente"
  ADD COLUMN "tecnicoId" TEXT NOT NULL,
  ADD COLUMN "creadoPorId" TEXT NOT NULL,
  ADD COLUMN "ultimoAviso" TEXT;

ALTER TABLE "ProgramacionRecurrente" ADD CONSTRAINT "ProgramacionRecurrente_tecnicoId_fkey" FOREIGN KEY ("tecnicoId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgramacionRecurrente" ADD CONSTRAINT "ProgramacionRecurrente_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Copia de las secciones nuevas de manual.sql y rls.sql.

-- ── La programación recurrente, encadenada a su empresa ─────────────────────
-- Igual que la orden que genera: una programación de Asistectire no puede
-- apuntar al cliente, la sede o el técnico de otra empresa.

ALTER TABLE "ProgramacionRecurrente"
  ADD CONSTRAINT programacion_cliente_empresa_fk
  FOREIGN KEY ("clienteId", "empresaId")
  REFERENCES "Cliente" ("id", "empresaId");

ALTER TABLE "ProgramacionRecurrente"
  ADD CONSTRAINT programacion_sede_empresa_fk
  FOREIGN KEY ("sedeId", "empresaId")
  REFERENCES "Sede" ("id", "empresaId");

ALTER TABLE "ProgramacionRecurrente"
  ADD CONSTRAINT programacion_sedecliente_cliente_fk
  FOREIGN KEY ("sedeClienteId", "clienteId")
  REFERENCES "SedeCliente" ("id", "clienteId");

-- El técnico fijo debe estar asignado a la sede: si no, la orden generada
-- violaría orden_tecnico_sede_fk y el trabajo fallaría cada día sin aviso.
ALTER TABLE "ProgramacionRecurrente"
  ADD CONSTRAINT programacion_tecnico_sede_fk
  FOREIGN KEY ("tecnicoId", "sedeId")
  REFERENCES "UsuarioSede" ("usuarioId", "sedeId");

-- @seccion:trabajos
-- ── Empresas para los trabajos programados ──────────────────────────────────
-- El cierre tácito y las órdenes recurrentes corren solos, empresa por
-- empresa, con el contexto de cada una: no se saltan el aislamiento. Pero
-- para recorrerlas hay que saber cuáles existen, y con RLS el rol de
-- aplicación sin contexto no ve ninguna.
--
-- Esta función es la única excepción, y estrecha: devuelve SOLO los ids de
-- las empresas activas. Ni nombre ni NIT. No se le dio BYPASSRLS al rol ni
-- se conectan los trabajos como dueño, que abrirían toda la base.
CREATE OR REPLACE FUNCTION empresas_para_trabajos() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$ SELECT id FROM "Empresa" WHERE activa ORDER BY id $$;

REVOKE ALL ON FUNCTION empresas_para_trabajos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION empresas_para_trabajos() TO tiretrack_app;

-- La función corre como el dueño de las tablas, y "Empresa" tiene FORCE ROW
-- LEVEL SECURITY, que también aplica al dueño: sin esta política la función
-- vería cero empresas y los trabajos no correrían nunca, en silencio. Se
-- concede SOLO al rol que ejecuta la migración —el dueño, que de todos modos
-- puede desactivar RLS en su tabla—, y solo para leer.
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS trabajos_dueno ON "Empresa"';
  EXECUTE format('CREATE POLICY trabajos_dueno ON "Empresa" FOR SELECT TO %I USING (true)', current_user);
END
$$;
-- @fin:trabajos
