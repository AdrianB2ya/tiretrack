import type { OperacionPendiente, RepositorioLocal, TipoOperacion } from "./repositorio";

/**
 * Motor de sincronización.
 *
 * Es la pieza más delicada del proyecto. El técnico trabaja horas sin señal,
 * acumula decenas de operaciones y al volver a cobertura se envían todas de
 * golpe. Un error aquí no se ve: se ve tres semanas después, cuando alguien
 * nota que una orden se facturó dos veces.
 *
 * Cuatro reglas gobiernan el diseño:
 *
 * 1. **Se envían operaciones, no estado.** Cada acción del técnico es un
 *    evento con id propio. Reintentar no duplica.
 * 2. **El orden se respeta.** `guardar_medicion` después de `crear_orden` de
 *    esa misma orden, siempre.
 * 3. **Un fallo no detiene la cola** — salvo que bloquee a las operaciones
 *    que dependen de él.
 * 4. **El servidor manda en los conflictos.** El dispositivo no negocia: si
 *    el servidor dice que la orden cambió, se descarta el envío local y se
 *    avisa a la persona.
 */

export type ResultadoEnvio =
  | {
      tipo: "aplicada";
      folio?: string | null;
      /**
       * Lo que devolvió el servidor. Al adjuntar una foto vuelve la URL
       * firmada para subir los bytes: sin esto se perdería y habría que
       * pedirla de nuevo en otra petición.
       */
      datos?: Record<string, unknown>;
    }
  /** El servidor ya la tenía: el reintento funcionó como debía. */
  | { tipo: "duplicada"; folio?: string | null }
  /** Alguien más cambió el recurso: hay que recargar, no reintentar. */
  | { tipo: "conflicto"; mensaje: string }
  /** El servidor la rechazó por contenido: reintentar no la va a arreglar. */
  | { tipo: "rechazada"; mensaje: string }
  /**
   * La sesión venció y no se pudo renovar. No es culpa del dato ni de la red:
   * alguien tiene que volver a ingresar. La operación se QUEDA en la cola y
   * no cuenta como intento fallido, porque no falló.
   */
  | { tipo: "sin_sesion"; mensaje: string }
  /** No se pudo llegar al servidor: se reintenta. */
  | { tipo: "sin_conexion"; mensaje: string };

export interface ClienteSincronizacion {
  enviar(operacion: OperacionPendiente): Promise<ResultadoEnvio>;
}

export interface ResumenSincronizacion {
  readonly enviadas: number;
  readonly aplicadas: number;
  readonly duplicadas: number;
  readonly conflictos: number;
  readonly rechazadas: number;
  readonly pendientes: number;
  /** Se detuvo por falta de conexión: no tiene sentido seguir intentando. */
  readonly interrumpida: boolean;
  /** La sesión venció y no se pudo renovar: hay que volver a ingresar. */
  readonly requiereIngreso: boolean;
  readonly incidencias: Incidencia[];
}

export interface Incidencia {
  readonly operacionId: string;
  readonly tipo: TipoOperacion;
  readonly ordenId: string | null;
  readonly clase: "conflicto" | "rechazada";
  readonly mensaje: string;
}

/** Máximo de intentos antes de apartar la operación para revisión manual. */
export const INTENTOS_MAXIMOS = 8;

export class MotorSincronizacion {
  private enCurso = false;

  constructor(
    private readonly repo: RepositorioLocal,
    private readonly cliente: ClienteSincronizacion,
  ) {}

  /** true mientras hay una sincronización corriendo. */
  get ocupado(): boolean {
    return this.enCurso;
  }

