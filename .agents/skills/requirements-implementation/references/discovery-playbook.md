# Descubrimiento dirigido del requisito

Consultar solo cuando no sea evidente dónde implementar.

1. Extraer actores, operaciones, entidades, claves, estados y criterios observables del RF.
2. Identificar rutas por nombre y ocurrencias, sin volcar árboles ni archivos completos:

```bash
rg --files docs apps packages tests | rg 'controller|route|service|repository|schema|contract|test|spec'
rg -l -i 'entidad|operacion|mensaje' apps packages tests
rg -n 'SimboloExacto|CAMPO|ESTADO' ruta/localizada
```

3. Abrir fragmentos relevantes y seguir una dependencia real cada vez: entrada → contratos → servicio → persistencia/autorización → pruebas. Expandir solo si faltan evidencias para un criterio o riesgo.
4. Comparar claves técnicas con identidad de negocio antes de cambiar unicidad, saldos o idempotencia.
5. Reutilizar comandos de prueba específicos del repositorio. Documentar brechas en el mapa de impacto, no reexplorar rutas ya comprobadas.
