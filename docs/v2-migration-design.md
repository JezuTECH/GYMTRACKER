# Gym Tracker V2 Migration Design

## Objetivo

Diseñar una migración segura desde el modelo actual basado en texto libre hacia un modelo `v2` con:

- maestro de ejercicios por usuario
- identificadores estables por ejercicio
- soporte para dos modos de registro: `strength` y `endurance`
- edición y borrado seguro (soft delete) desde la pantalla de registro
- migración paralela sin tocar destructivamente `v1`
- rollback posible en cualquier momento

## Decisiones Cerradas

### Producto

- Cada usuario tendrá su propio maestro de ejercicios.
- El ejercicio tendrá un `exerciseId` estable.
- El nombre del ejercicio se podrá cambiar sin romper histórico.
- El grupo muscular sigue siendo una dimensión analítica importante.
- Cambiar el grupo de un ejercicio afectará por defecto solo a registros futuros.
- Habrá un `trackingMode` en el maestro del ejercicio.
- `trackingMode` se activará/desactivará con un switch desde ficha/creación.
- `trackingMode` permitido en `v2`:
  - `strength`
  - `endurance`
- `endurance` registrará:
  - `durationMin` obligatorio
  - `distanceKm` opcional
- Los ejercicios nuevos podrán crearse desde registro, pero con confirmación explícita.
- El borrado de registros será `soft delete`.
- La migración será paralela: mantener `v1` intacto y rellenar `v2`.

### Técnica

- No se migrará "in place" en la primera fase.
- Habrá backup real de Firestore antes de cualquier escritura.
- `v2` convivirá temporalmente con `v1`.
- La app cambiará a `v2` por fases.
- No se eliminarán campos o colecciones `v1` hasta validar `v2`.

## Problemas del Modelo Actual

### Identidad débil del ejercicio

Hoy el ejercicio se identifica por texto (`muscleGroup` + `exercise`) en:

- `/workouts`
- `/plans`
- `users/{uid}/exerciseLibrary`

Eso impide:

- renombrar sin tocar histórico
- unificar nomenclatura
- evitar duplicados semánticos
- usar la ficha como maestro real

### Ficha no maestra

La pantalla de biblioteca reconstruye pares leyendo `workouts`, no desde la ficha:

- [src/components/ExerciseLibrary.jsx](/Users/jesusrodriguezsanchez/Developer/gym-tracker%20CODEX/src/components/ExerciseLibrary.jsx)
- [src/components/ExerciseChart.jsx](/Users/jesusrodriguezsanchez/Developer/gym-tracker%20CODEX/src/components/ExerciseChart.jsx)
- [src/components/PlanDay.jsx](/Users/jesusrodriguezsanchez/Developer/gym-tracker%20CODEX/src/components/PlanDay.jsx)

Resultado:

- si no hay registro, no hay ejercicio visible
- el maestro no existe realmente
- los dropdowns dependen de histórico sucio

### Normalización insuficiente

El `docKeyFor` actual elimina acentos de forma problemática:

- `Bíceps` -> `bceps`
- `Biceps` -> `biceps`

Eso hace que no sea seguro consolidar `v2` apoyándose en la clave actual.

### Modelo rígido para fuerza

Hoy Firestore exige `weight` numérico en creación:

- [firestore.rules](/Users/jesusrodriguezsanchez/Developer/gym-tracker%20CODEX/firestore.rules)

Y varias pantallas asumen `weight/reps`:

- registro
- gráfico
- diario
- utilidades de score

## Modelo de Datos Objetivo

### Maestro por usuario

Colección:

- `users/{uid}/exercises/{exerciseId}`

Documento:

