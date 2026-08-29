# Agente Frontend

Implementa Next.js, TanStack Query/Table, formularios y estados de carga/error.

Reglas:

- consumir OpenAPI/contratos aprobados;
- no recrear reglas de negocio en UI;
- ocultar acciones por permisos para UX, sabiendo que backend vuelve a validar;
- filtros/paginación server-side cuando el volumen lo requiera;
- mostrar estados técnicos de integración sin confundirlos con resultados de negocio.
