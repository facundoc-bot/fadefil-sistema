-- =============================================================================
--  SISTEMA FADEFIL · Migración 5: primer administrador y archivos de LINDE.
--  · Facu (facundoc@aqa.com.ar) entra como ADMIN; los demás usuarios se dan de alta
--    desde la sección Datos de la app.
--  · Los PDF de remitos y facturas de LINDE se guardan en Supabase Storage, en un
--    espacio privado "co2-linde" (carpetas remitos/ y facturas/), con los mismos
--    permisos de la app: leen todos los usuarios habilitados, suben ADMIN y CARGA,
--    y solo un ADMIN borra. Un archivo subido no se reemplaza (queda como respaldo).
-- =============================================================================

insert into usuarios (email, nombre, rol, activo)
values ('facundoc@aqa.com.ar', 'Facu', 'ADMIN', true)
on conflict (email) do update set rol = 'ADMIN', activo = true;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('co2-linde', 'co2-linde', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "co2-linde: leer" on storage.objects for select to authenticated
  using (bucket_id = 'co2-linde' and public.es_usuario());

create policy "co2-linde: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'co2-linde' and public.puede_cargar()
              and (storage.foldername(name))[1] in ('remitos', 'facturas'));

create policy "co2-linde: borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'co2-linde' and public.es_admin());
