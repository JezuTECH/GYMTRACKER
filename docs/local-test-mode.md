# Local Test Mode

## Objetivo

Hacer que `localhost` sea un entorno de prueba seguro por defecto:

- frontend local
- Firebase Auth emulator
- Firestore emulator
- Functions emulator
- sin tocar datos reales por accidente

## Comportamiento

- `npm start`
  - arranca emuladores y app en paralelo
  - muestra badge `TEST` dentro de la app
  - el login usa acceso anónimo local
- `npm run start:prod`
  - arranca la app local apuntando a producción
  - requiere override explícito para evitar errores accidentales

## Garantías

- Si la app corre en `localhost`, por defecto usa emuladores.
- Si alguien intenta abrir `localhost` contra el proyecto real sin override, la app falla con error explícito.
- El modo test no comparte datos con Firestore/Auth de producción.

## Puertos

- app: `http://localhost:3000`
- Emulator UI: `http://127.0.0.1:4000`
- Auth emulator: `127.0.0.1:9099`
- Firestore emulator: `127.0.0.1:8080`
- Functions emulator: `127.0.0.1:5001`

## Notas

- El usuario de prueba local entra con autenticación anónima.
- Los datos del emulador son locales al entorno de desarrollo.
- Antes de migrar datos reales, la validación funcional debe hacerse primero aquí.
