-- Sesión de soporte (R16). Copia de la sección @seccion:soporte de rls.sql.
-- @seccion:soporte
-- ── Sesión de soporte del superadmin (R16) ──────────────────────────────────
-- Durante una sesión de soporte el servidor fija app.soporte_id. Este
-- disparador marca TODA fila de auditoría escrita en ella, venga del camino
-- que venga: depender de que cada INSERT lo recuerde es justo el olvido que
-- el aislamiento evita poniendo las reglas en la base.
CREATE OR REPLACE FUNCTION marcar_auditoria_soporte() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('app.soporte_id', true), '') <> '' THEN
    NEW."viaSuplantacion" := true;
    NEW.detalle := coalesce(NEW.detalle, '{}'::jsonb)
                   || jsonb_build_object('sesionSoporte', current_setting('app.soporte_id', true));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS auditoria_soporte ON "Auditoria";
CREATE TRIGGER auditoria_soporte BEFORE INSERT ON "Auditoria"
  FOR EACH ROW EXECUTE FUNCTION marcar_auditoria_soporte();
-- @fin:soporte
