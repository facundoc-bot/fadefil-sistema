-- Pruebas de las migraciones: datos iniciales, identificadores y permisos por rol.
-- Cada bloque termina con NOTICE "OK: …" o corta todo con "FALLA: …".
\set QUIET on
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos iniciales
do $$ begin
  if (select count(*) from reglas_trabajo) <> 10 then raise exception 'FALLA: reglas_trabajo debería tener 10 tipos de OT'; end if;
  if (select count(*) from catalogo where categoria <> 'CO2') <> 28 or not exists (select 1 from catalogo where codigo = 'CO2' and not activo) then raise exception 'FALLA: el catálogo inicial debería tener 28 códigos y CO2 (inactivo)'; end if;
  if (select count(distinct sistema) from sistemas_purificacion) <> 14 then raise exception 'FALLA: deberían ser 14 sistemas y prefiltros'; end if;
  if exists (select 1 from sistemas_purificacion where codigo_componente is null and componente <> sistema and rol <> 'INSTALACION' and rol <> 'CONSUMO')
    then raise exception 'FALLA: hay componentes sin código'; end if;
  if (select deposito_id from plazas where plaza_id = 'GBA') <> 'Depósito CABA' then raise exception 'FALLA: GBA usa el Depósito CABA'; end if;
  if (select controla_stock from depositos where deposito_id = 'Depósito CABA') then raise exception 'FALLA: el central no controla stock'; end if;
  if (select insumo and adicional and not filtro from reglas_trabajo where tipo_ot = 'ALTA_INICIAL') is not true then raise exception 'FALLA: reglas del alta inicial'; end if;
  if (select valor from co2_config where clave = 'CARGAS_KG') <> '5;10' then raise exception 'FALLA: cargas de CO₂'; end if;
  if not exists (select 1 from usuarios where email = 'facundoc@aqa.com.ar' and rol = 'ADMIN' and activo) then raise exception 'FALLA: Facu tiene que ser ADMIN'; end if;
  if (select public or not ('application/pdf' = any (allowed_mime_types)) from storage.buckets where id = 'co2-linde') is not false then raise exception 'FALLA: el espacio co2-linde tiene que ser privado y solo PDF'; end if;
  raise notice 'OK: datos iniciales (10 tipos de OT, 28 códigos, 14 sistemas, plazas CABA y GBA, configuración, Facu ADMIN, espacio de archivos co2-linde)';
end $$;

-- ---------------------------------------------------------------- identificadores
do $$ begin
  if siguiente_id('OT') <> 'OT-000001' or siguiente_id('OT') <> 'OT-000002' or siguiente_id('REM') <> 'REM-000001' then
    raise exception 'FALLA: siguiente_id'; end if;
  raise notice 'OK: identificadores correlativos por prefijo (OT-000001, OT-000002, REM-000001)';
end $$;

-- ---------------------------------------------------------------- usuarios de prueba
insert into usuarios (email, nombre, rol) values ('  Facu@Empresa.com ', 'Facu', 'ADMIN'), ('carga@empresa.com', 'Carga', 'CARGA'),
  ('consulta@empresa.com', 'Consulta', 'CONSULTA'), ('baja@empresa.com', 'Baja', 'CARGA');
update usuarios set activo = false where email = 'baja@empresa.com';
do $$ begin
  if not exists (select 1 from usuarios where email = 'facu@empresa.com') then raise exception 'FALLA: el email se guarda en minúscula y sin espacios'; end if;
  raise notice 'OK: emails en minúscula';
end $$;

-- ---------------------------------------------------------------- sin sesión
begin;
set local role anon;
do $$ begin
  begin perform count(*) from clientes; raise exception 'FALLA: sin sesión se pudo leer clientes';
  exception when insufficient_privilege then raise notice 'OK: sin sesión no se lee nada'; end;
end $$;
rollback;

