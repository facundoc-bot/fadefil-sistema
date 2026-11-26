-- =============================================================================
--  SISTEMA FADEFIL · Migración 2: permisos.
--
--  Quién entra: solo quien figura en la tabla usuarios (activo), según el email con
--  el que inició sesión. Roles:
--    ADMIN    lee todo y edita los maestros (sección Datos de la app).
--    CARGA    lee todo, edita datos de clientes y cobranzas (dto, facturado).
--    CONSULTA solo lee.
--  Las operaciones (OT, envíos, remitos, ajustes…) NO se escriben directo desde la app:
--  pasan por la función del servidor que valida con el motor de reglas y guarda todo
--  junto (usa la clave de servicio, que no tiene estas restricciones).
-- =============================================================================

-- Rol del usuario de la sesión ('' si no está habilitado).
create function mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select rol from usuarios where email = lower(coalesce(auth.jwt() ->> 'email', '')) and activo), '')
$$;

create function es_usuario() returns boolean language sql stable as $$ select mi_rol() <> '' $$;
create function es_admin() returns boolean language sql stable as $$ select mi_rol() = 'ADMIN' $$;
create function puede_cargar() returns boolean language sql stable as $$ select mi_rol() in ('ADMIN', 'CARGA') $$;

-- Sin sesión (anon) no se ve nada.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
revoke execute on function siguiente_id(text, int) from public, anon, authenticated;

-- Con sesión: la app solo LEE, salvo lo que se habilita más abajo (maestros para ADMIN, algunas columnas para CARGA).
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from authenticated;

-- Seguridad por fila en todas las tablas, y lectura para cualquier usuario habilitado.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy leer on %I for select to authenticated using (es_usuario())', t);
  end loop;
end $$;

-- Los contadores no los lee la app.
drop policy leer on contadores;

-- Maestros: los edita un ADMIN.
do $$
declare t text;
begin
  foreach t in array array['config', 'usuarios', 'regiones', 'depositos', 'plazas', 'zonas', 'tecnicos', 'modelos', 'catalogo',
    'sistemas_purificacion', 'listas', 'reglas_trabajo', 'maquinas', 'co2_config', 'co2_depositos'] loop
    execute format('grant insert, update, delete on %I to authenticated', t);
    execute format('create policy admin_agrega on %I for insert to authenticated with check (es_admin())', t);
    execute format('create policy admin_edita on %I for update to authenticated using (es_admin()) with check (es_admin())', t);
    execute format('create policy admin_borra on %I for delete to authenticated using (es_admin())', t);
  end loop;
end $$;

-- Datos de un cliente (nombre, sector, zona, frecuencia…): ADMIN y CARGA. El alta la hace la OT de alta o instalación.
grant update (nombre_fantasia, razon_social_cuit, sector, tipo_cliente, modalidad, zona_id, frecuencia_mant_dias, comentarios) on clientes to authenticated;
create policy carga_edita on clientes for update to authenticated using (puede_cargar()) with check (puede_cargar());

-- Cobranzas: descuento y facturado de las líneas de OT.
grant update (dto, facturado) on ot_lineas to authenticated;
create policy carga_edita on ot_lineas for update to authenticated using (puede_cargar()) with check (puede_cargar());

-- Inconsistencias: un ADMIN las marca resueltas.
grant update (estado, resolucion, usuario) on inconsistencias, co2_inconsistencias to authenticated;
create policy admin_resuelve on inconsistencias for update to authenticated using (es_admin()) with check (es_admin());
create policy admin_resuelve on co2_inconsistencias for update to authenticated using (es_admin()) with check (es_admin());

-- Un ADMIN no puede sacarse a sí mismo el rol ni desactivarse (para no quedar sin administradores).
create function proteger_ultimo_admin() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE' or new.rol <> 'ADMIN' or not new.activo) and old.rol = 'ADMIN' and old.activo
     and not exists (select 1 from usuarios where rol = 'ADMIN' and activo and email <> old.email) then
    raise exception 'Tiene que quedar al menos un administrador activo.';
  end if;
  return coalesce(new, old);
end $$;
create trigger usuarios_ultimo_admin before update or delete on usuarios for each row execute function proteger_ultimo_admin();

-- Los emails se guardan en minúscula.
create function usuarios_email_minuscula() returns trigger language plpgsql as $$
begin new.email := lower(trim(new.email)); return new; end $$;
create trigger usuarios_email before insert or update on usuarios for each row execute function usuarios_email_minuscula();
