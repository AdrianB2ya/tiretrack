/**
 * Respuestas del servidor para las pantallas en línea, en las capturas: con
 * listas vacías no se ve cómo quedan las tarjetas, los textos largos ni los
 * colores de cada estado.
 */
const llanta = (i: number, estado: string, extra: Record<string, unknown> = {}) => ({
  id: `ll-${i}`, serial: `MX10${i}23`, numeroInterno: `A-${10 + i}`, numCalor: null, marca: "Michelin", diseno: "XDN-2",
  medida: "295/80R22.5", estado, clienteNombre: "Transportes Reyna", sedeNombre: estado === "bodega" ? "Fundación" : null,
  vehiculoCodigo: estado === "montada" ? "CA-12" : null, posicion: estado === "montada" ? i : null, vidas: i % 3, ...extra,
});

const RESPUESTAS: [RegExp, unknown][] = [
  [/^\/usuarios$/, [
    { id: "u1", nombre: "Carlos Méndez", email: "carlos@asistectire.com", rol: "tecnico", activo: true, sedes: ["sede-fun"], sinActivar: false },
    { id: "u2", nombre: "Ana Torres", email: "ana.torres@asistectire.com", rol: "tecnico", activo: true, sedes: ["sede-fun"], sinActivar: true },
    { id: "u3", nombre: "Jorge Ramírez", email: "jorge@asistectire.com", rol: "coordinador", activo: true, sedes: ["sede-fun"], sinActivar: false },
    { id: "u4", nombre: "Luis Reyna", email: "luis@transportesreyna.com", rol: "cliente", activo: false, sedes: [], sinActivar: false },
  ]],
  [/^\/sedes$/, [
    { id: "sede-fun", nombre: "Fundación", codigo: "FUN", ciudad: "Fundación" },
    { id: "sede-vdp", nombre: "Valledupar", codigo: "VDP", ciudad: null },
  ]],
  [/^\/alertas$/, [
    { vehiculoId: "veh-1", vehiculoCodigo: "CA-12", vehiculoPlaca: "SXK482", clienteNombre: "Transportes Reyna", posicion: 3, serial: "MX10323", tipo: "cambio_inmediato", severidad: "critica", mensaje: "2,8 mm: llegó al límite de 3 mm" },
    { vehiculoId: "veh-1", vehiculoCodigo: "CA-12", vehiculoPlaca: "SXK482", clienteNombre: "Transportes Reyna", posicion: 6, serial: "MX10623", tipo: "programar_cambio", severidad: "alta", mensaje: "4,5 mm: programar el cambio antes de 5 mm" },
    { vehiculoId: "veh-2", vehiculoCodigo: "CA-15", vehiculoPlaca: "TRK903", clienteNombre: "Cementos del Caribe", posicion: 1, serial: null, tipo: "dot_vencido", severidad: "critica", mensaje: "Fabricada en 2018: vencida desde 09/2024" },
    { vehiculoId: "veh-2", vehiculoCodigo: "CA-15", vehiculoPlaca: "TRK903", clienteNombre: "Cementos del Caribe", posicion: 2, serial: "BS7781", tipo: "diferencia_lados", severidad: "media", mensaje: "Diferencia de lados 1,5 mm: alinear, revisar calibración y balanceo" },
  ]],
  [/^\/llantas\/stock$/, [
    { sedeId: "sede-fun", sedeNombre: "Fundación", medida: "295/80R22.5", cantidad: 2, minimo: 6 },
    { sedeId: "sede-fun", sedeNombre: "Fundación", medida: "11R22.5", cantidad: 8, minimo: 4 },
    { sedeId: "sede-vdp", sedeNombre: "Valledupar", medida: "295/80R22.5", cantidad: 0, minimo: null },
  ]],
  [/^\/llantas\/ll-1$/, {
    llanta: llanta(1, "montada"),
    vidas: [{ numero: 0, banda: null, reencauchadora: null, costo: 1850000, profundidadInicial: 16, inicio: "2026-03-02" }],
    movimientos: [
      { tipo: "montaje", fecha: "2026-03-02", posicion: 3, kilometraje: 41200, detalle: null, vehiculoCodigo: "CA-12", sedeNombre: null, folio: "OS-FUN-000003" },
      { tipo: "rotacion", fecha: "2026-07-14", posicion: 1, kilometraje: 62000, detalle: null, vehiculoCodigo: "CA-12", sedeNombre: null, folio: "OS-FUN-000007" },
    ],
    mediciones: [
      { fecha: "2026-03-02", folio: "OS-FUN-000003", vehiculoCodigo: "CA-12", posicion: 3, profundidad: 16, kilometraje: 41200 },
      { fecha: "2026-10-06", folio: "OS-FUN-000011", vehiculoCodigo: "CA-12", posicion: 1, profundidad: 9, kilometraje: 78900 },
    ],
    indicadores: { profInicial: 16, profBaja: 3, mmDesgaste: 7, pctRodado: 53.8, referencia: "PROYECCIÓN 50% - 70%", kmRecorrido: 37700, kmPorMm: 5385.7, proyeccionKm: 70014, costo: 1850000, cpk: 26.4 },
  }],
  [/^\/llantas(\?|$)/, [llanta(1, "montada"), llanta(2, "bodega"), llanta(3, "reencauche"), llanta(4, "desecho", { serial: null })]],
  [/^\/reclamos$/, [
    { id: "r1", proveedor: "Michelin", motivoRetiro: "separacion", estado: "enviado", fecha: "2026-09-20", valorReconocido: null, notas: "2026-09-21: enviado con fotos", llantaId: "ll-3", llanta: "MX10323", clienteNombre: "Transportes Reyna" },
    { id: "r2", proveedor: "Bridgestone", motivoRetiro: "falla_reencauche", estado: "aprobado", fecha: "2026-08-02", valorReconocido: 450000, notas: null, llantaId: "ll-4", llanta: "BS7781", clienteNombre: "Cementos del Caribe" },
  ]],
  [/^\/tablero/, {
    llantas: 48,
    porMarca: [
      { grupo: "Michelin", llantas: 30, kmPorMm: 5400, proyeccionKm: 70200, cpk: 26.4 },
      { grupo: "Bridgestone", llantas: 12, kmPorMm: 4800, proyeccionKm: 62400, cpk: 29.8 },
      { grupo: "Goodyear", llantas: 6, kmPorMm: null, proyeccionKm: null, cpk: null },
    ],
    porDiseno: [{ grupo: "Michelin XDN-2", llantas: 30, kmPorMm: 5400, proyeccionKm: 70200, cpk: 26.4 }],
    porPosicion: [{ grupo: "1", llantas: 8, kmPorMm: 6100, proyeccionKm: 79300, cpk: 23.1 }],
    compras: { yaPedidas: [{ medida: "295/80R22.5", cantidad: 3 }], en30: [{ medida: "295/80R22.5", cantidad: 2 }], en60: [], en90: [{ medida: "11R22.5", cantidad: 4 }], sinEstimar: 7 },
    vidaUtil: { retiradas: 9, porMarca: [{ grupo: "Michelin", llantas: 6, kmPromedio: 84000 }], porDiseno: [] },
  }],
  [/^\/auditoria/, { registros: [
    { id: "a1", usuarioId: "u3", usuarioNombre: "Jorge Ramírez", rol: "coordinador", accion: "exportar_informe", detalle: { registros: 120, origen: "csv" }, ip: "181.52.10.4", creadoEn: "2026-10-16T14:05:00.000Z" },
    { id: "a2", usuarioId: null, usuarioNombre: null, rol: null, accion: "cambiar_estado", detalle: { folio: "OS-FUN-000009", motivo: "cierre tácito" }, ip: null, creadoEn: "2026-10-16T11:00:00.000Z" },
    { id: "a3", usuarioId: "u9", usuarioNombre: "Soporte Plataforma", rol: "administrador", accion: "suplantar_empresa", detalle: { ticket: "SOP-1042" }, ip: "10.0.0.1", viaSuplantacion: true, creadoEn: "2026-10-15T20:30:00.000Z" },
  ], siguiente: null }],
  [/^\/informe\/causas-retiro/, {
    total: 12,
    porMotivo: [{ motivo: "desgaste_normal", cantidad: 7 }, { motivo: "corte", cantidad: 3 }, { motivo: "separacion", cantidad: 2 }],
    porMarca: [{ grupo: "Michelin", motivo: "desgaste_normal", cantidad: 5 }, { grupo: "Bridgestone", motivo: "corte", cantidad: 3 }],
    porPosicion: [{ grupo: "1", motivo: "desgaste_normal", cantidad: 4 }],
    porVehiculo: [{ grupo: "CA-12", motivo: "corte", cantidad: 2 }],
  }],
  [/^\/programaciones$/, [
    { id: "p-1", activa: true, clienteNombre: "Transportes Reyna", sedeClienteNombre: "Planta Fundación", sedeCodigo: "FUN", sedeId: "sede-fun", vehiculoCodigo: "CA-12", descripcion: "CA-12 · SXK482", tipo: "preventivo", frecuencia: "mensual", cada: 1, proxima: "2026-11-02", tecnicoId: "u-tec1", tecnicoNombre: "Carlos Méndez", ultimoAviso: null },
  ]],
  [/^\/empresa\/limites$/, { cambioInmediato: 3, programarCambio: 5 }],
  [/^\/informe\/resumen/, { registros: 0, ordenes: 0, sinCerrar: 0, filas: [] }],
];

export async function datosEnLinea(_metodo: string, ruta: string): Promise<unknown> {
  const r = RESPUESTAS.find(([re]) => re.test(ruta));
  return { ok: true, datos: r ? r[1] : [] };
}
