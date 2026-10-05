# Cómo arrancar el proyecto

## Requisitos

- **Node.js 20 o superior** — https://nodejs.org
- Git

PostgreSQL todavía no hace falta: se necesita a partir de la tarea 1.2.

## Primeros pasos

```bash
cd tiretrack
git init
git add -A
git commit -m "Fundación: tareas 0.1 a 1.1"

npm install
npm run verify     # typecheck + lint + 201 pruebas
```

Si `npm run verify` termina sin errores, el proyecto está sano.

## Qué hay hasta ahora

| Carpeta | Estado |
|---|---|
| `packages/domain` | Reglas de negocio puras, 123 pruebas |
| `packages/contracts` | Esquemas Zod compartidos, 44 pruebas |
| `apps/api/prisma` | Esquema de 24 tablas, restricciones SQL y semilla |
| `apps/api/src` | Verificación estructural del esquema, 34 pruebas |
| `apps/mobile` | Vacío. Empieza en la tarea 2.1 |

Todavía **no hay aplicación ejecutable**: hay fundación probada. La API
arranca en la tarea 1.3 y la app móvil en la 2.1.

## Cuando llegue el momento de la base de datos (tarea 1.2)

Hará falta PostgreSQL. Dos caminos:

**Local con Docker**
```bash
docker run --name tiretrack-db -e POSTGRES_PASSWORD=local \
  -e POSTGRES_DB=tiretrack -p 5432:5432 -d postgres:16
```

**Administrado** — Neon o Supabase tienen plan gratuito y evitan instalar nada.

Después:
```bash
cd apps/api
cp .env.example .env        # y poner la cadena de conexión real
npx prisma migrate dev --create-only --name init
cat prisma/manual.sql >> prisma/migrations/*_init/migration.sql
npx prisma migrate dev
npm run seed
```

El SQL manual va **dentro** de la migración, no aparte: si se aplica después
queda una ventana en la que pueden entrar datos sin las restricciones.

## Leer antes de seguir

`CLAUDE.md` tiene el stack, el modelo de datos, las reglas de negocio con su
justificación y la disciplina de trabajo. Es el contexto que necesita
cualquier sesión futura para continuar sin repetir decisiones.
