# Contrato MIPRES — Validación de vigencia de direccionamientos

**Estado:** ACCEPTED

## 1. Objetivo

Consultar en MIPRES los direccionamientos asociados a un número de prescripción y determinar si existe al menos un direccionamiento vigente.

Este alcance no contempla:

- creación de direccionamientos;
- modificación de direccionamientos;
- anulación de direccionamientos;
- programación;
- entrega;
- suministro;
- sincronización masiva;
- consultas por paciente;
- consultas por fecha.

La integración es exclusivamente de lectura.

---

## 2. Servicio MIPRES

Servicio utilizado:

```text
WSSUMMIPRESNOPBS
```

Base URL de producción:

```text
https://wsmipres.sispro.gov.co/WSSUMMIPRESNOPBS
```

La URL base debe ser configurable mediante variable de entorno y no debe hardcodearse en la lógica de dominio.

Variable sugerida:

```text
MIPRES_BASE_URL=https://wsmipres.sispro.gov.co/WSSUMMIPRESNOPBS
```

---

## 3. Credenciales

La integración requiere:

```text
NIT
token inicial
```

Ambos valores se configuran exclusivamente mediante variables de entorno o referencias equivalentes a un gestor de secretos.

Variables:

```text
MIPRES_NIT
MIPRES_INITIAL_TOKEN
```

Nunca deben almacenarse valores reales en:

- Git;
- documentación;
- frontend;
- logs;
- auditoría;
- fixtures;
- respuestas de API internas.

---

## 4. Obtención del token operativo

Endpoint:

```http
GET /api/GenerarToken/{nit}/{token}
```

URL:

```text
{MIPRES_BASE_URL}/api/GenerarToken/{nit}/{MIPRES_INITIAL_TOKEN}
```

Parámetros:

| Parámetro | Fuente                 |
| --------- | ---------------------- |
| `nit`     | `MIPRES_NIT`           |
| `token`   | `MIPRES_INITIAL_TOKEN` |

No tiene body.

La respuesta contiene el token operativo que será utilizado posteriormente para consultar los direccionamientos.

El token operativo:

- se obtiene en backend;
- nunca se expone al frontend;
- nunca se registra completo en logs;
- puede mantenerse temporalmente en memoria/cache;
- debe regenerarse cuando deje de ser válido.

La lógica de obtención y renovación debe estar encapsulada en un componente como:

```text
MipresTokenProvider
```

---

## 5. Consulta de direccionamientos

Endpoint:

```http
GET /api/DireccionamientoXPrescripcion/{nit}/{token}/{noPrescripcion}
```

URL:

```text
{MIPRES_BASE_URL}/api/DireccionamientoXPrescripcion/{MIPRES_NIT}/{tokenOperativo}/{noPrescripcion}
```

Parámetros:

| Parámetro        | Descripción                                         |
| ---------------- | --------------------------------------------------- |
| `nit`            | NIT configurado para la integración                 |
| `token`          | Token operativo obtenido mediante `GenerarToken`    |
| `noPrescripcion` | Número de prescripción MIPRES asociado a la fórmula |

No tiene body.

No se requiere paginación para este caso de uso.

---

## 6. Campos requeridos

Del direccionamiento MIPRES solamente son obligatorios para este caso de uso:

```text
ID
IDDireccionamiento
NoPrescripcion
TipoTec
ConTec
FecMaxEnt
EstDireccionamiento
FecAnulacion
```

Campos principales:

| Campo MIPRES          | Uso interno                        |
| --------------------- | ---------------------------------- |
| `ID`                  | Identificador de enlace externo    |
| `IDDireccionamiento`  | Identificador del direccionamiento |
| `NoPrescripcion`      | Número de prescripción             |
| `TipoTec`             | Tipo de tecnología                 |
| `ConTec`              | Consecutivo de tecnología          |
| `FecMaxEnt`           | Fecha máxima de entrega            |
| `EstDireccionamiento` | Estado oficial MIPRES              |
| `FecAnulacion`        | Evidencia de anulación             |

El resto del payload puede conservarse como evidencia técnica, pero no forma parte de la regla necesaria para determinar vigencia.

---

## 7. Regla de vigencia

La fecha oficial utilizada para validar vigencia es:

```text
FecMaxEnt
```

internamente:

```text
fecha_maxima
```

La comparación se realiza usando:

```text
America/Bogota
```

Un direccionamiento tiene vigencia temporal cuando:

```text
current_date(America/Bogota) < fecha_maxima
```

La igualdad no se considera vigente:

```text
current_date(America/Bogota) == fecha_maxima
→ NO VIGENTE
```

Un direccionamiento anulado no puede considerarse vigente.

Por lo tanto, conceptualmente:

```pseudo
isCurrent(direction):

    if direction is annulled:
        return false

    return currentDate("America/Bogota")
           < direction.fechaMaxima
```

---

## 8. Resultado por direccionamiento

Cada direccionamiento debe normalizarse como mínimo a:

