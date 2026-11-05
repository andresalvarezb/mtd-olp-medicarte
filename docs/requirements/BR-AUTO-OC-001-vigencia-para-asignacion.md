# BR-AUTO-OC-001 — Vigencia de autorizaciones para asignar OC

## Objetivo

Aplicar una única regla temporal para ofrecer una autorización como candidata
y aceptarla como destino de una asignación de orden de compra. La evaluación
usa fechas calendario de `America/Bogota`.

## Regla de vigencia

Una autorización está `VIGENTE` **para OC** cuando ambas fechas son válidas,
`FECHA_ASIGNACION` cumple su ventana y `FECHA_FINAL_VIGENCIA` está vigente o
dentro de los cinco días calendario de gracia. Las dos validaciones temporales
son independientes del mes al que pertenece la otra fecha y usan el calendario
`America/Bogota`:

- `FECHA_ASIGNACION` pertenece al mes calendario actual, **o** está entre hoy y
  hoy + 20 días calendario, inclusive. Una asignación del mes actual puede
  superar el horizonte de 20 días; una asignación fuera del mes actual y a más
  de 20 días no es elegible.
- `FECHA_FINAL_VIGENCIA` es hoy o posterior, **o** venció hace entre uno y cinco
  días calendario, inclusive. La gracia cruza límites de mes y año. Desde el día
  6, no se crea una nueva relación comercial mientras siga vencida.

Las fechas inválidas o ausentes, una fecha de asignación fuera de su ventana y
una fecha final vencida hace más de cinco días producen `NO VIGENTE`. Para
`MES_GESTION` se usa el año y mes de `FECHA_ASIGNACION`, con formato `YYYY-MM`;
si la fecha no se puede interpretar, el campo queda vacío.

`VIGENTE` en los archivos de OC significa elegible por fechas para crear una
nueva relación de compra. Durante los días 1 a 5 también se permite atención y,
con recepción real, reserva física. Desde el día 6 ya no se crea un nuevo
vínculo mientras siga vencida. Los vínculos ya activos se conservan o liberan
según [BR-AUTO-EXP-001](BR-AUTO-EXP-001-gracia-continuidad-atencion.md); no se
confunde la relación comercial con recepción, reserva física ni consumo. Los
demás controles de fuente/estado, habilitación, Anexo Tarifario, MIPRES,
producto, permisos, alcance y capacidad siguen aplicándose.

## Aplicación

- `AUTO-para-generar-OC.xlsx` conserva sus siete encabezados actuales y solo
  incluye autorizaciones `VIGENTE` con saldo de compra disponible.
- El importador vuelve a evaluar la autorización destino en el servidor para
  creación de OC, asignación a OC existente y reasignación. Una fila manual no
  puede omitir esta validación.
- La creación desde demanda consolidada también revalida esta regla. La
  consolidación ofrece las mismas candidatas por fechas.
- Desde el sexto día posterior al vencimiento, el importador no crea nuevos
  vínculos para esa AUTO mientras siga vencida, aunque su mes de vencimiento
  todavía sea el actual.
- Desde el día 6, el worker libera la reserva física pendiente y el vínculo
  activo solo cuando no existe atención confirmada, sin esperar al cambio de
  mes. Si existe atención confirmada, conserva la reserva restante y el vínculo
  activo para continuidad. Una recepción física posterior de esa misma OC
  activa puede aumentar progresivamente la reserva conforme a
  [BR-AUTO-EXP-001](BR-AUTO-EXP-001-gracia-continuidad-atencion.md); una nueva
  relación comercial vencida sigue bloqueada.
- Las fuentes liberadas se conservan como historial. La renovación no restaura
  automáticamente una fuente ni una allocation liberada; las nuevas relaciones
  siguen sujetas a selección manual y a las validaciones vigentes.
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
3. La ventana de `FECHA_ASIGNACION` se aplica igual si el vencimiento ocurre en
   el mes actual; la fecha final de hoy se acepta, y una fecha anterior se
   acepta solo hasta el quinto día de gracia, incluso al cambiar de mes o año.
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
9. Una AUTO vencida es `VIGENTE` para una nueva OC hasta el quinto día
   posterior al vencimiento, sin depender del mes o año, si la fecha de
   asignación también cumple su ventana. El día 6 pasa a `NO VIGENTE` si sigue
   vencida.
10. Al día 6 sin atención confirmada se libera la reserva física pendiente y
    el vínculo activo OC; con atención confirmada se conservan ambos. Una
    recepción posterior de la misma OC activa puede completar la reserva
    dentro del snapshot, el saldo autorizado pendiente y el pool físico; no se
    reactivan fuentes liberadas ni se crean nuevos vínculos vencidos.
