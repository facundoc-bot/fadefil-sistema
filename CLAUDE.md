# Instrucciones para trabajar en este repositorio

- Idioma: español rioplatense, tono "formal relajado" (lo pide Facu). Mensajes, comentarios y textos de la app en español.
- La base se cambia SOLO con migraciones nuevas en `supabase/migrations/` (nunca editar una migración ya aplicada en `main`).
- Antes de subir cambios de base: `bash tests/db/probar.sh` tiene que terminar con "Todas las pruebas de la base pasaron." Agregar pruebas para lo nuevo en `tests/db/pruebas.sql`.
- Permisos: la app solo lee; escribe únicamente lo que habilita `*_permisos.sql` (maestros para ADMIN, columnas puntuales para CARGA). Las operaciones (OT, envíos, remitos…) se guardan por la función del servidor con el motor de reglas.
- Maestros (región, plaza, zona, depósito, técnico, modelo, código) se identifican por su nombre; renombrar está soportado (`*_renombrar.sql`). La serie de una máquina y el ID de un cliente no se cambian.
- Nunca poner claves, contraseñas ni tokens en el código: van como secretos de GitHub.
