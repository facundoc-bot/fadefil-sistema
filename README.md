# Sistema FADEFIL

Sistema de clientes, máquinas, stock y cilindros de CO₂ de FADEFIL: una app web liviana conectada directo a una base de datos en Supabase.

Reemplaza a la versión en Google Sheets + Apps Script (hasta la 1.5), que quedó lenta. Las reglas de negocio son las mismas.

## Cómo está armado

| Parte | Qué es | Dónde |
|---|---|---|
| Base de datos | PostgreSQL en Supabase (plan gratuito, São Paulo) | `supabase/migrations/` |
| Permisos | Login + roles ADMIN / CARGA / CONSULTA, controlados por la base | `supabase/migrations/*_permisos.sql` |
| Guardado de operaciones | Función del servidor con el motor de reglas: valida y guarda cada lote completo o nada | (fase 1b) |
| App | Página web estática | (fase 2) |
| Publicación | GitHub Actions: cada cambio en `main` se prueba y se aplica solo | `.github/workflows/` |
| Tarea diaria | Mantiene activa la base y guarda una copia de seguridad (30 días) | `.github/workflows/tarea-diaria.yml` |

## Secretos (Settings → Secrets and variables → Actions)

- `SUPABASE_ACCESS_TOKEN`: token de acceso de Supabase (vence: renovarlo antes de la fecha).
- `SUPABASE_DB_PASSWORD`: contraseña de la base.
- `SUPABASE_PROJECT_REF`: código del proyecto.

Nunca se escriben en el código ni en el chat.

## Probar la base en una computadora

Con PostgreSQL 15 o superior instalado:

```
bash tests/db/probar.sh
```

Crea una base descartable, aplica las migraciones y prueba los datos iniciales, los permisos de cada rol y el renombrado de maestros.

## Documentación

Decisiones y plan: en el proyecto "TRABAJO FADEFIL" de Claude (`arquitectura/MIGRACION_SUPABASE.md`).
