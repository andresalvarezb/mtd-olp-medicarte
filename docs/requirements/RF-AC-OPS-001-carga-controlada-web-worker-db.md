# RF-AC-OPS-001 — Carga controlada en Alto Costo

**Estado:** dirección de solución confirmada por el usuario el 2026-11-11; diseño incremental pendiente de implementar y validar.

**Fecha:** 2026-11-11.

**Alcance:** pantallas, API, worker, consultas a Google Drive y PostgreSQL que participan en el flujo de Alto Costo.

**Relacionado:** [RF-PAC-002 — Tarjeta de paciente en el flujo de Alto Costo](./RF-PAC-002-tarjeta-paciente-alto-costo.md).

## 1. Propósito

Evitar que el uso normal de Alto Costo produzca picos innecesarios de consultas, conexiones o llamadas a servicios externos. La información seguirá disponible para las personas autorizadas, pero se cargará y actualizará en partes pequeñas, con límites claros y posibilidad de continuar el trabajo después de una interrupción.

La propuesta aborda cuatro lugares: la carga de las pantallas, el procesamiento del worker, la búsqueda de soportes en Drive y la consulta de autorizaciones en PostgreSQL.

## 2. Explicación sencilla

Hoy algunas partes ya trabajan por páginas o lotes. Eso limita cuánto se envía en una respuesta, pero no siempre limita cuánto trabajo debe hacer PostgreSQL para preparar esa respuesta. De manera similar, un worker puede procesar un grupo pequeño y aun así repetir ese trabajo con mucha frecuencia.

La meta es que el sistema haga el trabajo necesario una sola vez cuando sea posible, lo divida en partes manejables, guarde el punto donde quedó y reserve las consultas más pesadas para cuando realmente se necesitan.

## 3. Evidencia y límites del diagnóstico

### 3.1 Comportamiento observado en el código revisado

- La lista del maestro de pacientes solicita 25 registros por página. La lista de autorizaciones comienza con 10; el API permite hasta 100 por respuesta.
- El worker de sincronización local usa páginas de 50 pacientes y limita cada ejecución a 20 páginas. Conserva un cursor/checkpoint para poder continuar.
- La sincronización local de pacientes está programada para las 9:00 a. m. de Bogotá cuando está habilitada.
- El proceso de Drive conserva estado de revisión por autorización y limita la concurrencia por lote. El alcance de candidatos puede incluir todos los registros (`ALL`), según configuración.
- La consulta de autorizaciones calcula el total de coincidencias y aplica clasificación/orden antes de devolver la página. Una página pequeña no garantiza que el trabajo interno de la base sea pequeño.
- El pool de PostgreSQL tiene un máximo predeterminado de cuatro conexiones por instancia. El máximo conjunto depende de cuántas instancias de API y worker estén activas.

### 3.2 Mediciones históricas de Render compartidas en el diagnóstico

Estas cifras provienen de una consulta anterior de métricas de 30 días; no son una lectura nueva de esta fecha ni describen necesariamente el estado actual:

| Componente | Observación histórica | Qué permite concluir |
|---|---|---|
| API | El p95 de latencia llegó aproximadamente a 31,4 segundos; CPU observada baja en la muestra. | Hubo solicitudes muy lentas; las métricas por sí solas no identifican qué ruta o consulta las causó. |
| PostgreSQL | CPU máxima cercana a 14%; memoria máxima cercana a 714 MiB; conexiones entre 2 y 23, con promedio cercano a 8. | No se observó CPU alta de forma sostenida. Sí conviene correlacionar las conexiones y tiempos de espera con las caídas. |
| Worker | CPU baja y memoria máxima aproximada de 194 MB en la muestra. | No hay evidencia de saturación sostenida de CPU o memoria del worker en ese periodo. |
| Drive | En una muestra de alrededor de 98 minutos se procesaron cerca de 990 registros; el lote tuvo búsquedas de Drive por elemento. | El volumen de consultas externas puede ser alto; esta muestra no prueba cuántas llamadas se hacen ahora ni el alcance actualmente desplegado. |
| Incidentes | Se observaron reinicios de API/worker y errores de conexión a PostgreSQL/Redis en una ventana de caída. | La estabilidad de dependencias debe resolverse y observarse antes de ajustar capacidad o concurrencia. |

