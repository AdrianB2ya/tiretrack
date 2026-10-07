import { useCallback } from "react";
import { puedeVerAuditoria } from "@tiretrack/domain";
import { PantallaAuditoria, type PaginaAuditoria } from "../../src/admin/PantallaAuditoria";
import { useServicios } from "../../src/app/Arranque";
import { useUsuario } from "../../src/app/ProveedorSesion";
import { Vacio } from "../../src/diseno/componentes";

/** Auditoría: solo el administrador, en línea. */
export default function RutaAuditoria() {
  const usuario = useUsuario();
  const { enLinea } = useServicios();
  const cargar = useCallback((consulta: string) => enLinea<PaginaAuditoria>("GET", `/auditoria${consulta}`), [enLinea]);
  if (!puedeVerAuditoria(usuario.rol)) return <Vacio mensaje="La auditoría la consulta el administrador." />;
  return <PantallaAuditoria cargar={cargar} />;
}
