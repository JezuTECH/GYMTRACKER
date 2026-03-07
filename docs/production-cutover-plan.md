# Gym Tracker Production Cutover Plan

## Objetivo

Mover la versión nueva de la aplicación al proyecto productivo `gymtracker-a01c8` con:

- backup real previo
- migración de datos segura y reversible
- ventana de corte corta
- rollback claro
- validación funcional después del cambio

Este plan asume la estrategia correcta para el estado actual del código:

- migración aditiva, no destructiva
- mantener `workouts` y `plans` actuales
- añadir y rellenar el maestro `users/{uid}/exercises`
- backfill de campos nuevos en `workouts` y `plans`
- no borrar `v1` ni legado durante el cutover

## Decisión de Cutover

### Recomendación

Hacer un cutover con `write freeze` corto y migración aditiva.

No recomiendo:

- dual-write en la primera salida
- restauraciones “a ciegas”
- migración destructiva
- cortar directamente a producción sin ensayo en `staging`

### Motivo

Ahora mismo el producto es de uso diario y el coste de una inconsistencia es alto. Un freeze corto es mucho más seguro que meter sincronización compleja entre modelos.

## Estado Objetivo en Producción

### Colecciones

- `users/{uid}/exercises/{exerciseId}`
- `workouts`
- `plans`
- `users/{uid}` con `dailyMetrics`

### Qué cambia

#### Maestro por usuario

Cada ejercicio tendrá:

- `exerciseId` estable
- `name`
- `muscleGroup`
- `trackingMode`
- `aliases` para absorber nombres antiguos
- metadatos de ficha

#### Workouts

Se mantienen en la colección actual, con backfill de:

- `exerciseId`
- `exerciseNameSnapshot`
- `muscleGroupSnapshot`
- `trackingMode`
- `trackingModeSnapshot`
- `durationMin`
- `distanceKm`
- `delete`
- `deletedAt`

#### Plans

Se mantienen en la colección actual, con backfill de:

- `exerciseId`
- `exerciseNameSnapshot`
- `muscleGroupSnapshot`
- `trackingModeSnapshot`

## Bloqueantes Antes de Producción

### Bloqueante 1: correo KPI

Hoy el envío visual de correo está habilitado solo en emulador:

