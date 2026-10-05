import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { abrirBaseEnMemoria } from "../datos/conexionNode";
import { migrar, type Conexion } from "../datos/base";
import { RepositorioLocal } from "../datos/repositorio";
import { AlmacenSeguroMemoria, CLAVES } from "../sesion/almacen";
import { ServicioSesion, type UsuarioSesion } from "../sesion/servicio";

/**
 * Sesión y almacenamiento seguro.
 *
 * Lo que más importa: que el cierre de sesión no borre trabajo sin enviar sin
 * avisar, y que cambiar de usuario deje la base limpia.
 */

let db: Conexion;
let almacen: AlmacenSeguroMemoria;
let sesion: ServicioSesion;
let repo: RepositorioLocal;

const tecnico: UsuarioSesion = {
  id: "u-tec1",
  nombre: "Carlos Méndez",
  email: "carlos@aistectire.com",
  rol: "tecnico",
  empresaId: "emp-1",
  clienteId: null,
  sedes: ["sede-fun", "sede-ct01"],
  sedePrincipal: "sede-fun",
};

const coordinador: UsuarioSesion = {
  ...tecnico,
  id: "u-coo",
  nombre: "Jorge Ramírez",
  rol: "coordinador",
};

const ordenBase = {
  id: "ord-1",
  sedeId: "sede-fun",
  clienteId: "cli-1",
  sedeClienteId: "sc-1",
  vehiculoId: "veh-1",
  tecnicoId: "u-tec1",
  configuracionEjeId: "cfg-1",
  tipo: "preventivo",
  estado: "en_proceso",
  fecha: "2026-09-17",
};

beforeEach(async () => {
  db = await abrirBaseEnMemoria();
  await migrar(db);
  almacen = new AlmacenSeguroMemoria();
  sesion = new ServicioSesion(almacen, db);
  repo = new RepositorioLocal(db);
});

afterEach(async () => {
  await db.cerrar();
});

async function iniciar(usuario = tecnico) {
  await sesion.iniciar({
    token: "jwt-de-acceso",
    refreshToken: "token-de-refresco",
    usuario,
  });
}

describe("inicio de sesión", () => {
  it("guarda los tokens y el perfil", async () => {
    await iniciar();
    expect(await sesion.token()).toBe("jwt-de-acceso");
    expect(await sesion.refreshToken()).toBe("token-de-refresco");
    expect(sesion.actual?.nombre).toBe("Carlos Méndez");
  });

  it("los tokens van al almacén seguro, no a SQLite", async () => {
    // Un celular de trabajo se pierde, se presta y a veces se revende. Un
    // token en el sistema de archivos lo lee cualquiera, y abre la cartera
    // completa de clientes.
    await iniciar();

    const filas = await db.consultar<Record<string, unknown>>("SELECT * FROM sesion");
    const comoTexto = JSON.stringify(filas);
    expect(comoTexto).not.toContain("jwt-de-acceso");
    expect(comoTexto).not.toContain("token-de-refresco");

    expect(almacen.contiene("jwt-de-acceso")).toBe(true);
  });

  it("guarda en la base solo lo que la app necesita sin señal", async () => {
    await iniciar();
    const [fila] = await db.consultar<Record<string, unknown>>("SELECT * FROM sesion");
    expect(fila?.["usuario_id"]).toBe("u-tec1");
    expect(fila?.["empresa_id"]).toBe("emp-1");
    expect(fila?.["rol"]).toBe("tecnico");
  });

  it("solo hay una sesión a la vez", async () => {
    await iniciar();
    await iniciar(coordinador);
    const filas = await db.consultar("SELECT * FROM sesion");
    expect(filas).toHaveLength(1);
  });
});