-- ---------------------------------------------------------------- con sesión pero sin usuario habilitado
begin;
set local role authenticated;
set local request.jwt.claims = '{"email":"intruso@gmail.com"}';
do $$ begin
  if (select count(*) from catalogo) <> 0 or (select count(*) from usuarios) <> 0 then raise exception 'FALLA: un usuario no habilitado ve datos'; end if;
  raise notice 'OK: con una cuenta que no está en usuarios no se ve nada';
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"email":"baja@empresa.com"}';
do $$ begin
  if (select count(*) from catalogo) <> 0 then raise exception 'FALLA: un usuario inactivo ve datos'; end if;
  raise notice 'OK: un usuario inactivo no ve nada';
end $$;
rollback;

-- ---------------------------------------------------------------- ADMIN: maestros desde la app
begin;
set local role authenticated;
set local request.jwt.claims = '{"email":"FACU@empresa.com"}';
do $$ begin
  if mi_rol() <> 'ADMIN' then raise exception 'FALLA: mi_rol del admin (email en mayúsculas)'; end if;
  insert into depositos (deposito_id, direccion) values ('Depósito Córdoba', 'Nicanor Carranza 3450');
  insert into regiones values ('INTERIOR SUR') ;
  insert into plazas (plaza_id, region_id, deposito_id, provincia) values ('Córdoba', 'INTERIOR', 'Depósito Córdoba', 'Córdoba');
  insert into zonas (zona_id, plaza_id) values ('Nueva Córdoba', 'Córdoba');
  insert into tecnicos (tecnico_id, plaza_id) values ('Juan Pérez', 'Córdoba');
  insert into modelos (modelo) values ('Ion 3000');
  insert into maquinas (serie, modelo, fecha_alta, deposito_inicial_id) values ('AQ1001', 'Ion 3000', '2026-01-10', 'Depósito Córdoba');
  insert into co2_depositos (deposito_id, plaza_linde) values ('Depósito Córdoba', '23081740');
  update config set valor = '-;E;-;E;-;P' where clave = 'ESQUEMA_MANTENIMIENTO';
  begin update config set valor = '-;-;-;-;-;-' where clave = 'ESQUEMA_MANTENIMIENTO'; raise exception 'FALLA: se guardó un esquema sin mantenimientos';
  exception when check_violation then null; end;
  raise notice 'OK: el ADMIN carga depósitos, regiones, plazas, zonas, técnicos, modelos, máquinas y configuración';
end $$;
commit;

do $$ begin
  if not exists (select 1 from maquinas_estado where serie = 'AQ1001' and estado = 'NUEVA' and ubicacion_tipo = 'DEPOSITO'
                 and ubicacion_id = 'Depósito Córdoba' and fecha_ultimo_mov = '2026-01-10') then
    raise exception 'FALLA: una máquina nueva arranca Nueva en su depósito inicial'; end if;
  raise notice 'OK: máquina nueva → estado Nueva en su depósito inicial';
end $$;

-- Datos operativos de prueba (los escribe el servidor, que usa la clave de servicio).
begin;
set local role service_role;
insert into clientes (cliente_id, nombre_fantasia, zona_id) values ('50001', 'Bar Córdoba', 'Nueva Córdoba');
insert into ot (ot_id, fecha, cliente_id, zona_id, tipo, created_by) values ('OT-000001', '2026-02-01', '50001', 'Nueva Córdoba', 'INSTALACION', 'facu@empresa.com');
insert into ot_lineas (linea_id, ot_id, cliente_id, fecha, codigo, cantidad, movimiento, cobranza) values ('OT-000001-1', 'OT-000001', '50001', '2026-02-01', 'SED1', 1, 'ENTREGADO', true);
insert into stock (deposito_id, codigo, disponible) values ('Depósito Córdoba', 'SED1', 10);
insert into operaciones (op_id, clase, fecha, region_id, datos, created_by) values
  ('ENV-000001', 'ENVIO', '2026-01-15', 'INTERIOR', '{"origen":"Depósito CABA","destino":"Depósito Córdoba","items":[{"codigo":"SED1","cantidad":10}]}', 'facu@empresa.com'),
  ('OT-000001', 'OT', '2026-02-01', 'INTERIOR', '{"tipo":"INSTALACION","tecnico":"Juan Pérez","clienteNuevo":{"zonaId":"Nueva Córdoba"}}', 'facu@empresa.com');
