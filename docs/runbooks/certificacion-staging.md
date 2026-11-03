# Runbook de certificación de staging

**Propósito:** reunir evidencia para AUD-P0-04 en un staging aislado. Este
runbook es una guía de ejecución; no registra un despliegue, una restauración ni
una integración ya probada.

**Restricciones:** usar únicamente datos sintéticos. No importar dumps de
producción, datos clínicos reales, tokens, Secret Files ni valores de variables
al repositorio o a la evidencia compartida. No ejecutar contra producción.
Staging debe estar aislado de las bases, colas, Drive y Sheets productivos.

El runbook debe completarse para un SHA candidato limpio y sus artefactos
inmutables. Si staging aislado o la autorización de Operaciones no existen,
registrar el bloqueo y detener las acciones que dependan de ellos.

## 1. Ficha de ejecución

Completar antes de comenzar; anonimizar IDs internos si la evidencia sale del
equipo de operaciones.

| Campo                                             | Valor     |
| ------------------------------------------------- | --------- |
| Fecha/hora inicio y zona horaria                  | Pendiente |
| Entorno/servicios Render de staging               | Pendiente |
| SHA candidato (`git rev-parse HEAD`)              | Pendiente |
| Rama y estado limpio del checkout                 | Pendiente |
| Deploy IDs de Web, API y Worker                   | Pendiente |
| Digest de imagen Web/API/Worker                   | Pendiente |
| PostgreSQL y versión                              | Pendiente |
| Ejecutores y aprobadores                          | Pendiente |
| ID de evidencia o carpeta segura                  | Pendiente |
| Política aprobada de backup, RPO, RTO y retención | Pendiente |

No anexar variables resueltas, tokens, JSON de credenciales, URLs con
credenciales ni datos personales. Guardar pruebas de presencia como `sí/no`,
fecha de verificación y ejecutor.

## 2. Precondiciones y decisión de continuar

1. Confirmar autorización escrita para operar el staging aislado, responsables
   disponibles y ventana de prueba.
2. Confirmar que staging tiene recursos propios y no comparte DATABASE_URL,
   REDIS_URL, cuenta MIPRES, Drive, spreadsheet, alertas ni credenciales con
   producción.
3. Confirmar SHA limpio y aprobado por los gates de GitHub CI. Adjuntar enlace o
   identificador del run y su resultado; este runbook no sustituye CI.
4. Confirmar que el commit corresponde al desplegado y guardar el SHA mostrado
   por Render. Registrar el digest de cada imagen; no basta el tag `latest`.
5. Confirmar política aprobada de backup, RPO/RTO, retención, cifrado y
   responsables. Si falta, no declarar continuidad certificada y no improvisar
   umbrales.
6. Revisar en `docs/render-runtime-configuration.md` las claves de cada
   servicio. En Render Dashboard, comprobar únicamente presencia/ausencia y
   estado, ocultando valores. Verificar los Secret Files y su nombre/tamaño, sin
   leer ni copiar contenido en el acta. Confirmar que las raíces Drive
   autorizadas corresponden al conjunto aprobado: el consumidor combina la
   variable singular histórica y la lista plural CSV.
7. Confirmar que `GOOGLE_DRIVE_AUDIT_SYNC_ENABLED=false` y
   `RECONCILIATION_SCHEDULER_ENABLED=false`. Verificar que
   `SCHEDULER_ENABLED=true` solo gobierne los trabajos existentes de Worker.
   Si se requiere una excepción, documentar aprobador, duración y reversión
   antes de cambiarla.

**No continuar** ante SHA/digest no identificable, recursos compartidos con
producción, clave crítica ausente, dato real, política sin aprobación cuando se
pruebe restore, job inesperado, o error de migración. Registrar el hallazgo,
hora, servicio y evidencia redactada; no pegar secretos ni payloads.

## 3. Despliegue e imágenes

1. Verificar el plan de despliegue y los artefactos de Web, API y Worker para el
   SHA aprobado. Guardar los deploy IDs, SHA observado, digests y resultado de
   arranque/salud.
2. Revisar salud de API (`/api/v1/health`) y Web por sus URLs de staging. Probar
   el acceso no autenticado esperado y un actor sintético autorizado por cada
   organización; confirmar una solicitud protegida sin token devuelve rechazo.
