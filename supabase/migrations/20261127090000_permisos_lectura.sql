-- =============================================================================
--  Permisos de lectura explícitos. Los proyectos nuevos de Supabase ya no les dan
--  acceso automático a las tablas a los usuarios con sesión (antes venía por defecto);
--  el proyecto real lo tenía por haberse creado antes, la demo no. Lo que cada uno
--  ve lo siguen decidiendo las reglas por fila (todas las tablas las tienen).
-- =============================================================================
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
alter default privileges in schema public grant select on tables to authenticated;
grant execute on function mi_rol(), es_usuario(), es_admin(), puede_cargar() to authenticated;
