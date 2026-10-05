# Pruebas

## Correr todo

```bash
npm run verify     # typecheck + lint + pruebas
```

Sin PostgreSQL, las pruebas de aislamiento se **omiten** y lo dicen en la
salida. No se marcan como aprobadas: lo que no se ejecutó no se aprueba.

## Con base de datos

Las pruebas de aislamiento necesitan PostgreSQL real. Con un doble no se
probaría nada, porque haría exactamente lo que le programemos — y lo que se
verifica es justamente que el motor bloquee aunque el código no filtre.

```bash
docker run --name tiretrack-test \
  -e POSTGRES_USER=tiretrack -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=tiretrack_test -p 5432:5432 -d postgres:16

export DATABASE_URL_TEST="postgresql://tiretrack:test@localhost:5432/tiretrack_test"
npm test
```

En CI la base siempre está disponible, y el pipeline **falla si las pruebas
de aislamiento se omiten**.

## Qué cubre cada capa

| Capa | Qué verifica | Necesita base |
|---|---|---|
| `packages/domain` | Reglas de negocio puras | No |
| `packages/contracts` | Validación de los datos que cruzan la red | No |
| `apps/api/src/schema.test.ts` | Invariantes de arquitectura del esquema | No |
| `apps/api/src/pruebas/` | Que el motor impida ver datos ajenos | **Sí** |

## Prueba de mutación

Una prueba que nunca falla no vale nada. Las dos suites estructurales están
verificadas rompiendo el código a propósito:

- Meter un `Float` en el esquema, quitar `empresaId` de un índice o poner
  `@default(uuid())` → fallan las pruebas de esquema.
- Cambiar una política RLS a `USING (true)` → fallan 12 pruebas de
  aislamiento.

Si se modifica una política, conviene repetir el ejercicio: relajar el
aislamiento sin que nadie lo note es la falla más cara del sistema.
