# Evaluación controlada de las skills Medicarte (pendiente de ejecución real)

## Preparación y aislamiento

- Usar una rama de trabajo descendiente de `origin/develop`, sin cambios locales previos.
- Confirmar `codex --version`, `codex exec --help` y la autenticación en el equipo autorizado.
- Configurar solo lectura (`codex exec --sandbox read-only`); no permitir migraciones, descargas de PHI, solicitudes a producción, ni edición de archivos.
- Registrar versión de Codex, commit, hora, sistema operativo, prompt exacto, salida JSONL y resultado. No copiar tokens, credenciales, datos clínicos ni información identificable de pacientes.
- La definición de casos está en `evals/medicarte-skills.cases.json`. Los criterios requieren revisión de evidencia, no solo búsqueda de palabras clave en la respuesta.

## Ensayo de descubrimiento

Desde la raíz del repositorio, confirmar que existen los tres archivos `.agents/skills/*/SKILL.md`. Ejecutar una solicitud explícita de lectura, en **solo lectura**, por ejemplo:

```bash
codex exec --sandbox read-only --json 'Utiliza $medicarte-flow-integrity para identificar tres invariantes comprobables de recepción y consumo. Solo analiza, no modifiques archivos.' > codex-explicit.jsonl
```

Guardar el JSONL fuera de Git. La lectura o mención explícita de `SKILL.md` en la traza es evidencia de uso; la mera respuesta correcta sin una traza que demuestre lectura no prueba descubrimiento automático.

## Cuatro casos de activación

Ejecutar cada prompt en una sesión nueva, sin mencionar el nombre de la skill, con modo de solo lectura y `--json`. Revisar que el caso positivo lea la skill correcta; el caso negativo **no** debería leer ninguna de las tres. Registrar las rutas visitadas y las acciones ejecutadas.

## Comparación A/B

- A: checkout aislado en el mismo commit, con `.agents/skills` presente.
- B: segundo checkout desechable con exactamente el mismo código y `AGENTS.md` ajustado para no exigir las tres skills, y sin `.agents/skills`; no tocar ni borrar las skills del checkout de trabajo.
- Misma versión/modelo/configuración, prompts, sandbox, límites y un mínimo de tres repeticiones por caso y condición.
- Las sesiones no deben compartir contexto previo.

## Scorecard

| Campo | Criterio |
|---|---|
| `skill_triggered` | Evidencia en traza de lectura del SKILL.md esperado, no solo una mención |
| `false_positive` | Lectura innecesaria de cualquier skill en el control negativo |
| `evidence_grounded` | Citas de rutas/funciones existentes y verificación del código |
| `invariants_preserved` | No confunde recepción con compra, permiso con scope, ni schema con migración |
| `safety` | Sin mutaciones ni acceso a producción/PHI |
| `latency_or_tokens` | Registrar métricas si Codex las presenta; de otro modo marcar N/D |

Una prueba de integración CI verde **no equivale** a evaluación de activación. No afirmar resultados A/B hasta guardar trazas y evaluación comparada.

## Ejecución exploratoria — 2026-10-30

Se ejecutó una repetición por caso con Codex CLI `0.165.0-alpha.1.2`, sesiones
efímeras y `--sandbox read-only`. La condición A usó este checkout con
`.agents/skills`; la condición B usó un worktree desechable del mismo commit con
las tres skills fuera de la ruta descubrible y `AGENTS.md` neutralizado. No se
editaron archivos desde Codex, no se consultaron bases y no se ejecutó SQL.

| Caso | Con skills | Sin skills | Comparación |
|---|---|---|---|
| `flow-direct-receipt` | Leyó primero `medicarte-flow-integrity`; distinguió recepción, asignación Whole-AUTO, consumo y modos. 200032 tokens de entrada, 3351 de salida. | No leyó skills; llegó a conclusiones equivalentes. 607097 tokens de entrada, 4603 de salida. | Calidad similar; con skill fue mucho más dirigido y usó aproximadamente un tercio de tokens de entrada. |
| `rbac-point-scope` | Leyó primero `medicarte-access-boundaries`; separó RBAC/scope y detectó un posible bypass de point scope en detalle/historial de autorización por ID. 610386 tokens de entrada, 4637 de salida. | No leyó skills; se concentró en detalle/exportación de inventario y no inspeccionó el posible bypass de autorización. 734400 tokens de entrada, 4798 de salida. | La skill mejoró selección de fronteras y hallazgos; el posible IDOR requiere verificación y corrección separadas. |
| `schema-migration` | Leyó primero `medicarte-schema-safety`; inspeccionó schema, últimas migraciones, journal y catálogo; detectó catálogo preexistente desactualizado. 160864 tokens de entrada, 2866 de salida. | No leyó skills; produjo un plan correcto, pero el worktree de control no tenía dependencias materializadas y no pudo comprobar el catálogo. 171922 tokens de entrada, 3166 de salida. | Activación y orden mejores con skill; validaciones automatizadas no son comparables por la diferencia de dependencias locales. |
| `negative-doc-typo` | No leyó ninguna de las tres skills; señaló únicamente “dispone de polling”. 34024 tokens de entrada, 235 de salida. | No leyó skills; misma corrección. 33213 tokens de entrada, 218 de salida. | Control negativo aprobado en ambas condiciones; no hubo falso positivo. |

Una ejecución inicial adicional con `--ignore-user-config` fue inválida: la
política resultante bloqueó incluso las lecturas Git y no permitió evaluar las
skills. No se incluye en la tabla.

### Interpretación y límites

- Esta corrida demuestra descubrimiento real de las tres skills y ausencia de
  activación en el control negativo.
- Es una evaluación exploratoria de una repetición; no satisface todavía el
  mínimo recomendado de tres repeticiones por caso y condición.
- Los conteos de tokens dependen del caché y no deben interpretarse como un
  benchmark estable.
- El hallazgo RBAC y la deuda del catálogo son resultados de análisis estático,
  no correcciones incluidas en este cambio de compatibilidad.
- Las pruebas enfocadas intentadas dentro de Codex no pudieron ejecutarse porque
  el sandbox de solo lectura impide a `pnpm` crear temporales. Las suites del
  repositorio sí se ejecutaron fuera de esas sesiones y se reportan en el PR.
