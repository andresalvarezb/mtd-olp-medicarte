---
name: financial-integrity
description: Protege consistencia de cuotas moderadoras, recaudos, devoluciones, saldos, eventos y conciliaciones financieras de Medicarte. Actívala al cambiar importes, estados o trazabilidad financiera; no por cambios logísticos o visuales sin efecto financiero.
---

# Integridad financiera

**Entrada:** operación, autorización, estados, importes y fuente de la regla aprobada. Leer `references/evidence.md` y el requerimiento vigente antes de inferir una fórmula. RF-MTD-RECAUDO-001 contiene reglas históricas superadas por RF-MTD-CM-002.

1. Distinguir valor fuente, dinero efectivamente recibido, devolución, invalidación, saldo neto y obligación. Comprobar la proyección contra eventos persistidos; no sumar versiones históricas como pagos independientes ni confundir `NOT_COLLECTED` con devolución.
2. Revisar unicidad, clave de idempotencia, versión esperada, bloqueo/transacción y auditoría para impedir doble contabilización o reversiones duplicadas. Conservar eventos históricos inmutables y relaciones al evento corregido.
3. Seguir sincronización externa y conciliación por ID de evento. Un fallo externo posterior al commit no revierte dinero registrado; definir reintento y compensación verificables según el contrato vigente, sin declarar concluida una reversión contable no confirmada.
4. Si cambian exportables o alcance por organización/punto, activar `exportables-contract-integrity` o `rbac-point-scope` según corresponda. Para datos reales o esquema versionado, seguir las fronteras de `AGENTS.md` y sus autorizaciones.
5. Probar con datos sintéticos importes exactos, reintento idéntico y conflictivo, concurrencia, estados permitidos/prohibidos, rollback por error de auditoría y proyecciones/conciliación. Elegir pruebas enfocadas y entorno local autorizado conforme a `AGENTS.md`.

**Finaliza cuando:** eventos, saldos y efectos externos concuerdan con el requerimiento vigente y las pruebas ejecutadas; documentar brechas y riesgo de conciliación sin inventar reglas contables.
