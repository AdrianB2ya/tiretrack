import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import jwt from "jsonwebtoken";
import { generateSecret, generateSync } from "otplib";
import { hayBaseDeDatos, conectarAislado } from "./base";
import { ddlDePrueba } from "./generar-esquema";
import { RepositorioPg } from "../acceso/repositorio";
import { ServicioAuth, hashear } from "../acceso/servicio";

/**
 * Autenticación contra PostgreSQL real.
 *
 * Las reglas puras ya están probadas en @tiretrack/domain. Aquí se verifica
 * lo que solo se puede comprobar con base de datos: que los tokens se
 * guarden hasheados, que el bloqueo persista entre peticiones, que cambiar
 * la contraseña revoque las sesiones y que el correo repetido en dos
 * empresas no deje entrar a la equivocada.
 */

const disponible = await hayBaseDeDatos();

const EMP_A = "emp-auth-a";
const EMP_B = "emp-auth-b";
const PASSWORD = "Llantas2026";

let db: pg.Client;
let servicio: ServicioAuth;
let repo: RepositorioPg;
let reloj = new Date("2026-09-14T10:00:00.000Z");

describe.skipIf(!disponible)("autenticación", () => {
  beforeAll(async () => {
    db = await conectarAislado(import.meta.url);

    // Generado desde schema.prisma, no escrito a mano. A mano, "accion" era
    // text y en la base real es el enum AccionAuditoria: el repositorio lo
    // insertaba con un cast a text, cada login fallaba con un 500 contra
    // PostgreSQL real y estas pruebas pasaban.
    await db.query(
      ddlDePrueba(["Empresa", "Usuario", "SesionUsuario", "TokenRecuperacion", "Auditoria"], {
        extras: {
          Usuario: ['UNIQUE ("empresaId", email)'],
          SesionUsuario: ['UNIQUE ("refreshHash")'],
          TokenRecuperacion: ['UNIQUE ("tokenHash")'],
        },
      }),
    );

    repo = new RepositorioPg(db);
    servicio = new ServicioAuth(repo, { jwtSecret: "secreto-de-pruebas" }, () => reloj);
  }, 60_000);

  afterAll(async () => {
    if (db) await db.end();
  });

  beforeEach(async () => {
    reloj = new Date("2026-09-14T10:00:00.000Z");
    await db.query(`TRUNCATE "Auditoria", "TokenRecuperacion", "SesionUsuario", "Usuario", "Empresa" CASCADE`);

    for (const [id, nombre] of [
      [EMP_A, "Asistectire"],
      [EMP_B, "Llantas del Cesar"],
    ]) {
      await db.query(`INSERT INTO "Empresa" (id, nombre, nit) VALUES ($1, $2, $3)`, [
        id,
        nombre,
        `NIT-${id}`,
      ]);
    }

    const hash = await servicio.hashearPassword(PASSWORD);

    await db.query(
      `INSERT INTO "Usuario" (id, "empresaId", nombre, cedula, email, "passwordHash", rol)
       VALUES ('u-tec', $1, 'Carlos', '108', 'carlos@asistectire.com', $2, 'tecnico')`,
      [EMP_A, hash],
    );
    await db.query(
      `INSERT INTO "Usuario" (id, "empresaId", nombre, cedula, email, "passwordHash", rol,
                              "dobleFactorActivo", "dobleFactorSecreto")
       VALUES ('u-adm', $1, 'Marcela', '521', 'marcela@asistectire.com', $2, 'administrador', true, $3)`,
      [EMP_A, hash, generateSecret()],
    );
    // La misma persona trabaja para dos empresas: el correo se repite
    await db.query(
      `INSERT INTO "Usuario" (id, "empresaId", nombre, cedula, email, "passwordHash", rol)
       VALUES ('u-doble-a', $1, 'Pedro', '111', 'pedro@correo.com', $2, 'tecnico')`,
      [EMP_A, hash],
    );
    await db.query(
      `INSERT INTO "Usuario" (id, "empresaId", nombre, cedula, email, "passwordHash", rol)
       VALUES ('u-doble-b', $1, 'Pedro', '111', 'pedro@correo.com', $2, 'coordinador')`,
      [EMP_B, hash],
    );
  });

  describe("login", () => {
    it("deja entrar con credenciales correctas", async () => {
      const r = await servicio.login({ email: "carlos@asistectire.com", password: PASSWORD });
      expect(r.tipo).toBe("ok");
      if (r.tipo !== "ok") return;
      expect(r.usuario.id).toBe("u-tec");
      expect(r.token.length).toBeGreaterThan(20);
    });

    it("el token lleva empresa y rol para que RLS pueda usarlos", async () => {
      const r = await servicio.login({ email: "carlos@asistectire.com", password: PASSWORD });
      if (r.tipo !== "ok") throw new Error("debió entrar");
      const claims = servicio.verificarToken(r.token);
      expect(claims?.sub).toBe("u-tec");
      expect(claims?.empresaId).toBe(EMP_A);
      expect(claims?.rol).toBe("tecnico");
    });

    it("rechaza una contraseña incorrecta", async () => {
      const r = await servicio.login({ email: "carlos@asistectire.com", password: "Incorrecta1" });
      expect(r.tipo).toBe("error");
      if (r.tipo !== "error") return;
      expect(r.veredicto.codigo).toBe("CREDENCIALES_INVALIDAS");
    });

    it("responde igual ante un correo que no existe", async () => {
      // Distinguirlos permitiría averiguar qué correos están registrados.
      const inexistente = await servicio.login({ email: "nadie@x.com", password: PASSWORD });
      const malaPassword = await servicio.login({
        email: "carlos@asistectire.com",
        password: "Mala1234567",
      });
      if (inexistente.tipo !== "error" || malaPassword.tipo !== "error") throw new Error();
      expect(inexistente.veredicto.codigo).toBe(malaPassword.veredicto.codigo);
      expect(inexistente.veredicto.mensaje).toBe(malaPassword.veredicto.mensaje);
    });

    it("no entra un usuario desactivado", async () => {
      await db.query(`UPDATE "Usuario" SET activo = false WHERE id = 'u-tec'`);
      const r = await servicio.login({ email: "carlos@asistectire.com", password: PASSWORD });
      if (r.tipo !== "error") throw new Error();
      expect(r.veredicto.codigo).toBe("CREDENCIALES_INVALIDAS");
    });

    it("la contraseña nunca se guarda en claro", async () => {
      const r = await db.query(`SELECT "passwordHash" FROM "Usuario" WHERE id = 'u-tec'`);
      expect(r.rows[0].passwordHash).not.toContain(PASSWORD);
      expect(r.rows[0].passwordHash.startsWith("$2")).toBe(true);
    });
  });

  describe("correo repetido en varias empresas", () => {
    it("no elige por el usuario: devuelve las opciones", async () => {
      const r = await servicio.login({ email: "pedro@correo.com", password: PASSWORD });
      expect(r.tipo).toBe("elegir_empresa");
      if (r.tipo !== "elegir_empresa") return;
      expect(r.empresas).toHaveLength(2);
      expect(r.empresas.map((e) => e.id).sort()).toEqual([EMP_A, EMP_B]);
    });

    it("con la empresa indicada entra al usuario correcto", async () => {
      const a = await servicio.login({
        email: "pedro@correo.com",
        password: PASSWORD,
        empresaId: EMP_A,
      });
      if (a.tipo !== "ok") throw new Error();
      expect(a.usuario.id).toBe("u-doble-a");
      expect(a.usuario.rol).toBe("tecnico");

      const b = await servicio.login({
        email: "pedro@correo.com",
        password: PASSWORD,
        empresaId: EMP_B,
      });
      if (b.tipo !== "ok") throw new Error();
      expect(b.usuario.id).toBe("u-doble-b");
      expect(b.usuario.rol).toBe("coordinador");
    });
  });

  describe("bloqueo por intentos fallidos", () => {
    it("bloquea tras cinco intentos y persiste entre peticiones", async () => {
      for (let i = 0; i < 5; i++) {
        await servicio.login({ email: "carlos@asistectire.com", password: "Mala1234567" });
      }
      const r = await db.query(
        `SELECT "intentosFallidos", "bloqueadoHasta" FROM "Usuario" WHERE id = 'u-tec'`,
      );
      expect(r.rows[0].intentosFallidos).toBe(5);
      expect(r.rows[0].bloqueadoHasta).not.toBeNull();

      // Ni con la contraseña correcta
      const conCorrecta = await servicio.login({
        email: "carlos@asistectire.com",
        password: PASSWORD,
      });
      if (conCorrecta.tipo !== "error") throw new Error();
      expect(conCorrecta.veredicto.codigo).toBe("CUENTA_BLOQUEADA");
    });

    it("el bloqueo caduca solo", async () => {
      for (let i = 0; i < 5; i++) {
        await servicio.login({ email: "carlos@asistectire.com", password: "Mala1234567" });
      }
      reloj = new Date("2026-09-14T10:20:00.000Z"); // 20 minutos después
      const r = await servicio.login({ email: "carlos@asistectire.com", password: PASSWORD });
      expect(r.tipo).toBe("ok");
    });

    it("un acceso correcto limpia el contador", async () => {
      await servicio.login({ email: "carlos@asistectire.com", password: "Mala1234567" });
      await servicio.login({ email: "carlos@asistectire.com", password: PASSWORD });
      const r = await db.query(`SELECT "intentosFallidos" FROM "Usuario" WHERE id = 'u-tec'`);
      expect(r.rows[0].intentosFallidos).toBe(0);
    });

    it("queda registrado en auditoría", async () => {
      await servicio.login({ email: "carlos@asistectire.com", password: "Mala1234567" });
      await servicio.login({ email: "carlos@asistectire.com", password: PASSWORD });
      const r = await db.query(`SELECT accion FROM "Auditoria" ORDER BY "creadoEn"`);
      const acciones = r.rows.map((x) => x.accion);
      expect(acciones).toContain("login_fallido");
      expect(acciones).toContain("login_exitoso");
    });
  });

  describe("doble factor", () => {
    it("el administrador no entra sin código", async () => {
      const r = await servicio.login({ email: "marcela@asistectire.com", password: PASSWORD });
      if (r.tipo !== "error") throw new Error();
      expect(r.veredicto.codigo).toBe("REQUIERE_2FA");
    });

    it("pedir el segundo factor no cuenta como intento fallido", async () => {
      // Si contara, abrir el diálogo de 2FA cinco veces bloquearía la cuenta.
      for (let i = 0; i < 5; i++) {
        await servicio.login({ email: "marcela@asistectire.com", password: PASSWORD });
      }
      const r = await db.query(`SELECT "intentosFallidos" FROM "Usuario" WHERE id = 'u-adm'`);
      expect(r.rows[0].intentosFallidos).toBe(0);
    });

    it("un código incorrecto sí cuenta como intento fallido", async () => {
      await servicio.login({
        email: "marcela@asistectire.com",
        password: PASSWORD,
        codigo2fa: "000000",
      });
      const r = await db.query(`SELECT "intentosFallidos" FROM "Usuario" WHERE id = 'u-adm'`);
      expect(r.rows[0].intentosFallidos).toBe(1);
    });

    it.each([["texto pegado", "$cuerpo = @{ email = ... }"], ["cinco dígitos", "12345"], ["letras", "abcdef"]])(
      "un código mal formado (%s) se rechaza como incorrecto, no revienta",
      async (_caso, codigo) => {
        // La librería LANZA con un código que no son 6 dígitos: sin validar
        // antes, el login respondía 500 "se reintentará" y no contaba el intento.
        const r = await servicio.login({ email: "marcela@asistectire.com", password: PASSWORD, codigo2fa: codigo });
        expect(r.tipo).toBe("error");
        const f = await db.query(`SELECT "intentosFallidos" FROM "Usuario" WHERE id = 'u-adm'`);
        expect(f.rows[0].intentosFallidos).toBe(1);
      },
    );

    it("entra con el código correcto", async () => {
      const s = await db.query(`SELECT "dobleFactorSecreto" FROM "Usuario" WHERE id = 'u-adm'`);
      const codigo = generateSync({ secret: s.rows[0].dobleFactorSecreto });
      const r = await servicio.login({
        email: "marcela@asistectire.com",
        password: PASSWORD,
        codigo2fa: codigo,
      });
      expect(r.tipo).toBe("ok");
    });
  });

  describe("refresco de sesión", () => {
    it("el refresh se guarda hasheado, nunca en claro", async () => {
      const r = await servicio.login({ email: "carlos@asistectire.com", password: PASSWORD });
      if (r.tipo !== "ok") throw new Error();

      const fila = await db.query(`SELECT "refreshHash" FROM "SesionUsuario"`);
      expect(fila.rows[0].refreshHash).not.toBe(r.refreshToken);
      expect(fila.rows[0].refreshHash).toBe(hashear(r.refreshToken));
    });

    it("entrega un token nuevo y revoca el anterior", async () => {
      const login = await servicio.login({ email: "carlos@asistectire.com", password: PASSWORD });
      if (login.tipo !== "ok") throw new Error();

      const refrescado = await servicio.refrescar(login.refreshToken);
      expect(refrescado.tipo).toBe("ok");
      if (refrescado.tipo !== "ok") return;
      expect(refrescado.refreshToken).not.toBe(login.refreshToken);

      // El anterior ya no sirve: si se filtró, deja de ser útil al primer uso
      const reintento = await servicio.refrescar(login.refreshToken);
      expect(reintento.tipo).toBe("error");
    });

    it("no acepta un refresh inventado", async () => {
      const r = await servicio.refrescar("token-que-nadie-emitio");
      if (r.tipo !== "error") throw new Error();
      expect(r.veredicto.codigo).toBe("SESION_INVALIDA");
    });

    it("no refresca si el usuario fue desactivado", async () => {
      const login = await servicio.login({ email: "carlos@asistectire.com", password: PASSWORD });
      if (login.tipo !== "ok") throw new Error();
      await db.query(`UPDATE "Usuario" SET activo = false WHERE id = 'u-tec'`);
      const r = await servicio.refrescar(login.refreshToken);
      expect(r.tipo).toBe("error");
    });
  });

  describe("recuperación de contraseña", () => {
    it("el token se guarda hasheado", async () => {
      const { tokenEnClaro } = await servicio.solicitarRecuperacion("carlos@asistectire.com");
      expect(tokenEnClaro).not.toBeNull();
      const r = await db.query(`SELECT "tokenHash" FROM "TokenRecuperacion"`);
      expect(r.rows[0].tokenHash).toBe(hashear(tokenEnClaro as string));
    });

    it("no revela si el correo existe", async () => {
      const r = await servicio.solicitarRecuperacion("nadie@x.com");
      expect(r.tokenEnClaro).toBeNull();
      const filas = await db.query(`SELECT count(*)::int AS n FROM "TokenRecuperacion"`);
      expect(filas.rows[0].n).toBe(0);
    });

    it("restablece y permite entrar con la nueva", async () => {
      const { tokenEnClaro } = await servicio.solicitarRecuperacion("carlos@asistectire.com");
      const v = await servicio.restablecerPassword(tokenEnClaro as string, "NuevaClave2026");
      expect(v.permitido).toBe(true);

      const r = await servicio.login({
        email: "carlos@asistectire.com",
        password: "NuevaClave2026",
      });
      expect(r.tipo).toBe("ok");
    });

    it("el token sirve una sola vez", async () => {
      const { tokenEnClaro } = await servicio.solicitarRecuperacion("carlos@asistectire.com");
      await servicio.restablecerPassword(tokenEnClaro as string, "NuevaClave2026");
      const segunda = await servicio.restablecerPassword(tokenEnClaro as string, "OtraClave2026");
      expect(segunda.codigo).toBe("TOKEN_USADO");
    });

    it("caduca a los treinta minutos", async () => {
      const { tokenEnClaro } = await servicio.solicitarRecuperacion("carlos@asistectire.com");
      reloj = new Date("2026-09-14T10:31:00.000Z");
      const v = await servicio.restablecerPassword(tokenEnClaro as string, "NuevaClave2026");
      expect(v.codigo).toBe("TOKEN_EXPIRADO");
    });

    it("rechaza una contraseña débil", async () => {
      const { tokenEnClaro } = await servicio.solicitarRecuperacion("carlos@asistectire.com");
      const v = await servicio.restablecerPassword(tokenEnClaro as string, "corta");
      expect(v.permitido).toBe(false);
    });

    it("cambiar la contraseña expulsa las sesiones abiertas", async () => {
      // Si alguien tomó la cuenta, debe quedar fuera de inmediato.
      const login = await servicio.login({ email: "carlos@asistectire.com", password: PASSWORD });
      if (login.tipo !== "ok") throw new Error();

      const { tokenEnClaro } = await servicio.solicitarRecuperacion("carlos@asistectire.com");
      await servicio.restablecerPassword(tokenEnClaro as string, "NuevaClave2026");

      const r = await servicio.refrescar(login.refreshToken);
      expect(r.tipo).toBe("error");
    });

    it("también limpia el bloqueo por intentos", async () => {
      for (let i = 0; i < 5; i++) {
        await servicio.login({ email: "carlos@asistectire.com", password: "Mala1234567" });
      }
      const { tokenEnClaro } = await servicio.solicitarRecuperacion("carlos@asistectire.com");
      await servicio.restablecerPassword(tokenEnClaro as string, "NuevaClave2026");

      const r = await servicio.login({
        email: "carlos@asistectire.com",
        password: "NuevaClave2026",
      });
      expect(r.tipo).toBe("ok");
    });
  });

  describe("verificación de token", () => {
    it("rechaza uno firmado con otro secreto", async () => {
      const otro = new ServicioAuth(repo, { jwtSecret: "secreto-distinto" }, () => reloj);
      const r = await otro.login({ email: "carlos@asistectire.com", password: PASSWORD });
      if (r.tipo !== "ok") throw new Error();
      expect(servicio.verificarToken(r.token)).toBeNull();
    });

    it("rechaza uno manipulado", async () => {
      const r = await servicio.login({ email: "carlos@asistectire.com", password: PASSWORD });
      if (r.tipo !== "ok") throw new Error();
      const partes = r.token.split(".");
      const alterado = `${partes[0]}.${partes[1]}.firmaFalsa`;
      expect(servicio.verificarToken(alterado)).toBeNull();
    });

    it("rechaza uno caducado", () => {
      // jwt.verify usa el reloj del SISTEMA, no el inyectado en el servicio,
      // así que la caducidad se prueba firmando un token ya vencido en vez
      // de adelantar el reloj del servicio.
      const vencido = jwt.sign(
        { sub: "u-tec", empresaId: EMP_A, rol: "tecnico", clienteId: null },
        "secreto-de-pruebas",
        { expiresIn: -60, issuer: "tiretrack" },
      );
      expect(servicio.verificarToken(vencido)).toBeNull();
    });

    it("rechaza uno emitido por otro sistema", () => {
      const ajeno = jwt.sign({ sub: "u-tec" }, "secreto-de-pruebas", { issuer: "otro-sistema" });
      expect(servicio.verificarToken(ajeno)).toBeNull();
    });
  });
});

// Solo existe sin base: con base, un "omitido" haría fallar la guarda del CI.
if (!disponible) describe("autenticación", () => {
  it("omitida: falta PostgreSQL", () => {
    expect(disponible).toBe(false);
  });
});