describe("cambio de usuario", () => {
  it("entrar con otro usuario borra la base local, una vez confirmado", async () => {
    // El técnico nuevo no debe ver las órdenes del que usó el celular ayer.
    // Pero el borrado ya no es automático: si queda trabajo sin enviar hay
    // que confirmarlo, porque antes se perdía sin que nadie se enterara.
    await iniciar();
    await repo.guardarOrden(ordenBase);
    expect(await repo.contarPendientes()).toBe(1);

    const sinConfirmar = await sesion.iniciar(
      { token: "t2", refreshToken: "r2", usuario: coordinador },
    );
    expect(sinConfirmar.ok).toBe(false);
    expect(await repo.ordenesAsignadas()).toHaveLength(1);

    await sesion.iniciar({ token: "t2", refreshToken: "r2", usuario: coordinador }, true);
    expect(await repo.contarPendientes()).toBe(0);
    expect(await repo.ordenesAsignadas()).toHaveLength(0);
  });

  it("sin trabajo pendiente, el cambio de usuario no pregunta nada", async () => {
    await iniciar();
    const r = await sesion.iniciar({ token: "t2", refreshToken: "r2", usuario: coordinador });
    expect(r.ok).toBe(true);
  });

  it("entrar con el mismo usuario conserva el trabajo", async () => {
    // Refrescar la sesión no debe costarle al técnico su captura.
    await iniciar();
    await repo.guardarOrden(ordenBase);

    await iniciar(tecnico);
    expect(await repo.contarPendientes()).toBe(1);
  });

  it("el mismo usuario en otra empresa cuenta como distinto", async () => {
    // Mezclar datos de dos empresas sería una fuga entre clientes. Se avisa
    // igual del trabajo sin enviar, y al confirmar se borra.
    await iniciar();
    await repo.guardarOrden(ordenBase);
    const otraEmpresa = { ...tecnico, empresaId: "emp-2" };

    const sinConfirmar = await sesion.iniciar({ token: "t", refreshToken: "r", usuario: otraEmpresa });
    expect(sinConfirmar.ok).toBe(false);

    await sesion.iniciar({ token: "t", refreshToken: "r", usuario: otraEmpresa }, true);
    expect(await repo.contarPendientes()).toBe(0);
  });
});

describe("restaurar sesión al abrir la app", () => {
  it("devuelve el usuario guardado sin pedir credenciales", async () => {
    await iniciar();
    const otra = new ServicioSesion(almacen, db);
    expect((await otra.restaurar())?.id).toBe("u-tec1");
  });

  it("sin nada guardado no hay sesión", async () => {
    expect(await sesion.restaurar()).toBeNull();
  });

  it("un perfil sin token se trata como sesión cerrada", async () => {
    // Pasa si el borrado quedó a medias.
    await iniciar();
    await almacen.borrar(CLAVES.token);
    expect(await sesion.restaurar()).toBeNull();
  });

  it("un perfil corrupto no revienta el arranque", async () => {
    await almacen.guardar(CLAVES.usuario, "esto-no-es-json");
    await almacen.guardar(CLAVES.token, "algo");
    expect(await sesion.restaurar()).toBeNull();
  });
});

describe("cierre de sesión", () => {
  it("cierra limpio cuando no hay nada pendiente", async () => {
    await iniciar();
    const r = await sesion.cerrar();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.descartado).toBeNull();
  });

  it("borra los tokens del almacén seguro", async () => {
    await iniciar();
    await sesion.cerrar();
    expect(almacen.claves).toEqual([]);
    expect(await sesion.token()).toBeNull();
    expect(sesion.actual).toBeNull();
  });

  it("borra la base local", async () => {
    await iniciar();
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await sesion.cerrar();
    expect(await repo.ordenesAsignadas()).toHaveLength(0);
  });

  it("NO cierra si hay trabajo sin enviar", async () => {
    // Borrar la base con mediciones pendientes es perder una jornada de
    // campo, y eso no se recupera: el camión ya se fue.
    await iniciar();
    await repo.guardarOrden(ordenBase);

    const r = await sesion.cerrar();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.veredicto.codigo).toBe("TRABAJO_SIN_ENVIAR");
    expect(r.veredicto.mensaje).toContain("1 cambio");
  });

  it("el trabajo sigue ahí después del aviso", async () => {
    await iniciar();
    await repo.guardarOrden(ordenBase);
    await sesion.cerrar();

    expect(await repo.contarPendientes()).toBe(1);
    expect(await sesion.token()).toBe("jwt-de-acceso");
  });

  it("cierra si la persona confirma el descarte", async () => {
    await iniciar();
    await repo.guardarOrden(ordenBase);

    const r = await sesion.cerrar(true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Se informa qué se perdió, no se descarta en silencio
    expect(r.valor.descartado?.operaciones).toBe(1);
    expect(await repo.contarPendientes()).toBe(0);
  });

  it("también avisa por fotos sin subir", async () => {
    await iniciar();
    await repo.guardarOrden({ ...ordenBase, encolar: false });
    await db.ejecutar(
      `INSERT INTO foto (id, orden_id, uri_local, nombre, tipo_mime, creada_en)
       VALUES ('f-1','ord-1','file:///foto.jpg','foto.jpg','image/jpeg',?)`,
      [new Date().toISOString()],
    );

    const r = await sesion.cerrar();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.veredicto.mensaje).toContain("1 foto");
  });

  it("permite consultar lo pendiente antes de intentar salir", async () => {
    await iniciar();
    await repo.guardarOrden(ordenBase);
    const t = await sesion.trabajoPendiente();
    expect(t.operaciones).toBe(1);
    expect(t.ordenes).toBe(1);
  });
});

