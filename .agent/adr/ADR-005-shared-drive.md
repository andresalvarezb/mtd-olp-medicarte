# ADR-005 — Google Shared Drive para soportes
**Estado:** ACCEPTED

## Decisión
Guardar soportes en una unidad compartida mediante Drive API. PostgreSQL guarda `drive_file_id`, hash, tipo, versión, actor, tamaño y demás metadatos.

## Reglas
No enlaces públicos. El acceso del usuario ocurre a través de la API después de autorización.

## Configuración del destino
El ID del Drive/carpeta destino no se fija en código. Es un parámetro administrable únicamente por MTD Admin.

Un cambio:
- aplica a nuevas cargas;
- no mueve automáticamente archivos existentes;
- debe quedar auditado;
- obliga a conservar en cada `attachment` la referencia al destino usado en el momento de carga.

La aplicación no elimina soportes automáticamente por antigüedad. Los documentos permanecen en el Drive corporativo sin una fecha máxima definida por este producto.
