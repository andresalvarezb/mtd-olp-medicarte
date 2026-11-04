# BR-AUTO-OC-001 — Vigencia de autorizaciones para asignar OC

## Objetivo

Aplicar una única regla temporal para ofrecer una autorización como candidata
y aceptarla como destino de una asignación de orden de compra. La evaluación
usa fechas calendario de `America/Bogota`.

## Regla de vigencia

Una autorización está `VIGENTE` **para OC** cuando ambas fechas son válidas y
se cumple cualquiera de estas alternativas:

1. `FECHA_FINAL_VIGENCIA` es hoy o posterior, y `FECHA_ASIGNACION` pertenece al
   mismo año y mes de hoy o está entre hoy y hoy + 20 días calendario, inclusive.
2. `FECHA_FINAL_VIGENCIA` pertenece al mes actual de Bogotá, aunque ya haya
   pasado y `FECHA_ASIGNACION` pertenezca a un mes anterior.

Las fechas inválidas o ausentes, una fecha de asignación fuera de esas dos
alternativas y una fecha final anterior al mes actual producen `NO VIGENTE`. Para
`MES_GESTION` se usa el año y mes de `FECHA_ASIGNACION`, con formato `YYYY-MM`;
si la fecha no se puede interpretar, el campo queda vacío.

`VIGENTE` en los archivos de OC significa elegible por fechas para compra. La
consulta clínica puede mostrar la misma AUTO vencida para entrega y aplicación.
La vigencia temporal es independiente del estado de anulación y del estado del
vínculo con una OC. Los demás controles de fuente/estado, habilitación,
Anexo Tarifario, MIPRES, producto, permisos, alcance y capacidad siguen
aplicándose. Esta regla no cambia la ventana de entrega ni de aplicación.

## Aplicación

- `AUTO-para-generar-OC.xlsx` conserva sus siete encabezados actuales y solo
  incluye autorizaciones `VIGENTE` con saldo de compra disponible.
- El importador vuelve a evaluar la autorización destino en el servidor para
  creación de OC, asignación a OC existente y reasignación. Una fila manual no
  puede omitir esta validación.
- La creación desde demanda consolidada también revalida esta regla. La
  consolidación ofrece las mismas candidatas por fechas.
- Desde el sexto día posterior al vencimiento, una AUTO vencida en el mes
  actual solo puede vincularse a compra aún no recibida. El importador no crea
  ni transfiere una reserva física a una AUTO ya vencida.
- El worker libera la reserva física no consumida desde el día 6. El vínculo
  de compra pendiente se libera cuando también terminó el mes de vencimiento.
  Los vínculos liberados antes de este cambio permanecen históricos; una nueva
  vinculación es manual.
- `ordenes-compra.xlsx` mantiene `OC_PRODUCTOS` y amplía `AUTO_RELACIONADAS`
  con fechas de asignación y vencimiento, `MES_GESTION`, `ESTADO_VIGENCIA`,
  `ESTADO_ANULACION` y `ESTADO_VINCULO_OC`.
- `AUTO_RELACIONADAS` conserva una sola fila por pareja OC/AUTO y prioriza el
  vínculo activo frente a evidencia liberada, sin sumar cantidades históricas
  duplicadas.
- La hoja `AUTORIZACIONES` presenta una fila por autorización del alcance MTD
  actual, incluso si nunca tuvo OC, con fechas, mes de gestión, vigencia,
  anulación, vínculos y las OC relacionadas. El resumen del vínculo es
  `SIN_OC`, `ACTIVO` o `LIBERADO`.

No requiere cambios de esquema ni migración.

Para desplegar, publicar primero el ajuste del worker y después la elegibilidad
en API y exportables. Así el worker anterior no libera vínculos creados bajo la
nueva regla. No se restauran automáticamente vínculos ya liberados.

## Criterios de aceptación

1. Una asignación del mismo mes/año que hoy es `VIGENTE` aunque supere hoy +
   20 días, si su fecha final no está vencida.
2. Una asignación exactamente en hoy + 20 días es `VIGENTE`; en hoy + 21 es
   `NO VIGENTE` cuando cae fuera del mes actual.
3. La regla funciona al cambiar de mes y de año; la fecha final de hoy se
   acepta, y una fecha anterior se acepta solo durante su mes de vencimiento.
4. Una fecha de asignación o vencimiento inválida se clasifica `NO VIGENTE`.
5. El archivo de candidatas excluye todas las autorizaciones `NO VIGENTE` y
   conserva sus siete encabezados compatibles con el importador.
6. El servidor rechaza un destino `NO VIGENTE` en OC nueva, asignación
   pendiente y reasignación, sin crear ni cambiar vínculos.
7. `ordenes-compra.xlsx` incluye autorizaciones sin OC, distingue vigencia,
   anulación y vínculo, y no duplica la cantidad de un vínculo liberado cuando
   también existe un vínculo activo para la pareja OC/AUTO.
8. Las exportaciones siguen limitadas al permiso y al alcance organizacional
   MTD autorizados.
9. Una AUTO vencida durante el mes actual es `VIGENTE` para OC aunque su
   asignación sea de un mes anterior; al cambiar de mes pasa a `NO VIGENTE`
   salvo que su fecha final se haya ampliado.
10. Al día 6 se libera únicamente la reserva física; el vínculo de compra
    permanece durante el mes y se libera al cumplirse ambos plazos. El
    importador no crea una reserva física para una AUTO vencida.
