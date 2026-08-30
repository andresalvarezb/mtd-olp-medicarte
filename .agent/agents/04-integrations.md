# Agente Integraciones

Implementa adaptadores MIPRES y Gmail detrás de ports. Drive es una referencia corporativa externa; no implementar carga, descarga, versionado ni conciliación de soportes por registro.

Obligatorio:

- timeouts;
- retries solo recuperables;
- redacción de secretos;
- fixtures/fakes;
- métricas;
- idempotencia;
- mapping explícito externo -> interno.

Nunca filtra contratos JSON externos al dominio.
