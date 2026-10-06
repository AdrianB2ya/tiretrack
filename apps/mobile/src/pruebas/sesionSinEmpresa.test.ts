import { describe, it, expect } from "vitest";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar } from "../datos/base";
import { MIGRACIONES } from "../datos/esquema";
import { ServicioSesion } from "../sesion/servicio";
import { AlmacenSeguroMemoria } from "../sesion/almacen";

/**
 * Migración 11: la sesión local exigía empresa y el superadmin no tiene.
 * Guardar su sesión fallaba: no podía entrar a la app.
 */
describe("sesión sin empresa", () => {
  it("el superadmin puede iniciar sesión en el teléfono", async () => {
    const db = await abrirBaseEnMemoria();
    await migrar(db);
    const sesion = new ServicioSesion(new AlmacenSeguroMemoria(), db);
    const r = await sesion.iniciar({
      token: "t",
      refreshToken: "r",
      usuario: { id: "u-sup", nombre: "Soporte", email: "s@x.co", rol: "superadmin", empresaId: null, clienteId: null, sedes: [], sedePrincipal: null },
    });
    expect(r.ok).toBe(true);
    expect((await sesion.restaurar())?.rol).toBe("superadmin");
    await db.cerrar();
  });

  it("migrar desde la 10 conserva la sesión que había", async () => {
    // Un técnico con la app abierta no debe tener que volver a entrar.
    const db = await abrirBaseEnMemoria();
    await migrar(db, MIGRACIONES.filter((m) => m.version <= 10));
    await db.ejecutar(
      `INSERT INTO sesion (id, usuario_id, empresa_id, rol, nombre, cliente_id, sede_principal_id)
       VALUES (1, 'u-tec1', 'emp-1', 'tecnico', 'Carlos Méndez', NULL, 'sede-fun')`,
    );
    await migrar(db);
    const filas = await db.consultar<Record<string, unknown>>(`SELECT usuario_id, empresa_id, sede_principal_id FROM sesion`);
    expect(filas).toEqual([{ usuario_id: "u-tec1", empresa_id: "emp-1", sede_principal_id: "sede-fun" }]);
    await db.cerrar();
  });
});
