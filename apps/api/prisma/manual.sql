-- ============================================================================
-- Restricciones que Prisma no genera
-- ============================================================================
-- Se aplican DESPUÉS de la migración inicial:
--
--   npx prisma migrate dev --create-only --name init
--   cat prisma/manual.sql >> prisma/migrations/<timestamp>_init/migration.sql
--   npx prisma migrate dev
--
-- Principio: si una inconsistencia tiene consecuencia financiera o legal, la
-- restricción vive en el motor. Una validación de aplicación se puede saltar
-- con un script de migración, una carga masiva o un endpoint escrito con
-- prisa. Una llave foránea no.
-- ============================================================================

-- ── Aislamiento entre empresas ──────────────────────────────────────────────
-- Encadenadas, hacen estructuralmente imposible que una orden de Asistectire
-- referencie un cliente de otra empresa suscrita.

ALTER TABLE "OrdenServicio"
  ADD CONSTRAINT orden_cliente_empresa_fk
  FOREIGN KEY ("clienteId", "empresaId")
  REFERENCES "Cliente" ("id", "empresaId");

ALTER TABLE "OrdenServicio"
  ADD CONSTRAINT orden_sede_empresa_fk
  FOREIGN KEY ("sedeId", "empresaId")
  REFERENCES "Sede" ("id", "empresaId");

ALTER TABLE "OrdenServicio"
  ADD CONSTRAINT orden_configuracion_empresa_fk
  FOREIGN KEY ("configuracionEjeId", "empresaId")
  REFERENCES "ConfiguracionEje" ("id", "empresaId");

-- ── Coherencia cliente ↔ sede del cliente ───────────────────────────────────
-- Impide que la orden apunte a la sede de un cliente y al id de otro.

ALTER TABLE "OrdenServicio"
  ADD CONSTRAINT orden_sedecliente_cliente_fk
  FOREIGN KEY ("sedeClienteId", "clienteId")
  REFERENCES "SedeCliente" ("id", "clienteId");

-- ── El técnico debe estar asignado a la sede de la orden ────────────────────
-- Deja de ser una validación de backend olvidable.
-- Efecto colateral buscado: no se puede quitar a un técnico de una sede
-- mientras tenga órdenes ahí. Para sacarlo se marca la asignación como
-- inactiva, no se borra.

ALTER TABLE "OrdenServicio"
  ADD CONSTRAINT orden_tecnico_sede_fk
  FOREIGN KEY ("tecnico_id", "sedeId")
  REFERENCES "UsuarioSede" ("usuarioId", "sedeId");

-- ── La posición debe existir en la configuración que la orden congeló ───────
-- Impide guardar la posición 47 en un montacargas de 4 llantas.

ALTER TABLE "LlantaRegistro"
  ADD CONSTRAINT llanta_orden_configuracion_fk
  FOREIGN KEY ("ordenId", "configuracionEjeId")
  REFERENCES "OrdenServicio" ("id", "configuracionEjeId");

-- ── Requisitos de cierre ────────────────────────────────────────────────────
-- Una orden cerrada es un documento: sin firma no respalda nada, y sin la
-- identidad estampada no se puede saber a quién se le prestó el servicio.

ALTER TABLE "OrdenServicio"
  ADD CONSTRAINT orden_cerrada_requiere_firma
  CHECK (
    estado <> 'cerrada'
    OR ("firmaNombre" IS NOT NULL AND "firmaCedula" IS NOT NULL)
  );

ALTER TABLE "OrdenServicio"
  ADD CONSTRAINT orden_cerrada_requiere_congelado
  CHECK (
    estado <> 'cerrada'
    OR (
      "clienteNombre" IS NOT NULL
      AND "clienteNit" IS NOT NULL
      AND "vehiculoCodigo" IS NOT NULL
      AND "tecnicoNombre" IS NOT NULL
      AND "congeladoEn" IS NOT NULL
    )
  );

-- ── Solo el superadmin puede no tener empresa ───────────────────────────────

ALTER TABLE "Usuario"
  ADD CONSTRAINT usuario_empresa_segun_rol
  CHECK (
    (rol = 'superadmin' AND "empresaId" IS NULL)
    OR (rol <> 'superadmin' AND "empresaId" IS NOT NULL)
  );

-- Un usuario cliente debe estar vinculado a su cliente: es el dato que
-- limita todo lo que puede ver desde fuera de la empresa.
ALTER TABLE "Usuario"
  ADD CONSTRAINT usuario_cliente_requiere_vinculo
  CHECK (rol <> 'cliente' OR "clienteId" IS NOT NULL);

