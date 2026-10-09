-- Profundidad en tres puntos de la banda (exterior, centro, interior), en la
-- llanta montada y en la desmontada. "profundidad" y "desProfundidad" quedan
-- como la mínima de las tres: lo que ya las usa sigue igual.
ALTER TABLE "LlantaRegistro"
  ADD COLUMN "profExterior" DECIMAL(5,2),
  ADD COLUMN "profCentro" DECIMAL(5,2),
  ADD COLUMN "profInterior" DECIMAL(5,2),
  ADD COLUMN "desProfExterior" DECIMAL(5,2),
  ADD COLUMN "desProfCentro" DECIMAL(5,2),
  ADD COLUMN "desProfInterior" DECIMAL(5,2);
