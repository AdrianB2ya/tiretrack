import type { Rol, Veredicto } from "@tiretrack/domain";
import { CLAVES, type AlmacenSeguro } from "./almacen";
import { hayTrabajoSinEnviar, vaciarDatos, type Conexion } from "../datos/base";

/**
 * Sesión del dispositivo.
 *
 * El dispositivo pertenece a **un usuario de una empresa**. Cambiar de
 * usuario o de empresa borra la base local: mezclar datos de dos empresas
 * sería una fuga entre clientes, y filtrar en cada consulta local es un
 * filtro más que alguien puede olvidar.
 */

export interface UsuarioSesion {
  readonly id: string;
  readonly nombre: string;
  readonly email: string;
  readonly rol: Rol;
  /** null para el superadmin: no pertenece a ninguna empresa. */
  readonly empresaId: string | null;
  readonly clienteId: string | null;
  readonly sedes: readonly string[];
  readonly sedePrincipal: string | null;
}

export interface TrabajoPendiente {
  readonly operaciones: number;
  readonly fotos: number;
  readonly ordenes: number;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; veredicto: Veredicto };

const fallo = (codigo: string, mensaje: string): Resultado<never> => ({
  ok: false,
  veredicto: { permitido: false, codigo, mensaje },
});

export class ServicioSesion {
  private usuario: UsuarioSesion | null = null;

  constructor(
    private readonly almacen: AlmacenSeguro,
    private readonly db: Conexion,
  ) {}

