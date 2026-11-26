#!/usr/bin/env bash
# Prueba la app en un navegador, de punta a punta, en esta computadora:
# PostgreSQL descartable con las migraciones y datos de prueba → función del servidor en Deno →
# servidor local de la app → Chrome (Playwright) recorre las pantallas.
# Necesita PostgreSQL, Node, Deno, Python con Playwright y Chrome. No corre en la publicación.
set -euo pipefail
cd "$(dirname "$0")/../.."
BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1); export PATH="$BIN:$PATH"
DENO=$(command -v deno || echo node_modules/.bin/deno)
DIR=$(mktemp -d); PORT=55433
COMO=""; [ "$(id -u)" = 0 ] && COMO="runuser -u postgres --"
PIDS=""
trap 'kill $PIDS 2>/dev/null || true; $COMO pg_ctl -D "$DIR/datos" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
chown -R postgres "$DIR" 2>/dev/null || true
$COMO initdb -D "$DIR/datos" -U postgres -A trust >/dev/null
$COMO pg_ctl -D "$DIR/datos" -o "-p $PORT -k $DIR" -l "$DIR/log" start -w >/dev/null
PSQL="psql -h $DIR -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$PSQL -f tests/db/supabase_simulado.sql
for f in supabase/migrations/*.sql; do $PSQL -f "$f"; done
echo "· Datos de prueba"
node scripts/copiar_librerias.mjs >/dev/null
PGHOST=$DIR PGPORT=$PORT PGUSER=postgres PGDATABASE=postgres node tests/motor/pruebas_base.mjs | tail -1
echo "· PostgREST, función del servidor (Deno) y app"
export JWT_SECRETO="secreto-de-prueba-local-de-la-app-fadefil-0123456789"
PGRST=$(command -v postgrest || echo ../tools/postgrest)
[ -x "$PGRST" ] || PGRST=/home/claude/tools/postgrest
PGRST_DB_URI="postgres://postgres@127.0.0.1:$PORT/postgres" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$JWT_SECRETO" PGRST_SERVER_PORT=3000 \
  "$PGRST" > "$DIR/rest.log" 2>&1 &
PIDS="$PIDS $!"
SUPABASE_DB_URL="postgres://postgres@127.0.0.1:$PORT/postgres" SUPABASE_URL="http://localhost:8787" SUPABASE_ANON_KEY=x \
  "$DENO" run -A --quiet supabase/functions/guardar/index.ts > "$DIR/deno.log" 2>&1 &
PIDS="$PIDS $!"
FUNCION_PUERTO=8000 node tests/app/servidor_local.mjs > "$DIR/app.log" 2>&1 &
PIDS="$PIDS $!"
sleep 4
python3 tests/app/probar_app.py || { echo "--- servidor:"; tail -20 "$DIR/deno.log"; exit 1; }