- [functions/src/index.ts](/Users/jesusrodriguezsanchez/Developer/gym-tracker%20CODEX/functions/src/index.ts#L447)

Eso significa que el cutover a producción no debe incluir envío real de correo hasta configurar:

- proveedor SMTP o API transaccional
- secretos
- remitente validado
- política de errores y reintentos

Decisión recomendada:

- desplegar la pantalla `KPIs`
- dejar el botón de correo oculto o deshabilitado en producción
- activar correo en una segunda salida

### Bloqueante 2: rehearsal en staging

Antes de producción hace falta un ensayo en un proyecto Firebase de `staging` con:

- Auth real
- Firestore real
- Functions reales
- copia de datos o dataset representativo

Sin rehearsal, no recomendaría cutover.

### Bloqueante 3: conflictos de normalización

No se debe migrar si el `dry-run` deja conflictos manuales sin resolver.

Ejemplos de conflictos que requieren revisión:

- nombres parecidos pero no equivalentes
- cambios de grupo dudosos
- ejercicios repetidos sin `exerciseId`

## Entregables Previos

Antes del cutover deben existir:

1. script de backup gestionado de Firestore
2. script de export JSON para inspección rápida
3. script `dry-run`
4. script de migración real
5. script de verificación post-migración
6. documento de rollback
7. release candidate validado en local y `staging`

## Backups Obligatorios

### Backup 1: export gestionado completo

Backup oficial de Firestore a GCS.

Debe guardarse con timestamp y no sobrescribirse.

Contenido mínimo:

- base completa
- fecha/hora
- proyecto
- release asociada

### Backup 2: JSON operativo

Export JSON de:

- `workouts`
- `plans`
- `users`
- `users/{uid}/exercises`
- `users/{uid}/exerciseLibrary`

Objetivo:

- inspección rápida
- diff antes/después
- soporte a rollback lógico

### Backup 3: manifiesto de migración

Archivo con:

- número total de usuarios
- número de workouts
- número de plans
- maestros creados
- merges automáticos
- conflictos manuales
- conteos antes/después

## Estrategia de Migración

### Normalización segura

Se consolidará solo por equivalencias seguras:

- trim
- espacios múltiples
- mayúsculas/minúsculas
- tildes/acentos

No se mergeará automáticamente por parecido semántico.

### Alias del maestro

Cuando un ejercicio cambie de nombre, el maestro conservará alias de canonical keys antiguas.

Objetivo:

- no duplicar fichas visualmente
- absorber histórico con snapshots antiguos
- evitar que `CurlMáquina` y `Curl Máquina` aparezcan como ejercicios distintos si pertenecen al mismo `exerciseId`

### Backfill

El script debe:

1. crear maestro si no existe
2. enlazar `exerciseId` en `workouts`
3. rellenar snapshots faltantes
4. rellenar `trackingMode`
5. backfillear `plans`
6. generar reporte

## Ventana de Corte

### Duración objetivo

- objetivo: 30 a 60 minutos
- máximo aceptable: 90 minutos

### Recomendación operativa

No hacer cutover:

- antes de un entrenamiento
- de madrugada sin margen de soporte
- con cambios adicionales no relacionados en la misma salida

Recomendación:

- día laborable
- primera mitad del día
- con margen posterior para pruebas manuales

## Runbook de Cutover

### T-7 días

1. Cerrar alcance del release.
2. Congelar cambios funcionales no críticos.
3. Ejecutar rehearsal completo en `staging`.
4. Revisar conflictos del `dry-run`.
5. Cerrar lista de ejercicios dudosos manualmente.

### T-2 días

1. Ejecutar `dry-run` actualizado sobre snapshot reciente de producción.
2. Revisar diferencias con rehearsal.
3. Confirmar permisos GCP para export y restore.
4. Confirmar acceso al bucket de backups.
5. Confirmar versión exacta de frontend, functions y reglas.

### T-0, inicio de ventana

1. Activar `maintenance mode` o parar el uso de la app.
2. Verificar que no hay escritura activa.
3. Tomar backup gestionado completo.
4. Generar export JSON y manifiesto previo.
5. Ejecutar `dry-run` final sobre producción.
6. Si el resultado no coincide con lo aprobado, abortar.

### T-0, migración

1. Crear o actualizar `users/{uid}/exercises`.
2. Añadir `aliases` desde el histórico del mismo `exerciseId`.
3. Backfillear `workouts` en batches controlados.
4. Backfillear `plans`.
5. Ejecutar verificación automática.

### T-0, despliegue

Orden recomendado:

1. Functions y reglas compatibles hacia atrás
2. frontend nuevo

Motivo:

- evitar que el frontend nuevo llegue antes que backend/reglas compatibles

### T-0, smoke test

Validar en producción:

1. login
2. registro de fuerza
3. registro de resistencia
4. creación de ejercicio desde registro
5. rename en biblioteca sin duplicado
6. edición y soft delete
7. diario
8. KPIs 7 y 30 días

### T+1 hora

1. Revisar logs de errores frontend
2. Revisar logs de functions
3. Revisar conteos de creación/actualización
4. Confirmar que no aparecieron duplicados nuevos

### T+24 horas

1. Confirmar uso normal
2. Confirmar que el histórico se sigue viendo correctamente
3. Mantener legado intacto

## Verificaciones Post-Migración

### Técnicas

- todos los workouts activos tienen `exerciseId`
- todos los workouts tienen snapshots coherentes
- todos los ejercicios del maestro tienen `canonicalKey`
- los alias no duplican la canonical actual
- ningún plan queda con rutina huérfana si existía combinación conocida

### Funcionales

- los dropdowns salen del maestro
- un rename no crea ficha nueva
- cardio/resistencia muestra minutos y distancia
- `KPIs` no falla con periodos sin actividad

## Rollback

### Rollback rápido

Usar si el problema es de aplicación, no de corrupción de datos.

Pasos:

1. activar freeze o mantenimiento
2. revertir frontend
3. revertir functions si aplica
4. mantener datos migrados sin usarlos
5. reabrir solo cuando la versión anterior esté validada

Ventaja:

- rápido
- no requiere restore completo

### Rollback fuerte

Usar solo si hay corrupción real o escritura incorrecta masiva.

Pasos:

1. freeze completo
2. export de emergencia del estado roto
3. restaurar desde backup gestionado
4. validar integridad
5. reabrir con versión estable

### Criterio

Mientras la migración sea aditiva, el rollback preferido es el rápido.

No recomiendo restauración completa salvo incidencia grave.

## Checklist de Go / No-Go

### Go

- rehearsal en `staging` aprobado
- backup probado
- `dry-run` limpio o con conflictos resueltos
- scripts listos
- release candidate validado
- ventana reservada

### No-Go

- correo KPI pretendido en prod sin proveedor real
- conflictos manuales sin resolver
- diferencias fuertes entre rehearsal y producción
- imposibilidad de tomar backup gestionado
- reglas no compatibles con frontend nuevo

## Recomendación Final

Haría el cutover en dos salidas:

### Salida 1

- maestro por usuario
- backfill de `workouts`
- backfill de `plans`
- biblioteca
- registro
- diario
- KPIs sin correo real

### Salida 2

- correo KPI en producción con proveedor real

Esto baja mucho el riesgo y separa claramente:

- migración de datos
- feature externa dependiente de infraestructura de email

## Siguiente Paso Operativo

Después de este plan, el siguiente paso correcto es preparar:

1. scripts de backup
2. `dry-run`
3. migración real
4. verificación
5. rehearsal en `staging`
