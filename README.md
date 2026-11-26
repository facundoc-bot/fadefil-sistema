# Sistema FADEFIL

Sistema de clientes, máquinas, stock y cilindros de CO₂ de FADEFIL: una app web liviana conectada directo a una base de datos en Supabase.

Reemplaza a la versión en Google Sheets + Apps Script (hasta la 1.5), que quedó lenta. Las reglas de negocio son las mismas.

## Cómo está armado

| Parte | Qué es | Dónde |
|---|---|---|
| Base de datos | PostgreSQL en Supabase (plan gratuito, São Paulo) | `supabase/migrations/` |
| Permisos | Login + roles ADMIN / CARGA / CONSULTA, controlados por la base | `supabase/migrations/*_permisos.sql` |
| Motor de reglas | Las mismas reglas de la versión en Sheets (OT, stock, envíos, taller), pasadas tal cual | `supabase/functions/_compartido/motor.js`, `carga.js` |
| Guardado de operaciones | Función del servidor `guardar`: valida con el motor y guarda cada lote completo o nada, de a uno por vez; también anula y audita | `supabase/functions/guardar/`, `_compartido/estado.js` |
| App | Página web estática | (fase 2) |
| Publicación | GitHub Actions: cada cambio en `main` se prueba y se aplica solo (base y función) | `.github/workflows/` |
| Tarea diaria | Mantiene activa la base y guarda una copia de seguridad (30 días) | `.github/workflows/tarea-diaria.yml` |

## Secretos (Settings → Secrets and variables → Actions)

- `SUPABASE_ACCESS_TOKEN`: token de acceso de Supabase (vence: renovarlo antes de la fecha).
- `SUPABASE_DB_PASSWORD`: contraseña de la base.
- `SUPABASE_PROJECT_REF`: código del proyecto.

Nunca se escriben en el código ni en el chat.

## Probar la base en una computadora

Con PostgreSQL 15 o superior y Node 22 instalados:

```
npm install
bash tests/db/probar.sh
```

Crea una base descartable, aplica las migraciones y prueba:
- los datos iniciales, los permisos de cada rol, los archivos y el renombrado de maestros (`tests/db/pruebas.sql`);
- el motor de reglas con sus 61 pruebas originales de Sheets (`tests/motor/Pruebas.gs`);
- el guardado de punta a punta en la base: lotes, advertencias, errores, alta inicial, revisión, anulación, auditoría y dos guardados a la vez (`tests/motor/pruebas_base.mjs`);
- si está Deno, que la función del servidor conecte y valide (`tests/motor/humo_deno.ts`).

## Documentación

Decisiones y plan: en el proyecto "TRABAJO FADEFIL" de Claude (`arquitectura/MIGRACION_SUPABASE.md`).
