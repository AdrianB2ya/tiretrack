-- Bloqueo de la orden (R7, 2026-10-14).
ALTER TABLE "OrdenServicio" ADD COLUMN "bloqueadaPorId" TEXT;
ALTER TABLE "OrdenServicio" ADD COLUMN "bloqueadaEn" TIMESTAMP(3);
-- Quien bloquea es un usuario real (los usuarios no se borran, se desactivan).
ALTER TABLE "OrdenServicio" ADD CONSTRAINT "OrdenServicio_bloqueadaPorId_fkey"
  FOREIGN KEY ("bloqueadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Bloqueada o no, nunca a medias.
ALTER TABLE "OrdenServicio" ADD CONSTRAINT orden_bloqueo_completo
  CHECK (("bloqueadaPorId" IS NULL) = ("bloqueadaEn" IS NULL));
