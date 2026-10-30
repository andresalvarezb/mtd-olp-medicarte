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
