import { zServicioLlanta, zServicioVehiculo } from "./comunes";
import { describe, it, expect } from "vitest";
import { ESTADOS_ORDEN, ROLES } from "@tiretrack/domain";
import {
  CONTRACTS_VERSION,
  zDot,
  zEstadoOrden,
  zFechaISO,
  zFolio,
  zLogin,
  zMotivo,
  zPaginacion,
  zRol,
  zUuid,
} from "./index";
import {
  zAdjuntarFoto,
  zCambiarEstado,
  zCrearOrden,
  zFirma,
  zMedicionLlanta,
  zReasignar,
} from "./orden";
import {
  zCrearCliente,
  zCrearMedida,
  zCrearSede,
  zCrearUsuario,
  zCrearVehiculo,
  zLoteSincronizacion,
  zOperacion,
  zSolicitarSubida,
} from "./catalogo";

const ID = "3f9a1c2e-5b7d-4e8f-9a1b-2c3d4e5f6a7b";
const ID2 = "8c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const ID3 = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

describe("contratos", () => {
  it("expone su versión", () => {
    expect(CONTRACTS_VERSION).toBe("0.1.0");
  });
});

describe("los enums salen del dominio", () => {
  it("el esquema de estado acepta exactamente los del dominio", () => {
    // Si mañana se agrega un estado, el esquema lo acepta sin tocar nada.
    for (const e of ESTADOS_ORDEN) {
      expect(zEstadoOrden.safeParse(e).success).toBe(true);
    }
    expect(zEstadoOrden.safeParse("inventado").success).toBe(false);
  });

  it("el esquema de rol acepta exactamente los del dominio", () => {
    for (const r of ROLES) expect(zRol.safeParse(r).success).toBe(true);
    expect(zRol.safeParse("gerente").success).toBe(false);
  });
});

describe("primitivas", () => {
  it("el id debe ser UUID", () => {
    expect(zUuid.safeParse(ID).success).toBe(true);
    expect(zUuid.safeParse("OS-FUN-000123").success).toBe(false);
  });

  it("el motivo en blanco no cuenta como motivo", () => {
    expect(zMotivo.safeParse("   ").success).toBe(false);
    expect(zMotivo.safeParse("ab").success).toBe(false);
    expect(zMotivo.safeParse("Falta el número de parche").success).toBe(true);
  });

  it("valida el folio con la regla del dominio", () => {
    expect(zFolio.safeParse("OS-FUN-000123").success).toBe(true);
    // Un código de referencia no es un folio: son cosas distintas a propósito
    expect(zFolio.safeParse("FUN-K7M2").success).toBe(false);
  });

  it("acepta DOT vacío pero rechaza uno ilegible", () => {
    // El técnico puede no alcanzar a leerlo, pero si escribe algo debe servir.
    expect(zDot.safeParse("").success).toBe(true);
    expect(zDot.safeParse("3624").success).toBe(true);
    expect(zDot.safeParse("9924").success).toBe(false); // semana 99 no existe
    expect(zDot.safeParse("xx").success).toBe(false);
  });

  it("rechaza fechas que no existen en el calendario", () => {
    // Date.parse no sirve solo: "2026-02-31" se convierte en silencio al
    // 3 de marzo, y la orden quedaría con una fecha distinta a la escrita.
    expect(zFechaISO.safeParse("2026-09-04").success).toBe(true);
    expect(zFechaISO.safeParse("2026-02-31").success).toBe(false);
    expect(zFechaISO.safeParse("2026-04-31").success).toBe(false);
    expect(zFechaISO.safeParse("2026-13-01").success).toBe(false);
    expect(zFechaISO.safeParse("04/09/2026").success).toBe(false);
  });

  it("respeta los años bisiestos", () => {
    expect(zFechaISO.safeParse("2024-02-29").success).toBe(true);
    expect(zFechaISO.safeParse("2026-02-29").success).toBe(false);
  });

  it("la paginación trae valores por defecto", () => {
    const p = zPaginacion.parse({});
    expect(p.pagina).toBe(1);
    expect(p.porPagina).toBe(50);
    expect(zPaginacion.safeParse({ porPagina: 500 }).success).toBe(false);
  });
});

