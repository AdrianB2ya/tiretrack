-- Órdenes anteriores al sistema, cargadas desde Excel (2026-10-17).
--
-- Entran cerradas y sin firma digital: el papel firmado, si existe, no está
-- en el sistema. La marca "historica" lo dice en la base, y el PDF y el
-- informe lo dicen con todas las letras: una orden histórica nunca aparenta
-- tener firma.

ALTER TABLE "OrdenServicio" ADD COLUMN "historica" BOOLEAN NOT NULL DEFAULT false;
-- El número que tenía en el papel o en el sistema anterior, para buscarla.
ALTER TABLE "OrdenServicio" ADD COLUMN "referenciaAnterior" TEXT;

-- La firma sigue siendo obligatoria para cerrar, salvo en una histórica.
ALTER TABLE "OrdenServicio" DROP CONSTRAINT orden_cerrada_requiere_firma;
ALTER TABLE "OrdenServicio"
  ADD CONSTRAINT orden_cerrada_requiere_firma
  CHECK (
    estado <> 'cerrada'
    OR historica
    OR ("firmaNombre" IS NOT NULL AND "firmaCedula" IS NOT NULL)
  );

-- Una histórica no vuelve al flujo: está cerrada (o anulada, si se cargó por
-- error). Así la excepción de la firma no sirve para cerrar una orden normal.
ALTER TABLE "OrdenServicio"
  ADD CONSTRAINT orden_historica_cerrada
  CHECK (NOT historica OR estado IN ('cerrada', 'anulada'));
