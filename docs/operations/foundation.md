# Operación de la fundación técnica

## Configuración

- Los procesos validan variables de ambiente al iniciar y fallan temprano si falta una obligatoria.
- Los secretos reales no pertenecen al repositorio. `.env.example` solo documenta nombres y valores locales no sensibles.
- Las credenciales sembradas por Compose son solo para desarrollo; todos los puertos publicados por Compose se enlazan a loopback.
- La autenticación es local (ADR-026): la API valida usuario/contraseña contra PostgreSQL (Argon2id) y emite su propio JWT. `AUTH_JWT_SECRET` exige ≥256 bits. Keycloak/OIDC ya no participan.
- La Web se configura únicamente con `NEXT_PUBLIC_API_URL`; no existen variables OIDC.
- La región de producción aprobada en ADR-017/DEC-009 es Virginia (USA); la ausencia de región Colombia no bloquea producción.
- La preparación del Blueprint de Render, sus secretos, puertos y variables está documentada en [render.md](render.md).

## Ejecución local

```bash
pnpm install
docker compose up -d --wait postgres redis mipres-mock
DATABASE_URL=postgresql://authorization:authorization@localhost:15432/authorization pnpm db:migrate
docker compose up -d --build api worker web
```

Usuario técnico local de verificación: `foundation-admin` / `foundation-admin` (creado por el
bootstrap de `AUTH_BOOTSTRAP_ADMIN_*` en Compose; exclusivamente local y debe sustituirse fuera de
desarrollo).

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
- `POST /api/v1/auth/login`: autenticación local (Argon2id + JWT propio) con rate limiting dedicado.
- `GET /api/v1/openapi.json`: contrato OpenAPI.
- `POST /api/v1/foundation/events`: sonda autenticada no productiva para probar auditoría, outbox, job e idempotencia.
- `/api/v1/users`: CRUD administrativo de usuarios locales con asignaciones (permiso `users.manage`). Ver [gestión-usuarios.md](gestion-usuarios.md).
