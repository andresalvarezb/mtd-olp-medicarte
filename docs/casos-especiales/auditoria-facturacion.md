# CE-14 a CE-19 — Auditoría de facturación de autorizaciones

**Organización:** exclusivamente MTD en servicio. **Permisos:** `application_audits.read` y `application_audits.manage` según operación. **Fuente:** `apps/api/src/audits/authorization-billing-audit*.ts`, `authorization-billing-audit-eligibility.ts`, `packages/contracts/src/index.ts`. No confundir con auditoría clínica de aplicación o de fulfillment.

## CE-14 — Determinar elegibilidad de AUTO

Una AUTO es auditable cuando registra **atención real parcial o completa** (`PARTIAL`/`COMPLETE`), no por simple asignación o stock disponible. El cálculo confronta cantidad autorizada contra evidencia de cumplimiento, aplicación confirmada y consumo, tomando **el máximo entre fuentes de representación**, no la suma de las tres (para evitar doble conteo). Si no hay atención real: `AUTHORIZATION_BILLING_AUDIT_NOT_ELIGIBLE`.

## CE-15 — Auditoría individual

1. Consultar autorización y elegibilidad desde la interfaz de consulta de AUTO.
2. `POST /api/v1/authorization-billing-audits/authorization/:authorizationItemId/start` crea/reutiliza una auditoría pendiente si es elegible.
3. `GET /api/v1/authorization-billing-audits/authorization/:authorizationItemId` obtiene el expediente de auditoría (ausencia puede representar no iniciada).
4. Revisar soportes Drive si aplica mediante `POST /api/v1/authorization-billing-audits/:auditId/evidence/drive/search`; el endpoint **no cambia la decisión**.
5. Registrar resultado en `POST /api/v1/authorization-billing-audits/:auditId/decision` con `result: COMPLIES | DOES_NOT_COMPLY` y, cuando corresponde, `observation`.
6. Resultado pasa a `REVIEWED`; la decisión no se reabre mediante el mismo endpoint (`AUTHORIZATION_BILLING_AUDIT_ALREADY_REVIEWED`).

## CE-16 — Observación obligatoria

`DOES_NOT_COMPLY` requiere observación, con longitud hasta 4000 caracteres. La implementación también exige observación si se decide **sin evidencia**, incluso con resultado `COMPLIES` (`AUTHORIZATION_BILLING_AUDIT_OBSERVATION_REQUIRED_WITHOUT_EVIDENCE`). La búsqueda de soportes que ocurre **después** de `REVIEWED` no revierte el estado, resultado, auditor ni fecha de auditoría.

## CE-17 — Auditoría masiva por XLSX

**Pantalla:** funciones de auditoría masiva en Consulta de Autorizaciones. **Plantilla:** `GET /api/v1/authorization-billing-audits/bulk/template.xlsx`; máximo **20 MiB** y **5000 registros**. Versión técnica `BILLING_AUDIT_V1`. Tres encabezados **exactos y en orden**:

```text
CLAVE_AUTO | RESULTADO | OBSERVACION
```

`RESULTADO` acepta los valores visibles `CUMPLE` / `NO CUMPLE`, que el backend transforma en `COMPLIES` / `DOES_NOT_COMPLY`. Tratar `CLAVE_AUTO` numérica como **texto**, para no perder ceros o notación. La carga es `POST /api/v1/authorization-billing-audits/bulk/jobs` (`multipart/form-data`, campo `file`), seguida de vista del trabajo `GET .../jobs/:id`; **no confirma por cargar**. Confirmar con `POST .../jobs/:id/confirm`; descargar `GET .../jobs/:id/result.xlsx`. El archivo de resultados permite conciliar filas, errores y éxitos.

## CE-18 — Reglas por fila e idempotencia

Se validan: clave AUTO existente y no repetida indebidamente, estado auditable, ausencia de auditoría definitiva, resultado válido y observación cuando aplica. En la confirmación se **revalida** elegibilidad y se protege con transacción/bloqueo; una operación concurrente puede rechazar una fila que había sido válida en vista previa. Los trabajos pueden quedar `COMPLETED`, `PARTIALLY_COMPLETED` o `FAILED`. Volver a confirmar un job terminal devuelve su estado; **no** significa que una fila fallida deba alterarse manualmente en DB.

## CE-19 — Separación de auditorías

- **Auditoría de facturación por AUTO:** evalúa cumplimiento documental para facturación, resultado `CUMPLE/NO CUMPLE`.
- **Auditoría de entrega/aplicación (`fulfillment-audits`):** revisa el evento de entrega/aplicación; aprobación/rechazo individuales.
- **Auditoría de aplicación (`application-audits`):** revisa la aplicación y permite rechazo con causal específica.
- **`audit_events`:** trazabilidad técnica de acciones, no reemplaza expedientes ni decisiones funcionales.

**Evidencias mínimas:** id autorización, auditId, usuario MTD, timestamp, resultado, observación (cuando aplica), referencias Drive, correlación, resultado fila XLSX y lectura posterior. Usar datos sintéticos/desidentificados.
