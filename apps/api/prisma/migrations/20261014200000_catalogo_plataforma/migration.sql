-- Catálogo general desde la app (superadmin). Copia de @seccion:plataforma_catalogo de rls.sql.
-- @seccion:plataforma_catalogo
-- ── Catálogo GENERAL desde la app (superadmin) ──────────────────────────────
-- Las políticas de arriba dejan a toda empresa VER lo global y le prohíben
-- escribirlo (WITH CHECK exige su empresa). Esta, permisiva, deja escribir
-- SOLO entradas globales y SOLO con un contexto de superadmin: una empresa
-- sigue sin poder tocar el catálogo general, y el superadmin no puede crear
-- nada a nombre de una empresa.
DROP POLICY IF EXISTS plataforma_catalogo ON "Marca";
CREATE POLICY plataforma_catalogo ON "Marca"
  USING (app_rol() = 'superadmin' AND "esGlobal" = true)
  WITH CHECK (app_rol() = 'superadmin' AND "esGlobal" = true AND "empresaId" IS NULL);

DROP POLICY IF EXISTS plataforma_catalogo ON "Diseno";
CREATE POLICY plataforma_catalogo ON "Diseno"
  USING (app_rol() = 'superadmin' AND "esGlobal" = true)
  WITH CHECK (app_rol() = 'superadmin' AND "esGlobal" = true AND "empresaId" IS NULL
              AND EXISTS (SELECT 1 FROM "Marca" m WHERE m.id = "marcaId" AND m."esGlobal"));

DROP POLICY IF EXISTS plataforma_catalogo ON "DisenoMedida";
CREATE POLICY plataforma_catalogo ON "DisenoMedida"
  USING (app_rol() = 'superadmin' AND "empresaId" IS NULL)
  WITH CHECK (app_rol() = 'superadmin' AND "empresaId" IS NULL
              AND EXISTS (SELECT 1 FROM "Diseno" d WHERE d.id = "disenoId" AND d."esGlobal"));
-- @fin:plataforma_catalogo
