---
name: medicarte-access-boundaries
description: Revisa fronteras de acceso Medicarte: RBAC, organización, punto de dispensación, listados, recursos por id y mutaciones. Úsala en identidad, scopes, controllers, repositories y trabajos masivos.
---

# Fronteras de acceso Medicarte

1. Lee `references/evidence.md` y localiza controller, servicio, repositorio y pruebas del recurso.
2. Evalúa por separado permiso funcional, organización y alcance de punto. La autorización efectiva requiere permiso y recurso dentro del data scope.
3. Aplica el filtro en la consulta autoritativa; el frontend no es frontera de seguridad. Los listados no deben enumerar datos fuera de scope.
4. Para recursos por id, verifica la semántica 403/404 existente sin filtrar detalles. Para traslados valida origen y destino.
5. En preview/bulk, revalida la autorización dentro de la mutación o transacción; no confíes en caché, UI ni preview previo.
6. Añade pruebas negativas para otra organización, punto no concedido y revocación cuando aplique.

Reporta cada frontera comprobada y cualquier SQL dinámico o ruta indirecta que requiera revisión manual.
