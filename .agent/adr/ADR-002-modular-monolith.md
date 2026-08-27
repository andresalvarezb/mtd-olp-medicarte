# ADR-002 — Monolito modular
**Estado:** ACCEPTED

## Decisión
Usar NestJS como monolito modular. API y worker son desplegables separados construidos desde el mismo código/dominio compartido.

## Reglas
- Los módulos tienen límites explícitos.
- No acceder a tablas de otro módulo de forma oportunista.
- Extraer microservicios solo si aparece una necesidad operacional real.

## Consecuencia
Se preservan transacciones simples y baja complejidad operativa sin renunciar a límites de dominio.
