---
name: local-test-environments
description: Prepara, reutiliza y coordina entornos locales de pruebas con PostgreSQL, Redis, API y Worker, especialmente entre varias suites, procesos o worktrees. Actívala al levantar, compartir, aislar, paralelizar o limpiar esos entornos; no para pruebas unitarias sin servicios, CI, prodshadow ni despliegues remotos.
---

# Entornos locales para pruebas

## Objetivo y límites

Mantener las pruebas locales conectadas a servicios y datos de prueba identificados, evitando colisiones con otros procesos y pérdida de datos ajenos. Esta skill coordina los scripts existentes; no los reemplaza ni autoriza accesos a producción, cambios de infraestructura compartida, instalaciones, despliegues ni borrados generales.

## Procedimiento

1. Lee `AGENTS.md`, el `package.json` y los scripts que ejecutará la tarea. Revisa `git status --short --branch` y detecta modo de shell/host. No asumas que otro proceso o contenedor pertenece a esta tarea.
2. Clasifica servicios y efectos de la prueba: unitarias sin dependencias, integración con Compose, instancia local `db:test`, o `prodshadow`. Si el destino real no es inequívocamente un recurso local de pruebas, detente y aclara antes de conectarte o mutarlo.
3. Decide aislamiento antes de ejecutar:
   - Para un conjunto acotado de pruebas de integración, prefiere `pnpm.cmd test:integration:focused -- tests/integration/archivo.test.ts` en PowerShell. El modo predeterminado crea proyecto/puertos aislados, prepara servicios y limpia **su propio** proyecto efímero al terminar.
   - Para iteración repetida, permite un proyecto reutilizable dedicado con `INTEGRATION_REUSE=1`, nombre explícito `mtd-olp-medicarte-integration-<uuid>`, puertos reservados y `DATABASE_URL` correspondiente. Sigue `AGENTS.md` para sus valores. El runner exige archivos explícitos, valida proyecto, servicios, puerto e identidad PostgreSQL, y ejecuta `db:reset --yes`. Antes de correrlo, informa ese reset y requiere autorización explícita para usar esa base desechable; nunca continúes si puede contener datos que deban conservarse.
   - Reutilizar un stack o una base es modo **serial**. No lances suites/procesos simultáneos contra ese entorno: pueden hacer reset o modificar los mismos datos.
   - Para paralelismo, cada ejecución necesita su propio proyecto Compose, puertos y base, sin compartir volúmenes ni URLs. Usa runners que creen ese aislamiento automáticamente. Si la herramienta no permite probar que todos esos recursos son distintos, serializa; cambiar solo el nombre Compose no aísla una base externa compartida.
4. Antes de levantar o limpiar, confirma el nombre exacto del proyecto y sus servicios con los comandos/scripts documentados. No detengas servicios por nombre genérico, no uses `docker compose down` sin el archivo y proyecto explícitos, y nunca uses `down -v` sobre un entorno reutilizable o ajeno. Si un recurso ya existe y su propietario/propósito no está claro, no lo reclames ni lo limpies.
5. Ejecuta solo archivos explícitos para integración. Mantén `DATABASE_URL`, `API_URL` y puertos alineados con el entorno seleccionado; no exportes variables globales persistentes para una ejecución puntual. No cambies servicios locales existentes solo para hacer pasar pruebas.
6. Si falla, recupera logs del proyecto propio, separa errores de setup de fallos funcionales y deja los servicios reutilizables intactos. No repitas automáticamente una suite que resetea datos sin volver a comprobar su destino.
7. Al cerrar, confirma resultado y recursos: el modo efímero debe quedar limpio; el reutilizable puede permanecer activo si ya lo estaba o si se preparó expresamente para iteración. Limpia solo el proyecto temporal propio y reporta modo, suites, destino verificado, limpieza y limitaciones.

## Límites especiales

- `pnpm.cmd db:test:*` administra una instancia PostgreSQL local dedicada en TEST; verifica el destino antes de migrar, sembrar o detenerla. No confundas su puerto/base/directory con servicios locales de desarrollo.
- `prodshadow` es un flujo separado y queda fuera de esta skill. No lo uses como sustituto del entorno de integración ni lo limpies desde aquí.
- Si faltan Docker/Compose/Redis/PostgreSQL, informa el bloqueo y no sustituyas la verificación por una conexión a un servicio de desarrollo o producción.
- Nunca ejecutes migraciones, resets, seeds o limpiezas sobre destinos ambiguos o ajenos. No imprimas credenciales ni datos personales en reportes.

## Definición de terminado

Las pruebas solicitadas terminaron o su bloqueo quedó explicado; el entorno y la base usados fueron identificados y verificados; no hubo concurrencia sobre estado compartido; y solo se limpiaron recursos temporales propios.