insert into co2_cilindros (serie, peso_kg, estado, ubicacion_tipo, ubicacion_id, deposito_origen_id) values ('A1754410', 10, 'LLENO_DISPONIBLE', 'DEPOSITO', 'Depósito Córdoba', 'Depósito Córdoba');
update ot set tecnico = 'Juan Pérez' where ot_id = 'OT-000001';
commit;

-- Renombrar desde la app actualiza todo lo que lo usa (también el registro de operaciones).
begin;
set local role authenticated;
set local request.jwt.claims = '{"email":"facu@empresa.com"}';
update depositos set deposito_id = 'Depósito Córdoba Capital' where deposito_id = 'Depósito Córdoba';
update zonas set zona_id = 'Nva. Córdoba' where zona_id = 'Nueva Córdoba';
update tecnicos set tecnico_id = 'Juan P. Pérez' where tecnico_id = 'Juan Pérez';
update regiones set region_id = 'AMBA (Bs. As.)' where region_id = 'AMBA';
update catalogo set codigo = 'SED1M' where codigo = 'SED1';
commit;
do $$ begin
  if (select ubicacion_id from maquinas_estado where serie = 'AQ1001') <> 'Depósito Córdoba Capital'
     or (select ubicacion_id || '|' || deposito_origen_id from co2_cilindros where serie = 'A1754410') <> 'Depósito Córdoba Capital|Depósito Córdoba Capital'
     or (select datos ->> 'destino' from operaciones where op_id = 'ENV-000001') <> 'Depósito Córdoba Capital'
     or (select datos -> 'items' -> 0 ->> 'codigo' from operaciones where op_id = 'ENV-000001') <> 'SED1M'
     or (select datos -> 'clienteNuevo' ->> 'zonaId' from operaciones where op_id = 'OT-000001') <> 'Nva. Córdoba'
     or (select tecnico || '|' || zona_id from ot where ot_id = 'OT-000001') <> 'Juan P. Pérez|Nva. Córdoba'
     or (select zona_id from clientes where cliente_id = '50001') <> 'Nva. Córdoba'
     or (select codigo from ot_lineas where linea_id = 'OT-000001-1') <> 'SED1M'
     or (select valor from config where clave = 'REGIONES_TECNICO_OBLIGATORIO') <> 'AMBA (Bs. As.)'
     or (select region_id from plazas where plaza_id = 'CABA') <> 'AMBA (Bs. As.)'
     or (select count(*) from log where accion = 'RENOMBRAR') <> 5 then
    raise exception 'FALLA: renombrar no actualizó todas las referencias'; end if;
  raise notice 'OK: renombrar depósito, zona, técnico, región y código actualiza tablas, ubicaciones, CO₂, configuración y el registro de operaciones';
end $$;
update regiones set region_id = 'AMBA' where region_id = 'AMBA (Bs. As.)';
update catalogo set codigo = 'SED1' where codigo = 'SED1M';
update zonas set zona_id = 'Nueva Córdoba' where zona_id = 'Nva. Córdoba';
do $$ begin
  begin update maquinas set serie = 'AQ9999' where serie = 'AQ1001'; raise exception 'FALLA: se cambió la serie de una máquina';
  exception when raise_exception then if sqlerrm not like 'La serie de una máquina no se cambia%' then raise; end if; end;
  raise notice 'OK: la serie de una máquina no se cambia';
end $$;
do $$ begin
  if (select deposito_id from plazas where plaza_id = 'Córdoba') <> 'Depósito Córdoba Capital'
     or (select deposito_inicial_id from maquinas where serie = 'AQ1001') <> 'Depósito Córdoba Capital'
     or not exists (select 1 from stock where deposito_id = 'Depósito Córdoba Capital')
     or not exists (select 1 from co2_depositos where deposito_id = 'Depósito Córdoba Capital') then
    raise exception 'FALLA: renombrar un depósito no actualizó las referencias'; end if;
  raise notice 'OK: renombrar un depósito actualiza plazas, máquinas, stock y CO₂';
