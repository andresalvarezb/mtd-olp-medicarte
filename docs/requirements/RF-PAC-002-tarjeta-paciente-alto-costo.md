# RF-PAC-002 — Tarjeta contextual de paciente en Alto Costo

**Estado:** fuera del alcance activo por aclaración funcional del 2026-11-11.
**Relacionado:** [RF-PAC-001 — Maestro dinámico de pacientes e integración con MTDOM](./RF-PAC-001-maestro-pacientes-mtdom.md).

MEDICARTE y COMPENSAR mantienen `/autorizaciones/consulta` como funciona actualmente: búsqueda, filtros, detalle y datos existentes. Este proyecto no agrega una tarjeta de datos personales de MTDOM, un endpoint contextual ni un permiso nuevo para esas organizaciones.

El módulo `/pacientes`, incluido el acceso a los datos personales definidos por RF-PAC-001, corresponde únicamente a usuarios MTD autorizados. Cualquier propuesta futura de tarjeta requiere una nueva decisión de alcance antes de implementar.
