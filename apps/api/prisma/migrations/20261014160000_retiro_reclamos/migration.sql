-- Retiro y fallas (R10, 2026-10-14): motivo de retiro y reclamos de garantía.
ALTER TABLE "LlantaRegistro" ADD COLUMN "desMotivoRetiro" TEXT;

CREATE TABLE "Reclamo" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "llantaId" TEXT NOT NULL,
  "clienteId" TEXT NOT NULL,
  "proveedor" TEXT NOT NULL,
  "motivoRetiro" TEXT NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'abierto',
  "fecha" DATE NOT NULL,
  "valorReconocido" DECIMAL(14,2),
  "notas" TEXT,
  "creadoPorId" TEXT NOT NULL,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Reclamo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Reclamo_empresaId_estado_idx" ON "Reclamo"("empresaId", "estado");
CREATE INDEX "Reclamo_empresaId_llantaId_idx" ON "Reclamo"("empresaId", "llantaId");
ALTER TABLE "Reclamo" ADD CONSTRAINT "Reclamo_llanta_empresa_fkey"
  FOREIGN KEY ("llantaId", "empresaId") REFERENCES "Llanta"("id", "empresaId");
ALTER TABLE "Reclamo" ADD CONSTRAINT "Reclamo_cliente_empresa_fkey"
  FOREIGN KEY ("clienteId", "empresaId") REFERENCES "Cliente"("id", "empresaId");
ALTER TABLE "Reclamo" ADD CONSTRAINT reclamo_estado_valido
  CHECK (estado IN ('abierto','enviado','aprobado','rechazado','cerrado'));

ALTER TABLE "Reclamo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Reclamo" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "Reclamo";
CREATE POLICY aislamiento_empresa ON "Reclamo"
  USING ("empresaId" = app_empresa_id())
  WITH CHECK ("empresaId" = app_empresa_id());
DROP POLICY IF EXISTS cliente_solo_lo_suyo ON "Reclamo";
CREATE POLICY cliente_solo_lo_suyo ON "Reclamo"
  AS RESTRICTIVE
  USING (app_rol() <> 'cliente' OR "clienteId" = app_cliente_id());

DROP TRIGGER IF EXISTS actualizado_en ON "Reclamo";
CREATE TRIGGER actualizado_en BEFORE INSERT OR UPDATE ON "Reclamo"
  FOR EACH ROW EXECUTE FUNCTION marcar_actualizado_en();