describe("login", () => {
  it("normaliza el correo a minúsculas", () => {
    const r = zLogin.parse({ email: "  Carlos@Empresa.COM ", password: "x" });
    expect(r.email).toBe("carlos@empresa.com");
  });

  it("la empresa es opcional: solo hace falta si el correo se repite", () => {
    expect(zLogin.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
    expect(zLogin.safeParse({ email: "a@b.com", password: "x", empresaId: ID }).success).toBe(true);
  });

  it("el código 2FA son seis dígitos", () => {
    const base = { email: "a@b.com", password: "x" };
    expect(zLogin.safeParse({ ...base, codigo2fa: "123456" }).success).toBe(true);
    expect(zLogin.safeParse({ ...base, codigo2fa: "12345" }).success).toBe(false);
  });
});

describe("medición de una posición", () => {
  const base = { id: ID, posicion: 7, servicios: [], noIdentificada: false };

  it("acepta una captura completa", () => {
    const r = zMedicionLlanta.safeParse({
      ...base,
      marcaId: ID2,
      disenoId: ID3,
      medida: "295/80R22.5",
      dot: "3624",
      psiEncontrada: 105,
      psiCalibrado: 110,
      profundidad: 9,
      servicios: ["CALI"],
    });
    expect(r.success).toBe(true);
  });

  it("permite guardar mediciones sin identificar la llanta", () => {
    // Si se obliga a identificarla, el técnico inventa un dato.
    const r = zMedicionLlanta.safeParse({
      ...base,
      noIdentificada: true,
      motivoNoIdentificada: "interna",
      psiEncontrada: 90,
      profundidad: 8,
    });
    expect(r.success).toBe(true);
  });

  it("exige el motivo cuando no se pudo identificar", () => {
    const r = zMedicionLlanta.safeParse({ ...base, noIdentificada: true });
    expect(r.success).toBe(false);
  });

  it("no admite marca en una llanta marcada como no identificada", () => {
    const r = zMedicionLlanta.safeParse({
      ...base,
      noIdentificada: true,
      motivoNoIdentificada: "sucia",
      marcaId: ID2,
    });
    expect(r.success).toBe(false);
  });

  it("respeta la jerarquía marca → diseño → medida", () => {
    expect(zMedicionLlanta.safeParse({ ...base, disenoId: ID3 }).success).toBe(false);
    expect(zMedicionLlanta.safeParse({ ...base, medida: "11R22.5" }).success).toBe(false);
    expect(
      zMedicionLlanta.safeParse({ ...base, marcaId: ID2, disenoId: ID3, medida: "11R22.5" }).success,
    ).toBe(true);
  });

  it("rechaza presiones y profundidades imposibles", () => {
    expect(zMedicionLlanta.safeParse({ ...base, psiEncontrada: -5 }).success).toBe(false);
    expect(zMedicionLlanta.safeParse({ ...base, profundidad: 500 }).success).toBe(false);
  });
});

describe("crear orden", () => {
  const base = {
    id: ID,
    clientRequestId: ID2,
    sedeId: ID3,
    clienteId: ID,
    sedeClienteId: ID2,
    vehiculoId: ID3,
    tecnicoId: ID,
    configuracionEjeId: ID2,
    tipo: "preventivo" as const,
    fecha: "2026-09-04",
  };

  it("acepta una orden con conductor", () => {
    const r = zCrearOrden.safeParse({ ...base, conductorNombre: "Pedro Salas", sinConductor: false });
    expect(r.success).toBe(true);
  });

  it("acepta un vehículo estacionado sin conductor", () => {
    expect(zCrearOrden.safeParse({ ...base, sinConductor: true }).success).toBe(true);
  });

  it("exige conductor si no se marcó que está sin conductor", () => {
    expect(zCrearOrden.safeParse({ ...base, sinConductor: false }).success).toBe(false);
  });

  it("exige clave de idempotencia", () => {
    const { clientRequestId: _omitido, ...sinClave } = base;
    expect(zCrearOrden.safeParse({ ...sinClave, sinConductor: true }).success).toBe(false);
  });

  it("rechaza fechas mal formadas", () => {
    expect(zCrearOrden.safeParse({ ...base, sinConductor: true, fecha: "04/09/2026" }).success).toBe(
      false,
    );
    expect(zCrearOrden.safeParse({ ...base, sinConductor: true, fecha: "2026-02-31" }).success).toBe(
      false,
    );
  });

  it("el folio no viaja en el alta: lo asigna el servidor", () => {
    const r = zCrearOrden.parse({ ...base, sinConductor: true });
    expect("folio" in r).toBe(false);
  });
});

describe("cambio de estado", () => {
  it("acepta un cambio con motivo", () => {
    const r = zCambiarEstado.safeParse({
      version: 3,
      estado: "en_proceso",
      motivo: "Falta el número de parche de la posición 6",
    });
    expect(r.success).toBe(true);
  });

  it("es un comando: NO lleva versión general", () => {
    // Con versión, las operaciones encoladas del propio dispositivo subían la
    // versión del servidor al aplicarse, y la siguiente chocaba consigo misma.
    // Lo valida el servidor con las reglas del negocio.
    expect(zCambiarEstado.safeParse({ estado: "en_revision" }).success).toBe(true);
  });
});

describe("catálogo", () => {
  it("el código de sede entra en el folio: sin espacios ni símbolos", () => {
    expect(zCrearSede.safeParse({ id: ID, nombre: "Sede Fundación", codigo: "FUN" }).success).toBe(
      true,
    );
    expect(zCrearSede.safeParse({ id: ID, nombre: "x", codigo: "FU N" }).success).toBe(false);
    expect(zCrearSede.safeParse({ id: ID, nombre: "x", codigo: "F" }).success).toBe(false);
  });

  it("pasa el código de sede a mayúsculas", () => {
    expect(zCrearSede.parse({ id: ID, nombre: "x", codigo: "ct01" }).codigo).toBe("CT01");
  });

  it("valida el formato de la medida", () => {
    expect(
      zCrearMedida.safeParse({ disenoId: ID, medida: "295/80R22.5", profundidadOriginal: 16 })
        .success,
    ).toBe(true);
    expect(zCrearMedida.safeParse({ disenoId: ID, medida: "grande" }).success).toBe(false);
  });

  it("un usuario necesita al menos una sede", () => {
    const base = {
      id: ID,
      nombre: "Carlos Méndez",
      cedula: "1082334556",
      email: "c@e.com",
      rol: "tecnico" as const,
    };
    expect(zCrearUsuario.safeParse({ ...base, sedes: [] }).success).toBe(false);
    expect(zCrearUsuario.safeParse({ ...base, sedes: [ID2] }).success).toBe(true);
  });

  it("la sede principal debe estar entre las asignadas", () => {
    const base = {
      id: ID,
      nombre: "Carlos",
      cedula: "1082334556",
      email: "c@e.com",
      rol: "tecnico" as const,
      sedes: [ID2],
    };
    expect(zCrearUsuario.safeParse({ ...base, sedePrincipal: ID3 }).success).toBe(false);
    expect(zCrearUsuario.safeParse({ ...base, sedePrincipal: ID2 }).success).toBe(true);
  });

  it("un usuario cliente debe estar vinculado a su cliente", () => {
    const base = {
      id: ID,
      nombre: "Luis Reyna",
      cedula: "77221004",
      email: "l@r.com",
      rol: "cliente" as const,
      sedes: [ID2],
    };
    expect(zCrearUsuario.safeParse(base).success).toBe(false);
    expect(zCrearUsuario.safeParse({ ...base, clienteId: ID3 }).success).toBe(true);
  });

  it("el vehículo cuelga de la sede del cliente, no del cliente", () => {
    const r = zCrearVehiculo.safeParse({
      id: ID,
      sedeClienteId: ID2,
      configuracionEjeId: ID3,
      codigo: "CA-12",
      nombre: "Tractocamión #12",
      tipo: "Tractocamión",
    });
    expect(r.success).toBe(true);
    expect(zCrearVehiculo.safeParse({ id: ID, clienteId: ID2 }).success).toBe(false);
  });

  it("acepta clientes con el mismo NIT en empresas distintas", () => {
    // El aislamiento lo hace la base de datos con un único por empresa.
    const nit = "800.112.334-1";
    expect(zCrearCliente.safeParse({ id: ID, nombre: "Reyna", nit }).success).toBe(true);
    expect(zCrearCliente.safeParse({ id: ID2, nombre: "Reyna", nit }).success).toBe(true);
  });
});

describe("sincronización", () => {
  const operacion = {
    id: ID,
    tipo: "guardar_medicion" as const,
    creadaEn: "2026-09-04T14:32:10.000Z",
    recursoId: ID2,
    datos: { posicion: 7 },
    intentos: 0,
  };

  it("acepta un lote de operaciones", () => {
    const r = zLoteSincronizacion.safeParse({ dispositivoId: ID3, operaciones: [operacion] });
    expect(r.success).toBe(true);
  });

  it("rechaza un lote vacío", () => {
    expect(zLoteSincronizacion.safeParse({ dispositivoId: ID3, operaciones: [] }).success).toBe(
      false,
    );
  });

  it("limita el tamaño del lote", () => {
    const muchas = Array.from({ length: 201 }, () => operacion);
    expect(
      zLoteSincronizacion.safeParse({ dispositivoId: ID3, operaciones: muchas }).success,
    ).toBe(false);
  });

  it("cada operación lleva su propio id, que da la idempotencia", () => {
    // Reintentar el envío no debe crear un registro duplicado.
    const { id: _sinId, ...sinIdentificador } = operacion;
    expect(zOperacion.safeParse(sinIdentificador).success).toBe(false);
  });

  it("rechaza tipos de operación desconocidos", () => {
    expect(zOperacion.safeParse({ ...operacion, tipo: "borrar_todo" }).success).toBe(false);
  });
});

describe("subida de fotos", () => {
  const base = {
    id: ID,
    ordenId: ID2,
    nombreArchivo: "posicion-7.jpg",
    tipoMime: "image/jpeg" as const,
  };

  it("acepta una foto ya comprimida", () => {
    expect(zSolicitarSubida.safeParse({ ...base, tamanoBytes: 220_000 }).success).toBe(true);
  });

  it("rechaza una foto sin comprimir", () => {
    // Subir 4 MB por 22 posiciones en 4G rural no funciona.
    expect(zSolicitarSubida.safeParse({ ...base, tamanoBytes: 4_000_000 }).success).toBe(false);
  });

  it("solo admite imágenes", () => {
    const r = zSolicitarSubida.safeParse({
      ...base,
      tipoMime: "application/pdf",
      tamanoBytes: 1000,
    });
    expect(r.success).toBe(false);
  });
});

describe("servicios en el contrato", () => {
  it("rechaza el nombre del servicio: viaja el código", () => {
    // El nombre es para mostrar y puede cambiar; si fuera el identificador,
    // renombrar un servicio rompería la sincronización.
    expect(zServicioLlanta.safeParse("Calibración").success).toBe(false);
    expect(zServicioLlanta.safeParse("CALI").success).toBe(true);
  });

  it("un servicio del vehículo no se acepta por llanta", () => {
    expect(zServicioLlanta.safeParse("ENGR").success).toBe(false);
    expect(zServicioVehiculo.safeParse("ENGR").success).toBe(true);
  });
});

describe("firma", () => {
  const firma = {
    nombre: "Luis Reyna",
    cedula: "77221004",
    trazo: "[[[0,0],[10,5]]]",
    consentimiento: "2026-09-v1",
    versionContenido: 4,
  };

  it("acepta una firma completa", () => {
    expect(zFirma.safeParse(firma).success).toBe(true);
  });

  it("exige la versión del CONTENIDO firmado", () => {
    const { versionContenido: _, ...sin } = firma;
    expect(zFirma.safeParse(sin).success).toBe(false);
  });

  it("exige el consentimiento: es la constancia de la Ley 1581", () => {
    // Antes el contrato no lo conocía y lo descartaba en silencio.
    const { consentimiento: _, ...sin } = firma;
    expect(zFirma.safeParse(sin).success).toBe(false);
  });

  it("exige el trazo", () => {
    const { trazo: _, ...sin } = firma;
    expect(zFirma.safeParse(sin).success).toBe(false);
  });

  it("conserva el consentimiento al validar, no lo descarta", () => {
    const r = zFirma.safeParse(firma);
    expect(r.success && r.data.consentimiento).toBe("2026-09-v1");
  });
});

describe("reasignación", () => {
  it("exige el motivo: sin él es indistinguible de quitarle trabajo a otro", () => {
    const tecnicoId = "0e3b1c7a-1111-4a1b-9c2d-000000000001";
    expect(zReasignar.safeParse({ tecnicoId }).success).toBe(false);
    expect(zReasignar.safeParse({ tecnicoId, motivo: "Cambio de turno" }).success).toBe(true);
  });
});

describe("adjuntar foto", () => {
  it("acepta una foto válida", () => {
    const r = zAdjuntarFoto.safeParse({
      id: "0e3b1c7a-1111-4a1b-9c2d-000000000002",
      nombre: "posicion-7.jpg", tipoMime: "image/jpeg", tamanoBytes: 220_000,
    });
    expect(r.success).toBe(true);
  });

  it("rechaza lo que no es imagen", () => {
    const r = zAdjuntarFoto.safeParse({
      id: "0e3b1c7a-1111-4a1b-9c2d-000000000002",
      nombre: "x.pdf", tipoMime: "application/pdf", tamanoBytes: 1000,
    });
    expect(r.success).toBe(false);
  });
});
