# ADR-005 — Drive corporativo externo para soportes

**Estado:** ACCEPTED

## Decisión

Google Drive continúa como repositorio corporativo externo y su destino puede conservarse como configuración administrativa. Medicarte carga y administra los soportes directamente en Drive, fuera del flujo de archivos de la aplicación.

## Reglas

La aplicación no carga, descarga, cuenta, versiona ni valida archivos individuales de soporte. No existe relación obligatoria `attachment -> authorization_item`, endpoint de attachments ni conciliación Drive/PostgreSQL.

## Configuración del destino

El ID o referencia del Drive/carpeta corporativa no se fija en código. Si se expone como configuración o enlace administrativo, solo MTD Admin puede modificarlo y el cambio queda auditado.

Un cambio:

- orienta la operación externa de Medicarte;
- no mueve ni modifica archivos existentes;
- debe quedar auditado;
- no crea metadatos de archivos en la aplicación.

La aplicación no elimina soportes ni gobierna su retención. Las políticas corporativas de Drive quedan fuera de este producto.
