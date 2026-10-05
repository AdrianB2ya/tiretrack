import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { hayBaseDeDatos, conectarAislado } from "./base";
import { RepositorioFlotaPg } from "../flota/repositorio";
import { ServicioFlota, type Contexto } from "../flota/servicio";
import type { DefinicionEje } from "@tiretrack/domain";

/**
 * Flota contra PostgreSQL real.
 *
 * El foco es el versionado inmutable de las plantillas de eje: que crear una
 * versión nueva no toque el diagrama de las órdenes ya creadas.
 */

const disponible = await hayBaseDeDatos();

const EMP = "emp-flota";
const ADMIN: Contexto = { empresaId: EMP, rol: "administrador", usuarioId: "u-adm" };
const COORD: Contexto = { empresaId: EMP, rol: "coordinador", usuarioId: "u-coo" };
const TECNICO: Contexto = { empresaId: EMP, rol: "tecnico", usuarioId: "u-tec" };

const montacargas: DefinicionEje[] = [
  { numero: 1, tipoEje: "direccional", psiObjetivo: 110, profundidadMinima: 3, posicionesIzquierda: [1], posicionesDerecha: [2] },
  { numero: 2, tipoEje: "traccion", psiObjetivo: 105, profundidadMinima: 2.5, posicionesIzquierda: [3], posicionesDerecha: [4] },
];

const volqueta: DefinicionEje[] = [
  { numero: 1, tipoEje: "direccional", psiObjetivo: 110, profundidadMinima: 3, posicionesIzquierda: [1], posicionesDerecha: [2] },
  { numero: 2, tipoEje: "traccion", psiObjetivo: 105, profundidadMinima: 2.5, posicionesIzquierda: [3, 4], posicionesDerecha: [5, 6] },
];

let db: pg.Client;
let servicio: ServicioFlota;

