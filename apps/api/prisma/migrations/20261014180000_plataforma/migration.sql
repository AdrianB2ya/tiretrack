-- Plataforma (R16): alta y listado de empresas por el superadmin. Copia de la
-- sección @seccion:plataforma de rls.sql.
-- @seccion:plataforma
-- ── Plataforma: alta y listado de empresas (R16) ────────────────────────────
-- El superadmin no pertenece a ninguna empresa: con RLS no ve ninguna. Para
-- darlas de alta y listarlas hay dos funciones estrechas, que SOLO responden
-- si el contexto de la petición es de superadmin (el servidor fija app.rol
-- desde el token firmado). Para cualquier otro rol devuelven nada / false.
-- No se dio BYPASSRLS ni se conecta la API como dueño.
CREATE OR REPLACE FUNCTION empresas_para_plataforma()
  RETURNS TABLE (id text, nombre text, nit text, activa boolean, "creadoEn" timestamp)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT e.id, e.nombre, e.nit, e.activa, e."creadoEn" FROM "Empresa" e
     WHERE NULLIF(current_setting('app.rol', true), '') = 'superadmin'
     ORDER BY e.nombre
  $$;

-- El NIT de una empresa es único en la plataforma; se compara solo por dígitos.
CREATE OR REPLACE FUNCTION nit_de_empresa_en_uso(p_nit text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT coalesce(NULLIF(current_setting('app.rol', true), '') = 'superadmin', false)
       AND EXISTS (SELECT 1 FROM "Empresa"
                    WHERE regexp_replace(nit, '\D', '', 'g') = regexp_replace(p_nit, '\D', '', 'g'))
  $$;

REVOKE ALL ON FUNCTION empresas_para_plataforma() FROM PUBLIC;
REVOKE ALL ON FUNCTION nit_de_empresa_en_uso(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION empresas_para_plataforma() TO tiretrack_app;
GRANT EXECUTE ON FUNCTION nit_de_empresa_en_uso(text) TO tiretrack_app;
-- Leen "Empresa" como el dueño: la política trabajos_dueno (arriba) ya le
-- permite leerla pese a FORCE ROW LEVEL SECURITY.
-- @fin:plataforma
