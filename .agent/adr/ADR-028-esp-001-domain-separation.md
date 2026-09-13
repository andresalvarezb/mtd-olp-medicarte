# ADR-028 — Separación del dominio clínico y logístico

## Estado

Aceptada.

## Contexto

El modelo anterior utilizaba `authorization_items` como unidad clínica y también
como unidad de programación, compra, entrega y aplicación. Esto impedía consolidar
la demanda de varios pacientes y exponía información clínica al abastecimiento.

`refactor.md` establece que la autorización debe continuar representando la
necesidad clínica, pero no debe ser propietaria del inventario ni de la operación
logística.

## Decisión

- `authorization_items` es propiedad del dominio clínico y contractual.
- Las columnas logísticas existentes permanecen únicamente como histórico legacy.
- El código nuevo no las utilizará para crear operaciones futuras.
- La programación se modela como una entidad independiente relacionada con la
  autorización mediante una referencia clínica y un código comercial.
- La demanda se consolida por período, punto físico y código comercial.
- Las futuras órdenes, entregas, recepciones e inventario no tendrán una relación
  directa con `authorization_items`.
- `patient_application` será el único puente futuro entre una autorización y el
  consumo físico de inventario.
- El histórico legacy se consulta mediante un lector explícito de solo lectura.
- Las restricciones de integridad se implementan en PostgreSQL además de las
  validaciones de aplicación.

## Alcance de esta decisión

Esta primera implementación crea el límite de dominio y el esqueleto persistente
de puntos, períodos, programaciones, historial append-only y demanda proyectada.
Las APIs y máquinas de estado de compra, recepción, inventario y aplicación se
implementarán en sus especificaciones posteriores.

## Consecuencias

Positivas:

- La autorización deja de ser el centro estructural del abastecimiento.
- El lineage puede navegar desde la demanda hasta la programación y autorización.
- Los cambios legacy quedan aislados y consultables.
- PostgreSQL protege claves, cantidades y referencias cruzadas.

Costos:

- Durante la migración convivirán columnas legacy y tablas nuevas.
- Las consultas clínicas y las consultas históricas requieren lectores distintos.
- Algunas invariantes agregadas, como la suma de fuentes de demanda, se completarán
  en la implementación de consolidación.

## Alternativas descartadas

- Seguir agregando columnas logísticas a `authorization_items`.
- Eliminar inmediatamente las columnas antiguas y perder trazabilidad.
- Usar un campo polimórfico sin FK para relacionar demanda, programación e inventario.
- Implementar OC, recepción e inventario antes de cerrar la frontera de dominio.
