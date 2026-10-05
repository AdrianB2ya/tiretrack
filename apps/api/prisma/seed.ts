import { CATALOGO_SERVICIOS } from "@tiretrack/domain";
/**
 * Datos semilla.
 *
 * Crea una empresa completa y utilizable: sedes, usuarios de cada rol,
 * catálogo, un cliente con vehículos y las configuraciones de eje. Es lo
 * mínimo para que alguien pueda crear una orden apenas termina de instalar.
 *
 *   npm run seed --workspace=@tiretrack/api
 *
 * Los ids son fijos y legibles a propósito: facilitan depurar y hacen que
 * volver a sembrar sea idempotente.
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * UUID determinista a partir de un nombre legible.
 *
 * Los contratos exigen UUID en todo id (`zId`): con ids como "sede-fun" o
 * "veh-ca12", toda operación del celular que los referencie —crear una orden
 * sobre ese vehículo, por ejemplo— se rechazaba y quedaba apartada. Es el
 * mismo defecto que la tarea 5.8 corrigió en la semilla de pruebas.
 *
 * Determinista (UUID v5) para que volver a sembrar siga siendo idempotente,
 * y con el nombre legible en el código para poder depurar.
 */
const ESPACIO_SEMILLA = "tiretrack-semilla";
function uid(nombre: string): string {
  const h = createHash("sha1").update(`${ESPACIO_SEMILLA}:${nombre}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50; // versión 5
  h[8] = (h[8]! & 0x3f) | 0x80; // variante RFC 4122
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const EMPRESA = uid("emp-aistectire");

/** Configuraciones de eje con sus umbrales por tipo. */
const CONFIGURACIONES = [
  {
    id: "cfg-montacargas-v1",
    nombre: "Montacargas",
    ejes: [
      { eje: 1, izq: [1], der: [2], tipo: "direccional", psi: 110, profMin: 3.0 },
      { eje: 2, izq: [3], der: [4], tipo: "traccion", psi: 105, profMin: 2.5 },
    ],
  },
  {
    id: "cfg-volqueta-v1",
    nombre: "Volqueta doble troque",
    ejes: [
      { eje: 1, izq: [1], der: [2], tipo: "direccional", psi: 110, profMin: 3.0 },
      { eje: 2, izq: [3, 4], der: [5, 6], tipo: "traccion", psi: 105, profMin: 2.5 },
      { eje: 3, izq: [7, 8], der: [9, 10], tipo: "traccion", psi: 105, profMin: 2.5 },
    ],
  },
  {
    id: "cfg-tractocamion-v1",
    nombre: "Tractocamión 6x4",
    ejes: [
      { eje: 1, izq: [1], der: [2], tipo: "direccional", psi: 110, profMin: 3.0 },
      { eje: 2, izq: [3, 4], der: [5, 6], tipo: "traccion", psi: 105, profMin: 2.5 },
      { eje: 3, izq: [7, 8], der: [9, 10], tipo: "traccion", psi: 105, profMin: 2.5 },
      { eje: 4, izq: [11, 12], der: [13, 14], tipo: "arrastre", psi: 100, profMin: 2.0 },
      { eje: 5, izq: [15, 16], der: [17, 18], tipo: "arrastre", psi: 100, profMin: 2.0 },
      { eje: 6, izq: [19, 20], der: [21, 22], tipo: "arrastre", psi: 100, profMin: 2.0 },
    ],
  },
];

/** Marcas y diseños globales: los mantiene la plataforma. */
const CATALOGO_GLOBAL = [
  {
    id: "mar-michelin",
    nombre: "Michelin",
    disenos: [
      {
        id: "dis-xzy3",
        nombre: "XZY-3",
        tipoEje: "direccional",
        medidas: [
          { medida: "295/80R22.5", prof: 16.0 },
          { medida: "11R22.5", prof: 14.5 },
          { medida: "315/80R22.5", prof: 16.5 },
        ],
      },
      {
        id: "dis-xdn2",
        nombre: "XDN-2",
        tipoEje: "traccion",
        medidas: [
          { medida: "295/80R22.5", prof: 19.5 },
          { medida: "11R22.5", prof: 18.0 },
        ],
      },
      {
        id: "dis-xte2",
        nombre: "XTE-2",
        tipoEje: "arrastre",
        medidas: [{ medida: "385/65R22.5", prof: 14.0 }],
      },
    ],
  },
  {
    id: "mar-bridgestone",
    nombre: "Bridgestone",
    disenos: [
      {
        id: "dis-r268",
        nombre: "R268",
        tipoEje: "direccional",
        medidas: [
          { medida: "295/80R22.5", prof: 14.5 },
          { medida: "11R22.5", prof: 13.0 },
        ],
      },
      {
        id: "dis-m840",
        nombre: "M840",
        tipoEje: "traccion",
        medidas: [{ medida: "295/80R22.5", prof: 20.0 }],
      },
    ],
  },
  {
    id: "mar-goodyear",
    nombre: "Goodyear",
    disenos: [
      {
        id: "dis-g287",
        nombre: "G287 MSA",
        tipoEje: "traccion",
        medidas: [{ medida: "295/80R22.5", prof: 21.0 }],
      },
      {
        id: "dis-kmaxs",
        nombre: "KMAX S",
        tipoEje: "direccional",
        medidas: [{ medida: "295/80R22.5", prof: 15.5 }],
      },
    ],
  },
];

/** Orden y nombres tomados del informe operativo. */
/**
 * Los servicios salen del catálogo del dominio, no de una lista propia. Antes
 * esta era una copia hecha a mano: coincidía con el dominio por cuidado, y el
 * día que alguien corrigiera una tilde en un solo lado, el contrato empezaría
 * a rechazar mediciones.
 */
const SERVICIOS = CATALOGO_SERVICIOS;

const TIPOS_PARCHE = [
  "Parche radial (frío)",
  "Parche diagonal",
  "Hongo / parche-vástago",
  "Vulcanizado (caliente)",
  "Sellante",
];

/**
 * Hash de ejemplo. En producción lo genera el flujo de alta de usuario, que
 * envía un correo para que la persona defina su propia contraseña: aquí
 * nunca se asignan contraseñas.
 */
const HASH_SEMILLA = "$2b$12$SEMILLA.NO.USAR.EN.PRODUCCION.CAMBIAR.AL.PRIMER.INGRESO";

async function main() {
  console.warn("Sembrando datos…");

  await prisma.empresa.upsert({
    where: { id: EMPRESA },
    update: {},
    create: {
      id: EMPRESA,
      nombre: "Aistectire S.A.S.",
      nit: "901.234.567-8",
      plan: "profesional",
      unidadPresion: "psi",
      unidadProfundidad: "mm",
    },
  });

  // ── Sedes. El código entra en el folio: OS-FUN-000123 ─────────────────────
  const sedes = [
    { id: "sede-fun", nombre: "Sede Fundación", codigo: "FUN", ciudad: "Fundación", dep: "Magdalena" },
    { id: "sede-vdp", nombre: "Sede Valledupar", codigo: "VDP", ciudad: "Valledupar", dep: "Cesar" },
    { id: "sede-ct01", nombre: "Carro Taller 01", codigo: "CT01", ciudad: "Móvil", dep: "Magdalena" },
  ];
  for (const s of sedes) {
    await prisma.sede.upsert({
      where: { id: uid(s.id) },
      update: {},
      create: {
        id: uid(s.id),
        empresaId: EMPRESA,
        nombre: s.nombre,
        codigo: s.codigo,
        ciudad: s.ciudad,
        departamento: s.dep,
      },
    });
    // Un consecutivo por sede: el folio es atómico por sede, no por empresa
    await prisma.consecutivo.upsert({
      where: { empresaId_sedeId_tipo: { empresaId: EMPRESA, sedeId: uid(s.id), tipo: "OS" } },
      update: {},
      create: {
        id: uid(`con-${s.codigo.toLowerCase()}`),
        empresaId: EMPRESA,
        sedeId: uid(s.id),
        tipo: "OS",
        prefijo: "OS",
        valor: 0,
      },
    });
  }

  // ── Usuarios. El técnico rota entre sedes ─────────────────────────────────
  const usuarios = [
    { id: "usr-admin", nombre: "Marcela Ospina", cedula: "52114876", email: "marcela@aistectire.com", rol: "administrador" as const, sedes: ["sede-fun", "sede-vdp", "sede-ct01"], principal: "sede-fun" },
    { id: "usr-coord", nombre: "Jorge Ramírez", cedula: "79445201", email: "jorge@aistectire.com", rol: "coordinador" as const, sedes: ["sede-fun", "sede-ct01"], principal: "sede-fun" },
    { id: "usr-tec1", nombre: "Carlos Méndez", cedula: "1082334556", email: "carlos@aistectire.com", rol: "tecnico" as const, sedes: ["sede-fun", "sede-ct01"], principal: "sede-fun" },
    { id: "usr-tec2", nombre: "Ana Torres", cedula: "1065221980", email: "ana@aistectire.com", rol: "tecnico" as const, sedes: ["sede-vdp"], principal: "sede-vdp" },
  ];
  for (const u of usuarios) {
    await prisma.usuario.upsert({
      where: { id: uid(u.id) },
      update: {},
      create: {
        id: uid(u.id),
        empresaId: EMPRESA,
        nombre: u.nombre,
        cedula: u.cedula,
        email: u.email,
        passwordHash: HASH_SEMILLA,
        rol: u.rol,
        // El administrador exige doble factor
        dobleFactorActivo: u.rol === "administrador",
      },
    });
    for (const sedeId of u.sedes) {
      await prisma.usuarioSede.upsert({
        where: { usuarioId_sedeId: { usuarioId: uid(u.id), sedeId: uid(sedeId) } },
        update: {},
        create: { usuarioId: uid(u.id), sedeId: uid(sedeId), esPrincipal: sedeId === u.principal },
      });
    }
  }

  // ── Configuraciones de eje con sus umbrales ───────────────────────────────
  for (const cfg of CONFIGURACIONES) {
    const total = cfg.ejes.reduce((n, e) => n + e.izq.length + e.der.length, 0);
    await prisma.configuracionEje.upsert({
      where: { id: uid(cfg.id) },
      update: {},
      create: {
        id: uid(cfg.id),
        empresaId: EMPRESA,
        nombre: cfg.nombre,
        version: 1,
        totalPosiciones: total,
        vigente: true,
      },
    });
    for (const e of cfg.ejes) {
      const crear = async (numero: number, lado: "izquierdo" | "derecho", interna: boolean) => {
        await prisma.posicionEje.upsert({
          where: { configuracionEjeId_numero: { configuracionEjeId: uid(cfg.id), numero } },
          update: {},
          create: {
            id: uid(`${cfg.id}-p${numero}`),
            configuracionEjeId: uid(cfg.id),
            numero,
            eje: e.eje,
            lado,
            esInterna: interna,
            esDireccional: e.tipo === "direccional",
            tipoEje: e.tipo,
            psiObjetivo: e.psi,
            profundidadMinima: e.profMin,
          },
        });
      };
      // En ruedas duales, la segunda de cada lado es la interna
      for (const [i, n] of e.izq.entries()) await crear(n, "izquierdo", e.izq.length > 1 && i === 1);
      for (const [i, n] of e.der.entries()) await crear(n, "derecho", e.der.length > 1 && i === 0);
    }
  }

  // ── Catálogo global: marca → diseño → medida ──────────────────────────────
  for (const m of CATALOGO_GLOBAL) {
    await prisma.marca.upsert({
      where: { id: uid(m.id) },
      update: {},
      create: { id: uid(m.id), nombre: m.nombre, esGlobal: true, empresaId: null },
    });
    for (const d of m.disenos) {
      await prisma.diseno.upsert({
        where: { id: uid(d.id) },
        update: {},
        create: { id: uid(d.id), marcaId: uid(m.id), nombre: d.nombre, tipoEje: d.tipoEje, esGlobal: true },
      });
      for (const me of d.medidas) {
        await prisma.disenoMedida.upsert({
          where: { disenoId_medida: { disenoId: uid(d.id), medida: me.medida } },
          update: {},
          create: {
            id: uid(`${d.id}-${me.medida.replace(/\W/g, "")}`),
            disenoId: uid(d.id),
            medida: me.medida,
            profundidadOriginal: me.prof,
          },
        });
      }
    }
  }

  for (const [i, s] of SERVICIOS.entries()) {
    await prisma.servicio.upsert({
      where: { empresaId_codigo: { empresaId: EMPRESA, codigo: s.codigo } },
      update: {},
      create: {
        id: uid(`srv-${s.codigo.toLowerCase()}`),
        empresaId: EMPRESA,
        codigo: s.codigo,
        nombre: s.nombre,
        porLlanta: s.porLlanta,
        orden: i,
      },
    });
  }

  for (const [i, nombre] of TIPOS_PARCHE.entries()) {
    await prisma.tipoParche.upsert({
      where: { empresaId_nombre: { empresaId: EMPRESA, nombre } },
      update: {},
      create: { id: uid(`par-${i + 1}`), empresaId: EMPRESA, nombre },
    });
  }

  // ── Un cliente con dos sedes y vehículos ──────────────────────────────────
  await prisma.cliente.upsert({
    where: { id: uid("cli-reyna") },
    update: {},
    create: {
      id: uid("cli-reyna"),
      empresaId: EMPRESA,
      nombre: "Transportes Reyna",
      nit: "800.112.334-1",
      contacto: "Luis Reyna",
      telefono: "3104452210",
      email: "luis@transportesreyna.com",
    },
  });

  const sedesCliente = [
    { id: "sc-reyna-fun", nombre: "Planta Fundación", ciudad: "Fundación", dep: "Magdalena" },
    { id: "sc-reyna-vdp", nombre: "Patio Valledupar", ciudad: "Valledupar", dep: "Cesar" },
  ];
  for (const sc of sedesCliente) {
    await prisma.sedeCliente.upsert({
      where: { id: uid(sc.id) },
      update: {},
      create: {
        id: uid(sc.id),
        clienteId: uid("cli-reyna"),
        nombre: sc.nombre,
        ciudad: sc.ciudad,
        departamento: sc.dep,
      },
    });
  }

  const vehiculos = [
    { id: "veh-ca12", sc: "sc-reyna-fun", codigo: "CA-12", placa: "SXK482", nombre: "Tractocamión #12", tipo: "Tractocamión", cfg: "cfg-tractocamion-v1", km: 78900 },
    { id: "veh-cv07", sc: "sc-reyna-fun", codigo: "CV-07", placa: "TRD119", nombre: "Volqueta #7", tipo: "Volqueta", cfg: "cfg-volqueta-v1", km: 45200 },
    { id: "veh-ca19", sc: "sc-reyna-vdp", codigo: "CA-19", placa: "WQP663", nombre: "Tractocamión #19", tipo: "Tractocamión", cfg: "cfg-tractocamion-v1", km: 61300 },
  ];
  for (const v of vehiculos) {
    await prisma.vehiculo.upsert({
      where: { id: uid(v.id) },
      update: {},
      create: {
        id: uid(v.id),
        sedeClienteId: uid(v.sc),
        configuracionEjeId: uid(v.cfg),
        codigo: v.codigo,
        placa: v.placa,
        nombre: v.nombre,
        tipo: v.tipo,
        kmActual: v.km,
      },
    });
  }

  // El usuario del cliente es EXTERNO: solo ve lo de su propio clienteId
  await prisma.usuario.upsert({
    where: { id: uid("usr-cliente") },
    update: {},
    create: {
      id: uid("usr-cliente"),
      empresaId: EMPRESA,
      clienteId: uid("cli-reyna"),
      nombre: "Luis Reyna",
      cedula: "77221004",
      email: "luis@transportesreyna.com",
      passwordHash: HASH_SEMILLA,
      rol: "cliente",
    },
  });

  console.warn("Listo:");
  console.warn(`  ${sedes.length} sedes · ${usuarios.length + 1} usuarios`);
  console.warn(`  ${CONFIGURACIONES.length} configuraciones de eje`);
  console.warn(`  ${CATALOGO_GLOBAL.length} marcas globales · ${SERVICIOS.length} servicios`);
  console.warn(`  1 cliente · ${sedesCliente.length} sedes · ${vehiculos.length} vehículos`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