describe.skipIf(!disponible)("flota", () => {
  beforeAll(async () => {
    db = await conectarAislado(import.meta.url);

    await db.query(`
      DROP TABLE IF EXISTS "OrdenServicio", "Vehiculo", "PosicionEje", "ConfiguracionEje",
                           "SedeCliente", "Cliente" CASCADE;

      CREATE TABLE "Cliente" (
        id text PRIMARY KEY,
        "empresaId" text NOT NULL,
        nombre text NOT NULL,
        nit text NOT NULL,
        contacto text, telefono text, email text,
        activo boolean NOT NULL DEFAULT true,
        "desactivadoEn" timestamptz,
        UNIQUE ("empresaId", nit)
      );

      CREATE TABLE "SedeCliente" (
        id text PRIMARY KEY,
        "clienteId" text NOT NULL REFERENCES "Cliente"(id),
        nombre text NOT NULL,
        direccion text, ciudad text, departamento text,
        activa boolean NOT NULL DEFAULT true,
        "desactivadaEn" timestamptz,
        UNIQUE (id, "clienteId")
      );

      CREATE TABLE "ConfiguracionEje" (
        id text PRIMARY KEY,
        "empresaId" text NOT NULL,
        nombre text NOT NULL,
        version integer NOT NULL DEFAULT 1,
        "totalPosiciones" integer NOT NULL,
        vigente boolean NOT NULL DEFAULT true,
        "reemplazadaPorId" text,
        UNIQUE ("empresaId", nombre, version)
      );

      CREATE TABLE "PosicionEje" (
        id text PRIMARY KEY,
        "configuracionEjeId" text NOT NULL REFERENCES "ConfiguracionEje"(id) ON DELETE CASCADE,
        numero integer NOT NULL,
        eje integer NOT NULL,
        lado text NOT NULL,
        "esInterna" boolean NOT NULL DEFAULT false,
        "esDireccional" boolean NOT NULL DEFAULT false,
        "tipoEje" text NOT NULL DEFAULT 'multiuso',
        "psiObjetivo" numeric(6,2),
        "profundidadMinima" numeric(5,2),
        UNIQUE ("configuracionEjeId", numero)
      );

      CREATE TABLE "Vehiculo" (
        id text PRIMARY KEY,
        "sedeClienteId" text NOT NULL REFERENCES "SedeCliente"(id),
        "configuracionEjeId" text NOT NULL REFERENCES "ConfiguracionEje"(id),
        codigo text NOT NULL,
        placa text, nombre text NOT NULL, tipo text NOT NULL,
        "kmActual" integer NOT NULL DEFAULT 0,
        activo boolean NOT NULL DEFAULT true,
        "desactivadoEn" timestamptz
      );

      CREATE TABLE "OrdenServicio" (
        id text PRIMARY KEY,
        "empresaId" text NOT NULL,
        "clienteId" text NOT NULL,
        "sedeClienteId" text NOT NULL,
        "vehiculoId" text NOT NULL,
        "configuracionEjeId" text NOT NULL REFERENCES "ConfiguracionEje"(id),
        estado text NOT NULL DEFAULT 'en_proceso'
      );
    `);

    servicio = new ServicioFlota(new RepositorioFlotaPg(db));
  }, 60_000);

  afterAll(async () => {
    if (db) await db.end();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE "OrdenServicio", "Vehiculo", "PosicionEje", "ConfiguracionEje", "SedeCliente", "Cliente" CASCADE`,
    );
  });

  // Escenario base reutilizable
  async function escenario() {
    const cfg = await servicio.crearConfiguracion(ADMIN, { nombre: "Montacargas", ejes: montacargas });
    if (!cfg.ok) throw new Error("no se creó la configuración");

    const cliente = await servicio.crearCliente(ADMIN, {
      nombre: "Transportes Reyna",
      nit: "800.112.334-1",
    });
    if (!cliente.ok) throw new Error();

    const sede = await servicio.crearSedeCliente(ADMIN, {
      clienteId: cliente.valor.id,
      nombre: "Planta Fundación",
      ciudad: "Fundación",
    });
    if (!sede.ok) throw new Error();

    const vehiculo = await servicio.crearVehiculo(ADMIN, {
      sedeClienteId: sede.valor.id,
      configuracionEjeId: cfg.valor.id,
      codigo: "MK-03",
      nombre: "Montacargas #3",
      tipo: "Montacargas",
      kmActual: 12400,
    });
    if (!vehiculo.ok) throw new Error();

    return { cfg: cfg.valor, cliente: cliente.valor, sede: sede.valor, vehiculo: vehiculo.valor };
  }

  describe("jerarquía cliente → sede → vehículo", () => {
    it("crea la cadena completa", async () => {
      const e = await escenario();
      expect(e.vehiculo.sedeClienteId).toBe(e.sede.id);
      expect(e.sede.clienteId).toBe(e.cliente.id);
    });

    it("el vehículo cuelga de la sede, no del cliente", async () => {
      const e = await escenario();
      const vehiculos = await servicio.vehiculosDeSede(ADMIN, e.sede.id);
      expect(vehiculos.map((v) => v.id)).toEqual([e.vehiculo.id]);
    });

    it("verifica que el vehículo pertenezca al cliente elegido", async () => {
      const e = await escenario();
      const ok = await servicio.verificarCadena(ADMIN, e.cliente.id, e.vehiculo.id);
      expect(ok.permitido).toBe(true);

      const otro = await servicio.crearCliente(ADMIN, { nombre: "Otro", nit: "900.000.111-2" });
      if (!otro.ok) throw new Error();
      const mal = await servicio.verificarCadena(ADMIN, otro.valor.id, e.vehiculo.id);
      expect(mal.codigo).toBe("VEHICULO_DE_OTRO_CLIENTE");
    });

    it("no crea una sede en un cliente deshabilitado", async () => {
      const e = await escenario();
      await db.query(`UPDATE "Cliente" SET activo = false WHERE id = $1`, [e.cliente.id]);
      const r = await servicio.crearSedeCliente(ADMIN, {
        clienteId: e.cliente.id,
        nombre: "Nueva",
      });
      expect(r.ok).toBe(false);
    });
  });

  describe("NIT único por empresa", () => {
    it("rechaza un NIT repetido dentro de la empresa", async () => {
      await servicio.crearCliente(ADMIN, { nombre: "Reyna", nit: "800.112.334-1" });
      const r = await servicio.crearCliente(ADMIN, { nombre: "Otro nombre", nit: "800.112.334-1" });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("NIT_DUPLICADO");
    });
  });

  describe("permisos", () => {
    it("el técnico puede crear clientes", async () => {
      // Decisión tomada: crear es operativo, llega a una sede sin registrar.
      const r = await servicio.crearCliente(TECNICO, { nombre: "Nuevo", nit: "900.111.222-3" });
      expect(r.ok).toBe(true);
    });

    it("el técnico NO puede deshabilitar clientes", async () => {
      const e = await escenario();
      const r = await servicio.desactivarCliente(TECNICO, e.cliente.id);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("SIN_PERMISO");
    });

    it("el técnico no crea vehículos", async () => {
      const e = await escenario();
      const r = await servicio.crearVehiculo(TECNICO, {
        sedeClienteId: e.sede.id,
        configuracionEjeId: e.cfg.id,
        codigo: "X-1",
        nombre: "X",
        tipo: "Camión",
      });
      expect(r.ok).toBe(false);
    });

    it("solo el administrador define plantillas de eje", async () => {
      const r = await servicio.crearConfiguracion(COORD, { nombre: "Volqueta", ejes: volqueta });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("SIN_PERMISO");
    });
  });

  describe("desactivación en cascada", () => {
    it("no deshabilita un cliente con sedes activas", async () => {
      const e = await escenario();
      const r = await servicio.desactivarCliente(ADMIN, e.cliente.id);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("TIENE_HIJOS_ACTIVOS");
    });

    it("no deshabilita una sede con vehículos activos", async () => {
      const e = await escenario();
      const r = await servicio.desactivarSedeCliente(ADMIN, e.sede.id);
      expect(r.ok).toBe(false);
    });

    it("deshabilita de abajo hacia arriba", async () => {
      const e = await escenario();
      expect((await servicio.desactivarVehiculo(ADMIN, e.vehiculo.id)).ok).toBe(true);
      expect((await servicio.desactivarSedeCliente(ADMIN, e.sede.id)).ok).toBe(true);
      expect((await servicio.desactivarCliente(ADMIN, e.cliente.id)).ok).toBe(true);
    });

    it("no deshabilita un vehículo con órdenes abiertas", async () => {
      // Quedarían órdenes apuntando a algo que ya no sale en el selector y
      // nadie podría cerrarlas.
      const e = await escenario();
      await db.query(
        `INSERT INTO "OrdenServicio" (id, "empresaId", "clienteId", "sedeClienteId", "vehiculoId", "configuracionEjeId", estado)
         VALUES ('o-1', $1, $2, $3, $4, $5, 'en_proceso')`,
        [EMP, e.cliente.id, e.sede.id, e.vehiculo.id, e.cfg.id],
      );
      const r = await servicio.desactivarVehiculo(ADMIN, e.vehiculo.id);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("TIENE_ORDENES_ABIERTAS");
    });

    it("una orden cerrada no impide deshabilitar", async () => {
      const e = await escenario();
      await db.query(
        `INSERT INTO "OrdenServicio" (id, "empresaId", "clienteId", "sedeClienteId", "vehiculoId", "configuracionEjeId", estado)
         VALUES ('o-2', $1, $2, $3, $4, $5, 'cerrada')`,
        [EMP, e.cliente.id, e.sede.id, e.vehiculo.id, e.cfg.id],
      );
      expect((await servicio.desactivarVehiculo(ADMIN, e.vehiculo.id)).ok).toBe(true);
    });

    it("lo deshabilitado desaparece de los listados", async () => {
      const e = await escenario();
      await servicio.desactivarVehiculo(ADMIN, e.vehiculo.id);
      const vehiculos = await servicio.vehiculosDeSede(ADMIN, e.sede.id);
      expect(vehiculos).toHaveLength(0);
    });
  });

  describe("versionado de configuraciones", () => {
    it("la primera versión es la 1 y queda vigente", async () => {
      const e = await escenario();
      expect(e.cfg.version).toBe(1);
      expect(e.cfg.vigente).toBe(true);
      expect(e.cfg.totalPosiciones).toBe(4);
    });

    it("no permite dos configuraciones con el mismo nombre", async () => {
      await escenario();
      const r = await servicio.crearConfiguracion(ADMIN, { nombre: "Montacargas", ejes: volqueta });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("NOMBRE_EN_USO");
    });

    it("crear una versión nueva incrementa el número", async () => {
      const e = await escenario();
      const r = await servicio.nuevaVersion(ADMIN, {
        configuracionAnteriorId: e.cfg.id,
        ejes: montacargas,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.configuracion.version).toBe(2);
      expect(r.valor.configuracion.nombre).toBe("Montacargas");
    });

    it("la versión anterior deja de estar vigente pero NO se borra", async () => {
      // Las órdenes que la congelaron la siguen necesitando para dibujar su
      // diagrama.
      const e = await escenario();
      await servicio.nuevaVersion(ADMIN, {
        configuracionAnteriorId: e.cfg.id,
        ejes: montacargas,
      });

      const todas = await servicio.listarConfiguraciones(ADMIN, true);
      const anterior = todas.find((c) => c.id === e.cfg.id);
      expect(anterior).toBeDefined();
      expect(anterior?.vigente).toBe(false);
      expect(anterior?.reemplazadaPorId).toBeTruthy();

      // Sus posiciones siguen intactas
      const posiciones = await servicio.posicionesDe(ADMIN, e.cfg.id);
      expect(posiciones).toHaveLength(4);
    });

    it("una orden ya creada conserva su diagrama tras el cambio", async () => {
      // Es la razón de todo el versionado: el cliente firmó un documento con
      // un diagrama concreto y ese documento no puede cambiar después.
      const e = await escenario();
      await db.query(
        `INSERT INTO "OrdenServicio" (id, "empresaId", "clienteId", "sedeClienteId", "vehiculoId", "configuracionEjeId", estado)
         VALUES ('o-vieja', $1, $2, $3, $4, $5, 'cerrada')`,
        [EMP, e.cliente.id, e.sede.id, e.vehiculo.id, e.cfg.id],
      );

      await servicio.nuevaVersion(ADMIN, {
        configuracionAnteriorId: e.cfg.id,
        ejes: volqueta, // pasa de 4 a 6 posiciones
        confirmado: true,
      });

      const orden = await db.query(
        `SELECT "configuracionEjeId" FROM "OrdenServicio" WHERE id = 'o-vieja'`,
      );
      expect(orden.rows[0].configuracionEjeId).toBe(e.cfg.id);

      const posiciones = await servicio.posicionesDe(ADMIN, e.cfg.id);
      expect(posiciones).toHaveLength(4); // sigue dibujándose con 4
    });

    it("los vehículos activos se mueven a la versión nueva", async () => {
      const e = await escenario();
      const r = await servicio.nuevaVersion(ADMIN, {
        configuracionAnteriorId: e.cfg.id,
        ejes: montacargas,
      });
      if (!r.ok) throw new Error();
      expect(r.valor.vehiculosMovidos).toBe(1);

      const v = await db.query(`SELECT "configuracionEjeId" FROM "Vehiculo" WHERE id = $1`, [
        e.vehiculo.id,
      ]);
      expect(v.rows[0].configuracionEjeId).toBe(r.valor.configuracion.id);
    });

    it("pide confirmación si cambia el número de posiciones con vehículos en uso", async () => {
      const e = await escenario();
      const r = await servicio.nuevaVersion(ADMIN, {
        configuracionAnteriorId: e.cfg.id,
        ejes: volqueta, // 6 en vez de 4
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("REQUIERE_CONFIRMACION");
      expect(r.veredicto.mensaje).toContain("1 vehículo");
    });

    it("con confirmación sí procede", async () => {
      const e = await escenario();
      const r = await servicio.nuevaVersion(ADMIN, {
        configuracionAnteriorId: e.cfg.id,
        ejes: volqueta,
        confirmado: true,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.configuracion.totalPosiciones).toBe(6);
    });

    it("no se versiona dos veces la misma versión", async () => {
      const e = await escenario();
      await servicio.nuevaVersion(ADMIN, { configuracionAnteriorId: e.cfg.id, ejes: montacargas });
      const segunda = await servicio.nuevaVersion(ADMIN, {
        configuracionAnteriorId: e.cfg.id,
        ejes: montacargas,
      });
      expect(segunda.ok).toBe(false);
      if (segunda.ok) return;
      expect(segunda.veredicto.codigo).toBe("YA_REEMPLAZADA");
    });

    it("un vehículo nuevo no puede nacer con una versión reemplazada", async () => {
      const e = await escenario();
      await servicio.nuevaVersion(ADMIN, { configuracionAnteriorId: e.cfg.id, ejes: montacargas });

      const r = await servicio.crearVehiculo(ADMIN, {
        sedeClienteId: e.sede.id,
        configuracionEjeId: e.cfg.id, // la vieja
        codigo: "MK-04",
        nombre: "Montacargas #4",
        tipo: "Montacargas",
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("CONFIGURACION_NO_VIGENTE");
    });

    it("rechaza una configuración con posiciones incoherentes", async () => {
      const rota: DefinicionEje[] = [
        { numero: 1, tipoEje: "direccional", posicionesIzquierda: [1], posicionesDerecha: [2] },
        { numero: 2, tipoEje: "traccion", posicionesIzquierda: [7], posicionesDerecha: [8] },
      ];
      const r = await servicio.crearConfiguracion(ADMIN, { nombre: "Rota", ejes: rota });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("POSICIONES_INCOHERENTES");
    });
  });

  describe("posiciones y umbrales", () => {
    it("guarda el tipo de eje y los umbrales por posición", async () => {
      const e = await escenario();
      const posiciones = await servicio.posicionesDe(ADMIN, e.cfg.id);

      const p1 = posiciones.find((p) => p.numero === 1);
      expect(p1?.tipoEje).toBe("direccional");
      expect(p1?.esDireccional).toBe(true);
      expect(p1?.psiObjetivo).toBe(110);
      expect(p1?.profundidadMinima).toBe(3);

      const p3 = posiciones.find((p) => p.numero === 3);
      expect(p3?.tipoEje).toBe("traccion");
      expect(p3?.psiObjetivo).toBe(105);
    });

    it("los umbrales llegan como número, no como texto", async () => {
      // pg devuelve numeric como string: comparados como cadenas, "9" > "10".
      const e = await escenario();
      const posiciones = await servicio.posicionesDe(ADMIN, e.cfg.id);
      expect(typeof posiciones[0]?.psiObjetivo).toBe("number");
      expect(typeof posiciones[0]?.profundidadMinima).toBe("number");
    });

    it("marca la rueda interna en los ejes duales", async () => {
      const r = await servicio.crearConfiguracion(ADMIN, { nombre: "Volqueta", ejes: volqueta });
      if (!r.ok) throw new Error();
      const posiciones = await servicio.posicionesDe(ADMIN, r.valor.id);

      // Eje 2: izquierda [3,4] y derecha [5,6]. Las internas miran al centro.
      expect(posiciones.find((p) => p.numero === 4)?.esInterna).toBe(true);
      expect(posiciones.find((p) => p.numero === 5)?.esInterna).toBe(true);
      expect(posiciones.find((p) => p.numero === 3)?.esInterna).toBe(false);
      expect(posiciones.find((p) => p.numero === 6)?.esInterna).toBe(false);
      // El eje sencillo no tiene internas
      expect(posiciones.find((p) => p.numero === 1)?.esInterna).toBe(false);
    });
  });

  describe("kilometraje", () => {
    it("acepta un avance normal", async () => {
      const e = await escenario();
      const r = await servicio.actualizarKilometraje(TECNICO, e.vehiculo.id, 13000);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.vehiculo.kmActual).toBe(13000);
    });

    it("avisa si retrocede, sin bloquear", async () => {
      // Cambiar el odómetro es real y frecuente en flotas viejas.
      const e = await escenario();
      const aviso = await servicio.actualizarKilometraje(TECNICO, e.vehiculo.id, 500);
      expect(aviso.ok).toBe(false);
      if (aviso.ok) return;
      expect(aviso.veredicto.codigo).toBe("KM_RETROCEDE");

      const confirmado = await servicio.actualizarKilometraje(TECNICO, e.vehiculo.id, 500, true);
      expect(confirmado.ok).toBe(true);
      if (!confirmado.ok) return;
      expect(confirmado.valor.retrocedio).toBe(true);
    });

    it("rechaza un valor negativo incluso confirmado", async () => {
      const e = await escenario();
      const r = await servicio.actualizarKilometraje(TECNICO, e.vehiculo.id, -10, true);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.veredicto.codigo).toBe("KM_NEGATIVO");
    });
  });
});

describe.skipIf(disponible)("flota", () => {
  it("omitida: falta PostgreSQL", () => {
    expect(disponible).toBe(false);
  });
});
