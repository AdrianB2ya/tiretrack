-- Límites de cambio de llanta por empresa (R2, 2026-10-13).
ALTER TABLE "Empresa" ADD COLUMN "limiteCambioInmediato" DECIMAL(5,2) NOT NULL DEFAULT 3;
ALTER TABLE "Empresa" ADD COLUMN "limiteProgramarCambio" DECIMAL(5,2) NOT NULL DEFAULT 5;
-- La base también impide límites incoherentes, aunque el servidor ya los valide.
ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_limites_coherentes"
  CHECK ("limiteCambioInmediato" > 0 AND "limiteProgramarCambio" > "limiteCambioInmediato");
