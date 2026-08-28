# Operación de la fundación técnica

## Configuración

- Los procesos validan variables de ambiente al iniciar y fallan temprano si falta una obligatoria.
- Los secretos reales no pertenecen al repositorio. `.env.example` solo documenta nombres y valores locales no sensibles.
- El realm importado y sus credenciales conocidas son solo para desarrollo; todos los puertos publicados por Compose se enlazan a loopback.
- `OIDC_ISSUER` debe ser la URL pública que aparece en el token. `OIDC_JWKS_URL` permite resolver las llaves por una red privada.
- Producción queda bloqueada si la infraestructura seleccionada no satisface la región Colombia definida en ADR-017.

## Ejecución local

```bash
pnpm install
docker compose up -d --wait postgres redis keycloak
DATABASE_URL=postgresql://authorization:authorization@localhost:15432/authorization pnpm db:migrate
docker compose up -d --build api worker web
```

Usuario técnico local de verificación: `foundation-admin`. La credencial del realm importado es exclusivamente local y debe sustituirse fuera de desarrollo.

## Convenciones asíncronas

- Los eventos permanecen en PostgreSQL hasta que el dispatcher los entrega a BullMQ.
- Los consumidores validan nombre, versión, payload, correlation ID e idempotency key.
- El efecto lógico se deduplica en `job_results`; Redis no decide si el efecto ya ocurrió.
- Después de tres intentos con backoff exponencial, el job queda en `foundation.dead-letter` sin eliminación automática.

## Endpoints operativos

- `GET /api/v1/health`: API, PostgreSQL y Redis.
- `GET /api/v1/metrics`: métricas Prometheus.
- `GET /api/v1/admin/dead-letter-jobs`: fallos durables, protegido por organización y `platform.jobs.manage`.
- `GET /api/v1/openapi.json`: contrato OpenAPI.
- `POST /api/v1/foundation/events`: sonda autenticada no productiva para probar auditoría, outbox, job e idempotencia.
