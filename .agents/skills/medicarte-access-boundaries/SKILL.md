---
name: medicarte-access-boundaries
description: Revisa autorización y visibilidad de datos Medicarte por RBAC, organización y punto. Úsala cuando cambien identidad, scopes, filtros autoritativos, recursos por id o mutaciones/batches con alcance; no para UI aislada, reglas de cantidades sin efecto de acceso ni cambios exclusivos de esquema.
---

# Fronteras de acceso Medicarte

**Entrada esperada:** actor/rol, organización, puntos concedidos, recurso o endpoint y operación solicitada. Si falta una frontera, no asumas acceso global.

1. Lee `references/evidence.md` y localiza controller, servicio, repositorio/SQL y pruebas del recurso.
2. Evalúa por separado permiso funcional, organización y punto; la autorización efectiva requiere permiso y recurso dentro del data scope.
3. Aplica filtros en la consulta autoritativa. La UI no es frontera; listados, exports y recursos por id no deben enumerar datos fuera de scope.
4. Conserva la semántica 403/404 existente sin filtrar detalles; en traslados valida origen y destino.
5. En preview, bulk, workers o jobs, revalida cada recurso dentro de la mutación o transacción y define el tratamiento de filas no autorizadas.
6. Usa `rg` para rutas indirectas y ejecuta pruebas negativas de otra organización, punto no concedido, revocación y mezcla de filas autorizadas/no autorizadas.

**Finaliza cuando:** cada frontera tiene enforcement autoritativo y prueba positiva/negativa, las operaciones masivas no amplían scope y se reportan SQL dinámico, rutas indirectas y límites no verificados.
