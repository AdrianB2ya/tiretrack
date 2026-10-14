-- Avisos por correo (R13).
ALTER TABLE "Empresa" ADD COLUMN "ultimoAvisoCambios" TEXT;
ALTER TABLE "OrdenServicio" ADD COLUMN "avisoClienteEn" TIMESTAMP(3);
