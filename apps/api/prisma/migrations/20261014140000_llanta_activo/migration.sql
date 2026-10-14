-- La llanta como activo (R8, 2026-10-14): ficha, vidas, movimientos y
-- stock mínimo por sede.

CREATE TABLE "Llanta" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "clienteId" TEXT NOT NULL,
  "sedeId" TEXT,
  "numeroInterno" TEXT,
  "serial" TEXT,
  "numCalor" TEXT,
  "dot" TEXT,
  "marcaId" TEXT,
  "disenoId" TEXT,
  "medida" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'bodega',
  "vehiculoId" TEXT,
  "posicion" INTEGER,
  "vidas" INTEGER NOT NULL DEFAULT 0,
  "costo" DECIMAL(14,2),
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Llanta_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Llanta_empresaId_clienteId_serial_key" ON "Llanta"("empresaId", "clienteId", "serial");
CREATE UNIQUE INDEX "Llanta_empresaId_clienteId_numeroInterno_key" ON "Llanta"("empresaId", "clienteId", "numeroInterno");
CREATE UNIQUE INDEX "Llanta_id_empresaId_key" ON "Llanta"("id", "empresaId");
CREATE INDEX "Llanta_empresaId_estado_idx" ON "Llanta"("empresaId", "estado");
CREATE INDEX "Llanta_empresaId_vehiculoId_idx" ON "Llanta"("empresaId", "vehiculoId");
CREATE INDEX "Llanta_empresaId_sedeId_estado_idx" ON "Llanta"("empresaId", "sedeId", "estado");

CREATE TABLE "LlantaVida" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "llantaId" TEXT NOT NULL,
  "numero" INTEGER NOT NULL,
  "banda" TEXT,
  "reencauchadora" TEXT,
  "costo" DECIMAL(14,2),
  "profundidadInicial" DECIMAL(5,2),
  "inicio" DATE NOT NULL,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LlantaVida_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LlantaVida_llantaId_numero_key" ON "LlantaVida"("llantaId", "numero");
CREATE INDEX "LlantaVida_empresaId_llantaId_idx" ON "LlantaVida"("empresaId", "llantaId");

CREATE TABLE "LlantaMovimiento" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "llantaId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "fecha" DATE NOT NULL,
  "vehiculoId" TEXT,
  "posicion" INTEGER,
  "ordenId" TEXT,
  "kilometraje" INTEGER,
  "sedeId" TEXT,
  "detalle" TEXT,
  "usuarioId" TEXT,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LlantaMovimiento_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LlantaMovimiento_empresaId_llantaId_idx" ON "LlantaMovimiento"("empresaId", "llantaId");
CREATE INDEX "LlantaMovimiento_empresaId_ordenId_idx" ON "LlantaMovimiento"("empresaId", "ordenId");

CREATE TABLE "StockMinimo" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "sedeId" TEXT NOT NULL,
  "medida" TEXT NOT NULL,
  "cantidad" INTEGER NOT NULL,
  CONSTRAINT "StockMinimo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StockMinimo_empresaId_sedeId_medida_key" ON "StockMinimo"("empresaId", "sedeId", "medida");

ALTER TABLE "LlantaRegistro" ADD COLUMN "llantaId" TEXT;
ALTER TABLE "LlantaRegistro" ADD COLUMN "desLlantaId" TEXT;

-- Llaves compuestas con empresaId: nada apunta a otra empresa.
ALTER TABLE "Llanta" ADD CONSTRAINT "Llanta_cliente_empresa_fkey"
  FOREIGN KEY ("clienteId", "empresaId") REFERENCES "Cliente"("id", "empresaId");
ALTER TABLE "Llanta" ADD CONSTRAINT "Llanta_sede_empresa_fkey"
  FOREIGN KEY ("sedeId", "empresaId") REFERENCES "Sede"("id", "empresaId");
ALTER TABLE "Llanta" ADD CONSTRAINT "Llanta_vehiculo_fkey"
  FOREIGN KEY ("vehiculoId") REFERENCES "Vehiculo"("id");
ALTER TABLE "LlantaVida" ADD CONSTRAINT "LlantaVida_llanta_empresa_fkey"
  FOREIGN KEY ("llantaId", "empresaId") REFERENCES "Llanta"("id", "empresaId");
ALTER TABLE "LlantaMovimiento" ADD CONSTRAINT "LlantaMovimiento_llanta_empresa_fkey"
  FOREIGN KEY ("llantaId", "empresaId") REFERENCES "Llanta"("id", "empresaId");
ALTER TABLE "StockMinimo" ADD CONSTRAINT "StockMinimo_sede_empresa_fkey"
  FOREIGN KEY ("sedeId", "empresaId") REFERENCES "Sede"("id", "empresaId");
ALTER TABLE "LlantaRegistro" ADD CONSTRAINT "LlantaRegistro_llanta_fkey"
  FOREIGN KEY ("llantaId") REFERENCES "Llanta"("id");
ALTER TABLE "LlantaRegistro" ADD CONSTRAINT "LlantaRegistro_desLlanta_fkey"
  FOREIGN KEY ("desLlantaId") REFERENCES "Llanta"("id");

-- Coherencia que la base garantiza aunque alguien escriba directo.
ALTER TABLE "Llanta" ADD CONSTRAINT llanta_estado_valido
  CHECK (estado IN ('bodega','montada','reencauche','reparacion','desecho'));
ALTER TABLE "Llanta" ADD CONSTRAINT llanta_montada_tiene_lugar
  CHECK (estado <> 'montada' OR ("vehiculoId" IS NOT NULL AND posicion IS NOT NULL));
ALTER TABLE "Llanta" ADD CONSTRAINT llanta_identificable
  CHECK (serial IS NOT NULL OR "numeroInterno" IS NOT NULL);
ALTER TABLE "StockMinimo" ADD CONSTRAINT stock_minimo_no_negativo CHECK (cantidad >= 0);

-- Una posición de un vehículo tiene a lo sumo una llanta montada.
CREATE UNIQUE INDEX llanta_una_por_posicion ON "Llanta"("vehiculoId", posicion) WHERE estado = 'montada';

-- Copia de rls.sql: aislamiento por empresa, y el cliente solo ve lo suyo.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Llanta', 'LlantaVida', 'LlantaMovimiento', 'StockMinimo'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS aislamiento_empresa ON %I', t);
    EXECUTE format($f$
      CREATE POLICY aislamiento_empresa ON %I
        USING ("empresaId" = app_empresa_id())
        WITH CHECK ("empresaId" = app_empresa_id())
    $f$, t);
  END LOOP;
END
$$;
DROP POLICY IF EXISTS cliente_solo_lo_suyo ON "Llanta";
CREATE POLICY cliente_solo_lo_suyo ON "Llanta"
  AS RESTRICTIVE
  USING (app_rol() <> 'cliente' OR "clienteId" = app_cliente_id());

-- Copia de actualizado-en.sql para la tabla nueva.
DROP TRIGGER IF EXISTS actualizado_en ON "Llanta";
CREATE TRIGGER actualizado_en BEFORE INSERT OR UPDATE ON "Llanta"
  FOR EACH ROW EXECUTE FUNCTION marcar_actualizado_en();
