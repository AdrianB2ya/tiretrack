import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BaseDePruebas, hayBaseDeDatos, CTX_COORDINADOR_A, CTX_COORDINADOR_B, CTX_TECNICO_A, CTX_SIN_CONTEXTO } from "./base";

/**
 * Aislamiento entre empresas.
 *
 * Lo que se verifica aquí no es que el código filtre bien: es que el MOTOR
 * impida ver o escribir datos ajenos AUNQUE la consulta no filtre. Por eso
 * casi todas las consultas de estas pruebas están escritas a propósito sin
 * WHERE por empresa: simulan al desarrollador que se le olvidó.
 *
 * Necesitan PostgreSQL real. Con un doble no se probaría nada, porque haría
 * exactamente lo que le programemos.
 */

const disponible = await hayBaseDeDatos();
const cuando = disponible ? describe : describe.skip;

if (!disponible) {
  console.warn(
    "\n  Pruebas de aislamiento OMITIDAS: no hay PostgreSQL.\n" +
      "  Levanta uno con:\n" +
      "    docker run --name tiretrack-test -e POSTGRES_PASSWORD=postgres \\\n" +
      "      -e POSTGRES_DB=tiretrack_test -p 5432:5432 -d postgres:16\n" +
      "  En CI la base siempre está disponible.\n",
  );
}

const bd = new BaseDePruebas();

