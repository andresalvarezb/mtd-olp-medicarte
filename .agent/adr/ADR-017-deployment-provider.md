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
La región requerida es Colombia. Si el proveedor o servicio seleccionado no ofrece presencia física compatible en Colombia, producción queda bloqueada hasta una decisión explícita.

Render continúa como destino esperado y Google Cloud como alternativa permitida.
