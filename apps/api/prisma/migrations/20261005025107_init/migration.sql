-- CreateEnum
CREATE TYPE "PlanSuscripcion" AS ENUM ('trial', 'basico', 'profesional', 'enterprise');

-- CreateEnum
CREATE TYPE "UnidadPresion" AS ENUM ('psi', 'bar', 'kpa');

-- CreateEnum
CREATE TYPE "UnidadProfundidad" AS ENUM ('mm', 'in32');

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('superadmin', 'administrador', 'coordinador', 'tecnico', 'cliente');

-- CreateEnum
CREATE TYPE "LadoVehiculo" AS ENUM ('izquierdo', 'derecho');

-- CreateEnum
CREATE TYPE "EstadoVehiculo" AS ENUM ('operativo', 'en_taller', 'alerta', 'fuera_servicio');

-- CreateEnum
CREATE TYPE "TipoServicio" AS ENUM ('preventivo', 'correctivo');

-- CreateEnum
CREATE TYPE "Prioridad" AS ENUM ('baja', 'normal', 'alta');

-- CreateEnum
CREATE TYPE "EstadoOrden" AS ENUM ('borrador', 'programada', 'en_proceso', 'en_revision', 'pendiente_cliente', 'cerrada', 'anulada');

-- CreateEnum
CREATE TYPE "PrioridadRecomendacion" AS ENUM ('urgente', 'proxima', 'seguimiento');

-- CreateEnum
CREATE TYPE "EstadoRecomendacion" AS ENUM ('abierta', 'ejecutada', 'descartada');

-- CreateEnum
CREATE TYPE "Frecuencia" AS ENUM ('dias_habiles', 'dias_calendario', 'semanal', 'quincenal', 'mensual');

-- CreateEnum
CREATE TYPE "AccionAuditoria" AS ENUM ('crear', 'actualizar', 'deshabilitar', 'cambiar_estado', 'reasignar', 'aprobar', 'anular', 'login_exitoso', 'login_fallido', 'recuperar_password', 'suplantar_empresa', 'exportar_informe', 'exportar_listado');

-- CreateTable
CREATE TABLE "Empresa" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "nit" TEXT NOT NULL,
    "nitSecundario" TEXT,
    "plan" "PlanSuscripcion" NOT NULL DEFAULT 'trial',
    "unidadPresion" "UnidadPresion" NOT NULL DEFAULT 'psi',
    "unidadProfundidad" "UnidadProfundidad" NOT NULL DEFAULT 'mm',
    "moneda" TEXT NOT NULL DEFAULT 'COP',
    "zonaHoraria" TEXT NOT NULL DEFAULT 'America/Bogota',
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "desactivadoEn" TIMESTAMP(3),

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sede" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "direccion" TEXT,
    "ciudad" TEXT,
    "departamento" TEXT,
    "nitSecundario" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "desactivadoEn" TIMESTAMP(3),

    CONSTRAINT "Sede_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT,
    "nombre" TEXT NOT NULL,
    "cedula" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT,
    "passwordHash" TEXT NOT NULL,
    "rol" "Rol" NOT NULL DEFAULT 'tecnico',
    "clienteId" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "passwordActualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intentosFallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoHasta" TIMESTAMP(3),
    "dobleFactorActivo" BOOLEAN NOT NULL DEFAULT false,
    "dobleFactorSecreto" TEXT,
    "ultimoAcceso" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "desactivadoEn" TIMESTAMP(3),

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsuarioSede" (
    "usuarioId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "esPrincipal" BOOLEAN NOT NULL DEFAULT false,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "asignadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsuarioSede_pkey" PRIMARY KEY ("usuarioId","sedeId")
);

