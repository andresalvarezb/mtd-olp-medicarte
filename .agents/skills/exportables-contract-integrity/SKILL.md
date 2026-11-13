---
name: exportables-contract-integrity
description: Protege contratos de datos de exportables Excel y CSV de Medicarte. Actívala al cambiar columnas, filas, fuentes, filtros o formatos consumidos; no por estilos visuales ajenos al archivo ni por una consulta que no cambia el exportable.
---

# Contratos de exportables

**Entrada:** exportable y consumidor afectados, contrato actual y cambio pedido. Leer `references/evidence.md` y comprobar el contrato de ese archivo en código, tests y consumidores; AUTO para OC y autorizaciones son ejemplos distintos.

1. Registrar hojas o archivos, encabezados, orden, tipos, fechas, cantidades, nulos y valores que el consumidor interpreta. Distinguir cambio compatible de cambio que requiere migración o versión del consumidor.
2. Para cada columna, seguir su fuente autoritativa y los joins por paciente/documento, autorización, producto, orden y punto que correspondan. Medir cardinalidad antes de agregar relaciones de uno a muchos; una fila duplicada puede duplicar cantidades o dinero.
3. Verificar filtros de organización y punto en la consulta autoritativa y minimizar datos personales. Activar `rbac-point-scope` si cambia visibilidad o enforcement y `patient-master-integrity` si cambia identidad maestra. Para importes, contrastar el requerimiento financiero vigente; no activar otra skill solo por un nombre de columna.
4. Probar encabezados y orden exactos, número e identidad de filas, valores representativos, nulos, fechas, números y casos negativos de alcance. Usar fixtures sintéticos y revisar CSV/XLSX producido, incluidos campos que puedan interpretarse como fórmulas.

**Finaliza cuando:** contrato y compatibilidad están documentados por exportable, las pruebas enfocadas pasan y se informan consumidores o casos no comprobados. No modificar exportables reales al diseñar esta skill.
