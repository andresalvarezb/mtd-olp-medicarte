# ADR-017 — Proveedor de despliegue portable

**Estado:** ACCEPTED

## Contexto

Se espera desplegar el aplicativo inicialmente en Render y se desea conservar Google Cloud como alternativa.

## Decisión

- Render es el destino primario esperado.
- Google Cloud es una alternativa válida.
- Web, API y worker deben distribuirse como contenedores Docker y la configuración debe permanecer desacoplada del proveedor.

## Consecuencias

No deben introducirse dependencias de aplicación exclusivas de Render que impidan desplegar en Google Cloud sin modificar reglas de negocio.

## Región

**Revisión (2026-08-31):** la regla original que exigía presencia física en Colombia queda sustituida por la aprobación explícita de la siguiente región; DEC-009 refleja la misma decisión.

- La región de producción aprobada en Render es Virginia, Estados Unidos.
- Se acepta expresamente que los servicios, bases de datos y datos administrados por Render residan y/o sean procesados en Virginia, USA.
- La presencia física en Colombia deja de ser un requisito arquitectónico; la ausencia de región Colombia NO bloquea producción.
- Cambios futuros de región exigen una decisión explícita equivalente; ningún agente puede sustituir silenciosamente la región aprobada.

Render continúa como destino esperado y Google Cloud como alternativa permitida, manteniendo Docker y la portabilidad entre proveedores.