end $$;

-- ---------------------------------------------------------------- CONSULTA: solo lee
begin;
set local role authenticated;
set local request.jwt.claims = '{"email":"consulta@empresa.com"}';
do $$ declare n int; begin
  if (select count(*) from catalogo) <> 29 then raise exception 'FALLA: CONSULTA lee el catálogo'; end if;
  begin insert into catalogo (codigo, descripcion, categoria) values ('X1', 'x', 'INSUMO'); raise exception 'FALLA: CONSULTA agregó al catálogo';
  exception when insufficient_privilege then null; end;
  update zonas set activa = false where zona_id = 'Nueva Córdoba'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLA: CONSULTA editó una zona'; end if;
  update clientes set sector = 'x' where cliente_id = '50001'; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLA: CONSULTA editó un cliente'; end if;
  raise notice 'OK: CONSULTA lee pero no edita';
end $$;
rollback;

-- ---------------------------------------------------------------- CARGA
begin;
set local role authenticated;
set local request.jwt.claims = '{"email":"carga@empresa.com"}';
do $$ declare n int; begin
  update clientes set sector = 'Gastronomía', esquema_mant = 'P;-;-;-;-;-' where cliente_id = '50001'; get diagnostics n = row_count;
  begin update clientes set esquema_mant = 'P;E' where cliente_id = '50001'; raise exception 'FALLA: se guardó un esquema de cliente inválido';
  exception when check_violation then null; end;
  if n <> 1 then raise exception 'FALLA: CARGA edita los datos de un cliente'; end if;
  begin update clientes set cliente_id = '99' where cliente_id = '50001'; raise exception 'FALLA: CARGA cambió el ID de un cliente';
  exception when insufficient_privilege then null; end;
  update ot_lineas set dto = '10%', facturado = 'F-0001' where linea_id = 'OT-000001-1'; get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLA: CARGA edita cobranzas'; end if;
  begin update ot_lineas set cantidad = 5 where linea_id = 'OT-000001-1'; raise exception 'FALLA: CARGA cambió la cantidad de una línea de OT';
  exception when insufficient_privilege then null; end;
  begin insert into ot (ot_id, fecha, cliente_id, zona_id, tipo, created_by) values ('OT-X', '2026-02-02', '50001', 'Nueva Córdoba', 'MANTENIMIENTO', 'x');
    raise exception 'FALLA: CARGA guardó una OT sin pasar por el servidor';
  exception when insufficient_privilege then null; end;
  begin update stock set disponible = 999; raise exception 'FALLA: CARGA tocó el stock';
  exception when insufficient_privilege then null; end;
  begin insert into depositos (deposito_id) values ('Depósito X'); raise exception 'FALLA: CARGA agregó un depósito';
  exception when insufficient_privilege then null; end;
  begin perform siguiente_id('OT'); raise exception 'FALLA: la app pidió un identificador directo';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from contadores) then raise exception 'FALLA: la app ve los contadores'; end if;
  raise notice 'OK: CARGA edita clientes y cobranzas; no guarda operaciones ni toca stock, maestros ni contadores';
end $$;
commit;

-- ---------------------------------------------------------------- siempre queda un administrador
begin;
set local role authenticated;
set local request.jwt.claims = '{"email":"facu@empresa.com"}';
do $$ begin
  update usuarios set activo = false where email = 'facundoc@aqa.com.ar';
  begin update usuarios set rol = 'CARGA' where email = 'facu@empresa.com'; raise exception 'FALLA: se quedó sin administradores';
  exception when raise_exception then
    if sqlerrm not like 'Tiene que quedar%' then raise; end if;
  end;
  insert into usuarios (email, nombre, rol) values ('otro.admin@empresa.com', 'Otro', 'ADMIN');
  update usuarios set rol = 'CARGA' where email = 'facu@empresa.com';
  raise notice 'OK: tiene que quedar al menos un administrador activo (con otro, sí se puede cambiar)';
