# SPEC-008 — Organizaciones, roles y permisos
**Fase:** 1 y transversal

## Matriz confirmada
- MTD: operación/admin completa según rol.
- Compensar: ver autorizaciones; consolidado solo con permiso explícito.
- OLP: ver autorizaciones y disponibles; consolidado según permiso.
- Medicarte: ver autorizaciones, disponibles, registrar dispensación y cargar/corregir soportes; consolidado según permiso.
- Auditoría: MTD.
- Administración: MTD.

## Regla
Cada request debe aplicar permiso + alcance de organización. La UI solo refleja la autorización, no la sustituye.

## Permisos confirmados adicionales
- `dispensing.register`: Medicarte.
- modificación del destino de soportes en Drive: solo MTD Admin.

## Tests obligatorios
Acceso cruzado, elevación de privilegios, usuario suspendido, multi-organización, lectura sensible, descarga de soporte.