3. Verificar logs de arranque por errores de configuración, conexión o
   credenciales, ocultando URLs y valores. Confirmar que logs y métricas no
   contienen datos personales, tokens o documentos.
4. Registrar resultado por servicio:

| Servicio | Deploy ID | SHA observado | Digest de imagen | Health / arranque | Evidencia |
| -------- | --------- | ------------- | ---------------- | ----------------- | --------- |
| Web      | Pendiente | Pendiente     | Pendiente        | Pendiente         | Pendiente |
| API      | Pendiente | Pendiente     | Pendiente        | Pendiente         | Pendiente |
| Worker   | Pendiente | Pendiente     | Pendiente        | Pendiente         | Pendiente |

## 4. Migraciones y estado de datos

1. Antes del deploy, tomar el backup de staging según la política aprobada y
   verificar que el artefacto de backup es legible. Registrar identificador,
   fecha y tamaño; nunca adjuntar su contenido.
2. Revisar el resultado de los `preDeployCommand` de API y Worker. Ambos
   servicios declaran `node packages/database/dist/migrate.js`: confirmar que
   las migraciones terminaron sin error ni ejecución concurrente insegura.
   Detener y escalar si hay fallo, divergencia o duda sobre el orden.
3. Consultar de forma de solo lectura el historial/journal de la base de
   staging. Asociar cada migración aplicada con el SHA/digest y comparar con
   `packages/database/migrations/meta/_journal.json` del candidato. No marcar
   un drift como resuelto con SQL manual.
4. Ejecutar catálogo/schema checks y consultas de integridad aprobadas: claves
   foráneas, constraints, conteos sintéticos, referencias de inventario,
   cantidades de reservas y movimientos. Guardar solo consultas sin datos
   personales y resultados agregados.
5. Confirmar que no hubo cambios no planeados y que el servicio se mantiene
   saludable. Si el schema no es compatible con la versión previa, bloquear el
   rollback de imagen y preparar una corrección forward aprobada.

| Control                          | Esperado                                  | Resultado / evidencia |
| -------------------------------- | ----------------------------------------- | --------------------- |
| Backup previo identificado       | Sí; staging sintético y política aprobada | Pendiente             |
| Migraciones predeploy API/Worker | Completas, sin error ni carrera           | Pendiente             |
| Journal aplicado vs. candidato   | Sin drift no explicado                    | Pendiente             |
| Constraints/FK e invariantes     | Sin violaciones                           | Pendiente             |
| SHA/digest y schema documentados | Sí                                        | Pendiente             |

## 5. Variables, integraciones y jobs

Para cada clave, registrar `presente`, `ausente` o `no aplica` sin guardar el
valor. Verificar por separado API y Worker en el Dashboard; `sync: false` no
rellena las claves nuevas en servicios ya existentes.

| Prueba sintética                            | Criterio de aceptación                                                                                              | Resultado |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------- |
| MIPRES desde API                            | Cuenta de pruebas/autorización sintética; éxito y error/degradación controlados; sin token ni datos clínicos en log | Pendiente |
| Google Sheets desde API                     | Spreadsheet sandbox; escritura/lectura de fila sintética, idempotencia y error controlado                           | Pendiente |
| Google Drive bajo demanda desde API         | Carpeta sandbox; búsqueda limitada a IDs autorizados; archivo sintético y denegación fuera de scope                 | Pendiente |
| Sincronización periódica Drive desde Worker | Toggle observado `false`; sin ejecución periódica                                                                   | Pendiente |
| Despacho outbox y barrido Worker            | Trabajo sintético, una sola ejecución lógica, sin duplicados y estado observado                                     | Pendiente |
| Scheduler de reconciliación                 | Toggle `false`; no dispara automáticamente                                                                          | Pendiente |
| Reconciliación manual                       | Solo sobre dataset sintético; resultado revisado por Inventario/Finanzas; no aplicar correcciones no aprobadas      | Pendiente |
| Sentry / OpenTelemetry                      | No aplica hasta decisión de Operaciones; si se habilita, verificar destino y alerta sin exponer DSN                 | Pendiente |
| Dead letter / backlog / alertas             | Visibilidad y procedimiento de recuperación demostrados con evento sintético                                        | Pendiente |

No utilizar facturas, pacientes, autorizaciones, documentos o cuentas reales como
fixtures. Para cada prueba registrar actor, hora, resultado HTTP/estado, IDs
sintéticos, correlación y consultas agregadas. Limpiar fixtures mediante la vía
soportada y confirmar ausencia de restos.

