import { useMemo, useState } from "react";
import { fechaEnColombia, puedeGestionarProgramaciones } from "@tiretrack/domain";
import { PantallaProgramaciones, type FuentesProgramaciones } from "../src/coordinador/PantallaProgramaciones";
import type { ProgramacionListada } from "../src/coordinador/programacion";
import { useServicios } from "../src/app/Arranque";
import { useDatos } from "../src/app/ProveedorDatos";
import { useUsuario } from "../src/app/ProveedorSesion";
import { Vacio } from "../src/diseno/componentes";

/** Visitas recurrentes: en línea; las listas para elegir salen del celular. */
export default function RutaProgramaciones() {
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const { fuentesOrden } = useDatos();
  const [hoy] = useState(() => fechaEnColombia());

  const fuentes = useMemo<FuentesProgramaciones>(
    () => ({
      listar: () => enLinea<ProgramacionListada[]>("GET", "/programaciones"),
      crear: (p) => enLinea<{ id: string; proxima: string }>("POST", "/programaciones", p),
      pausar: (id) => enLinea("POST", `/programaciones/${id}/desactivar`, {}),
      cambiarTecnico: (id, tecnicoId) => enLinea("POST", `/programaciones/${id}/tecnico`, { tecnicoId }),
      sedes: () => fuentesOrden.sedes(),
      clientes: () => fuentesOrden.clientes(),
      sedesDeCliente: (id) => fuentesOrden.sedesDeCliente(id),
      vehiculos: (id) => fuentesOrden.vehiculos(id),
      tecnicos: (id) => fuentesOrden.tecnicos(id),
    }),
    [enLinea, fuentesOrden],
  );

  if (!puedeGestionarProgramaciones(usuario.rol)) {
    return <Vacio mensaje="Las visitas recurrentes las programan el administrador y el coordinador." />;
  }
  return <PantallaProgramaciones fuentes={fuentes} hoy={hoy} sedesDelUsuario={usuario.sedes ?? []} />;
}