-- CreateTable
CREATE TABLE "TokenRecuperacion" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "usadoEn" TIMESTAMP(3),
    "ipSolicitud" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenRecuperacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SesionUsuario" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "dispositivo" TEXT,
    "ip" TEXT,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "revocadaEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SesionUsuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SesionSuplantacion" (
    "id" TEXT NOT NULL,
    "superadminId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "ticketSoporte" TEXT,
    "iniciadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "terminadaEn" TIMESTAMP(3),

    CONSTRAINT "SesionSuplantacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "nit" TEXT NOT NULL,
    "nitSecundario" TEXT,
    "contacto" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "desactivadoEn" TIMESTAMP(3),

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SedeCliente" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "ciudad" TEXT,
    "departamento" TEXT,
    "telefono" TEXT,
    "nitSecundario" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "desactivadaEn" TIMESTAMP(3),

    CONSTRAINT "SedeCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracionEje" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "totalPosiciones" INTEGER NOT NULL,
    "vigente" BOOLEAN NOT NULL DEFAULT true,
    "reemplazadaPorId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfiguracionEje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosicionEje" (
    "id" TEXT NOT NULL,
    "configuracionEjeId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "eje" INTEGER NOT NULL,
    "lado" "LadoVehiculo" NOT NULL,
    "esInterna" BOOLEAN NOT NULL DEFAULT false,
    "esDireccional" BOOLEAN NOT NULL DEFAULT false,
    "tipoEje" TEXT NOT NULL DEFAULT 'multiuso',
    "psiObjetivo" DECIMAL(6,2),
    "profundidadMinima" DECIMAL(5,2),

    CONSTRAINT "PosicionEje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehiculo" (
    "id" TEXT NOT NULL,
    "sedeClienteId" TEXT NOT NULL,
    "configuracionEjeId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "placa" TEXT,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "marca" TEXT,
    "modelo" TEXT,
    "anio" INTEGER,
    "kmActual" INTEGER NOT NULL DEFAULT 0,
    "ultimoPM" TIMESTAMP(3),
    "proximoPM" TIMESTAMP(3),
    "estado" "EstadoVehiculo" NOT NULL DEFAULT 'operativo',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "desactivadoEn" TIMESTAMP(3),

    CONSTRAINT "Vehiculo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Marca" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT,
    "nombre" TEXT NOT NULL,
    "esGlobal" BOOLEAN NOT NULL DEFAULT false,
    "creadaEnCampo" BOOLEAN NOT NULL DEFAULT false,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desactivadoEn" TIMESTAMP(3),

    CONSTRAINT "Marca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Diseno" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT,
    "marcaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipoEje" TEXT NOT NULL DEFAULT 'multiuso',
    "esGlobal" BOOLEAN NOT NULL DEFAULT false,
    "creadaEnCampo" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desactivadoEn" TIMESTAMP(3),

    CONSTRAINT "Diseno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisenoMedida" (
    "id" TEXT NOT NULL,
    "disenoId" TEXT NOT NULL,
    "medida" TEXT NOT NULL,
    "profundidadOriginal" DECIMAL(5,2),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisenoMedida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Servicio" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "porLlanta" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoParche" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TipoParche_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrdenServicio" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "sedeClienteId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "tecnico_id" TEXT NOT NULL,
    "configuracionEjeId" TEXT NOT NULL,
    "folio" TEXT,
    "codigoReferencia" TEXT,
    "tipo" "TipoServicio" NOT NULL,
    "prioridad" "Prioridad" NOT NULL DEFAULT 'normal',
    "estado" "EstadoOrden" NOT NULL DEFAULT 'borrador',
    "fecha" DATE NOT NULL,
    "kilometraje" INTEGER,
    "hallazgos" TEXT,
    "accion" TEXT,
    "observaciones" TEXT,
    "notaCoordinador" TEXT,
    "motivoDevolucion" TEXT,
    "horasTrabajo" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "sinConductor" BOOLEAN NOT NULL DEFAULT false,
    "conductorNombre" TEXT,
    "conductorCedula" TEXT,
    "firmaNombre" TEXT,
    "firmaCedula" TEXT,
    "firmaUrl" TEXT,
    "firmaVersion" INTEGER,
    "firmaFechaHora" TIMESTAMP(3),
    "firmaCargo" TEXT,
    "firmaTrazo" TEXT,
    "firmaConsentimiento" TEXT,
    "clienteNombre" TEXT,
    "clienteNit" TEXT,
    "sedeClienteNombre" TEXT,
    "vehiculoCodigo" TEXT,
    "vehiculoPlaca" TEXT,
    "tecnicoNombre" TEXT,
    "tecnicoCedula" TEXT,
    "congeladoEn" TIMESTAMP(3),
    "aprobadoPorId" TEXT,
    "aprobadoEn" TIMESTAMP(3),
    "autoAprobada" BOOLEAN NOT NULL DEFAULT false,
    "enviadoClienteEn" DATE,
    "limiteCliente" DATE,
    "cierreTacito" BOOLEAN NOT NULL DEFAULT false,
    "motivoCierre" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "versionContenido" INTEGER NOT NULL DEFAULT 0,
    "clientRequestId" TEXT,
    "sincronizadoEn" TIMESTAMP(3),
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "anuladaEn" TIMESTAMP(3),

    CONSTRAINT "OrdenServicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrdenServicioVehiculo" (
    "ordenId" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,

    CONSTRAINT "OrdenServicioVehiculo_pkey" PRIMARY KEY ("ordenId","servicioId")
);

-- CreateTable
CREATE TABLE "OrdenEstadoHistorial" (
    "id" TEXT NOT NULL,
    "ordenId" TEXT NOT NULL,
    "estadoAnterior" "EstadoOrden",
    "estadoNuevo" "EstadoOrden" NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "motivo" TEXT,
    "visibleCliente" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrdenEstadoHistorial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlantaRegistro" (
    "id" TEXT NOT NULL,
    "ordenId" TEXT NOT NULL,
    "configuracionEjeId" TEXT NOT NULL,
    "posicion" INTEGER NOT NULL,
    "marcaId" TEXT,
    "disenoId" TEXT,
    "medida" TEXT,
    "numCalor" TEXT,
    "serial" TEXT,
    "dot" TEXT,
    "estadoLlanta" TEXT,
    "numParche" TEXT,
    "tipoParcheId" TEXT,
    "psiEncontrada" DECIMAL(6,2),
    "psiCalibrado" DECIMAL(6,2),
    "profundidad" DECIMAL(5,2),
    "observaciones" TEXT,
    "noIdentificada" BOOLEAN NOT NULL DEFAULT false,
    "motivoNoIdentificada" TEXT,
    "notaNoIdentificada" TEXT,
    "desPosicionOrigen" INTEGER,
    "desMarcaId" TEXT,
    "desDisenoId" TEXT,
    "desMedida" TEXT,
    "desNumCalor" TEXT,
    "desSerial" TEXT,
    "desDot" TEXT,
    "desProfundidad" DECIMAL(5,2),
    "desDestino" TEXT,
    "desDetalle" TEXT,
    "capturadoPorId" TEXT NOT NULL,
    "capturadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlantaRegistro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlantaServicio" (
    "llantaRegistroId" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,

    CONSTRAINT "LlantaServicio_pkey" PRIMARY KEY ("llantaRegistroId","servicioId")
);

-- CreateTable
CREATE TABLE "Foto" (
    "id" TEXT NOT NULL,
    "ordenId" TEXT,
    "llantaRegistroId" TEXT,
    "ruta" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tamanoBytes" INTEGER,
    "subidaPorId" TEXT,
    "confirmada" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subidaEn" TIMESTAMP(3),

    CONSTRAINT "Foto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recomendacion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "posicion" INTEGER,
    "texto" TEXT NOT NULL,
    "prioridad" "PrioridadRecomendacion" NOT NULL DEFAULT 'proxima',
    "estado" "EstadoRecomendacion" NOT NULL DEFAULT 'abierta',
    "origenOrdenId" TEXT NOT NULL,
    "creadaPorId" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltaEn" TIMESTAMP(3),
    "resueltaOrdenId" TEXT,

    CONSTRAINT "Recomendacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramacionRecurrente" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "sedeClienteId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "tipo" "TipoServicio" NOT NULL,
    "frecuencia" "Frecuencia" NOT NULL,
    "cada" INTEGER NOT NULL DEFAULT 1,
    "inicio" DATE NOT NULL,
    "proxima" DATE NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desactivadoEn" TIMESTAMP(3),

    CONSTRAINT "ProgramacionRecurrente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consecutivo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'OS',
    "prefijo" TEXT NOT NULL DEFAULT 'OS',
    "valor" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Consecutivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditoria" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT,
    "usuarioId" TEXT,
    "usuarioNombre" TEXT,
    "rol" TEXT,
    "entidad" TEXT,
    "entidadId" TEXT,
    "accion" "AccionAuditoria" NOT NULL,
    "detalle" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "viaSuplantacion" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperacionAplicada" (
    "empresaId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "respuesta" JSONB,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperacionAplicada_pkey" PRIMARY KEY ("empresaId","clave")
);

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_nit_key" ON "Empresa"("nit");

-- CreateIndex
CREATE INDEX "Empresa_activa_idx" ON "Empresa"("activa");

-- CreateIndex
CREATE INDEX "Sede_empresaId_activa_idx" ON "Sede"("empresaId", "activa");

-- CreateIndex
CREATE UNIQUE INDEX "Sede_empresaId_codigo_key" ON "Sede"("empresaId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Sede_id_empresaId_key" ON "Sede"("id", "empresaId");

-- CreateIndex
CREATE INDEX "Usuario_empresaId_rol_activo_idx" ON "Usuario"("empresaId", "rol", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_empresaId_email_key" ON "Usuario"("empresaId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_empresaId_cedula_key" ON "Usuario"("empresaId", "cedula");

-- CreateIndex
CREATE UNIQUE INDEX "UsuarioSede_usuarioId_sedeId_key" ON "UsuarioSede"("usuarioId", "sedeId");

-- CreateIndex
CREATE UNIQUE INDEX "TokenRecuperacion_tokenHash_key" ON "TokenRecuperacion"("tokenHash");

-- CreateIndex
CREATE INDEX "TokenRecuperacion_usuarioId_idx" ON "TokenRecuperacion"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "SesionUsuario_refreshHash_key" ON "SesionUsuario"("refreshHash");

-- CreateIndex
CREATE INDEX "SesionUsuario_usuarioId_revocadaEn_idx" ON "SesionUsuario"("usuarioId", "revocadaEn");

-- CreateIndex
CREATE INDEX "SesionSuplantacion_empresaId_iniciadaEn_idx" ON "SesionSuplantacion"("empresaId", "iniciadaEn");

-- CreateIndex
CREATE INDEX "Cliente_empresaId_activo_idx" ON "Cliente"("empresaId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_empresaId_nit_key" ON "Cliente"("empresaId", "nit");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_id_empresaId_key" ON "Cliente"("id", "empresaId");

-- CreateIndex
CREATE INDEX "SedeCliente_clienteId_activa_idx" ON "SedeCliente"("clienteId", "activa");

-- CreateIndex
CREATE UNIQUE INDEX "SedeCliente_id_clienteId_key" ON "SedeCliente"("id", "clienteId");

-- CreateIndex
CREATE INDEX "ConfiguracionEje_empresaId_vigente_idx" ON "ConfiguracionEje"("empresaId", "vigente");

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracionEje_empresaId_nombre_version_key" ON "ConfiguracionEje"("empresaId", "nombre", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracionEje_id_empresaId_key" ON "ConfiguracionEje"("id", "empresaId");

-- CreateIndex
CREATE INDEX "PosicionEje_configuracionEjeId_idx" ON "PosicionEje"("configuracionEjeId");

-- CreateIndex
CREATE UNIQUE INDEX "PosicionEje_configuracionEjeId_numero_key" ON "PosicionEje"("configuracionEjeId", "numero");

-- CreateIndex
CREATE INDEX "Vehiculo_sedeClienteId_activo_idx" ON "Vehiculo"("sedeClienteId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "Vehiculo_sedeClienteId_codigo_key" ON "Vehiculo"("sedeClienteId", "codigo");

-- CreateIndex
CREATE INDEX "Marca_empresaId_activa_idx" ON "Marca"("empresaId", "activa");

-- CreateIndex
CREATE UNIQUE INDEX "Marca_empresaId_nombre_key" ON "Marca"("empresaId", "nombre");

-- CreateIndex
CREATE INDEX "Diseno_marcaId_activo_idx" ON "Diseno"("marcaId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "Diseno_marcaId_nombre_key" ON "Diseno"("marcaId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "DisenoMedida_disenoId_medida_key" ON "DisenoMedida"("disenoId", "medida");

-- CreateIndex
CREATE INDEX "Servicio_empresaId_activo_idx" ON "Servicio"("empresaId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "Servicio_empresaId_codigo_key" ON "Servicio"("empresaId", "codigo");

-- CreateIndex
CREATE INDEX "TipoParche_empresaId_activo_idx" ON "TipoParche"("empresaId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "TipoParche_empresaId_nombre_key" ON "TipoParche"("empresaId", "nombre");

-- CreateIndex
CREATE INDEX "OrdenServicio_empresaId_estado_idx" ON "OrdenServicio"("empresaId", "estado");

-- CreateIndex
CREATE INDEX "OrdenServicio_empresaId_tecnico_id_estado_idx" ON "OrdenServicio"("empresaId", "tecnico_id", "estado");

-- CreateIndex
CREATE INDEX "OrdenServicio_empresaId_clienteId_fecha_idx" ON "OrdenServicio"("empresaId", "clienteId", "fecha");

-- CreateIndex
CREATE INDEX "OrdenServicio_empresaId_vehiculoId_estado_idx" ON "OrdenServicio"("empresaId", "vehiculoId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "OrdenServicio_empresaId_folio_key" ON "OrdenServicio"("empresaId", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "OrdenServicio_empresaId_clientRequestId_key" ON "OrdenServicio"("empresaId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "OrdenServicio_id_configuracionEjeId_key" ON "OrdenServicio"("id", "configuracionEjeId");

-- CreateIndex
CREATE INDEX "OrdenEstadoHistorial_ordenId_creadoEn_idx" ON "OrdenEstadoHistorial"("ordenId", "creadoEn");

-- CreateIndex
CREATE INDEX "LlantaRegistro_ordenId_idx" ON "LlantaRegistro"("ordenId");

-- CreateIndex
CREATE INDEX "LlantaRegistro_serial_idx" ON "LlantaRegistro"("serial");

-- CreateIndex
CREATE INDEX "LlantaRegistro_desSerial_idx" ON "LlantaRegistro"("desSerial");

-- CreateIndex
CREATE UNIQUE INDEX "LlantaRegistro_ordenId_posicion_key" ON "LlantaRegistro"("ordenId", "posicion");

-- CreateIndex
CREATE INDEX "Foto_ordenId_idx" ON "Foto"("ordenId");

-- CreateIndex
CREATE INDEX "Foto_llantaRegistroId_idx" ON "Foto"("llantaRegistroId");

-- CreateIndex
CREATE INDEX "Foto_confirmada_creadoEn_idx" ON "Foto"("confirmada", "creadoEn");

-- CreateIndex
CREATE INDEX "Recomendacion_empresaId_vehiculoId_estado_idx" ON "Recomendacion"("empresaId", "vehiculoId", "estado");

-- CreateIndex
CREATE INDEX "Recomendacion_empresaId_estado_prioridad_idx" ON "Recomendacion"("empresaId", "estado", "prioridad");

-- CreateIndex
CREATE INDEX "ProgramacionRecurrente_empresaId_activa_proxima_idx" ON "ProgramacionRecurrente"("empresaId", "activa", "proxima");

-- CreateIndex
CREATE UNIQUE INDEX "Consecutivo_empresaId_sedeId_tipo_key" ON "Consecutivo"("empresaId", "sedeId", "tipo");

-- CreateIndex
CREATE INDEX "Auditoria_empresaId_entidad_entidadId_idx" ON "Auditoria"("empresaId", "entidad", "entidadId");

-- CreateIndex
CREATE INDEX "Auditoria_empresaId_usuarioId_creadoEn_idx" ON "Auditoria"("empresaId", "usuarioId", "creadoEn");

-- CreateIndex
CREATE INDEX "Auditoria_empresaId_accion_creadoEn_idx" ON "Auditoria"("empresaId", "accion", "creadoEn");

-- CreateIndex
CREATE INDEX "OperacionAplicada_creadaEn_idx" ON "OperacionAplicada"("creadaEn");

-- AddForeignKey
ALTER TABLE "Sede" ADD CONSTRAINT "Sede_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioSede" ADD CONSTRAINT "UsuarioSede_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioSede" ADD CONSTRAINT "UsuarioSede_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenRecuperacion" ADD CONSTRAINT "TokenRecuperacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesionUsuario" ADD CONSTRAINT "SesionUsuario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesionSuplantacion" ADD CONSTRAINT "SesionSuplantacion_superadminId_fkey" FOREIGN KEY ("superadminId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SedeCliente" ADD CONSTRAINT "SedeCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfiguracionEje" ADD CONSTRAINT "ConfiguracionEje_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosicionEje" ADD CONSTRAINT "PosicionEje_configuracionEjeId_fkey" FOREIGN KEY ("configuracionEjeId") REFERENCES "ConfiguracionEje"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehiculo" ADD CONSTRAINT "Vehiculo_sedeClienteId_fkey" FOREIGN KEY ("sedeClienteId") REFERENCES "SedeCliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehiculo" ADD CONSTRAINT "Vehiculo_configuracionEjeId_fkey" FOREIGN KEY ("configuracionEjeId") REFERENCES "ConfiguracionEje"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Marca" ADD CONSTRAINT "Marca_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diseno" ADD CONSTRAINT "Diseno_marcaId_fkey" FOREIGN KEY ("marcaId") REFERENCES "Marca"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisenoMedida" ADD CONSTRAINT "DisenoMedida_disenoId_fkey" FOREIGN KEY ("disenoId") REFERENCES "Diseno"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Servicio" ADD CONSTRAINT "Servicio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoParche" ADD CONSTRAINT "TipoParche_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenServicio" ADD CONSTRAINT "OrdenServicio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenServicio" ADD CONSTRAINT "OrdenServicio_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenServicio" ADD CONSTRAINT "OrdenServicio_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenServicio" ADD CONSTRAINT "OrdenServicio_sedeClienteId_fkey" FOREIGN KEY ("sedeClienteId") REFERENCES "SedeCliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenServicio" ADD CONSTRAINT "OrdenServicio_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "Vehiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenServicio" ADD CONSTRAINT "OrdenServicio_tecnico_id_fkey" FOREIGN KEY ("tecnico_id") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenServicio" ADD CONSTRAINT "OrdenServicio_configuracionEjeId_fkey" FOREIGN KEY ("configuracionEjeId") REFERENCES "ConfiguracionEje"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenServicio" ADD CONSTRAINT "OrdenServicio_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenServicio" ADD CONSTRAINT "OrdenServicio_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenServicioVehiculo" ADD CONSTRAINT "OrdenServicioVehiculo_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "OrdenServicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenEstadoHistorial" ADD CONSTRAINT "OrdenEstadoHistorial_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "OrdenServicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlantaRegistro" ADD CONSTRAINT "LlantaRegistro_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "OrdenServicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlantaRegistro" ADD CONSTRAINT "LlantaRegistro_configuracionEjeId_posicion_fkey" FOREIGN KEY ("configuracionEjeId", "posicion") REFERENCES "PosicionEje"("configuracionEjeId", "numero") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlantaRegistro" ADD CONSTRAINT "LlantaRegistro_tipoParcheId_fkey" FOREIGN KEY ("tipoParcheId") REFERENCES "TipoParche"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlantaRegistro" ADD CONSTRAINT "LlantaRegistro_capturadoPorId_fkey" FOREIGN KEY ("capturadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlantaServicio" ADD CONSTRAINT "LlantaServicio_llantaRegistroId_fkey" FOREIGN KEY ("llantaRegistroId") REFERENCES "LlantaRegistro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlantaServicio" ADD CONSTRAINT "LlantaServicio_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Foto" ADD CONSTRAINT "Foto_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "OrdenServicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Foto" ADD CONSTRAINT "Foto_llantaRegistroId_fkey" FOREIGN KEY ("llantaRegistroId") REFERENCES "LlantaRegistro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recomendacion" ADD CONSTRAINT "Recomendacion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recomendacion" ADD CONSTRAINT "Recomendacion_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recomendacion" ADD CONSTRAINT "Recomendacion_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "Vehiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recomendacion" ADD CONSTRAINT "Recomendacion_origenOrdenId_fkey" FOREIGN KEY ("origenOrdenId") REFERENCES "OrdenServicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recomendacion" ADD CONSTRAINT "Recomendacion_creadaPorId_fkey" FOREIGN KEY ("creadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramacionRecurrente" ADD CONSTRAINT "ProgramacionRecurrente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramacionRecurrente" ADD CONSTRAINT "ProgramacionRecurrente_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramacionRecurrente" ADD CONSTRAINT "ProgramacionRecurrente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramacionRecurrente" ADD CONSTRAINT "ProgramacionRecurrente_sedeClienteId_fkey" FOREIGN KEY ("sedeClienteId") REFERENCES "SedeCliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramacionRecurrente" ADD CONSTRAINT "ProgramacionRecurrente_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "Vehiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consecutivo" ADD CONSTRAINT "Consecutivo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consecutivo" ADD CONSTRAINT "Consecutivo_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===== manual.sql =====
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
-- Encadenadas, hacen estructuralmente imposible que una orden de Aistectire
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


-- ===== rls.sql =====
-- ============================================================================
-- Row Level Security — aislamiento entre empresas
-- ============================================================================
-- Se aplica DESPUÉS de manual.sql, en la misma migración inicial.
--
-- Por qué RLS y no solo un WHERE en cada consulta:
--
-- El aislamiento no puede depender de que el desarrollador recuerde filtrar.
-- Un solo endpoint escrito con prisa, un script de migración o una carga
-- masiva bastan para que una empresa vea los datos de otra. Con RLS la
-- política la aplica el motor: aunque la consulta no filtre, PostgreSQL no
-- devuelve filas ajenas.
--
-- FORCE es indispensable: sin él, el dueño de las tablas —que suele ser el
-- mismo usuario con el que se conecta la aplicación— se salta las políticas.
--
-- Cómo lo usa el backend: al abrir cada transacción ejecuta
--   SET LOCAL app.empresa_id = '<id del token>';
--   SET LOCAL app.rol        = '<rol del token>';
--   SET LOCAL app.usuario_id = '<id del usuario>';
--   SET LOCAL app.cliente_id = '<clienteId, solo si rol = cliente>';
-- LOCAL es importante: el valor muere con la transacción y no se filtra a la
-- siguiente petición que reutilice la conexión del pool.
-- ============================================================================

-- ── Rol de la aplicación ────────────────────────────────────────────────────
-- La API NO se conecta como dueño de las tablas. Un rol aparte hace que FORCE
-- tenga efecto y limita el daño si se filtran las credenciales.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiretrack_app') THEN
    CREATE ROLE tiretrack_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO tiretrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tiretrack_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tiretrack_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tiretrack_app;

-- ════════════════════════════════════════════════════════════════════════════
-- ROL DE AUTENTICACIÓN
-- ════════════════════════════════════════════════════════════════════════════
-- @seccion:acceso
--
-- El login ocurre ANTES de saber la empresa: hay que buscar al usuario por
-- correo sin contexto. Con las políticas de empresa, esa consulta devuelve
-- cero filas y el login respondería "credenciales incorrectas" a todo el
-- mundo.
--
-- Se resuelve con un rol aparte para el módulo de acceso, con permisos
-- ÚNICAMENTE sobre las cinco tablas que la autenticación necesita.
--
-- Se descartó `BYPASSRLS`: saltarse las políticas deja leer TODA la base si
-- hay un fallo en el módulo de acceso. Aquí el rol simplemente no tiene
-- permiso sobre las tablas operativas, así que ni una inyección de SQL en
-- ese módulo alcanzaría una orden de servicio.
--
-- También se descartaron funciones SECURITY DEFINER por operación: serían
-- más estrictas (columna por columna), pero obligan a mantener nueve
-- consultas duplicadas en SQL, que es exactamente el tipo de duplicación que
-- termina desincronizándose.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiretrack_auth') THEN
    CREATE ROLE tiretrack_auth NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO tiretrack_auth;

-- Solo lo que la autenticación hace, y nada más:
GRANT SELECT, UPDATE          ON "Usuario"            TO tiretrack_auth;
GRANT SELECT, INSERT, UPDATE  ON "SesionUsuario"      TO tiretrack_auth;
GRANT SELECT, INSERT, UPDATE  ON "TokenRecuperacion"  TO tiretrack_auth;
GRANT INSERT                  ON "Auditoria"          TO tiretrack_auth;
-- Para decir a qué empresa pertenece cada usuario cuando el correo está en
-- varias y hay que preguntar cuál.
GRANT SELECT                  ON "Empresa"            TO tiretrack_auth;

-- Las tablas nuevas NO le llegan por defecto: el bloque de arriba solo
-- concede a tiretrack_app. Agregar una tabla al módulo de acceso obliga a
-- escribir su GRANT aquí, a la vista.

-- Políticas que le abren esas tablas completas. Son permisivas y se combinan
-- con OR: no tocan el aislamiento del rol de aplicación.
DROP POLICY IF EXISTS acceso_autenticacion ON "Usuario";
CREATE POLICY acceso_autenticacion ON "Usuario"
  FOR ALL TO tiretrack_auth USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS acceso_autenticacion ON "SesionUsuario";
CREATE POLICY acceso_autenticacion ON "SesionUsuario"
  FOR ALL TO tiretrack_auth USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS acceso_autenticacion ON "TokenRecuperacion";
CREATE POLICY acceso_autenticacion ON "TokenRecuperacion"
  FOR ALL TO tiretrack_auth USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS acceso_autenticacion ON "Auditoria";
CREATE POLICY acceso_autenticacion ON "Auditoria"
  FOR INSERT TO tiretrack_auth WITH CHECK (true);
-- @fin:acceso

-- ── Funciones de contexto ───────────────────────────────────────────────────
-- Leen lo que el backend fijó al abrir la transacción. El segundo argumento
-- en true evita que reviente si la variable no está: devuelve NULL, y una
-- política que compara contra NULL no deja pasar nada. Falla cerrado.

CREATE OR REPLACE FUNCTION app_empresa_id() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.empresa_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_rol() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.rol', true), '')
$$;

CREATE OR REPLACE FUNCTION app_usuario_id() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.usuario_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_cliente_id() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.cliente_id', true), '')
$$;

-- ── La propia tabla de empresas ─────────────────────────────────────────────
-- Sin política aquí, cualquier empresa podría listar a todas las demás con
-- sus nombres y NIT. La tabla del tenant también es dato del tenant.

ALTER TABLE "Empresa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Empresa" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "Empresa";
CREATE POLICY aislamiento_empresa ON "Empresa"
  USING (id = app_empresa_id())
  WITH CHECK (id = app_empresa_id());

-- ── Tablas con empresaId directo ────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Sede', 'Cliente', 'ConfiguracionEje', 'Servicio', 'TipoParche',
    'OrdenServicio', 'Recomendacion', 'ProgramacionRecurrente', 'Consecutivo',
    -- Sin aislar, una empresa podría ver o bloquear las claves de otra.
    'OperacionAplicada',
    -- Faltaba: con los permisos por defecto del rol de aplicación, cualquier
    -- empresa leía las suplantaciones de las demás, con motivo y ticket.
    'SesionSuplantacion'
  ]
  LOOP
    -- Se salta lo que no exista. Sin esto el bucle es atómico: una sola
    -- tabla faltante —un nombre mal escrito, por ejemplo— haría fallar el
    -- bloque entero y NINGUNA tabla quedaría con RLS, en silencio.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_class
      WHERE relname = t AND relnamespace = 'public'::regnamespace AND relkind = 'r'
    );

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

-- ── Usuario: además, el superadmin no pertenece a ninguna empresa ───────────

ALTER TABLE "Usuario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Usuario" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "Usuario";
CREATE POLICY aislamiento_empresa ON "Usuario"
  USING ("empresaId" = app_empresa_id())
  WITH CHECK ("empresaId" = app_empresa_id());

-- ── Tablas hijas: heredan el aislamiento por su padre ───────────────────────
-- No llevan empresaId propio. La política verifica que el padre sea visible,
-- lo que a su vez aplica la política del padre.

ALTER TABLE "SedeCliente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SedeCliente" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "SedeCliente";
CREATE POLICY aislamiento_empresa ON "SedeCliente"
  USING (EXISTS (SELECT 1 FROM "Cliente" c WHERE c.id = "clienteId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Cliente" c WHERE c.id = "clienteId"));

ALTER TABLE "Vehiculo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vehiculo" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "Vehiculo";
CREATE POLICY aislamiento_empresa ON "Vehiculo"
  USING (EXISTS (SELECT 1 FROM "SedeCliente" s WHERE s.id = "sedeClienteId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "SedeCliente" s WHERE s.id = "sedeClienteId"));

ALTER TABLE "PosicionEje" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosicionEje" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "PosicionEje";
CREATE POLICY aislamiento_empresa ON "PosicionEje"
  USING (EXISTS (SELECT 1 FROM "ConfiguracionEje" c WHERE c.id = "configuracionEjeId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "ConfiguracionEje" c WHERE c.id = "configuracionEjeId"));

ALTER TABLE "LlantaRegistro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LlantaRegistro" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "LlantaRegistro";
CREATE POLICY aislamiento_empresa ON "LlantaRegistro"
  USING (EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"));

ALTER TABLE "LlantaServicio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LlantaServicio" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "LlantaServicio";
CREATE POLICY aislamiento_empresa ON "LlantaServicio"
  USING (EXISTS (SELECT 1 FROM "LlantaRegistro" l WHERE l.id = "llantaRegistroId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "LlantaRegistro" l WHERE l.id = "llantaRegistroId"));

ALTER TABLE "OrdenServicioVehiculo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrdenServicioVehiculo" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "OrdenServicioVehiculo";
CREATE POLICY aislamiento_empresa ON "OrdenServicioVehiculo"
  USING (EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"));

ALTER TABLE "OrdenEstadoHistorial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrdenEstadoHistorial" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "OrdenEstadoHistorial";
CREATE POLICY aislamiento_empresa ON "OrdenEstadoHistorial"
  USING (EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"));

ALTER TABLE "Foto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Foto" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "Foto";
CREATE POLICY aislamiento_empresa ON "Foto"
  USING (
    ("ordenId" IS NOT NULL AND EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"))
    OR ("llantaRegistroId" IS NOT NULL AND EXISTS (SELECT 1 FROM "LlantaRegistro" l WHERE l.id = "llantaRegistroId"))
  )
  WITH CHECK (
    ("ordenId" IS NOT NULL AND EXISTS (SELECT 1 FROM "OrdenServicio" o WHERE o.id = "ordenId"))
    OR ("llantaRegistroId" IS NOT NULL AND EXISTS (SELECT 1 FROM "LlantaRegistro" l WHERE l.id = "llantaRegistroId"))
  );

ALTER TABLE "UsuarioSede" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsuarioSede" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "UsuarioSede";
CREATE POLICY aislamiento_empresa ON "UsuarioSede"
  USING (EXISTS (SELECT 1 FROM "Sede" s WHERE s.id = "sedeId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Sede" s WHERE s.id = "sedeId"));

-- ── Catálogo: lo global lo ve todo el mundo, lo propio solo su empresa ──────

ALTER TABLE "Marca" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Marca" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "Marca";
CREATE POLICY aislamiento_empresa ON "Marca"
  USING ("esGlobal" = true OR "empresaId" = app_empresa_id())
  -- Una empresa no puede crear marcas globales ni marcas de otra empresa
  WITH CHECK ("empresaId" = app_empresa_id());

ALTER TABLE "Diseno" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Diseno" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "Diseno";
CREATE POLICY aislamiento_empresa ON "Diseno"
  USING (EXISTS (SELECT 1 FROM "Marca" m WHERE m.id = "marcaId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Marca" m WHERE m.id = "marcaId"));

ALTER TABLE "DisenoMedida" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DisenoMedida" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aislamiento_empresa ON "DisenoMedida";
CREATE POLICY aislamiento_empresa ON "DisenoMedida"
  USING (EXISTS (SELECT 1 FROM "Diseno" d WHERE d.id = "disenoId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Diseno" d WHERE d.id = "disenoId"));

-- ── Auditoría: se lee de la propia empresa, y NO se modifica ni se borra ────
-- Un registro de auditoría que se puede alterar no sirve como evidencia.

ALTER TABLE "Auditoria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Auditoria" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auditoria_lectura ON "Auditoria";
DROP POLICY IF EXISTS auditoria_escritura ON "Auditoria";
CREATE POLICY auditoria_lectura ON "Auditoria"
  FOR SELECT USING ("empresaId" = app_empresa_id());
CREATE POLICY auditoria_escritura ON "Auditoria"
  FOR INSERT WITH CHECK ("empresaId" = app_empresa_id());

REVOKE UPDATE, DELETE ON "Auditoria" FROM tiretrack_app;

-- ── Sesiones y tokens: cada usuario solo los suyos ──────────────────────────

ALTER TABLE "SesionUsuario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SesionUsuario" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sesion_propia ON "SesionUsuario";
CREATE POLICY sesion_propia ON "SesionUsuario"
  USING ("usuarioId" = app_usuario_id())
  WITH CHECK ("usuarioId" = app_usuario_id());

ALTER TABLE "TokenRecuperacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TokenRecuperacion" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS token_propio ON "TokenRecuperacion";
CREATE POLICY token_propio ON "TokenRecuperacion"
  USING ("usuarioId" = app_usuario_id())
  WITH CHECK ("usuarioId" = app_usuario_id());

-- ── Portal del cliente ──────────────────────────────────────────────────────
-- El usuario cliente es el único que entra desde FUERA de la empresa. Su
-- aislamiento no puede depender de un filtro en la consulta: si se olvida
-- en un endpoint, un cliente ve la flota de otro.
--
-- La política se suma a la de empresa (en PostgreSQL las políticas
-- permisivas se combinan con OR, así que esta va como RESTRICTIVE para que
-- se aplique en AND).

DROP POLICY IF EXISTS cliente_solo_lo_suyo ON "OrdenServicio";
CREATE POLICY cliente_solo_lo_suyo ON "OrdenServicio"
  AS RESTRICTIVE
  USING (app_rol() <> 'cliente' OR "clienteId" = app_cliente_id());

DROP POLICY IF EXISTS cliente_solo_lo_suyo ON "Cliente";
CREATE POLICY cliente_solo_lo_suyo ON "Cliente"
  AS RESTRICTIVE
  USING (app_rol() <> 'cliente' OR id = app_cliente_id());

DROP POLICY IF EXISTS cliente_solo_lo_suyo ON "SedeCliente";
CREATE POLICY cliente_solo_lo_suyo ON "SedeCliente"
  AS RESTRICTIVE
  USING (app_rol() <> 'cliente' OR "clienteId" = app_cliente_id());

-- El cliente nunca escribe datos operativos: solo aprueba u objeta, y eso
-- pasa por la API con sus propias reglas.
DROP POLICY IF EXISTS cliente_no_escribe ON "LlantaRegistro";
CREATE POLICY cliente_no_escribe ON "LlantaRegistro"
  AS RESTRICTIVE
  FOR ALL
  USING (true)
  WITH CHECK (app_rol() <> 'cliente');

-- ── El técnico solo ve sus órdenes asignadas ────────────────────────────────
-- Decisión tomada: el técnico ve los CLIENTES de la empresa, pero solo las
-- ÓRDENES asignadas a él.

DROP POLICY IF EXISTS tecnico_solo_asignadas ON "OrdenServicio";
CREATE POLICY tecnico_solo_asignadas ON "OrdenServicio"
  AS RESTRICTIVE
  USING (app_rol() <> 'tecnico' OR tecnico_id = app_usuario_id());