No se dispone en esta sesión de una lectura nueva de Render ni de un plan de ejecución reciente de la base. Tampoco se debe asumir que la rama local, que contiene cambios sin confirmar, coincide con el código desplegado. Por tanto, los cambios de consultas, límites o configuración deben comenzar con una comprobación del commit, variables efectivas y métricas actuales.

## 4. Propuesta por área

### 4.1 Pantallas web: traer solo lo que se está usando

**Objetivo:** que abrir Alto Costo o cambiar de página no descargue información que la persona no está viendo.

**Propuesta:**

1. Mantener las páginas pequeñas que ya existen. No aumentar su tamaño para “arreglar” lentitud sin medir.
2. Cargar detalles adicionales —por ejemplo, historial o datos personales— solo cuando la persona abra el panel o la acción correspondiente.
3. Evitar solicitudes repetidas cuando se actualiza una selección o se cambian filtros rápidamente. Si una consulta anterior ya no corresponde a la pantalla actual, cancelar o ignorar su respuesta.
4. Aplicar filtros antes de pedir resultados cuando el flujo funcional lo permita. Mantener filtros, permisos y resultados consistentes al cambiar de página.
5. Mostrar claramente cuándo se está cargando, cuándo no hay resultados y cuándo ocurrió un error; no iniciar recargas automáticas frecuentes como forma de ocultar errores.

**Lo que no se propone:** ocultar registros, cambiar quién puede consultarlos o quitar filtros operativos. La paginación es una forma de presentar datos, no una regla de acceso.

**Criterios de aceptación:**

- Abrir una lista no descarga todos los registros ni el detalle completo de cada fila.
- Cambiar de página o filtro produce una consulta para los nuevos parámetros y no mezcla respuestas viejas con nuevas.
- Abrir un detalle solicita solo la información asociada al registro seleccionado.
- Los permisos organizacionales y de punto se mantienen en el servidor y los mismos registros siguen visibles para el mismo usuario autorizado.

### 4.2 Worker: repartir el trabajo y poder continuarlo

**Objetivo:** que las tareas en segundo plano no compitan innecesariamente entre sí ni envíen grandes cantidades de trabajo a PostgreSQL de una sola vez.

**Propuesta:**

1. Mantener los bloques, cursores, checkpoints, idempotencia y reintentos que ya forman parte de la sincronización local.
2. Revisar cada tarea periódica para conocer su duración, intervalo, concurrencia, cantidad seleccionada y resultado. No iniciar otro ciclo de una misma tarea mientras el anterior continúe activo.
3. Agrupar inserciones de eventos/outbox de cada página en una operación de base de datos, en lugar de enviar una consulta individual por paciente, siempre que se conserven las claves idempotentes y el manejo de errores.
4. Limitar el trabajo máximo por ciclo y permitir que los ciclos siguientes continúen desde el checkpoint. El límite debe balancear tiempo de finalización y carga; no debe dejar trabajos incompletos sin alarma.
5. Aplicar pausas graduales al reintentar errores temporales y registrar intentos, para que una caída de DB o un límite de Drive no genere una avalancha de reintentos.
6. Coordinar el máximo de conexiones de API y worker con el número real de instancias y la capacidad del plan PostgreSQL. No aumentar conexiones como respuesta automática a una cola lenta.

**Criterios de aceptación:**

- Un ciclo tiene un máximo verificable de registros/páginas y no se solapa consigo mismo dentro de la misma instancia.
- Si el worker se reinicia, puede continuar sin duplicar eventos y sin saltarse pacientes.
- Los reintentos no producen repetición rápida e ilimitada.
- Los registros de operación indican duración, cantidad leída/procesada, reintentos y resultado, sin incluir información personal o secretos.
- El máximo de conexiones posible de todos los procesos queda documentado y es compatible con el límite de PostgreSQL.

### 4.3 Google Drive: traer novedades hacia Alto Costo

**Objetivo:** tratar Google Drive como origen de novedades y Alto Costo como destino. Dos veces al día, detectar archivos nuevos o modificados dentro de las carpetas autorizadas y registrar en el sistema únicamente los soportes que todavía no están vinculados o cuya información cambió. El ciclo ordinario no debe recorrer todas las autorizaciones para buscar sus archivos.

