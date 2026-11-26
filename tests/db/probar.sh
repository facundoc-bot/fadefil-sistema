#!/usr/bin/env bash
# Prueba las migraciones y los permisos en un PostgreSQL local descartable.
# Uso: tests/db/probar.sh   (necesita PostgreSQL 15 o superior instalado: initdb, pg_ctl, psql)
set -euo pipefail
cd "$(dirname "$0")/../.."
BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1); export PATH="$BIN:$PATH"
DIR=$(mktemp -d); PORT=55432
COMO=""; [ "$(id -u)" = 0 ] && COMO="runuser -u postgres --"
trap '$COMO pg_ctl -D "$DIR/datos" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
chown -R postgres "$DIR" 2>/dev/null || true
$COMO initdb -D "$DIR/datos" -U postgres -A trust >/dev/null
$COMO pg_ctl -D "$DIR/datos" -o "-p $PORT -k $DIR" -l "$DIR/log" start -w >/dev/null
PSQL="psql -h $DIR -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$PSQL -f tests/db/supabase_simulado.sql
for f in supabase/migrations/*.sql; do echo "· $f"; $PSQL -f "$f"; done
$PSQL -f tests/db/pruebas.sql

# Motor de reglas y guardado (necesita Node y `npm install`): en una base aparte, recién migrada.
if command -v node >/dev/null && [ -d node_modules/postgres ]; then
  node tests/motor/pruebas_motor.mjs
  $PSQL -c "create database motor"
  PSQLM="psql -h $DIR -p $PORT -U postgres -d motor -v ON_ERROR_STOP=1 -q"
  $PSQLM -f tests/db/supabase_simulado.sql
  for f in supabase/migrations/*.sql; do $PSQLM -f "$f"; done
  PGHOST=$DIR PGPORT=$PORT PGUSER=postgres PGDATABASE=motor node tests/motor/pruebas_base.mjs
  DENO=$(command -v deno || ls node_modules/.bin/deno 2>/dev/null || true)
  if [ -n "$DENO" ]; then PGHOST=$DIR PGPORT=$PORT PGUSER=postgres PGDATABASE=motor "$DENO" run -A --quiet tests/motor/humo_deno.ts; fi
  echo "Todas las pruebas del motor pasaron."
else
  echo "(Sin Node o sin npm install: no se probaron el motor ni el guardado.)"
fi
