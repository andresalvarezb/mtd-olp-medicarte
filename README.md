# MTD – OLP – Medicarte

Plataforma operacional para el ciclo de autorizaciones, compras, logística,
recepciones, disponibilidad, atención y auditoría. El repositorio no define un
nombre comercial oficial para la aplicación.

> **Alcance de esta documentación:** lectura del código y los archivos de la rama
> `develop` en el commit `7ced5792c08faf35e673e2f1c2ca4571892ab87a`
> (17 de octubre de 2026). La presencia de una ruta o módulo en el código no
> constituye evidencia de una prueba de integración o de despliegue exitoso.

## Flujo operativo

```text
MTD: carga/actualización de AUTO y validación de elegibilidad
   ├─ programación y consolidación de demanda (cuando corresponda)
   └─ OC y relación histórica AUTO–producto–cantidad
        → OLP: revisión/aceptación y gestión logística
        → MEDICARTE: recepción física confirmada
        → disponibilidad/asignaciones sobre existencias comprobables
        → entrega o aplicación al paciente
        → trazabilidad, auditoría y conciliación
```

**Una OC no equivale a stock recibido ni autoriza por sí sola el consumo.**
La relación histórica de la OC con las autorizaciones debe distinguirse de la
existencia física, la reserva y el consumo. Véase
[ADR-043](docs/adr/043-authorization-order-receipt-fulfillment-reassignment.md).

## Componentes disponibles en el código

- **API:** NestJS 11; autenticación local JWT y controles de permisos/organización.
- **Web:** Next.js 16, React 19; páginas de autorizaciones, OC, programación,
  demanda, recepciones, disponibilidad, auditorías, MIPRES, indicadores y administración.
- **Worker:** BullMQ/Redis y outbox; tareas programadas de liberación por vencimiento,
  entre otras funciones condicionadas por configuración.
- **Persistencia:** PostgreSQL 17; Drizzle y migraciones versionadas.
- **Módulos de negocio:** importaciones XLSX, anexo tarifario, consulta y edición
  de autorizaciones, anulación, planeación, compras, inventario, entregas,
  aplicaciones, auditorías, exportables y reconciliación.
- **Observabilidad:** endpoint de salud, métricas, trazas y captura de errores
  según configuración.

Esta lista refleja clases y rutas registradas. Las decisiones funcionales
pendientes deben contrastarse con las implementaciones y las pruebas.

## Inicio rápido: desarrollo local

Requisitos: Node.js `>=22`, Corepack/pnpm, Docker con Compose y Bash
(Git Bash en Windows).

```bash
corepack enable
pnpm install --frozen-lockfile
bash scripts/local.sh up
```

El script crea `.env.local` desde `.env.local.example` si no existe y levanta
PostgreSQL, Redis, un mock de MIPRES y el servicio `dev` con recarga de código.
`dev` instala dependencias en el contenedor y aplica migraciones antes de iniciar
API, Web y Worker. Revise **antes de iniciar** los valores de `.env.local`:
los usuarios y contraseñas de ejemplo son exclusivamente para ambientes aislados.

| Servicio | Dirección local predeterminada |
| --- | --- |
| Web | <http://localhost:3002> |
| API/health | <http://localhost:3001/api/v1/health> |
| Swagger | <http://localhost:3001/api/v1/docs> |
| OpenAPI JSON | <http://localhost:3001/api/v1/openapi.json> |
| PostgreSQL | `127.0.0.1:15432` |
| Redis | `127.0.0.1:16379` |
| Mock MIPRES | `127.0.0.1:18090` |

```bash
bash scripts/local.sh status
bash scripts/local.sh logs dev
bash scripts/local.sh down
```

**No confunda** `docker-compose.local.yml` (desarrollo local) con
`docker-compose.yml` (infraestructura usada por integración/CI). Sus nombres de
base de datos y algunos puertos son diferentes.

## Comprobaciones

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
```

`pnpm test:integration` requiere el entorno de integración correspondiente;
no equivale a una comprobación ejecutada por la actualización de estos archivos.

## Documentación

- [Arquitectura y límites de dominio](docs/architecture-current.md)
- [Guía de desarrollo y verificación](docs/development-guide.md)
- [Mapa de API y seguridad](docs/api-guide.md)
- [Inventario documental y riesgos conocidos](docs/documentation-status.md)
- [ADR-043: AUTO, OC, recepción, consumo y reasignación](docs/adr/043-authorization-order-receipt-fulfillment-reassignment.md)
- [ADR-044: invalidaciones realtime](docs/adr/044-realtime-operational-invalidation.md)
- [BR-AUTO-ANNUL-001: anulación](docs/requirements/BR-AUTO-ANNUL-001-anulacion-autorizacion.md)
- [BR-AUTO-REN-001: renovación de vigencia](docs/requirements/BR-AUTO-REN-001-estado-16-vigencia.md)

`.agent/adr`, `.agent/specs` y `.agent/plans` contienen decisiones, diagnósticos y
planes históricos. No asuma que una propuesta de esas carpetas fue implementada;
verifique código, migraciones y pruebas en `develop`.
