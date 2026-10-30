# Descubrimiento dirigido del requisito

Consultar esta referencia solo cuando no sea evidente dónde implementar.

1. Extraer del requisito actores y límites, operaciones, entidades e identificadores, estados/invariantes y evidencias visibles.
2. Localizar primero rutas, sin volcar archivos completos:

```bash
rg --files docs apps packages tests | rg 'requirements|controller|route|service|repository|schema|contract|test|spec'
rg -l -i 'entidad|operacion|mensaje' apps packages tests
rg -n 'SimboloExacto|CAMPO|ESTADO' ruta/localizada
```

3. Seguir únicamente referencias reales entre interfaz/entrada, contrato, regla de negocio, persistencia, autorización, integraciones y pruebas. Ampliar una capa solo si la evidencia actual no resuelve la brecha.
4. Comparar identidad de negocio con claves técnicas antes de definir unicidad, saldos, deduplicación o idempotencia.
5. Tomar comandos de prueba de `package.json`, scripts o documentación del repositorio. Cubrir criterio positivo, rechazo, riesgo y regresión; no conectar a producción.