-- ── Una llanta sin identificar no puede traer marca ─────────────────────────
-- Si el técnico marcó que no pudo leerla, no debería haber datos de catálogo.

ALTER TABLE "LlantaRegistro"
  ADD CONSTRAINT llanta_no_identificada_sin_marca
  CHECK (
    "noIdentificada" = false
    OR ("marcaId" IS NULL AND "disenoId" IS NULL AND "motivoNoIdentificada" IS NOT NULL)
  );

-- ── Foto: exactamente una de las dos referencias ────────────────────────────
-- Polimorfismo débil: Prisma no lo puede expresar.

ALTER TABLE "Foto"
  ADD CONSTRAINT foto_una_sola_referencia
  CHECK (num_nonnulls("ordenId", "llantaRegistroId") = 1);

-- ── Mediciones dentro de rangos físicos posibles ────────────────────────────

ALTER TABLE "LlantaRegistro"
  ADD CONSTRAINT llanta_presiones_razonables
  CHECK (
    ("psiEncontrada" IS NULL OR ("psiEncontrada" >= 0 AND "psiEncontrada" <= 400))
    AND ("psiCalibrado" IS NULL OR ("psiCalibrado" >= 0 AND "psiCalibrado" <= 400))
  );

ALTER TABLE "LlantaRegistro"
  ADD CONSTRAINT llanta_profundidades_razonables
  CHECK (
    ("profundidad" IS NULL OR ("profundidad" >= 0 AND "profundidad" <= 60))
    AND ("desProfundidad" IS NULL OR ("desProfundidad" >= 0 AND "desProfundidad" <= 60))
  );

-- ── El consecutivo nunca retrocede ──────────────────────────────────────────

ALTER TABLE "Consecutivo"
  ADD CONSTRAINT consecutivo_no_negativo
  CHECK (valor >= 0);

-- ── Índice parcial: detectar órdenes abiertas de un vehículo ────────────────
-- Se consulta cada vez que se crea una orden, para avisar si el vehículo ya
-- tiene otra en curso.

CREATE INDEX orden_abierta_por_vehiculo
  ON "OrdenServicio" ("vehiculoId")
  WHERE estado IN ('borrador', 'programada', 'en_proceso', 'en_revision', 'pendiente_cliente');

-- ── Índice parcial: órdenes por vencer del cliente ──────────────────────────
-- Lo usa el trabajo programado que cierra por aprobación tácita.

CREATE INDEX orden_pendiente_cliente_limite
  ON "OrdenServicio" ("limiteCliente")
  WHERE estado = 'pendiente_cliente';

-- ── Índice parcial: recomendaciones abiertas por vehículo ───────────────────
-- Se consulta al abrir cada orden, para mostrar lo pendiente de visitas
-- anteriores.

CREATE INDEX recomendacion_abierta_por_vehiculo
  ON "Recomendacion" ("vehiculoId")
  WHERE estado = 'abierta';

-- ── Búsqueda de seriales para la trazabilidad ───────────────────────────────
-- El informe busca por serial parcial, tanto en la llanta montada como en la
-- desmontada.

CREATE INDEX llanta_serial_busqueda
  ON "LlantaRegistro" (lower("serial") text_pattern_ops)
  WHERE "serial" IS NOT NULL;

-- ── La programación recurrente, encadenada a su empresa ─────────────────────
-- Igual que la orden que genera: una programación de Asistectire no puede
-- apuntar al cliente, la sede o el técnico de otra empresa.

ALTER TABLE "ProgramacionRecurrente"
  ADD CONSTRAINT programacion_cliente_empresa_fk
  FOREIGN KEY ("clienteId", "empresaId")
  REFERENCES "Cliente" ("id", "empresaId");

ALTER TABLE "ProgramacionRecurrente"
  ADD CONSTRAINT programacion_sede_empresa_fk
  FOREIGN KEY ("sedeId", "empresaId")
  REFERENCES "Sede" ("id", "empresaId");

ALTER TABLE "ProgramacionRecurrente"
  ADD CONSTRAINT programacion_sedecliente_cliente_fk
  FOREIGN KEY ("sedeClienteId", "clienteId")
  REFERENCES "SedeCliente" ("id", "clienteId");

-- El técnico fijo debe estar asignado a la sede: si no, la orden generada
-- violaría orden_tecnico_sede_fk y el trabajo fallaría cada día sin aviso.
ALTER TABLE "ProgramacionRecurrente"
  ADD CONSTRAINT programacion_tecnico_sede_fk
  FOREIGN KEY ("tecnicoId", "sedeId")
  REFERENCES "UsuarioSede" ("usuarioId", "sedeId");
