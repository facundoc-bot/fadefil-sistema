# Sistema FADEFIL

Sistema de clientes, máquinas, stock y cilindros de CO₂ de FADEFIL: una app web liviana conectada directo a una base de datos en Supabase.

Reemplaza a la versión en Google Sheets + Apps Script (hasta la 1.5), que quedó lenta. Las reglas de negocio son las mismas.

## Cómo está armado

| Parte | Qué es | Dónde |
|---|---|---|
| Base de datos | PostgreSQL en Supabase (plan gratuito, São Paulo) | `supabase/migrations/` |
| Permisos | Login + roles ADMIN / CARGA / CONSULTA, controlados por la base | `supabase/migrations/*_permisos.sql` |
| Motor de reglas | Las mismas reglas de la versión en Sheets (OT, stock, envíos, taller y CO₂), pasadas tal cual | `supabase/functions/_compartido/motor.js`, `carga.js`, `co2_motor.js` |
| Guardado de operaciones | Función del servidor `guardar`: valida con el motor y guarda cada lote completo o nada, de a uno por vez; también anula y audita. CO₂: remitos de LINDE, aprobación de series dudosas, facturas y cilindros en las OT | `supabase/functions/guardar/`, `_compartido/estado.js`, `co2_estado.js` |
| App | Páginas web estáticas: app principal, CO₂, Datos (maestros, usuarios, carga masiva) y descargas a Excel; login con Google | `app/` |
| Publicación de la app | Cloudflare Pages; arma `config.js` y configura el login con Google en Supabase | `.github/workflows/app.yml` |
| Publicación | GitHub Actions: cada cambio en `main` se prueba y se aplica solo (base y función) | `.github/workflows/` |
| Tarea diaria | Mantiene activa la base, guarda una copia de seguridad (30 días) y audita equipos, stock y CO₂ | `.github/workflows/tarea-diaria.yml` |

## Secretos (Settings → Secrets and variables → Actions)

- `SUPABASE_ACCESS_TOKEN`: token de acceso de Supabase (vence: renovarlo antes de la fecha).
- `SUPABASE_DB_PASSWORD`: contraseña de la base.
- `SUPABASE_PROJECT_REF`: código del proyecto.
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`: publicación de la app.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: login con Google.

Nunca se escriben en el código ni en el chat.

## Probar la base en una computadora

Con PostgreSQL 15 o superior y Node 22 instalados:

```
npm install
bash tests/db/probar.sh
```

Crea una base descartable, aplica las migraciones y prueba:
- los datos iniciales, los permisos de cada rol, los archivos y el renombrado de maestros (`tests/db/pruebas.sql`);
- el motor de reglas y el de CO₂ con sus pruebas originales de Sheets (`tests/motor/Pruebas.gs`: 61, `tests/motor/co2_Pruebas.gs`: 32);
- el guardado de punta a punta en la base: lotes, advertencias, errores, alta inicial, revisión, anulación, auditoría y dos guardados a la vez, remitos de LINDE, CO₂ en las OT, series dudosas, facturas y auditorías (`tests/motor/pruebas_base.mjs`);
- si está Deno, que la función del servidor conecte y valide (`tests/motor/humo_deno.ts`).

## Documentación

Decisiones y plan: en el proyecto "TRABAJO FADEFIL" de Claude (`arquitectura/MIGRACION_SUPABASE.md`).

## Probar la app en un navegador (en una computadora)

```
npm install
bash tests/app/probar_app.sh
```

Levanta una base de prueba con datos, PostgREST, la función del servidor (Deno) y la app, y recorre con Chrome todas las pantallas, Datos, las descargas a Excel, la carga masiva y el guardado de una OT. Necesita PostgreSQL, Deno, PostgREST, Chrome y Python con Playwright.