## 6. Backup y restore drill

1. Usar un backup generado en staging con datos sintéticos y retención aprobada.
   No usar una copia ni dump de producción, aunque se afirme que está
   anonimizado.
2. Restaurar el backup en una instancia PostgreSQL descartable, aislada de
   producción y staging operativo. Medir por separado el tiempo de preparación,
   restauración y validación; compararlo con el RTO aprobado.
3. Verificar identificador/fecha del backup, versión de PostgreSQL, que la
   restauración terminó, conteos agregados, integridad referencial, invariantes
   de inventario/reservas y health/smoke de solo lectura.
4. Ejecutar reconciliación manual sobre los datos sintéticos restaurados y
   confirmar el resultado esperado con Inventario y Finanzas. No aceptar
   diferencias desconocidas ni auto-repararlas durante el drill.
5. Registrar RPO observado con timestamps del backup y del conjunto restaurado;
   registrar RTO observado y cualquier desviación frente a la política.
6. Destruir la instancia descartable de acuerdo con el proceso de staging y
   registrar que se eliminó. Conservar solo el acta, métricas agregadas y
   referencia segura del backup según la retención aprobada.

| Medida                       | Aprobado                   | Observado | Evidencia / aprobador |
| ---------------------------- | -------------------------- | --------- | --------------------- |
| RPO                          | Pendiente de política      | Pendiente | Pendiente             |
| RTO                          | Pendiente de política      | Pendiente | Pendiente             |
| Retención/cifrado            | Pendiente de política      | Pendiente | Pendiente             |
| Backup legible y restaurable | Sí                         | Pendiente | Pendiente             |
| Integridad y reconciliación  | Sin hallazgos no aceptados | Pendiente | Pendiente             |

## 7. Reversión y recuperación

1. Antes de desplegar, identificar el último digest sano y aprobado, el estado
   de migraciones y el backup sintético de staging.
2. Ante fallo de salud, migración, integración o integridad: detener promoción,
   capturar evidencia redactada y declarar el servicio/flujo afectado. No
   ejecutar SQL manual ni volver a habilitar jobs para “arreglar” datos.
3. Volver a la imagen anterior solo si las migraciones aplicadas son compatibles
   con ella y la revisión de Operaciones lo autoriza. No asumir que revertir una
   imagen revierte la base.
4. Si la migración no es compatible o dejó cambios parciales, mantener el
   entorno bloqueado y preparar una migración/corrección forward revisada.
   Cualquier restauración es sobre staging aislado con datos sintéticos y
   requiere aprobación del dueño de la base.
5. Repetir health, integridad, smoke y reconciliación después de la recuperación;
   registrar nuevo SHA/digest y aprobación. No promover mientras quede una
   diferencia no explicada.

## 8. Acta y salida

Adjuntar o enlazar de forma segura evidencia de CI, despliegues, imágenes,
migraciones, presencia de configuración, jobs, integración sintética,
reconciliación, backup/restore, tiempos observados y aprobaciones. Cada
resultado debe indicar SHA, entorno, actor, fecha/hora y `PASS`, `FAIL` o
`BLOQUEADO`; un `PASS LOCAL` no sustituye staging.

| Área                          | Resultado | Responsable               | Evidencia por SHA | Bloqueos/seguimiento                     |
| ----------------------------- | --------- | ------------------------- | ----------------- | ---------------------------------------- |
| CI y artefactos               | Pendiente | Pendiente                 | Pendiente         | Pendiente                                |
| Render/configuración          | Pendiente | Pendiente                 | Pendiente         | Pendiente                                |
| Migraciones/integridad        | Pendiente | Pendiente                 | Pendiente         | Pendiente                                |
| Integraciones/jobs            | Pendiente | Pendiente                 | Pendiente         | Pendiente                                |
| Backup/restore/reconciliación | Pendiente | Pendiente                 | Pendiente         | Pendiente                                |
| UAT/seguridad                 | Pendiente | Pendiente                 | Pendiente         | Pendiente                                |
| Decisión de liberar staging   | Pendiente | Administrador del sistema | Pendiente         | AUD-P0-04 sigue abierto hasta aprobación |

No usar este documento para declarar un hallazgo cerrado antes de completar la
evidencia y las aprobaciones exigidas en [checklist de liberación](../release-checklist.md).