cuando("aislamiento entre empresas", () => {
  beforeAll(async () => {
    await bd.iniciar();
  }, 60_000);

  afterAll(async () => {
    await bd.terminar();
  });

  describe("lectura", () => {
    it("una consulta SIN filtro solo devuelve datos de la propia empresa", async () => {
      // Este es el caso que justifica RLS: el desarrollador olvidó el WHERE.
      const r = await bd.comoUsuario(CTX_COORDINADOR_A, `SELECT id FROM "Cliente"`);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.id).toBe("cli-a");
    });

    it("pedir explícitamente un cliente de otra empresa devuelve vacío", async () => {
      const r = await bd.comoUsuario(
        CTX_COORDINADOR_A,
        `SELECT id FROM "Cliente" WHERE id = 'cli-b'`,
      );
      expect(r.rows).toHaveLength(0);
    });

    it("cada empresa ve su propia orden y ninguna más", async () => {
      const a = await bd.comoUsuario(CTX_COORDINADOR_A, `SELECT id FROM "OrdenServicio"`);
      const b = await bd.comoUsuario(CTX_COORDINADOR_B, `SELECT id FROM "OrdenServicio"`);
      expect(a.rows.map((x) => x.id)).toEqual(["ord-a"]);
      expect(b.rows.map((x) => x.id)).toEqual(["ord-b"]);
    });

    it("las tablas hijas heredan el aislamiento por su padre", async () => {
      // SedeCliente no tiene empresaId: se aísla a través de Cliente.
      const r = await bd.comoUsuario(CTX_COORDINADOR_A, `SELECT id FROM "SedeCliente"`);
      expect(r.rows.map((x) => x.id)).toEqual(["sc-a"]);
    });

    it("los vehículos se aíslan a dos niveles de profundidad", async () => {
      // Vehiculo → SedeCliente → Cliente → empresa
      const r = await bd.comoUsuario(CTX_COORDINADOR_A, `SELECT id FROM "Vehiculo"`);
      expect(r.rows.map((x) => x.id)).toEqual(["veh-a"]);
    });

    it("un JOIN no abre una puerta trasera", async () => {
      // Intento de llegar a datos ajenos cruzando tablas.
      const r = await bd.comoUsuario(
        CTX_COORDINADOR_A,
        `SELECT o.id FROM "OrdenServicio" o
         JOIN "Cliente" c ON c.id = o."clienteId"
         WHERE c.nit = '800.112.334-1'`,
      );
      // Las dos empresas tienen un cliente con ese mismo NIT
      expect(r.rows.map((x) => x.id)).toEqual(["ord-a"]);
    });

    it("un COUNT tampoco delata cuántos registros tiene la otra empresa", async () => {
      const r = await bd.comoUsuario(
        CTX_COORDINADOR_A,
        `SELECT count(*)::int AS n FROM "OrdenServicio"`,
      );
      expect(r.rows[0]?.n).toBe(1);
    });

    it("sin contexto no se ve absolutamente nada", async () => {
      // Falla cerrado: si el backend olvida fijar la empresa, no pasa nada.
      const r = await bd.comoUsuario(CTX_SIN_CONTEXTO, `SELECT id FROM "Cliente"`);
      expect(r.rows).toHaveLength(0);
    });

    it("un id de empresa inventado no da acceso a nada", async () => {
      const r = await bd.comoUsuario(
        { empresaId: "emp-inexistente", rol: "administrador" },
        `SELECT id FROM "OrdenServicio"`,
      );
      expect(r.rows).toHaveLength(0);
    });
  });

  describe("escritura", () => {
    it("no se puede insertar un cliente en otra empresa", async () => {
      await expect(
        bd.comoUsuario(
          CTX_COORDINADOR_A,
          `INSERT INTO "Cliente" (id, "empresaId", nombre, nit)
           VALUES ('cli-intruso', 'emp-b', 'Intruso', '999')`,
        ),
      ).rejects.toThrow(/row-level security|política|policy/i);
    });

    it("no se puede modificar un registro de otra empresa", async () => {
      await bd.comoUsuario(
        CTX_COORDINADOR_A,
        `UPDATE "Cliente" SET nombre = 'Hackeado' WHERE id = 'cli-b'`,
      );
      // No lanza error: simplemente no encuentra la fila. Se confirma que
      // el dato original quedó intacto.
      const r = await bd.comoUsuario(CTX_COORDINADOR_B, `SELECT nombre FROM "Cliente"`);
      expect(r.rows[0]?.nombre).toBe("Transportes Reyna");
    });

    it("no se puede borrar un registro de otra empresa", async () => {
      await bd.comoUsuario(CTX_COORDINADOR_A, `DELETE FROM "Cliente" WHERE id = 'cli-b'`);
      const r = await bd.comoUsuario(CTX_COORDINADOR_B, `SELECT id FROM "Cliente"`);
      expect(r.rows).toHaveLength(1);
    });

    it("no se puede mover un registro propio a otra empresa", async () => {
      await expect(
        bd.comoUsuario(
          CTX_COORDINADOR_A,
          `UPDATE "Cliente" SET "empresaId" = 'emp-b' WHERE id = 'cli-a'`,
        ),
      ).rejects.toThrow(/row-level security|política|policy/i);
    });
  });

  describe("llaves compuestas: el cruce es imposible incluso con RLS desactivado", () => {
    it("una orden no puede referenciar un cliente de otra empresa", async () => {
      // Se ejecuta como dueño, saltándose RLS: aquí lo que bloquea es la FK.
      await expect(
        bd.comoDueno.query(
          `INSERT INTO "OrdenServicio"
             (id, "empresaId", "sedeId", "clienteId", "sedeClienteId", "vehiculoId",
              tecnico_id, "configuracionEjeId", estado)
           VALUES ('ord-x', 'emp-a', 'sede-a', 'cli-b', 'sc-b', 'veh-b', 'tec-a', 'cfg-a', 'borrador')`,
        ),
      ).rejects.toThrow(/orden_cliente_empresa_fk|foreign key/i);
    });

    it("la sede del cliente debe pertenecer a ese cliente", async () => {
      await expect(
        bd.comoDueno.query(
          `INSERT INTO "OrdenServicio"
             (id, "empresaId", "sedeId", "clienteId", "sedeClienteId", "vehiculoId",
              tecnico_id, "configuracionEjeId", estado)
           VALUES ('ord-y', 'emp-a', 'sede-a', 'cli-a', 'sc-b', 'veh-a', 'tec-a', 'cfg-a', 'borrador')`,
        ),
      ).rejects.toThrow(/orden_sedecliente_cliente_fk|foreign key/i);
    });

    it("el técnico debe estar asignado a la sede de la orden", async () => {
      await expect(
        bd.comoDueno.query(
          `INSERT INTO "OrdenServicio"
             (id, "empresaId", "sedeId", "clienteId", "sedeClienteId", "vehiculoId",
              tecnico_id, "configuracionEjeId", estado)
           VALUES ('ord-z', 'emp-a', 'sede-a', 'cli-a', 'sc-a', 'veh-a', 'tec-b', 'cfg-a', 'borrador')`,
        ),
      ).rejects.toThrow(/orden_tecnico_sede_fk|foreign key/i);
    });

    it("la posición debe existir en la configuración que la orden congeló", async () => {
      await expect(
        bd.comoDueno.query(
          `INSERT INTO "LlantaRegistro" (id, "ordenId", "configuracionEjeId", posicion, "capturadoPorId")
           VALUES ('lr-x', 'ord-a', 'cfg-b', 1, 'tec-a')`,
        ),
      ).rejects.toThrow(/llanta_orden_configuracion_fk|foreign key/i);
    });
  });

  describe("el técnico solo ve sus órdenes asignadas", () => {
    beforeAll(async () => {
      // Segunda orden en la empresa A, asignada al coordinador
      await bd.comoDueno.query(
        `INSERT INTO "OrdenServicio"
           (id, "empresaId", "sedeId", "clienteId", "sedeClienteId", "vehiculoId",
            tecnico_id, "configuracionEjeId", estado)
         VALUES ('ord-a2', 'emp-a', 'sede-a', 'cli-a', 'sc-a', 'veh-a', 'coo-a', 'cfg-a', 'en_proceso')`,
      );
    });

    it("no ve la orden asignada a otra persona de su misma empresa", async () => {
      const r = await bd.comoUsuario(CTX_TECNICO_A, `SELECT id FROM "OrdenServicio"`);
      expect(r.rows.map((x) => x.id)).toEqual(["ord-a"]);
    });

    it("el coordinador sí ve las dos", async () => {
      const r = await bd.comoUsuario(CTX_COORDINADOR_A, `SELECT id FROM "OrdenServicio" ORDER BY id`);
      expect(r.rows.map((x) => x.id)).toEqual(["ord-a", "ord-a2"]);
    });

    it("el técnico sí ve los clientes de su empresa", async () => {
      // Decisión tomada: ve la cartera, pero solo sus órdenes.
      const r = await bd.comoUsuario(CTX_TECNICO_A, `SELECT id FROM "Cliente"`);
      expect(r.rows.map((x) => x.id)).toEqual(["cli-a"]);
    });
  });

  describe("portal del cliente", () => {
    const ctxCliente = {
      empresaId: "emp-a",
      rol: "cliente",
      usuarioId: "usr-cli",
      clienteId: "cli-a",
    };

    it("solo ve las órdenes de su propio cliente", async () => {
      const r = await bd.comoUsuario(ctxCliente, `SELECT id FROM "OrdenServicio" ORDER BY id`);
      expect(r.rows.map((x) => x.id)).toEqual(["ord-a", "ord-a2"]);
    });

    it("un cliente con otro clienteId no ve nada de esta empresa", async () => {
      // El caso grave: un cliente viendo la flota de otro.
      const r = await bd.comoUsuario(
        { ...ctxCliente, clienteId: "cli-otro" },
        `SELECT id FROM "OrdenServicio"`,
      );
      expect(r.rows).toHaveLength(0);
    });

    it("solo ve su propio registro de cliente", async () => {
      const r = await bd.comoUsuario(ctxCliente, `SELECT id FROM "Cliente"`);
      expect(r.rows.map((x) => x.id)).toEqual(["cli-a"]);
    });

    it("no puede escribir mediciones", async () => {
      await expect(
        bd.comoUsuario(
          ctxCliente,
          `INSERT INTO "LlantaRegistro" (id, "ordenId", "configuracionEjeId", posicion, "capturadoPorId")
           VALUES ('lr-cli', 'ord-a', 'cfg-a', 1, 'tec-a')`,
        ),
      ).rejects.toThrow(/row-level security|política|policy/i);
    });
  });

  describe("catálogo híbrido", () => {
    it("las marcas globales se ven desde cualquier empresa", async () => {
      const a = await bd.comoUsuario(CTX_COORDINADOR_A, `SELECT id FROM "Marca" ORDER BY id`);
      const b = await bd.comoUsuario(CTX_COORDINADOR_B, `SELECT id FROM "Marca" ORDER BY id`);
      expect(a.rows.map((x) => x.id)).toContain("mar-glob");
      expect(b.rows.map((x) => x.id)).toContain("mar-glob");
    });

    it("las marcas propias solo las ve su empresa", async () => {
      const b = await bd.comoUsuario(CTX_COORDINADOR_B, `SELECT id FROM "Marca"`);
      expect(b.rows.map((x) => x.id)).not.toContain("mar-a");
    });

    it("una empresa no puede crear marcas globales", async () => {
      // Solo la plataforma promueve marcas a globales.
      await expect(
        bd.comoUsuario(
          CTX_COORDINADOR_A,
          `INSERT INTO "Marca" (id, "empresaId", nombre, "esGlobal")
           VALUES ('mar-falsa', NULL, 'Falsa', true)`,
        ),
      ).rejects.toThrow(/row-level security|política|policy/i);
    });
  });

  describe("auditoría", () => {
    beforeAll(async () => {
      await bd.comoDueno.query(
        `INSERT INTO "Auditoria" (id, "empresaId", "usuarioId", accion)
         VALUES ('aud-a', 'emp-a', 'coo-a', 'exportar_informe'),
                ('aud-b', 'emp-b', 'coo-b', 'exportar_informe')`,
      );
    });

    it("cada empresa ve solo su propio registro", async () => {
      const r = await bd.comoUsuario(CTX_COORDINADOR_A, `SELECT id FROM "Auditoria"`);
      expect(r.rows.map((x) => x.id)).toEqual(["aud-a"]);
    });

    it("no se puede alterar un registro de auditoría", async () => {
      // Un registro que se puede modificar no sirve como evidencia.
      await expect(
        bd.comoUsuario(CTX_COORDINADOR_A, `UPDATE "Auditoria" SET accion = 'nada' WHERE id = 'aud-a'`),
      ).rejects.toThrow(/permission denied|permiso denegado/i);
    });

    it("no se puede borrar un registro de auditoría", async () => {
      await expect(
        bd.comoUsuario(CTX_COORDINADOR_A, `DELETE FROM "Auditoria" WHERE id = 'aud-a'`),
      ).rejects.toThrow(/permission denied|permiso denegado/i);
    });
  });

  describe("el contexto no se filtra entre peticiones", () => {
    it("la empresa fijada en una transacción no sobrevive a la siguiente", async () => {
      // SET LOCAL muere con la transacción. Si se usara SET a secas, la
      // siguiente petición que reutilice esta conexión del pool heredaría
      // la empresa anterior: una fuga silenciosa y muy difícil de detectar.
      await bd.comoUsuario(CTX_COORDINADOR_A, `SELECT 1`);
      const r = await bd.comoUsuario(CTX_SIN_CONTEXTO, `SELECT id FROM "Cliente"`);
      expect(r.rows).toHaveLength(0);
    });
  });
});