```text
MipresDirection {
    externalId
    directionId
    prescriptionNumber
    technologyType
    technologyConsecutive
    maximumDeliveryDate
    externalStatus
    annulled
    current
}
```

Los nombres oficiales del proveedor:

```text
ID
IDDireccionamiento
NoPrescripcion
TipoTec
ConTec
FecMaxEnt
EstDireccionamiento
FecAnulacion
```

no deben salir del adaptador MIPRES.

---

## 9. Resultado por prescripción

Una prescripción puede contener cero, uno o varios direccionamientos.

El resultado interno debe permitir distinguir:

```text
direccionamientos encontrados
direccionamientos vigentes
```

Ejemplo conceptual:

```json
{
  "prescriptionNumber": "20260000000000000000",
  "hasDirections": true,
  "hasCurrentDirection": true,
  "directions": [
    {
      "directionId": "12345",
      "maximumDeliveryDate": "2026-09-15",
      "current": true
    }
  ]
}
```

La decisión final se obtiene así:

```pseudo
directions =
    mipres.getDirectionsByPrescription(noPrescripcion)

if directions is empty:
    result = PENDING

else if any direction is current:
    result = CONFIRMED

else:
    result = PENDING
```

Un fallo técnico de comunicación con MIPRES produce:

```text
QUERY_ERROR
```

Nunca debe interpretarse un error técnico como ausencia de direccionamiento.

---

## 10. Precondición interna

La consulta MIPRES solamente se ejecuta cuando el registro cumple:

```text
coverage_type = NO_PBS
AND
enablement_status = ENABLED
```

Los registros que no cumplan ambas condiciones no generan consulta al proveedor.

---

## 11. Estados internos

Para este alcance únicamente se requieren:

```text
PENDING
CONFIRMED
QUERY_ERROR
```

### CONFIRMED

Existe al menos un direccionamiento no anulado que cumple:

```text
current_date(America/Bogota) < fecha_maxima
```

### PENDING

Se presenta cualquiera de estas condiciones:

```text
no existen direccionamientos
```

o:

```text
existen direccionamientos,
pero ninguno se encuentra vigente
```

### QUERY_ERROR

No fue posible determinar el resultado debido a un fallo técnico de la integración.

Ejemplos:

```text
timeout
error de red
token inválido no recuperable
respuesta no interpretable
error 5xx del proveedor
```

---

## 12. Evidencia histórica

Cada consulta debe dejar evidencia histórica.

No debe sobrescribirse la respuesta anterior.

Como mínimo conservar:

```text
prescription_number
queried_at
outcome
http_status
response_payload / referencia al raw
correlation_id
```

Los tokens deben ser eliminados o redactados antes de persistir cualquier request o respuesta técnica.

---

## 13. Arquitectura

El dominio depende exclusivamente de:

```text
MipresPort
```

Contrato conceptual:

```text
MipresPort
    getDirectionsByPrescription(
        prescriptionNumber
    ) -> Direction[]
```

Implementación externa:

```text
MipresHttpAdapter
    │
    ├── MipresTokenProvider
    │     └── GET GenerarToken
    │
    └── GET DireccionamientoXPrescripcion
```

La capa de dominio no conoce:

```text
GenerarToken
DireccionamientoXPrescripcion
FecMaxEnt
EstDireccionamiento
NoPrescripcion
```

Estos conceptos pertenecen exclusivamente a la capa anticorrupción del adaptador.

---

## 14. Configuración requerida

Variables:

```text
MIPRES_BASE_URL
MIPRES_NIT
MIPRES_INITIAL_TOKEN
```

Producción:

```text
MIPRES_BASE_URL=https://wsmipres.sispro.gov.co/WSSUMMIPRESNOPBS
```

No documentar valores reales de:

```text
MIPRES_NIT
MIPRES_INITIAL_TOKEN
```

---

## 15. Flujo completo

```text
FÓRMULA NO PBS HABILITADA
          │
          ▼
obtener noPrescripcion
          │
          ▼
MipresTokenProvider
          │
          ▼
GET GenerarToken
          │
          ▼
token operativo
          │
          ▼
GET DireccionamientoXPrescripcion
          │
          ▼
0..N direccionamientos
          │
          ▼
descartar anulados
          │
          ▼
comparar FecMaxEnt
con fecha actual America/Bogota
          │
      ┌───┴────┐
      │        │
 alguno      ninguno
 vigente     vigente
      │        │
      ▼        ▼
 CONFIRMED   PENDING
```

Si ocurre un fallo técnico:

```text
QUERY_ERROR
```

---

## 16. Fuente del número de prescripción

`noPrescripcion` proviene de la columna `No.PRESCRIPCION` del archivo de importación (DEC-016). El valor original es numérico y se conserva como evidencia; para esta API se deriva:

```text
no_prescripcion = No.PRESCRIPCION sin sus ultimos 3 digitos de la derecha
```

El valor derivado alimenta `MipresPort`. Si el valor no está vacío debe contener solo dígitos con longitud mayor a 3; en caso contrario la fila se rechaza en la importación con `INVALID_FIELD_FORMAT`.
