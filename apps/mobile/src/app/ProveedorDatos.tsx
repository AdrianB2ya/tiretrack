import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Conexion } from "../datos/base";
import {
  RepositorioLocal,
  type ContextoOrden,
  type FotoEnGaleria,
  type MedicionLocal,
  type OrdenLocal,
  type PosicionEjeLocal,
  type TecnicoLocal,
} from "../datos/repositorio";
import { MotorSincronizacion, type ResumenSincronizacion } from "../datos/sincronizacion";
import { Descargador, type ClienteDescarga } from "../datos/descarga";
import type { ServicioSesion } from "../sesion/servicio";
import { construirDiagrama, type Diagrama } from "../ordenes/diagrama";
import type { OrdenParaLista } from "../ordenes/lista";
import type { OrdenEnBandeja } from "../coordinador/bandeja";
import type { CatalogoEditor } from "../ordenes/EditorPosicion";
import type { FuentesNuevaOrden } from "../ordenes/FormularioNuevaOrden";

/**
 * Contexto de datos de la app.
 *
 * Une las pantallas con la base local. Dos reglas lo gobiernan:
 *
 * 1. **Todo se lee del dispositivo, nunca del servidor.** La pantalla no
 *    espera a la red: el técnico abre la app bajo un camión sin señal y tiene
 *    que ver su trabajo igual.
 * 2. **Escribir es inmediato; sincronizar es aparte.** Guardar una posición
 *    termina cuando toca SQLite. Si guardar esperara al servidor, cada
 *    posición tardaría lo que tarde la red — y sin red no se podría trabajar.
 */

export interface EstadoDatos {
  readonly cargando: boolean;
  readonly ordenes: readonly OrdenParaLista[];
  readonly pendientesDeEnviar: number;
  readonly sincronizando: boolean;
  readonly ultimaSincronizacion: ResumenSincronizacion | null;
}

export interface AccionesDatos {
  refrescar(): Promise<void>;
  sincronizar(): Promise<ResumenSincronizacion | null>;
  cargarOrden(ordenId: string): Promise<DatosOrden | null>;
  guardarMedicion(
    m: Parameters<RepositorioLocal["guardarMedicion"]>[0],
  ): Promise<void>;
  actualizarDatosOrden(
    ordenId: string,
    datos: { kilometraje?: number; hallazgos?: string; accion?: string },
  ): Promise<void>;
  firmar(
    ordenId: string,
    firma: { nombre: string; cedula: string; cargo?: string | null; trazo: string; consentimiento: string },
  ): Promise<void>;
  cambiarEstado(ordenId: string, estado: string, motivo?: string): Promise<void>;
  catalogoPara(marcaId: string | null, disenoId: string | null, tipoEje: string): Promise<CatalogoEditor>;
  /** Órdenes que esperan revisión, listas para la bandeja del coordinador. */
  bandejaRevision(): Promise<OrdenEnBandeja[]>;
  tecnicosDeSede(sedeId: string): Promise<TecnicoLocal[]>;
  reasignar(ordenId: string, tecnicoId: string, motivo: string): Promise<void>;
  medicionAnterior(vehiculoId: string, posicion: number, ordenId: string): Promise<MedicionLocal | null>;
  /** Fotos de la orden (medicionId null) o de una posición. */
  fotosDe(ordenId: string, medicionId: string | null): Promise<FotoEnGaleria[]>;
  fotosSinSubir(ordenId: string): Promise<number>;
  /** Registra la foto ya capturada y comprimida. Cambia el contenido: la firma lo nota. */
  adjuntarFoto(f: Parameters<RepositorioLocal["adjuntarFoto"]>[0]): Promise<string>;
  /** Lo que el formulario de orden nueva lee de la base del celular. */
  fuentesOrden: FuentesNuevaOrden;
  /** Guarda la orden nueva y la encola; si hay señal, sale enseguida. */
  crearOrden(o: Parameters<RepositorioLocal["guardarOrden"]>[0]): Promise<void>;
}

export interface DatosOrden {
  readonly orden: OrdenLocal;
  readonly mediciones: readonly MedicionLocal[];
  readonly posiciones: readonly PosicionEjeLocal[];
  readonly diagrama: Diagrama;
  /** null si la flota aún no se descargó. */
  readonly contexto: ContextoOrden | null;
}

const Contexto = createContext<(EstadoDatos & AccionesDatos) | null>(null);