  /**
   * Envía las operaciones pendientes.
   *
   * Si ya hay una corriendo, no arranca otra: dos sincronizaciones a la vez
   * enviarían las mismas operaciones dos veces. La idempotencia del servidor
   * lo absorbería, pero gastaría datos móviles del técnico al doble.
   */
  async sincronizar(limite = 100): Promise<ResumenSincronizacion> {
    if (this.enCurso) {
      return resumenVacio(await this.repo.contarPendientes(), true);
    }
    this.enCurso = true;

    const resumen = {
      enviadas: 0,
      aplicadas: 0,
      duplicadas: 0,
      conflictos: 0,
      rechazadas: 0,
      interrumpida: false,
      requiereIngreso: false,
      incidencias: [] as Incidencia[],
    };

    /**
     * Órdenes cuya creación falló. Las operaciones que dependen de ellas se
     * saltan: enviar una medición de una orden que el servidor no tiene solo
     * produce un rechazo y un intento gastado.
     */
    const ordenesBloqueadas = new Set<string>();

    try {
      const pendientes = await this.repo.operacionesPendientes(limite);

      for (const op of pendientes) {
        if (op.ordenId && ordenesBloqueadas.has(op.ordenId)) {
          continue;
        }

        const resultado = await this.cliente.enviar(op);
        resumen.enviadas++;

        switch (resultado.tipo) {
          case "aplicada":
          case "duplicada": {
            // La respuesta de adjuntar trae dónde subir los bytes.
            if (op.tipo === "adjuntar_foto" && resultado.tipo === "aplicada" && resultado.datos) {
              await this.repo.guardarDestinoDeFoto(op.recursoId, {
                url: resultado.datos["url"] as string | undefined,
                expiraEn: resultado.datos["expiraEn"] as number | undefined,
              });
            }
            // Duplicada no es un error: significa que un envío anterior sí
            // llegó y la respuesta se perdió. Es exactamente lo que la
            // idempotencia debe lograr.
            await this.repo.marcarOperacionAplicada(op.id);
            if (op.ordenId) {
              await this.repo.confirmarSincronizacion(op.ordenId, resultado.folio ?? null);
            }
            if (resultado.tipo === "aplicada") resumen.aplicadas++;
            else resumen.duplicadas++;
            break;
          }

          case "conflicto": {
            // Reintentar sola no sirve: el servidor tiene otro estado. Pero
            // borrarla perdería el trabajo del técnico —típicamente una firma
            // desactualizada o una posición ocupada—. Se aparta con su motivo,
            // igual que un rechazo. (Antes el comentario decía "se aparta"
            // mientras el código la eliminaba.)
            await this.repo.apartarOperacion(op.id, resultado.mensaje);
            resumen.conflictos++;
            resumen.incidencias.push({
              operacionId: op.id,
              tipo: op.tipo,
              ordenId: op.ordenId,
              clase: "conflicto",
              mensaje: resultado.mensaje,
            });
            if (op.tipo === "crear_orden" && op.ordenId) ordenesBloqueadas.add(op.ordenId);
            break;
          }

          case "rechazada": {
            // Reintentar sola dará el mismo error, pero borrarla perdería el
            // trabajo del técnico. Se aparta con su motivo: si la causa era
            // un desajuste del servidor, se reintenta tras corregirlo.
            await this.repo.apartarOperacion(op.id, resultado.mensaje);
            resumen.rechazadas++;
            resumen.incidencias.push({
              operacionId: op.id,
              tipo: op.tipo,
              ordenId: op.ordenId,
              clase: "rechazada",
              mensaje: resultado.mensaje,
            });
            if (op.tipo === "crear_orden" && op.ordenId) ordenesBloqueadas.add(op.ordenId);
            break;
          }

          case "sin_sesion": {
            // Se corta la ronda: las siguientes fallarían igual. No se marca
            // como fallida para no acercarla al umbral de "atascada".
            resumen.requiereIngreso = true;
            resumen.interrumpida = true;
            break;
          }

          case "sin_conexion": {
            // Se corta aquí: si no hay red, las siguientes van a fallar
            // igual y cada intento cuenta para el descarte.
            await this.repo.marcarOperacionFallida(op.id, resultado.mensaje);
            resumen.interrumpida = true;
            break;
          }
        }

        if (resumen.interrumpida) break;
      }
    } finally {
      this.enCurso = false;
    }

    return { ...resumen, pendientes: await this.repo.contarPendientes() };
  }

  /**
   * Operaciones que fallaron tantas veces que no vale seguir intentando.
   *
   * No se borran solas: representan trabajo del técnico y descartarlas en
   * silencio sería perder una jornada sin que nadie se entere. Se muestran
   * para que una persona decida.
   */
  async operacionesAtascadas(): Promise<OperacionPendiente[]> {
    const todas = await this.repo.operacionesPendientes(500);
    return todas.filter((o) => o.intentos >= INTENTOS_MAXIMOS);
  }
}

function resumenVacio(pendientes: number, interrumpida: boolean): ResumenSincronizacion {
  return {
    enviadas: 0,
    aplicadas: 0,
    duplicadas: 0,
    conflictos: 0,
    rechazadas: 0,
    pendientes,
    interrumpida,
    requiereIngreso: false,
    incidencias: [],
  };
}