describe("cierre por revocación del servidor", () => {
  it("no pregunta: el token ya no sirve", async () => {
    // La sesión fue revocada, la contraseña cambió o el usuario fue dado de
    // baja. Quedarse con los datos locales no aporta nada.
    await iniciar();
    await repo.guardarOrden(ordenBase);

    const descartado = await sesion.cerrarPorRevocacion();
    expect(descartado.operaciones).toBe(1);
    expect(await sesion.token()).toBeNull();
    expect(await repo.contarPendientes()).toBe(0);
  });

  it("informa qué se perdió para poder avisarle a la persona", async () => {
    await iniciar();
    await repo.guardarOrden(ordenBase);
    await repo.guardarMedicion({ ordenId: "ord-1", posicion: 1, capturadoPorId: "u-tec1" });

    const descartado = await sesion.cerrarPorRevocacion();
    expect(descartado.operaciones).toBe(2);
  });
});

describe("refresco de tokens", () => {
  it("reemplaza los tokens sin tocar el resto de la sesión", async () => {
    await iniciar();
    await repo.guardarOrden(ordenBase);

    await sesion.actualizarTokens("jwt-nuevo", "refresco-nuevo");

    expect(await sesion.token()).toBe("jwt-nuevo");
    expect(sesion.actual?.id).toBe("u-tec1");
    // El trabajo pendiente no se toca
    expect(await repo.contarPendientes()).toBe(1);
  });
});

describe("permisos desde la sesión", () => {
  it("distingue al técnico del gestor", async () => {
    await iniciar();
    expect(sesion.esTecnico()).toBe(true);
    expect(sesion.puedeAprobar()).toBe(false);

    await iniciar(coordinador);
    expect(sesion.esTecnico()).toBe(false);
    expect(sesion.puedeAprobar()).toBe(true);
  });

  it("las sedes se leen de la sesión, no del servidor", async () => {
    // En campo no hay señal para consultarlo.
    await iniciar();
    expect(sesion.sedesPermitidas()).toEqual(["sede-fun", "sede-ct01"]);
    expect(sesion.perteneceASede("sede-fun")).toBe(true);
    expect(sesion.perteneceASede("sede-vdp")).toBe(false);
  });

  it("sin sesión no hay permisos", async () => {
    expect(sesion.esTecnico()).toBe(false);
    expect(sesion.puedeAprobar()).toBe(false);
    expect(sesion.sedesPermitidas()).toEqual([]);
  });
});

describe("renovación de la sesión", () => {
  it("guarda los tokens nuevos", async () => {
    await sesion.iniciar({ token: "jwt-de-acceso", refreshToken: "token-de-refresco", usuario: tecnico });
    const ok = await sesion.renovar(async () => ({ token: "t2", refreshToken: "r2" }));
    expect(ok).toBe(true);
    expect(await sesion.token()).toBe("t2");
    expect(await sesion.refreshToken()).toBe("r2");
  });

  it("es de vuelo único: llamadas simultáneas hacen UNA petición", async () => {
    // El servidor revoca toda la sesión si ve el mismo token de renovación
    // dos veces. Dos renovaciones a la vez expulsarían al técnico.
    await sesion.iniciar({ token: "jwt-de-acceso", refreshToken: "token-de-refresco", usuario: tecnico });
    let llamadas = 0;
    const pedir = async () => {
      llamadas++;
      await new Promise((r) => setTimeout(r, 20));
      return { token: "t2", refreshToken: "r2" };
    };
    const resultados = await Promise.all([
      sesion.renovar(pedir), sesion.renovar(pedir), sesion.renovar(pedir),
    ]);
    expect(llamadas).toBe(1);
    expect(resultados).toEqual([true, true, true]);
  });

  it("después de terminar, una nueva renovación sí sale", async () => {
    await sesion.iniciar({ token: "jwt-de-acceso", refreshToken: "token-de-refresco", usuario: tecnico });
    let llamadas = 0;
    const pedir = async () => { llamadas++; return { token: `t${llamadas}`, refreshToken: "r" }; };
    await sesion.renovar(pedir);
    await sesion.renovar(pedir);
    expect(llamadas).toBe(2);
  });

  it("sin red al renovar devuelve false sin cerrar la sesión", async () => {
    await sesion.iniciar({ token: "jwt-de-acceso", refreshToken: "token-de-refresco", usuario: tecnico });
    const ok = await sesion.renovar(async () => { throw new Error("sin red"); });
    expect(ok).toBe(false);
    expect(await sesion.token()).not.toBeNull();
  });

  it("si el servidor rechaza la renovación, devuelve false", async () => {
    await sesion.iniciar({ token: "jwt-de-acceso", refreshToken: "token-de-refresco", usuario: tecnico });
    expect(await sesion.renovar(async () => null)).toBe(false);
  });
});
