# ADR-019 — Repositorio GitHub independiente en monorepo
**Estado:** ACCEPTED

## Contexto
La plataforma de autorizaciones constituye un producto con frontend, API, worker, contratos, dominio, infraestructura y documentación propios. Integrarla en `vita-back` o `vita-core` introduciría acoplamiento innecesario con otro bounded context.

## Decisión
Crear un repositorio nuevo e independiente en GitHub, estructurado como monorepo.

Estructura base:

```text
authorization-platform/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
├── packages/
│   ├── contracts/
│   ├── database/
│   ├── domain/
│   ├── ui/
│   └── config/
├── docs/
├── infra/
├── tests/
└── .agent/
```

## Consecuencias
- Web, API y worker evolucionan coordinadamente.
- Contratos, validaciones y tipos pueden compartirse sin publicar paquetes externos.
- Se evita acoplar la plataforma a `vita-back`/`vita-core`.
- CI/CD se administra desde un único repositorio.
- Deben imponerse límites internos de dependencias para evitar acoplamiento circular.