**Propuesta:**

1. Consultar el registro incremental de cambios de Drive cada 12 horas. Guardar un punto de continuación por cada unidad de Drive configurada y procesar los cambios en páginas de hasta 25 elementos. Si quedan más cambios, continuar con páginas adicionales en esa ejecución.
2. Filtrar archivos por las carpetas raíz configuradas e ignorar cambios ajenos a esas carpetas. Guardar el punto de continuación después de procesar cada página para poder reanudar tras un reinicio.
3. Conservar sin cambios la búsqueda de adjuntos actual. Cuando el archivo permita identificar una autorización, usar esa búsqueda existente para confirmar y obtener sus soportes; si no se puede identificar una autorización, ignorar el archivo.
4. Usar el identificador estable del archivo de Drive para evitar duplicados. Registrar en `authorization_drive_supports` los metadatos y el enlace (`webViewLink`) del archivo. Al abrir el soporte, Alto Costo dirige al usuario al enlace de Drive. No copiar el PDF binario a PostgreSQL; el archivo permanece en Drive.
5. Si un archivo cambia o se elimina, actualizar solo el soporte que corresponde a ese archivo y conservar su historial. Un barrido incompleto o un error de Drive no debe marcar otros soportes como ausentes.
6. Reintentar cambios fallidos con espera gradual: 5 minutos iniciales, duplicando cada espera hasta un máximo predeterminado de 12 horas. No avanzar el punto de continuación hasta haber persistido el cambio o haberlo guardado de forma durable para reintento.
7. Hacer una revisión inicial única y acotada de archivos existentes para establecer el inventario. Después, el proceso normal lee novedades; la reconstrucción del inventario completo queda como acción excepcional de recuperación.
8. Medir cambios recibidos, PDF dentro de alcance, soportes nuevos, actualizados, duplicados, no asociados y fallidos. Medir llamadas reales a Drive y no estimarlas solo por cantidad de autorizaciones.

**Criterios de aceptación:**

- El registro incremental se consulta dos veces al día y el ciclo ordinario no vuelve a ejecutar búsquedas por cada autorización.
- Cada página de cambios contiene como máximo 25 elementos; una ejecución puede procesar varias páginas para ponerse al día.
- Un PDF dentro de las carpetas autorizadas se vincula solo si se puede identificar su autorización con la búsqueda actual; si no, se ignora.
- Los archivos ya registrados no crean enlaces duplicados; los cambios de archivo actualizan el mismo registro.
- Abrir un soporte dirige al enlace de Drive y requiere que el usuario tenga acceso al archivo allí.
- Un cambio ajeno a las carpetas configuradas no modifica Alto Costo.
- Un fallo o reinicio no pierde cambios ni adelanta el punto guardado; el reintento es idempotente.
- Un archivo cuya autorización no se pueda identificar se ignora; no se crea una asociación por inferencia.
- Una página incompleta o un error no marca como eliminados los demás soportes.
- El volumen de llamadas de Drive baja respecto a las búsquedas actuales por autorización y queda medido directamente.

**Decisiones confirmadas por el usuario:** Drive es el origen de las novedades; Alto Costo recibe los soportes que aún no tiene; se procesan cambios dos veces al día, en páginas de hasta 25 elementos. Se conserva sin cambios la búsqueda de adjuntos ya definida. Los archivos sin autorización identificable se ignoran. El PDF permanece en Drive y Alto Costo guarda sus metadatos y el enlace para abrirlo.

### 4.4 PostgreSQL: descubrir qué consulta cuesta y optimizarla con evidencia

**Objetivo:** reducir el tiempo y recursos usados al consultar autorizaciones, sin cambiar el orden, los permisos o el significado de los resultados.

**Propuesta:**

