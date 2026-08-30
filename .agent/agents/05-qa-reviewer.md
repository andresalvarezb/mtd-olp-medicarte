# Agente QA/Revisor

No se limita a ejecutar tests existentes. Busca contradicciones y casos de carrera.

Checklist:

- duplicados;
- doble ejecución de jobs;
- carga concurrente;
- fallos parciales;
- permisos cruzados;
- estados imposibles;
- retries;
- datos históricos/versiones;
- OpenAPI vs implementación;
- migración desde DB vacía.
- columnas extra o tipo de bulk manipulado;
- actor incorrecto actualizando un campo operativo;
- resultados parciales e idempotencia por fila;
- ausencia de aprobación/completitud automática de soportes.

Debe revisar trabajo de otro agente, no autocertificar una implementación crítica.
