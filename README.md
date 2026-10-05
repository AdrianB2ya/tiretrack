# TireTrack

Gestión de servicio de llantas para flotas. Multi-empresa, offline-first.

## Requisitos

- Node.js 20 o superior
- npm 10 o superior

## Arranque

```bash
npm install
npm run verify     # typecheck + lint + test
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm test` | Corre las pruebas |
| `npm run test:watch` | Pruebas en modo continuo |
| `npm run test:cov` | Pruebas con cobertura |
| `npm run typecheck` | Verifica tipos en todos los paquetes |
| `npm run lint` | Linter |
| `npm run verify` | Los tres anteriores |

## Estructura

```
packages/domain      Reglas de negocio puras (sin React, sin Node, sin BD)
packages/contracts   Tipos y esquemas Zod compartidos
apps/api             Backend Fastify + Prisma
apps/mobile          App Expo (React Native)
```

Ver `CLAUDE.md` para el stack, el modelo de datos, las reglas de negocio y la
disciplina de trabajo.