end $$;
rollback;

-- ---------------------------------------------------------------- archivos de LINDE (Storage)
begin;
set local role authenticated;
set local request.jwt.claims = '{"email":"carga@empresa.com"}';
insert into storage.objects (bucket_id, name) values ('co2-linde', 'remitos/2026/REM-000001.pdf');
do $$ begin
  begin insert into storage.objects (bucket_id, name) values ('co2-linde', 'otra/cosa.pdf'); raise exception 'FALLA: se subió fuera de remitos/ y facturas/';
  exception when insufficient_privilege then null; end;
  delete from storage.objects where bucket_id = 'co2-linde';  -- CARGA no borra: la seguridad lo filtra
end $$;
commit;
begin;
set local role authenticated;
set local request.jwt.claims = '{"email":"consulta@empresa.com"}';
do $$ begin
  if (select count(*) from storage.objects where bucket_id = 'co2-linde') <> 1 then raise exception 'FALLA: CONSULTA no ve el archivo, o CARGA lo pudo borrar'; end if;
  begin insert into storage.objects (bucket_id, name) values ('co2-linde', 'facturas/F1.pdf'); raise exception 'FALLA: CONSULTA subió un archivo';
  exception when insufficient_privilege then null; end;
end $$;
commit;
begin;
set local role authenticated;
set local request.jwt.claims = '{"email":"nadie@otro.com"}';
do $$ begin
  if exists (select 1 from storage.objects) then raise exception 'FALLA: un desconocido ve archivos'; end if;
end $$;
set local request.jwt.claims = '{"email":"facu@empresa.com"}';
delete from storage.objects where name = 'remitos/2026/REM-000001.pdf';
do $$ begin
  if exists (select 1 from storage.objects) then raise exception 'FALLA: el ADMIN no pudo borrar'; end if;
  raise notice 'OK: archivos de LINDE: leen los usuarios habilitados, suben ADMIN y CARGA (solo en remitos/ y facturas/), borra solo ADMIN';
end $$;
commit;


-- ---------------------------------------------------------------- seguridad general
-- Toda tabla de la base tiene seguridad por filas (una tabla nueva sin permisos quedaría abierta),
-- las vistas respetan los permisos de quien consulta, y sin sesión no se puede leer nada.
do $$ declare sin text; begin
  select string_agg(c.relname, ', ') into sin from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if sin is not null then raise exception 'FALLA: tablas sin seguridad por filas: %', sin; end if;
  select string_agg(c.relname, ', ') into sin from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and not coalesce('security_invoker=true' = any (c.reloptions) or 'security_invoker=on' = any (c.reloptions), false);
  if sin is not null then raise exception 'FALLA: vistas que no respetan los permisos de quien consulta: %', sin; end if;
  select string_agg(c.relname, ', ') into sin from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege('anon', c.oid, 'select');
  if sin is not null then raise exception 'FALLA: sin sesión se puede leer: %', sin; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')) < 20 then
    raise exception 'FALLA: la prueba no encontró las tablas'; end if;
  raise notice 'OK: todas las tablas con seguridad por filas, vistas con permisos de quien consulta, nada visible sin sesión';
end $$;

-- ---------------------------------------------------------------- ingreso solo para mails habilitados
do $$ begin
  if hook_antes_de_crear_usuario('{"user": {"email": "Carga@Empresa.com"}}') <> '{}'::jsonb then raise exception 'FALLA: un mail habilitado no pudo crear su cuenta'; end if;
  if hook_antes_de_crear_usuario('{"user": {"email": "intruso@gmail.com"}}') -> 'error' ->> 'http_code' <> '403' then raise exception 'FALLA: se creó la cuenta de un mail que no está en Usuarios'; end if;
  if hook_antes_de_crear_usuario('{"user": {"email": "baja@empresa.com"}}') -> 'error' is null then raise exception 'FALLA: un usuario dado de baja pudo crear su cuenta'; end if;
  if hook_antes_de_crear_usuario('{"user": {}}') -> 'error' is null then raise exception 'FALLA: se creó una cuenta sin mail'; end if;
  if has_function_privilege('anon', 'hook_antes_de_crear_usuario(jsonb)', 'execute') or has_function_privilege('authenticated', 'hook_antes_de_crear_usuario(jsonb)', 'execute')
    or not has_function_privilege('supabase_auth_admin', 'hook_antes_de_crear_usuario(jsonb)', 'execute') then raise exception 'FALLA: permisos de la función de ingreso'; end if;
  raise notice 'OK: solo se crean cuentas de mails activos en Usuarios (los demás, rechazados con 403)';