```json
{
  "uid": "user_uid",
  "exerciseId": "ex_01J...",
  "name": "Press banca",
  "muscleGroup": "Pecho",
  "trackingMode": "strength",
  "isArchived": false,
  "description": "",
  "youtubeUrl": "",
  "technique": "",
  "mistakes": "",
  "equipment": "",
  "notes": "",
  "canonicalName": "press banca",
  "canonicalMuscleGroup": "pecho",
  "normalizationKey": "pecho||press banca",
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

Notas:

- `exerciseId` será la identidad estable.
- `name` y `muscleGroup` son editables.
- `normalizationKey` se usa para migración y detección de duplicados.
- La ficha actual se absorbe aquí.

### Registros transformados

Colección:

- `workouts_v2/{workoutId}`

Documento:

```json
{
  "uid": "user_uid",
  "exerciseId": "ex_01J...",
  "exerciseNameSnapshot": "Press banca",
  "muscleGroupSnapshot": "Pecho",
  "trackingModeSnapshot": "strength",
  "strength": {
    "weightKg": 80,
    "reps": 8
  },
  "endurance": null,
  "timestamp": "timestamp",
  "source": {
    "migratedFrom": "workouts/abc123"
  },
  "delete": false,
  "deletedAt": null,
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

Registro `endurance`:

```json
{
  "uid": "user_uid",
  "exerciseId": "ex_01J...",
  "exerciseNameSnapshot": "Correr",
  "muscleGroupSnapshot": "Resistencia",
  "trackingModeSnapshot": "endurance",
  "strength": null,
  "endurance": {
    "durationMin": 45,
    "distanceKm": 7.2
  },
  "timestamp": "timestamp",
  "source": {
    "createdInV2": true
  },
  "delete": false,
  "deletedAt": null,
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

Notas:

- Se mantienen snapshots para proteger histórico ante renombres.
- `trackingModeSnapshot` evita que un cambio posterior del maestro rompa interpretaciones antiguas.
- El borrado seguro vive en el documento.

### Planes transformados

Colección:

- `plans_v2/{planId}`

Documento:

```json
{
  "uid": "user_uid",
  "date": "timestamp",
  "description": "Planificación del día",
  "routines": [
    {
      "exerciseId": "ex_01J...",
      "exerciseNameSnapshot": "Press banca",
      "muscleGroupSnapshot": "Pecho",
      "trackingModeSnapshot": "strength",
      "series": "4x8"
    }
  ],
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

Notas:

- El plan sigue siendo editable.
- Para `endurance`, `series` se puede reinterpretar en el futuro, pero no es prioridad de la migración.

## Tracking Mode y UI

### Valores

- `strength`
- `endurance`

### Reglas

- El maestro manda.
- Al seleccionar un ejercicio en registro, la UI cambia según `trackingMode`.
- El switch debe mostrarse en:
  - alta de ejercicio desde registro
  - ficha del ejercicio

### Campos visibles

#### Strength

- Peso (kg)
- Repeticiones

#### Endurance

- Minutos
- Distancia (opcional)

### Métrica principal

No usar el nombre `PowerScore` para `endurance`.

#### Strength

- Métrica principal: `PowerScore`

#### Endurance

- Métrica principal:
  - si hay distancia: `Ritmo medio`
  - si no hay distancia: `Minutos`

## Grupos Musculares

### Regla de negocio

- El grupo muscular es una dimensión de análisis real.
- El grupo pertenece al maestro, pero el histórico guarda snapshot.

### Cambio de grupo

Por defecto:

- cambia solo futuros registros

Más adelante se puede añadir una acción explícita:

- `Aplicar nuevo grupo al histórico`

Eso será una operación separada y confirmada.

## Normalización

### Objetivo

Unificar equivalencias seguras sin imponer nombres a los usuarios.

### Normalización base para migración

Aplicar sobre `muscleGroup` y `exercise`:

1. trim
2. colapsar espacios internos
3. lowercase
4. eliminar diacríticos

Ejemplos de equivalencia segura:

- `Press militar` = `press militar`
- `Press  militar` = `Press militar`
- `Bíceps` = `Biceps`

Ejemplos no auto-unificables:

- `Remo barra` y `Remo con barra`
- `Correr` y `Cinta`
- `Andar rápido` y `Trekking`

### Política de merge

#### Auto-merge

Solo cuando la equivalencia es exacta tras normalización base.

#### Revisión manual

Cuando dos nombres distintos no colapsan exactamente pero parecen parecidos.

### Artefactos de migración

El `dry-run` generará:

- `safe-merges.json`
- `manual-review.json`
- `migration-report.json`

## Estrategia de Migración

### Fase 0: Backup

Antes de cualquier escritura:

1. Export completo de Firestore.
2. Export JSON adicional de:
   - `workouts`
   - `plans`
   - `users/*/exerciseLibrary`
3. Guardar conteos por colección.

### Fase 1: Dry-run

Leer datos actuales y producir:

- usuarios detectados
- pares únicos por usuario
- equivalencias seguras
- conflictos manuales
- cobertura de fichas actuales
- estimación de maestros a crear
- estimación de `workouts_v2` a crear
- estimación de `plans_v2` a crear

### Fase 2: Crear maestro `v2`

Por cada usuario:

- crear `users/{uid}/exercises/{exerciseId}`
- absorber metadatos de `exerciseLibrary` cuando existan
- priorizar campos ya existentes en la ficha

### Fase 3: Migrar workouts

Por cada `workout` no borrado:

- localizar `exerciseId`
- generar snapshots
- escribir en `workouts_v2`
- no borrar `workouts`

Por cada `workout` ya marcado como borrado:

- migrar también el estado de borrado

### Fase 4: Migrar plans

Por cada plan:

- resolver `exerciseId` de cada rutina
- guardar snapshots por rutina
- escribir en `plans_v2`

### Fase 5: Validación de consistencia

Validar:

- conteos `v1` vs `v2`
- cobertura de ejercicios
- cobertura de planes
- workouts sin `exerciseId`
- planes con rutinas no resueltas

## Rollback

### Estrategia principal

- `v1` permanece intacto
- la app puede seguir leyendo `v1` si `v2` falla

### Rollback rápido

- revertir cambios de código
- ignorar `v2`

### Rollback fuerte

Si hiciera falta:

- restaurar export completo de Firestore

## Reglas y Seguridad

### Reglas Firestore nuevas

Habrá que actualizar reglas para permitir:

- `users/{uid}/exercises/{exerciseId}`
- `workouts_v2`
- `plans_v2`

Y validar tipos según `trackingModeSnapshot`.

### Restricciones recomendadas

#### workouts_v2 strength

- `strength.weightKg` number
- `strength.reps` number o null
- `endurance` null

#### workouts_v2 endurance

- `endurance.durationMin` number
- `endurance.distanceKm` number o null
- `strength` null

#### soft delete

- permitir update del propietario
- exigir que `uid` no cambie

## Cambios de UI por Fase

### Fase A

- crear/editar maestro `v2`
- leer dropdowns desde maestro
- crear ejercicio desde registro con confirmación

### Fase B

- edición y soft delete desde registro

### Fase C

- `trackingMode` y formulario adaptativo

### Fase D

- gráfico y diario sobre `v2`
- métricas por tipo

### Fase E

- email KPI 7/30 días

## KPIs v1 por Email

### Disponibles con `v2`

- días con actividad
- total de registros
- ejercicios únicos
- grupos activos
- minutos totales
- media de minutos por día activo
- top grupos por número de registros
- top ejercicios por frecuencia
- para `endurance`:
  - distancia total
  - minutos de resistencia
  - ritmo medio cuando haya distancia

### No priorizar en v1

- número de sesiones reales de entreno
- minutos por grupo muscular en fuerza

Eso requeriría modelar sesiones o tiempo por ejercicio de forma más explícita.

## Orden de Implementación Recomendado

1. Diseño `v2` cerrado
2. Backup y dry-run
3. Scripts de migración paralela
4. Maestro `v2` + dropdowns desde maestro
5. Crear ejercicio desde registro con confirmación
6. Editar/borrar con soft delete desde registro
7. `trackingMode` `endurance`
8. Gráfico/diario sobre `v2`
9. Email KPI

## Riesgos

### Riesgo 1: merges erróneos

Mitigación:

- auto-merge solo en equivalencias seguras
- revisión manual en casos dudosos

### Riesgo 2: divergencia temporal `v1` / `v2`

Mitigación:

- periodo corto de convivencia
- migración y cambio de app en ventana controlada

### Riesgo 3: reglas Firestore demasiado permisivas

Mitigación:

- endurecer validación de campos al pasar a `v2`

### Riesgo 4: snapshots insuficientes para histórico

Mitigación:

- guardar `exerciseNameSnapshot`, `muscleGroupSnapshot`, `trackingModeSnapshot`

## Entregables Técnicos Siguientes

1. Script de backup
2. Script `dry-run` de migración
3. Script real de migración `v1 -> v2`
4. Nuevas reglas Firestore
5. Adaptación de UI a maestro `v2`
6. Adaptación de UI a `trackingMode`

