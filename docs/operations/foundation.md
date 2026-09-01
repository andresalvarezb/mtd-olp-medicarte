# Operación de la fundación técnica

## Configuración

- Los procesos validan variables de ambiente al iniciar y fallan temprano si falta una obligatoria.
- Los secretos reales no pertenecen al repositorio. `.env.example` solo documenta nombres y valores locales no sensibles.
- El realm importado y sus credenciales conocidas son solo para desarrollo; todos los puertos publicados por Compose se enlazan a loopback.
- `OIDC_ISSUER` debe ser la URL pública que aparece en el token. `OIDC_JWKS_URL` permite resolver las llaves por una red privada.
- La Web usa exclusivamente `NEXT_PUBLIC_OIDC_ISSUER`; las variables antiguas `NEXT_PUBLIC_OIDC_URL` y `NEXT_PUBLIC_OIDC_REALM` no son válidas.
- Producción queda bloqueada si la infraestructura seleccionada no satisface la región Colombia definida en ADR-017.
- La preparación del Blueprint de Render, sus secretos, puertos y variables está documentada en [render.md](render.md).

## Ejecución local

```bash
pnpm install
docker compose up -d --wait postgres redis keycloak mipres-mock
DATABASE_URL=postgresql://authorization:authorization@localhost:15432/authorization pnpm db:migrate
docker compose up -d --build api worker web
```

Usuario técnico local de verificación: `foundation-admin`. La credencial del realm importado es exclusivamente local y debe sustituirse fuera de desarrollo.

## Mock de MIPRES (Fase 3)

`infra/mipres-mock/server.mjs` emula `GenerarToken` y `DireccionamientoXPrescripcion` para desarrollo y pruebas E2E. El comportamiento se selecciona por el último dígito del número de prescripción: `0` vigente, `1` sin direccionamientos, `2` anulados, `3` vencido, `4` igualdad con hoy Bogotá, `5` HTTP 500, `6` HTTP 401, `7` respuesta no interpretable. En producción `MIPRES_BASE_URL` apunta al servicio real y el mock no participa.

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
- `/api/v1/users`: CRUD de usuarios con acceso y bandeja de solicitudes (permiso `users.manage`). Ver [gestión-usuarios.md](gestion-usuarios.md).