end $$;

-- ---------------------------------------------------------------- v2.1: esquema de mantenimientos y proveedores de CO₂
do $$ begin
  if (select valor from config where clave = 'ESQUEMA_MANTENIMIENTO') is null or exists (select 1 from config where clave = 'DIAS_MANTENIMIENTO') then
    raise exception 'FALLA: el esquema de mantenimientos reemplaza a los días entre mantenimientos'; end if;
  if (select proveedor_co2 from plazas where plaza_id = 'GBA') <> 'GN' or (select proveedor_co2 from plazas where plaza_id = 'CABA') <> 'LINDE' then
    raise exception 'FALLA: GBA trabaja con Gases Nordelta y CABA con LINDE'; end if;
  if (select string_agg(proveedor_id || ':' || lector_pdf, ',' order by proveedor_id) from co2_proveedores) <> 'GN:false,LINDE:true' then
    raise exception 'FALLA: proveedores iniciales'; end if;
  raise notice 'OK: esquema de mantenimientos en Configuración; CO₂ con LINDE (CABA y resto) y Gases Nordelta (GBA)';
end $$;

-- ---------------------------------------------------------------- v2.3: seguimiento de las OT
do $$ begin
  begin update ot set fecha_solicitud = '2026-02-05' where ot_id = 'OT-000001'; raise exception 'FALLA: se guardó una solicitud posterior a la OT';
  exception when check_violation then null; end;
  begin update ot set emergencia = true where ot_id = 'OT-000001'; raise exception 'FALLA: una instalación quedó como emergencia';
  exception when check_violation then null; end;
  begin update ot set excluir_respuesta = true where ot_id = 'OT-000001'; raise exception 'FALLA: se excluyó de la métrica sin motivo';
  exception when check_violation then null; end;
  begin update ot set rebotes = -1 where ot_id = 'OT-000001'; raise exception 'FALLA: rebotes negativos';
  exception when check_violation then null; end;
  begin update ot set demora_min = 2000 where ot_id = 'OT-000001'; raise exception 'FALLA: demora de más de 24 h';
  exception when check_violation then null; end;
  update ot set fecha_solicitud = '2026-01-20', rebotes = 1, demora_min = 30, excluir_respuesta = true, excluir_motivo = 'Falta documentación para ingresar' where ot_id = 'OT-000001';
  if (select count(*) from listas where tipo in ('MOTIVO_REBOTE', 'MOTIVO_DEMORA', 'MOTIVO_EXCLUSION')) < 10 then raise exception 'FALLA: faltan los motivos sugeridos'; end if;
  if (select valor from config where clave = 'VERSION') <> '2.3' then raise exception 'FALLA: versión'; end if;
  raise notice 'OK: seguimiento de OT (solicitud no posterior, emergencia solo en mantenimientos/reparaciones/entregas, exclusión con motivo, rebotes y demora acotados)';
end $$;
begin;
set local role authenticated;
set local request.jwt.claims = '{"email":"carga@empresa.com"}';
do $$ begin
  begin update ot set rebotes = 3 where ot_id = 'OT-000001'; raise exception 'FALLA: la app escribió el seguimiento directo en la base';
  exception when insufficient_privilege then null; end;
  raise notice 'OK: el seguimiento se guarda solo por la función del servidor';
end $$;
commit;

\echo 'Todas las pruebas de la base pasaron.'
