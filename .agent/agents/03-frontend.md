# Agente Frontend

Implementa Next.js, TanStack Query/Table, formularios y estados de carga/error.

Reglas:

- consumir OpenAPI/contratos aprobados;
- no recrear reglas de negocio en UI;
- ocultar acciones por permisos para UX, sabiendo que backend vuelve a validar;
- filtros/paginación server-side cuando el volumen lo requiera;
- mostrar estados técnicos de integración sin confundirlos con resultados de negocio.
- ofrecer descargas completas y cargas reducidas por tipo de operación; no formularios individuales para lugar/fechas;
- no asumir que ocultar columnas impide su envío: el contrato cerrado se valida en backend.