export interface ProveedorDatosProps {
  db: Conexion;
  sesion: ServicioSesion;
  motor: MotorSincronizacion;
  /** De dónde traer los datos. Sin esto el celular nunca recibe nada. */
  descarga: ClienteDescarga;
  children: ReactNode;
  /** Cada cuánto intentar sincronizar en segundo plano. 0 lo desactiva. */
  intervaloSincronizacionMs?: number;
  /**
   * Sube los bytes de las fotos. Corre después de la cola: adjuntar (en la
   * cola) es lo que trae la URL firmada para subir. Sin esto ninguna foto
   * salía del celular.
   */
  subidor?: { subirPendientes(): Promise<unknown> };
  /**
   * Quién tiene la sesión. Al cambiar, la lista se recarga: al cerrar sesión
   * la base ya se vació, pero las órdenes seguían en memoria y el siguiente
   * en entrar las habría visto. Al entrar alguien, se descarga enseguida: si
   * no, la lista quedaba vacía hasta la siguiente vuelta de un minuto.
   */
  usuarioId?: string | null;
}

export function ProveedorDatos({
  db,
  sesion,
  motor,
  descarga,
  children,
  intervaloSincronizacionMs = 60_000,
  usuarioId,
  subidor,
}: ProveedorDatosProps) {
  const repo = useMemo(() => new RepositorioLocal(db), [db]);
  const descargador = useMemo(() => new Descargador(repo), [repo]);

  const [cargando, setCargando] = useState(true);
  const [ordenes, setOrdenes] = useState<OrdenParaLista[]>([]);
  const [pendientesDeEnviar, setPendientes] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimaSincronizacion, setUltima] = useState<ResumenSincronizacion | null>(null);

  /** Evita actualizar el estado si la pantalla ya se desmontó. */
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const refrescar = useCallback(async () => {
    const locales = await repo.ordenesAsignadas();

    // Los nombres se resuelven de un golpe para todas: pedirlos por orden
    // haría tres consultas por fila, y con veinte órdenes son sesenta viajes
    // a SQLite cada vez que la lista se refresca.
    const contextos = await repo.contextosDeOrdenes(locales.map((o) => o.id));

    const conDatos = await Promise.all(
      locales.map(async (orden) => {
        const [capturadas, posiciones] = await Promise.all([
          repo.contarMediciones(orden.id),
          repo.posicionesDe(orden.configuracionEjeId),
        ]);
        const ctx = contextos.get(orden.id);
        return {
          orden,
          // Si la flota aún no se descargó se muestra el identificador: un
          // código feo es más útil que una línea en blanco.
          vehiculoCodigo: ctx?.vehiculoCodigo ?? orden.vehiculoId,
          clienteNombre: ctx?.clienteNombre ?? orden.clienteId,
          posicionesCapturadas: capturadas,
          posicionesTotales: posiciones.length,
          tieneCambiosSinEnviar: !orden.sincronizada,
        } satisfies OrdenParaLista;
      }),
    );

    if (!montado.current) return;
    setOrdenes(conDatos);
    setPendientes(await repo.contarPendientes());
    setCargando(false);
  }, [repo]);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  const sincronizar = useCallback(async (): Promise<ResumenSincronizacion | null> => {
    // El motor ya se protege de ejecuciones simultáneas; aquí solo se evita
    // encender el indicador dos veces.
    if (motor.ocupado) return null;

    setSincronizando(true);
    try {
      const resumen = await motor.sincronizar();
      if (montado.current) setUltima(resumen);
      // Primero se envía y después se trae: así lo que el técnico acaba de
      // capturar ya está en el servidor cuando llega la copia de vuelta, y
      // no queda como "trabajo sin enviar" que bloquee la actualización.
      await descargador.descargar(descarga);
      // Los bytes de las fotos, por fuera de la cola: una foto lenta no frena
      // las mediciones. Un fallo aquí no tumba la sincronización: la foto
      // queda esperando con su motivo y su próxima vuelta.
      if (subidor) await subidor.subirPendientes().catch(() => undefined);
      // Refrescar después: la sincronización pudo asignar folios.
      await refrescar();
      return resumen;
    } finally {
      if (montado.current) setSincronizando(false);
    }
  }, [motor, refrescar, descargador, descarga, subidor]);

  const usuarioAnterior = useRef(usuarioId);
  useEffect(() => {
    if (usuarioId === undefined || usuarioAnterior.current === usuarioId) return;
    usuarioAnterior.current = usuarioId;
    void refrescar();
    if (usuarioId) void sincronizar();
  }, [usuarioId, refrescar, sincronizar]);

  /**
   * Sincronización periódica en segundo plano.
   *
   * No se dispara al guardar cada posición: con 22 posiciones serían 22
   * intentos, y en señal intermitente cada uno gasta batería y datos para
   * fallar igual.
   */
  useEffect(() => {
    if (intervaloSincronizacionMs <= 0) return;
    const id = setInterval(() => {
      void sincronizar();
    }, intervaloSincronizacionMs);
    return () => clearInterval(id);
  }, [intervaloSincronizacionMs, sincronizar]);

  const cargarOrden = useCallback(
    async (ordenId: string): Promise<DatosOrden | null> => {
      const orden = await repo.buscarOrden(ordenId);
      if (!orden) return null;

      const [mediciones, posiciones, contexto] = await Promise.all([
        repo.medicionesDe(ordenId),
        repo.posicionesDe(orden.configuracionEjeId),
        repo.contextoDeOrden(ordenId),
      ]);

      return {
        orden,
        mediciones,
        posiciones,
        contexto,
        diagrama: construirDiagrama(posiciones, mediciones),
      };
    },
    [repo],
  );

  /**
   * Guardar termina cuando toca SQLite, no cuando responde el servidor.
   *
   * Es lo que permite capturar 22 posiciones seguidas sin señal. La operación
   * queda encolada y sale cuando haya red.
   */
  const guardarMedicion = useCallback<AccionesDatos["guardarMedicion"]>(
    async (m) => {
      await repo.guardarMedicion(m);
      await refrescar();
    },
    [repo, refrescar],
  );

  const actualizarDatosOrden = useCallback<AccionesDatos["actualizarDatosOrden"]>(
    async (ordenId, datos) => {
      await repo.actualizarDatosOrden(ordenId, datos);
      await refrescar();
    },
    [repo, refrescar],
  );

  const firmar = useCallback<AccionesDatos["firmar"]>(
    async (ordenId, firma) => {
      await repo.firmar(ordenId, firma);
      await refrescar();
    },
    [repo, refrescar],
  );

  const cambiarEstado = useCallback<AccionesDatos["cambiarEstado"]>(
    async (ordenId, estado, motivo) => {
      await repo.cambiarEstado(ordenId, estado, motivo);
      // Un cambio de estado sí conviene enviarlo pronto: el coordinador está
      // esperando esa orden en su bandeja.
      void sincronizar();
      await refrescar();
    },
    [repo, refrescar, sincronizar],
  );

  /**
   * Catálogo para el editor.
   *
   * Se pide por nivel en vez de cargar todo: un catálogo completo puede tener
   * miles de medidas y cargarlas para elegir una es tiempo de pantalla en
   * blanco frente al camión.
   */
  const catalogoPara = useCallback<AccionesDatos["catalogoPara"]>(
    async (marcaId, disenoId, tipoEje) => {
      const [marcas, servicios] = await Promise.all([repo.marcas(), repo.servicios()]);
      const disenos = marcaId ? await repo.disenosDe(marcaId, tipoEje) : [];
      const medidas = disenoId ? await repo.medidasDe(disenoId) : [];
      return { marcas, disenos, medidas, servicios };
    },
    [repo],
  );

  /**
   * Bandeja del coordinador.
   *
   * Los días de espera se calculan aquí, contra el reloj del dispositivo: el
   * coordinador revisa sin señal y no puede depender de que el servidor le
   * diga cuánto lleva esperando cada orden.
   */
  const bandejaRevision = useCallback<AccionesDatos["bandejaRevision"]>(async () => {
    const ordenes = await repo.ordenesEnRevision();
    const contextos = await repo.contextosDeOrdenes(ordenes.map((o) => o.id));

    return Promise.all(
      ordenes.map(async (orden) => {
        const [mediciones, posiciones] = await Promise.all([
          repo.medicionesDe(orden.id),
          repo.posicionesDe(orden.configuracionEjeId),
        ]);
        const ctx = contextos.get(orden.id);

        return {
          orden,
          vehiculoCodigo: ctx?.vehiculoCodigo ?? orden.vehiculoId,
          clienteNombre: ctx?.clienteNombre ?? orden.clienteId,
          // El nombre congelado en la orden manda: si se reasignó, la bandeja
          // debe seguir mostrando quién la ejecutó.
          tecnicoNombre: orden.tecnicoNombre ?? orden.tecnicoId,
          diagrama: construirDiagrama(posiciones, mediciones),
          diasEsperando: diasDesde(orden.enviadaRevisionEn),
        } satisfies OrdenEnBandeja;
      }),
    );
  }, [repo]);

  const tecnicosDeSede = useCallback<AccionesDatos["tecnicosDeSede"]>(
    async (sedeId) => repo.tecnicosDeSede(sedeId),
    [repo],
  );

  const reasignar = useCallback<AccionesDatos["reasignar"]>(
    async (ordenId, tecnicoId, motivo) => {
      await repo.reasignar(ordenId, tecnicoId, motivo);
      // El técnico nuevo está esperando saber que le llegó.
      void sincronizar();
      await refrescar();
    },
    [repo, refrescar, sincronizar],
  );

  const medicionAnterior = useCallback<AccionesDatos["medicionAnterior"]>(
    async (vehiculoId, posicion, ordenId) =>
      repo.ultimaMedicionDePosicion(vehiculoId, posicion, ordenId),
    [repo],
  );

  const fotosDe = useCallback<AccionesDatos["fotosDe"]>(
    async (ordenId, medicionId) => repo.fotosDe(ordenId, medicionId),
    [repo],
  );
  const fotosSinSubir = useCallback<AccionesDatos["fotosSinSubir"]>(
    async (ordenId) => repo.contarFotosSinSubir(ordenId),
    [repo],
  );
  const adjuntarFoto = useCallback<AccionesDatos["adjuntarFoto"]>(
    async (f) => {
      const id = await repo.adjuntarFoto(f);
      // Como guardar una medición: inmediato en el celular; la subida, aparte.
      await refrescar();
      return id;
    },
    [repo, refrescar],
  );

  const fuentesOrden = useMemo<FuentesNuevaOrden>(
    () => ({
      sedes: () => repo.sedes(),
      clientes: () => repo.clientes(),
      sedesDeCliente: (id) => repo.sedesDeCliente(id),
      vehiculos: (id) => repo.vehiculosDeSedeCliente(id),
      tecnicos: (id) => repo.tecnicosDeSede(id),
      ordenesAbiertas: (id) => repo.ordenesAbiertasDeVehiculo(id),
    }),
    [repo],
  );

  const crearOrden = useCallback<AccionesDatos["crearOrden"]>(
    async (o) => {
      await repo.guardarOrden(o);
      await refrescar();
      // Como un cambio de estado: alguien la está esperando (el técnico
      // asignado, o el coordinador si la creó el técnico).
      void sincronizar();
    },
    [repo, refrescar, sincronizar],
  );

  const valor = useMemo(
    () => ({
      cargando,
      ordenes,
      pendientesDeEnviar,
      sincronizando,
      ultimaSincronizacion,
      refrescar,
      sincronizar,
      cargarOrden,
      guardarMedicion,
      actualizarDatosOrden,
      firmar,
      cambiarEstado,
      catalogoPara,
      bandejaRevision,
      tecnicosDeSede,
      reasignar,
      medicionAnterior,
      fotosDe,
      fotosSinSubir,
      adjuntarFoto,
      fuentesOrden,
      crearOrden,
    }),
    [
      cargando, ordenes, pendientesDeEnviar, sincronizando, ultimaSincronizacion,
      refrescar, sincronizar, cargarOrden, guardarMedicion, actualizarDatosOrden,
      firmar, cambiarEstado, catalogoPara, bandejaRevision, tecnicosDeSede,
      reasignar, medicionAnterior, fotosDe, fotosSinSubir, adjuntarFoto, fuentesOrden, crearOrden,
    ],
  );

  // La sesión se usará para filtrar por técnico cuando el servidor devuelva
  // órdenes de varios: hoy la base local ya contiene solo las suyas.
  void sesion;

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useDatos(): EstadoDatos & AccionesDatos {
  const ctx = useContext(Contexto);
  if (!ctx) {
    // Fallar claro y temprano: un contexto ausente produce pantallas vacías
    // sin explicación, que es difícil de rastrear.
    throw new Error("useDatos debe usarse dentro de ProveedorDatos");
  }
  return ctx;
}

/**
 * Días transcurridos desde una marca ISO.
 *
 * Se cuenta contra el reloj del dispositivo, no del servidor: el coordinador
 * revisa sin señal.
 */
function diasDesde(marcaISO: string | null): number {
  if (!marcaISO) return 0;
  const desde = new Date(marcaISO).getTime();
  if (Number.isNaN(desde)) return 0;
  return Math.max(0, Math.floor((Date.now() - desde) / 86_400_000));
}
