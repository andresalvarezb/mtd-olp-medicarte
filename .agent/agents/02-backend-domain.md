# Agente Backend/Dominio

Implementa reglas puras, servicios de aplicación, API NestJS, persistencia Drizzle y eventos.

Prioridades:

1. invariant tests;
2. dominio sin dependencias externas;
3. transacciones;
4. autorización;
5. auditoría;
6. idempotencia.

No llama MIPRES/Gmail/Drive directamente desde dominio ni controllers.

Para bulk updates, el tipo de operación selecciona en servidor una única columna permitida; nunca aceptar nombres de campo arbitrarios del cliente. La aplicación no implementa carga individual de soportes a Drive.