1. Identificar rutas de API más lentas y frecuentes, correlacionando duración, filtros, página, organización y cantidad devuelta. No registrar documentos, nombres, perfiles personales ni tokens.
2. En un entorno seguro, obtener el plan de ejecución de las consultas representativas con datos semejantes a producción y revisar filas leídas, filas descartadas, ordenamientos y uso de memoria.
3. Revisar si el conteo exacto del total es necesario en cada interacción. Una opción es actualizar el total con menor frecuencia o devolver “hay más resultados”; esto requiere aprobación funcional porque cambia lo que la interfaz muestra.
4. Evaluar índices solo para filtros y uniones que las mediciones demuestren costosos. Un índice mejora algunas lecturas, pero ocupa espacio y puede volver más lentas las escrituras; se debe justificar cada uno.
5. Evaluar paginación por cursor para avanzar desde el último registro visto cuando el orden pueda expresarse de forma estable. La lista actual usa varios criterios calculados; por eso no se debe reemplazar `offset` por cursor sin resolver primero una clave de ordenamiento estable y probar equivalencia.
6. Considerar caché solo para datos que puedan reutilizarse y cuyo retraso sea aceptable. Las respuestas de autorización dependen de permisos, punto, cambios operativos y frescura; una caché compartida sin esas dimensiones podría mostrar resultados obsoletos o fuera de alcance.

**Criterios de aceptación:**

- Las consultas priorizadas tienen una medición base y una medición posterior con los mismos filtros y volumen comparable.
- Se reduce el tiempo o el trabajo de base medido sin empeorar de forma material las escrituras.
- Se conserva el orden de resultados, filtros, total/paginación acordados, aislamiento por organización y punto, y reglas de autorización.
- Pruebas comparan páginas iniciales, siguientes, vacías y fuera de rango, además de filtros y alcances de usuario.
- No se agregan índices, cachés ni cambios de esquema sin su revisión y validación correspondiente.

## 5. Orden de trabajo recomendado

| Fase | Trabajo | Motivo para hacerlo en este orden | Señal para continuar |
|---|---|---|---|
| **0. Aclarar el punto de partida** | Consultar Render otra vez; confirmar servicios, commit desplegado, variables activas, métricas recientes y ventana de las caídas. Separar los cambios locales existentes del código que realmente corre en producción. | Evita optimizar una versión o configuración distinta de la que usa Alto Costo. | Existe una línea base con hora, servicio, commit y configuración no secreta. |
| **1. Medir API y DB** | Ubicar endpoints lentos y consultas más costosas; comparar actividad normal y pico; revisar conexión total posible. | La latencia histórica de API fue alta y la DB tuvo conexiones interrumpidas; primero hay que saber qué solicitud explica el problema. | Se identifica al menos una consulta/ruta prioritaria y se conoce su plan/costo. |
| **2. Reducir repeticiones visibles en web** | Confirmar solicitudes duplicadas, mantener detalle bajo demanda y documentar el comportamiento de páginas y filtros. | Es un cambio acotado que puede evitar trabajo duplicado sin rediseñar consultas. | Se comprueba cuántas llamadas hace una interacción normal y queda un resultado base/posterior. |
| **3. Invertir el flujo Drive → Alto Costo** | Leer cambios de Drive cada 12 horas, asociar archivos nuevos/modificados, persistirlos idempotentemente y resolver nombres ambiguos de forma explícita. | Evita buscar en Drive desde cada autorización una y otra vez. | El punto de continuación sobrevive reinicios, no se duplican soportes y solo se procesan archivos dentro de las carpetas autorizadas. |
| **4. Afinar consultas y capacidad** | Ajustar SQL, índices, conteo/paginación o capacidad de conexión con base en mediciones. | Cambiar DB sin diagnóstico puede trasladar el cuello de botella o empeorar escrituras. | Comparación antes/después mantiene resultados funcionales y mejora el costo medido. |

Las fases pueden solaparse en investigación, pero los cambios se deben entregar en incrementos pequeños, con posibilidad de revertir cada uno. No se debe combinar un cambio de comportamiento, un cambio de SQL y una alteración de capacidad en una sola intervención difícil de diagnosticar.

## 6. Señales que debemos observar

Para saber si la mejora funciona, registrar y comparar al menos:

- **API:** duración p50/p95/p99 por ruta, errores y solicitudes por minuto.
- **PostgreSQL:** conexiones activas, conexiones esperando, consultas más lentas, tiempo de ejecución y lecturas de disco/memoria cuando estén disponibles.
- **Worker:** páginas/candidatos procesados, duración por ciclo, cola pendiente, reintentos y ciclos solapados evitados.
- **Drive:** número real de solicitudes, resultado, páginas de respuesta, errores de cuota y antigüedad del último chequeo.
- **Web:** solicitudes API generadas por abrir pantalla, cambiar filtro, cambiar página y abrir detalle.

Las mediciones deben usar datos agregados. No registrar identidades de pacientes ni cuerpos de respuesta personales.

## 7. Fuera de alcance

- Cambiar reglas de acceso, roles, puntos o visibilidad de autorizaciones.
- Cambiar cantidades, estados, vigencias, inventario, compras, dispensaciones o resultados de conciliación.
- Activar o desactivar integraciones, compuertas MTDOM/DP-07 o sincronizaciones de producción como parte de esta propuesta.
- Ejecutar migraciones, backfills, cambios de plan, reinicios o despliegues desde este documento.
- Copiar los archivos PDF binarios a PostgreSQL o a otro almacenamiento sin una decisión aparte.
- Introducir una caché de datos personales o de autorización sin definir frescura, aislamiento y revocación.

## 8. Decisiones pendientes antes de implementar

1. ¿Los PDFs con nombre distinto al número de autorización se deben buscar con la consulta de texto actual o enviar a revisión manual?
2. ¿La lista necesita mostrar un total exacto en todo momento, o acepta un indicador como “más resultados disponibles”?
3. ¿Qué rutas de consulta deben ser prioritarias según el uso diario de MEDICARTE?
4. ¿Qué ventana se tomará como carga pico representativa para comparar antes y después?
5. ¿Qué demora máxima de la sincronización de pacientes locales es aceptable si un lote debe continuar en el siguiente ciclo?

Estas decisiones no bloquean medir el estado actual ni corregir solicitudes duplicadas que no cambien el resultado. Sí deben resolverse antes de cambiar frescura de Drive, semántica del total o una regla de sincronización.

## 9. Evidencia de implementación necesaria

Cada fase implementada debe registrar:

- el commit y la configuración que se midieron;
- el comportamiento anterior y el nuevo;
- la comparación con carga semejante;
- pruebas de continuidad, duplicados y errores temporales para worker/Drive;
- pruebas de equivalencia de resultados y permisos para web/API/DB;
- el modo de revertir el cambio.

Las mediciones históricas descritas en este documento sirven para priorizar la investigación; no sustituyen una línea base actual ni autorizan cambios directos en producción.

## 10. Avance local — 2026-11-11

- El worker ahora tiene un modo de registro incremental de cambios de Drive: usa un cursor persistente por unidad de Drive, procesa páginas de hasta 25 cambios y no adelanta el cursor hasta terminar cada página.
- El cambio inicial conserva un backfill limitado a 25 autorizaciones por ejecución; al terminar, el ciclo normal procesa únicamente cambios de Drive. Los errores del backfill conservan el reintento gradual, con espera de 5 minutos iniciales y máximo predeterminado de 12 horas.
- Los archivos nuevos se vinculan cuando se puede identificar la autorización por el nombre exacto; para ellos se reutiliza sin cambios la búsqueda existente de nombre y texto. Los archivos sin autorización identificable se ignoran, según decisión del usuario.
- El enlace de Drive y los metadatos se guardan en la tabla existente; el PDF permanece en Drive y Alto Costo abre el enlace almacenado.
- No se modificó el SQL principal de autorizaciones porque en esta sesión no hubo plan de ejecución/medición actual. La paginación web, los abortos de solicitudes obsoletas y la carga de detalle bajo demanda ya están presentes en el código revisado; se mantienen sin cambios.
- No se consultó Render, no se ejecutaron pruebas, migraciones ni despliegues. Pasaron el build de `@authorization/config` y los typechecks de `@authorization/worker` y `@authorization/database`. La migración `0117_authorization_drive_change_cursor.sql` debe aplicarse mediante el proceso normal antes de activar el feed. La primera carga puede tardar varias ejecuciones, porque procesa 25 autorizaciones por vez. El modo actual no encuentra archivos nuevos con nombres libres si no es posible inferir una autorización; los ignora intencionalmente.