  /**
   * Guarda la sesión tras un ingreso correcto.
   *
   * Si entra un usuario distinto al anterior, se borra la base local antes de
   * empezar: el técnico nuevo no debe ver las órdenes del que usó el celular
   * ayer, y menos si son de otra empresa.
   */
  /**
   * Inicia sesión.
   *
   * Si entra OTRO usuario, los datos del anterior se borran: no puede ver
   * las órdenes de un compañero. Pero antes se comprueba que no quede
   * trabajo sin enviar: en un carro taller dos técnicos comparten la tablet,
   * y el segundo en entrar habría destruido la jornada del primero sin que
   * nadie se enterara. La comprobación va aquí, no en la pantalla, para que
   * ningún llamador pueda saltársela.
   */
  async iniciar(
    datos: {
      token: string;
      refreshToken: string;
      usuario: UsuarioSesion;
    },
    /** Descartar el trabajo del usuario anterior, ya advertido. */
    forzar = false,
  ): Promise<Resultado<{ descartado: TrabajoPendiente | null }>> {
    const anterior = await this.usuarioGuardado();
    const esOtro =
      anterior !== null &&
      (anterior.id !== datos.usuario.id || anterior.empresaId !== datos.usuario.empresaId);

    let descartado: TrabajoPendiente | null = null;
    if (esOtro) {
      const pendiente = await hayTrabajoSinEnviar(this.db);
      const hayAlgo = pendiente.operaciones > 0 || pendiente.fotos > 0;
      if (hayAlgo && !forzar) {
        return fallo(
          "TRABAJO_DE_OTRO_SIN_ENVIAR",
          `${anterior?.nombre ?? "El usuario anterior"} tiene ${pendiente.operaciones} cambio(s) ` +
            `y ${pendiente.fotos} foto(s) sin enviar. Que sincronice antes de entrar, ` +
            `o confirma que quieres descartarlos`,
        );
      }
      descartado = hayAlgo ? pendiente : null;
      await vaciarDatos(this.db);
    }

    await this.almacen.guardar(CLAVES.token, datos.token);
    await this.almacen.guardar(CLAVES.refresh, datos.refreshToken);
    // El perfil no es secreto, pero va junto para que cerrar sesión sea una
    // sola operación y no queden restos.
    await this.almacen.guardar(CLAVES.usuario, JSON.stringify(datos.usuario));

    await this.db.ejecutar(
      `INSERT OR REPLACE INTO sesion
         (id, usuario_id, empresa_id, rol, nombre, cliente_id, sede_principal_id)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
      [
        datos.usuario.id,
        datos.usuario.empresaId,
        datos.usuario.rol,
        datos.usuario.nombre,
        datos.usuario.clienteId,
        datos.usuario.sedePrincipal,
      ],
    );

    this.usuario = datos.usuario;
    return { ok: true, valor: { descartado } };
  }

  /** Restaura la sesión al abrir la app, sin pedir credenciales otra vez. */
  async restaurar(): Promise<UsuarioSesion | null> {
    const usuario = await this.usuarioGuardado();
    const token = await this.almacen.leer(CLAVES.token);

    // Un perfil sin token no sirve para nada: se trata como sesión cerrada.
    if (!usuario || !token) {
      this.usuario = null;
      return null;
    }

    this.usuario = usuario;
    return usuario;
  }

  private async usuarioGuardado(): Promise<UsuarioSesion | null> {
    const crudo = await this.almacen.leer(CLAVES.usuario);
    if (!crudo) return null;
    try {
      return JSON.parse(crudo) as UsuarioSesion;
    } catch {
      // Dato corrupto: se descarta en vez de reventar al arrancar la app.
      return null;
    }
  }

  get actual(): UsuarioSesion | null {
    return this.usuario;
  }

  async token(): Promise<string | null> {
    return this.almacen.leer(CLAVES.token);
  }

  async refreshToken(): Promise<string | null> {
    return this.almacen.leer(CLAVES.refresh);
  }

  /** Reemplaza el token tras refrescarlo, sin tocar el resto de la sesión. */
  /** Renovación en curso, compartida por todas las llamadas simultáneas. */
  private renovacionEnCurso: Promise<boolean> | null = null;

  /**
   * Renueva la sesión con el token de renovación.
   *
   * Es de VUELO ÚNICO: si varias llamadas piden renovar a la vez, comparten
   * la misma petición. El servidor detecta la reutilización de un token de
   * renovación y, al verla, revoca toda la sesión —es su defensa contra el
   * robo—. Dos renovaciones simultáneas con el mismo token dejarían al
   * técnico expulsado en plena sincronización.
   *
   * `pedirAlServidor` recibe el token de renovación y devuelve los nuevos, o
   * null si el servidor lo rechazó. Se inyecta para no atar la sesión a HTTP.
   */
  async renovar(
    pedirAlServidor: (refresh: string) => Promise<{ token: string; refreshToken: string } | null>,
  ): Promise<boolean> {
    if (this.renovacionEnCurso) return this.renovacionEnCurso;

    this.renovacionEnCurso = (async () => {
      try {
        const refresh = await this.refreshToken();
        if (!refresh) return false;
        const nuevos = await pedirAlServidor(refresh);
        if (!nuevos) return false;
        await this.actualizarTokens(nuevos.token, nuevos.refreshToken);
        return true;
      } catch {
        // Sin red al renovar: no es que la sesión venció. Se devuelve false y
        // la operación queda en la cola para el próximo intento.
        return false;
      } finally {
        this.renovacionEnCurso = null;
      }
    })();
    return this.renovacionEnCurso;
  }

  async actualizarTokens(token: string, refreshToken: string): Promise<void> {
    await this.almacen.guardar(CLAVES.token, token);
    await this.almacen.guardar(CLAVES.refresh, refreshToken);
  }

  /**
   * Cierra sesión.
   *
   * **Avisa si hay trabajo sin enviar y no cierra**, salvo que la persona lo
   * confirme. Borrar la base con mediciones pendientes es perder una jornada
   * de campo, y eso no se recupera: el camión ya se fue.
   */
  async cerrar(forzar = false): Promise<Resultado<{ descartado: TrabajoPendiente | null }>> {
    const pendiente = await hayTrabajoSinEnviar(this.db);
    const hayAlgo = pendiente.operaciones > 0 || pendiente.fotos > 0;

    if (hayAlgo && !forzar) {
      return fallo(
        "TRABAJO_SIN_ENVIAR",
        `Hay ${pendiente.operaciones} cambio(s) y ${pendiente.fotos} foto(s) sin enviar. ` +
          `Sincroniza antes de salir o confirma que quieres descartarlos`,
      );
    }

    await this.borrarTodo();
    return { ok: true, valor: { descartado: hayAlgo ? pendiente : null } };
  }

  /**
   * Cierre forzado por el servidor: la sesión fue revocada, la contraseña
   * cambió o el usuario fue dado de baja. Aquí no se pregunta — el token ya
   * no sirve y quedarse con los datos locales no aporta nada.
   */
  async cerrarPorRevocacion(): Promise<TrabajoPendiente> {
    const pendiente = await hayTrabajoSinEnviar(this.db);
    await this.borrarTodo();
    return pendiente;
  }

  private async borrarTodo(): Promise<void> {
    // Primero las credenciales: si algo falla después, al menos el token ya
    // no está en el dispositivo.
    for (const clave of Object.values(CLAVES)) {
      await this.almacen.borrar(clave);
    }
    await vaciarDatos(this.db);
    this.usuario = null;
  }

  /** Trabajo sin enviar, para mostrarlo antes de que la persona intente salir. */
  async trabajoPendiente(): Promise<TrabajoPendiente> {
    return hayTrabajoSinEnviar(this.db);
  }

  // ── Permisos derivados del rol ────────────────────────────────────────────

  esTecnico(): boolean {
    return this.usuario?.rol === "tecnico";
  }

  puedeAprobar(): boolean {
    const rol = this.usuario?.rol;
    return rol === "coordinador" || rol === "administrador";
  }

  /**
   * Sedes donde el usuario puede trabajar. Se lee de la sesión y no se pide
   * al servidor: en campo no hay señal para consultarlo.
   */
  sedesPermitidas(): readonly string[] {
    return this.usuario?.sedes ?? [];
  }

  perteneceASede(sedeId: string): boolean {
    return this.sedesPermitidas().includes(sedeId);
  }
}
