# Fix for "No token found" error with large database files

## Problem Description

La extensión Cursor Stats muestra el error "No token found" en bases de datos grandes (>2GB) porque utiliza `sql.js`, que carga todo el archivo en memoria a través de `fs.readFileSync()`. En macOS, especialmente en máquinas con Apple Silicon, el archivo `state.vscdb` puede superar fácilmente los 2GB (en nuestro caso alcanzaba 2.77GB), lo que provoca un error `ERR_FS_FILE_TOO_LARGE` cuando se intenta cargar el archivo completo en memoria.

## Solution

Esta PR reemplaza el uso de `sql.js` con `sqlite3`, que puede manejar archivos de base de datos grandes sin cargarlos completamente en memoria. La implementación:

1. Utiliza `sqlite3` como biblioteca principal para acceder a la base de datos
2. Mantiene `sql.js` como fallback solo para archivos pequeños (menores a 1.5GB)
3. Importa las dependencias dinámicamente para evitar problemas de compilación
4. Agrega más información de registro sobre el tamaño del archivo de base de datos
5. Mejora el manejo de errores y la retroalimentación en caso de problemas

## Testing

Esta solución ha sido probada en:
- macOS con bases de datos de más de 2.5GB
- Confirma que puede acceder correctamente al token de autenticación

## Cambios

- Agregado `sqlite3` como dependencia
- Modificado `src/services/database.ts` para usar sqlite3 en lugar de sql.js
- Mantenido compatibilidad hacia atrás con la lógica de sql.js existente
- Agregada verificación del tamaño del archivo para optimizar la estrategia de acceso a la base de datos

## Nota

Este cambio resuelve el problema manteniendo la funcionalidad existente y no debería afectar negativamente a los usuarios que no experimentan el problema. 