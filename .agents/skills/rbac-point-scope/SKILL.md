---
name: rbac-point-scope
description: Revisa autorización y visibilidad de datos Medicarte por RBAC, organización y punto. Úsala cuando cambien identidad, scopes, filtros autoritativos, recursos por id o mutaciones/batches con alcance; no para UI aislada, reglas de cantidades sin efecto de acceso ni cambios exclusivos de esquema.
---

# Fronteras de acceso Medicarte

**Entrada esperada:** actor/rol, organización, puntos concedidos, recurso o endpoint y operación solicitada. Si falta una frontera, no asumas acceso global.

1. Lee `references/evidence.md` y localiza controller, servicio, repositorio/SQL y pruebas del recurso.
2. Evalúa por separado permiso funcional, organización y punto; la autorización efectiva requiere permiso y recurso dentro del data scope.
3. Aplica filtros en la consulta autoritativa. La UI no es frontera; listados, exportables y recursos por id deben restringir organización y puntos de dispensación aun cuando el actor conozca el ID.
4. Conserva la semántica 403/404 existente sin filtrar detalles; en cambios de punto o traslados valida origen, destino y grants vigentes.
5. En preview, bulk, workers o jobs, revalida cada recurso dentro de la mutación o transacción y define el tratamiento de filas no autorizadas.
6. Usa `rg` para rutas indirectas y ejecuta pruebas positivas y negativas de misma/otra organización, punto concedido/no concedido, revocación, recurso por ID, exportable y mezcla de filas autorizadas/no autorizadas, según las rutas cambiadas. Para cambios de contrato de archivo, sigue la frontera de `AGENTS.md`.

**Finaliza cuando:** cada frontera tiene enforcement autoritativo y prueba positiva/negativa, las operaciones masivas no amplían scope y se reportan SQL dinámico, rutas indirectas y límites no verificados.
