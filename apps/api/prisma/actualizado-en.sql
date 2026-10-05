-- ============================================================================
-- "actualizadoEn" lo pone la BASE, en toda inserción y actualización
-- ============================================================================
-- En schema.prisma estas columnas son @updatedAt: las llena Prisma cuando ÉL
-- escribe. Pero el servidor escribe con SQL directo, y la migración no les da
-- valor por defecto. Resultado, en producción:
--
--   1. Crear una orden por la API fallaba: NULL en una columna NOT NULL.
--   2. Ningún cambio posterior la tocaba, y la descarga incremental filtra
--      por ella: una orden devuelta al técnico NUNCA llegaba a su celular.
--
-- Las pruebas no lo veían porque su esquema le inventaba un DEFAULT now().
--
-- Un disparador lo resuelve para cualquiera que escriba —Prisma, SQL
-- directo, trabajos programados— sin depender de que cada consulta se
-- acuerde. Este archivo es la única fuente: la migración lleva una copia y
-- las pruebas lo ejecutan tal cual.

CREATE OR REPLACE FUNCTION marcar_actualizado_en() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  -- En UTC, como lo guarda Prisma, sea cual sea la zona de la sesión.
  NEW."actualizadoEn" := timezone('UTC', now());
  RETURN NEW;
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Empresa', 'Sede', 'Usuario', 'Cliente', 'SedeCliente', 'Vehiculo',
    'OrdenServicio', 'LlantaRegistro'
  ]
  LOOP
    -- to_regclass respeta el search_path: sirve igual en producción
    -- (public) que en el esquema propio de cada archivo de pruebas. Se salta
    -- lo que no exista, para que una tabla ausente no aborte el bloque entero.
    CONTINUE WHEN to_regclass(format('%I', t)) IS NULL;
    EXECUTE format('DROP TRIGGER IF EXISTS actualizado_en ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER actualizado_en BEFORE INSERT OR UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION marcar_actualizado_en()',
      t
    );
  END LOOP;
END
$$;
