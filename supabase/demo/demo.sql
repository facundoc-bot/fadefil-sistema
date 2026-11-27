-- =============================================================================
--  SOLO PARA LA BASE DE LA DEMO (proyecto fadefil-demo). Nunca en la real.
--  Se aplica después de las migraciones (.github/workflows/demo.yml).
--  - Marca la base como demo (config DEMO = SI): el cargador de datos de ejemplo
--    se niega a correr donde no está esta marca.
--  - Quien entra con "Entrar a la demo" (sesión anónima, sin mail) es ADMIN.
--  - Foto de los datos de ejemplo (esquema demo_base) y vuelta a esa foto
--    ("Salir de la demo"): demo_guardar_base() / demo_restaurar().
-- =============================================================================

insert into config (clave, valor, descripcion) values ('DEMO', 'SI', 'Esta base es la de la demo (datos inventados).')
on conflict (clave) do update set valor = 'SI';

insert into usuarios (email, nombre, rol) values ('demo@fadefil.demo', 'Visitante de la demo', 'ADMIN')
on conflict (email) do update set rol = 'ADMIN', activo = true;

-- Sesión anónima de la demo = ADMIN (en la base real, mi_rol() solo mira Usuarios).
create or replace function mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select case when coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then 'ADMIN'
    else coalesce((select rol from usuarios where email = lower(coalesce(auth.jwt() ->> 'email', '')) and activo), '') end
$$;

create schema if not exists demo_base;
revoke all on schema demo_base from public;

-- Tablas de datos (todo public menos las que no cambian con el uso de la demo no hace falta distinguir: se copian todas).
create or replace function demo_tablas() returns setof text language sql stable as $$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' order by 1
$$;

create or replace function demo_guardar_base() returns void
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if (select valor from config where clave = 'DEMO') is distinct from 'SI' then raise exception 'No es la base de la demo.'; end if;
  for t in select demo_tablas() loop
    execute format('drop table if exists demo_base.%I', t);
    execute format('create table demo_base.%I as table public.%I', t, t);
  end loop;
end $$;

-- Vuelve a la foto: vacía todas las tablas y las recarga (en el orden que permitan las referencias).
create or replace function demo_restaurar() returns void
language plpgsql security definer set search_path = public as $$
declare
  t text; pendientes text[]; quedan text[]; vuelta int := 0; r record;
begin
  if (select valor from config where clave = 'DEMO') is distinct from 'SI' then raise exception 'No es la base de la demo.'; end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'demo_base') then raise exception 'La demo todavía no tiene foto.'; end if;
  perform pg_advisory_xact_lock(4207001);  -- el mismo bloqueo que el guardado
  execute (select 'truncate ' || string_agg(format('public.%I', x), ', ') || ' cascade' from demo_tablas() x);
  -- Sin los disparadores propios (p. ej. el que crea el estado de una máquina nueva): se copia tal cual la foto.
  for t in select demo_tablas() loop execute format('alter table public.%I disable trigger user', t); end loop;
  select array_agg(x) into pendientes from demo_tablas() x
    where exists (select 1 from information_schema.tables where table_schema = 'demo_base' and table_name = x);
  while coalesce(array_length(pendientes, 1), 0) > 0 and vuelta < 30 loop
    vuelta := vuelta + 1; quedan := '{}';
    foreach t in array pendientes loop
      begin
        execute format('insert into public.%I overriding system value select * from demo_base.%I', t, t);
      exception when foreign_key_violation then quedan := quedan || t;
      end;
    end loop;
    pendientes := quedan;
  end loop;
  if coalesce(array_length(pendientes, 1), 0) > 0 then raise exception 'No se pudo restaurar: %', pendientes; end if;
  for t in select demo_tablas() loop execute format('alter table public.%I enable trigger user', t); end loop;
  -- Columnas con numeración automática: siguen desde el máximo.
  for r in select c.table_name, c.column_name from information_schema.columns c
           where c.table_schema = 'public' and c.is_identity = 'YES' loop
    execute format('select setval(pg_get_serial_sequence(%L, %L), coalesce((select max(%I) from public.%I), 0) + 1, false)',
      'public.' || r.table_name, r.column_name, r.column_name, r.table_name);
  end loop;
end $$;

revoke execute on function demo_guardar_base(), demo_restaurar(), demo_tablas() from public, anon, authenticated;
