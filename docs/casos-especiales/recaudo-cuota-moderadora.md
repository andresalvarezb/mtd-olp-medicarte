# CE-85 a CE-88 — Recaudo de cuota moderadora y factura

**Corte de código:** checkout `3627564` (2026-10-29). **Estado:** implementado en fuente; escenarios operativos pendientes de ejecución. El recaudo financiero no registra entrega, aplicación, recepción ni consumo de inventario. Véase [AC-FIN-001](../requirements/AC-FIN-001-auditoria-financiera-alto-costo.md).

## Permisos y alcance

Todas las rutas requieren JWT y `X-Organization-Id`. El ID de ruta es el UUID del ítem de autorización.

| Actor | Consulta de recaudo y URL de factura | Registro de recaudo | Dashboard financiero |
| --- | --- | --- | --- |
| MTD | `authorizations.read` | `moderator_fees.manage` | `analytics.economics.read` y `application_audits.read` |
| MEDICARTE | `authorizations.read` y visibilidad operacional del producto/punto | Denegado por el servicio | Sin acceso de este flujo |
| Otras organizaciones | Denegado por el servicio de recaudo | Denegado | Sujeto al controlador de analítica; no forma parte de este flujo |

Los permisos se validan en el servidor. MEDICARTE puede consultar una autorización visible y su factura sin poder registrar un pago; MTD registra el recaudo. La disponibilidad del botón en la interfaz no concede permisos adicionales.

## CE-85 — Registrar o corregir un recaudo

MTD consulta `GET /api/v1/medicarte/authorizations/:id/moderator-fee` y registra con `POST` a la misma ruta. El cuerpo requiere una clave UUID de idempotencia y `expectedVersion`. `COLLECTED` exige importe positivo igual a la cuota esperada completa y fecha válida no futura; `NOT_COLLECTED` conserva importe y fecha de recaudo nulos. Cada cambio crea una nueva versión inmutable en `authorization_moderator_fee_events` y un evento de auditoría en la misma transacción. Un reintento idéntico no crea otra versión; una clave reutilizada con otro contenido produce conflicto.

## CE-86 — Alcance MEDICARTE y visibilidad

La consulta de MEDICARTE está limitada a autorizaciones relacionadas con puntos y productos de su alcance. Un usuario sin permiso de lectura o sin visibilidad operacional no debe obtener el estado ni la URL de factura. El permiso `moderator_fees.manage` se asigna inicialmente a `MTD_ADMIN` mediante la migración 0103; otros roles MTD solo lo reciben mediante RBAC explícito.

## CE-87 — Escritura externa en Google Sheets

Tras confirmar el evento en PostgreSQL, el API intenta añadir una fila al spreadsheet configurado. La escritura es asíncrona y un fallo de red, credenciales o permisos se registra en logs sin revertir el recaudo. No hay reintento persistente ni garantía de que una respuesta exitosa del POST implique una fila presente en Sheets. La fecha enviada procede de `authorization_fulfillments.effective_date`; si falta, el formato de la hoja usa la fecha actual de Bogotá.

La fila puede contener número de autorización, identificación y tipo de documento del paciente, documento profesional, fechas e importe financiero. No se envía el nombre del paciente; `FACTURA` se escribe vacía. Es información enviada a un sistema externo: limitar el acceso al spreadsheet y usar únicamente datos sintéticos en pruebas. La cuenta de servicio necesita acceso al spreadsheet; la operación de escritura solicita el alcance `spreadsheets`. El ID queda vacío por defecto. La documentación disponible no especifica la base legal, quién gobierna el destino ni sus reglas de acceso, retención y eliminación; corresponde confirmar la política aplicable para el spreadsheet configurado. No se ha decidido aquí que la aplicación deba implementar retención o borrado. Véase [AC-FIN-001](../requirements/AC-FIN-001-auditoria-financiera-alto-costo.md#231-salida-de-datos-a-google-sheets-y-gobernanza-pendiente).

## CE-88 — Consultar y abrir la factura

El API consulta `GET /api/v1/medicarte/authorizations/:id/moderator-fee/invoice-url` con alcance `spreadsheets.readonly`. Busca la autorización en la pestaña configurada, desde la fila más reciente, y devuelve la celda `Print factura` solo si contiene una URL HTTP(S). Si la fila, la columna o la URL faltan, devuelve `invoiceUrl: null`; la interfaz invita a reintentar manualmente y abre la URL encontrada en otra pestaña.

La interfaz indica que el proceso externo tarda **aproximadamente un minuto** tras registrar el recaudo. El API no genera la factura, no espera ese minuto ni consulta automáticamente hasta que aparezca. El servidor verifica el permiso y el alcance de la autorización antes de consultar Sheets, pero no verifica el dominio de la URL ni que el documento pertenezca a Drive. La interfaz abre el enlace con `noopener,noreferrer`; el acceso al archivo lo controla el servicio de destino y sus permisos. Una URL en la hoja tampoco reemplaza la comprobación de permisos para consultar este endpoint.

**Pruebas propuestas:** TE-98 a TE-105 en [la matriz](matriz-pruebas-especiales.md). Registrar resultados con datos sintéticos y sin copiar documentos, URLs de factura ni credenciales a evidencias públicas.
