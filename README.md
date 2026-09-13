# MTD - OLP - Medicarte

Base técnica para reconstruir la operación descrita en
[`refactor.md`](.agent/specs/refactor.md).

La única secuencia funcional vigente es:

```text
Autorización
→ programación
→ demanda proyectada
→ consolidación
→ orden de compra
→ entrega
→ recepción
→ inventario
→ aplicación al paciente
```

## Estado de la base

Se conserva únicamente infraestructura transversal:

- monorepo TypeScript;
- API NestJS y web Next.js;
- PostgreSQL con Drizzle;
- Redis y BullMQ;
- autenticación local y RBAC por organización;
- auditoría técnica, outbox e idempotencia;
- migraciones históricas para cumplir la estrategia `EXPAND → BACKFILL → VERIFY → SWITCH → CONTRACT`.

Los módulos operativos anteriores fueron retirados porque asociaban programación,
OC, dispensación y aplicación directamente a `authorization_items`. Las columnas y
tablas antiguas permanecen solamente para futura consulta y migración histórica; no
existe código activo que cree nuevas operaciones mediante ese modelo.

## Desarrollo

Requisitos: Node.js `>=22`, Corepack, Docker y Docker Compose.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d --build
```

Servicios locales:

- Web: <http://localhost:3002>
- API: <http://localhost:3001>
- OpenAPI: <http://localhost:3001/api/v1/docs>
- PostgreSQL: `localhost:15432`
- Redis: `localhost:6379`

## Verificación

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
```

La implementación nueva debe seguir el orden obligatorio de fases definido en
`.agent/specs/refactor.md`.
