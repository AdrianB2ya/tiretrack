-- Llantas de repuesto (dominio llanta/repuestos).
-- Un repuesto se mide como cualquier llanta, pero no existe en la plantilla
-- de ejes: su posición (101 en adelante) no puede apuntar a PosicionEje.

ALTER TABLE "Vehiculo" ADD COLUMN "repuestos" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Vehiculo" ADD CONSTRAINT vehiculo_repuestos_rango
  CHECK ("repuestos" >= 0 AND "repuestos" <= 10);

ALTER TABLE "LlantaRegistro" ADD COLUMN "posicionEnEje" INTEGER;
UPDATE "LlantaRegistro" SET "posicionEnEje" = posicion;

-- La llave a la plantilla pasa a la columna nueva: con ella nula (repuesto)
-- PostgreSQL no la comprueba.
ALTER TABLE "LlantaRegistro" DROP CONSTRAINT "LlantaRegistro_configuracionEjeId_posicion_fkey";
ALTER TABLE "LlantaRegistro" ADD CONSTRAINT "LlantaRegistro_configuracionEjeId_posicionEnEje_fkey"
  FOREIGN KEY ("configuracionEjeId", "posicionEnEje") REFERENCES "PosicionEje"("configuracionEjeId", "numero")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una posición de eje SIEMPRE pasa por la llave; solo un repuesto la salta.
ALTER TABLE "LlantaRegistro" ADD CONSTRAINT llanta_posicion_eje_o_repuesto
  CHECK (
    ("posicion" BETWEEN 1 AND 60 AND "posicionEnEje" = "posicion")
    OR ("posicion" BETWEEN 101 AND 110 AND "posicionEnEje" IS NULL)
  );
