-- Seguridad del ingreso: solo se crea una cuenta si el mail está habilitado en Usuarios.
-- Supabase Auth llama a esta función antes de crear cada usuario nuevo (hook "before user created",
-- se activa en la configuración del login: ver .github/workflows/app.yml). Si el mail no está en
-- Usuarios (activo), la cuenta no se crea y la pantalla de ingreso muestra el motivo.
-- Quien ya tiene cuenta y después se da de baja en Usuarios sigue sin ver nada: los permisos de
-- cada tabla miran Usuarios en cada consulta (mi_rol()).
create function public.hook_antes_de_crear_usuario(evento jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  correo text := lower(trim(coalesce(evento -> 'user' ->> 'email', '')));
begin
  if correo <> '' and exists (select 1 from public.usuarios where email = correo and activo) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403,
    'message', 'Esta cuenta no está habilitada en el sistema FADEFIL. Pedile a un administrador que agregue tu mail en Datos → Usuarios.'));
end $$;

revoke execute on function public.hook_antes_de_crear_usuario(jsonb) from public, anon, authenticated;
grant execute on function public.hook_antes_de_crear_usuario(jsonb) to supabase_auth_admin;
