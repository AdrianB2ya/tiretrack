-- Medidas creadas desde la app (R1, 2026-10-13): cada medida sabe de qué
-- empresa es (null = catálogo general) y si se creó en campo.
ALTER TABLE "DisenoMedida" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "DisenoMedida" ADD COLUMN "creadaEnCampo" BOOLEAN NOT NULL DEFAULT false;

-- Las medidas existentes de diseños propios son de la empresa del diseño.
UPDATE "DisenoMedida" dm SET "empresaId" = d."empresaId"
  FROM "Diseno" d WHERE d.id = dm."disenoId" AND d."esGlobal" = false;

ALTER TABLE "DisenoMedida" ADD CONSTRAINT "DisenoMedida_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX "DisenoMedida_disenoId_medida_key";
CREATE UNIQUE INDEX "DisenoMedida_disenoId_empresaId_medida_key" ON "DisenoMedida"("disenoId", "empresaId", "medida");
CREATE INDEX "DisenoMedida_empresaId_disenoId_idx" ON "DisenoMedida"("empresaId", "disenoId");

-- Copia de las políticas nuevas de rls.sql: el diseño y la medida propios no
-- se ven desde otra empresa aunque cuelguen de algo global.
DROP POLICY IF EXISTS aislamiento_empresa ON "Diseno";
CREATE POLICY aislamiento_empresa ON "Diseno"
  USING (("esGlobal" = true OR "empresaId" = app_empresa_id())
         AND EXISTS (SELECT 1 FROM "Marca" m WHERE m.id = "marcaId"))
  WITH CHECK ("empresaId" = app_empresa_id()
              AND EXISTS (SELECT 1 FROM "Marca" m WHERE m.id = "marcaId"));

DROP POLICY IF EXISTS aislamiento_empresa ON "DisenoMedida";
CREATE POLICY aislamiento_empresa ON "DisenoMedida"
  USING (("empresaId" IS NULL OR "empresaId" = app_empresa_id())
         AND EXISTS (SELECT 1 FROM "Diseno" d WHERE d.id = "disenoId"))
  WITH CHECK ("empresaId" = app_empresa_id()
              AND EXISTS (SELECT 1 FROM "Diseno" d WHERE d.id = "disenoId"));
