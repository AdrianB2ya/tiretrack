-- Revisión de lo creado en campo: una marca o un diseño duplicado queda como
-- alias del correcto. No se reescriben mediciones (los documentos cerrados no
-- cambian); los informes agrupan por el correcto.
ALTER TABLE "Marca" ADD COLUMN "reemplazadaPorId" TEXT;
ALTER TABLE "Marca" ADD CONSTRAINT "Marca_reemplazadaPorId_fkey"
  FOREIGN KEY ("reemplazadaPorId") REFERENCES "Marca"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Diseno" ADD COLUMN "reemplazadoPorId" TEXT;
ALTER TABLE "Diseno" ADD CONSTRAINT "Diseno_reemplazadoPorId_fkey"
  FOREIGN KEY ("reemplazadoPorId") REFERENCES "Diseno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Un alias de un alias rompería la agrupación: se unifica siempre hacia una vigente.
ALTER TABLE "Marca" ADD CONSTRAINT "Marca_no_alias_de_si_misma" CHECK ("reemplazadaPorId" IS NULL OR "reemplazadaPorId" <> id);
ALTER TABLE "Diseno" ADD CONSTRAINT "Diseno_no_alias_de_si_mismo" CHECK ("reemplazadoPorId" IS NULL OR "reemplazadoPorId" <> id);
