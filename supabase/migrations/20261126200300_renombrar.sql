-- =============================================================================
--  SISTEMA FADEFIL · Migración 4: renombrar maestros.
--  Región, plaza, zona, depósito, técnico, modelo y código del catálogo se identifican
--  por su nombre. Las claves foráneas (ON UPDATE CASCADE) actualizan las tablas que los
--  referencian; estos disparadores completan los campos de texto libre (ubicaciones,
--  movimientos de CO₂, configuración) y el registro de operaciones (JSON), para que la
--  auditoría siga reconstruyendo el mismo estado.
--  La serie de una máquina y el ID de un cliente no se cambian.
-- =============================================================================

-- Reemplaza un valor exacto (string JSON completo) en los datos de las operaciones.
create function renombrar_en_operaciones(p_viejo text, p_nuevo text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := to_jsonb(p_viejo)::text; n text := to_jsonb(p_nuevo)::text;
begin
  update operaciones set datos = replace(datos::text, v, n)::jsonb where datos::text like '%' || v || '%';
end $$;

create function anotar_renombre(p_que text, p_viejo text, p_nuevo text) returns void
language sql security definer set search_path = public as $$
  insert into log (usuario, accion, detalle, resultado)
  values (coalesce(auth.jwt() ->> 'email', ''), 'RENOMBRAR', p_que || ': ' || p_viejo || ' → ' || p_nuevo, 'OK');
$$;

create function renombrar_deposito() returns trigger language plpgsql security definer set search_path = public as $$
declare o text := old.deposito_id; n text := new.deposito_id;
begin
  update maquinas_estado set ubicacion_id = n where ubicacion_tipo = 'DEPOSITO' and ubicacion_id = o;
  update co2_cilindros set ubicacion_id = n where ubicacion_tipo = 'DEPOSITO' and ubicacion_id = o;
  update co2_cilindros set deposito_origen_id = n where deposito_origen_id = o;
  update co2_circuitos set deposito_origen_id = n where deposito_origen_id = o;
  update co2_movimientos set origen_id = n where origen_tipo = 'DEPOSITO' and origen_id = o;
  update co2_movimientos set destino_id = n where destino_tipo = 'DEPOSITO' and destino_id = o;
  update co2_movimientos set deposito_origen_id = n where deposito_origen_id = o;
  update config set valor = n where clave = 'DEPOSITO_CENTRAL' and valor = o;
  perform renombrar_en_operaciones(o, n);
  perform anotar_renombre('Depósito', o, n);
  return new;
end $$;
create trigger depositos_renombrar after update of deposito_id on depositos
  for each row when (old.deposito_id is distinct from new.deposito_id) execute function renombrar_deposito();

create function renombrar_zona() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update co2_trabajos set zona_id = new.zona_id where zona_id = old.zona_id;
  update co2_movimientos set zona_id = new.zona_id where zona_id = old.zona_id;
  perform renombrar_en_operaciones(old.zona_id, new.zona_id);
  perform anotar_renombre('Zona', old.zona_id, new.zona_id);
  return new;
end $$;
create trigger zonas_renombrar after update of zona_id on zonas
  for each row when (old.zona_id is distinct from new.zona_id) execute function renombrar_zona();

create function renombrar_plaza() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform renombrar_en_operaciones(old.plaza_id, new.plaza_id);
  perform anotar_renombre('Plaza', old.plaza_id, new.plaza_id);
  return new;
end $$;
create trigger plazas_renombrar after update of plaza_id on plazas
  for each row when (old.plaza_id is distinct from new.plaza_id) execute function renombrar_plaza();

create function renombrar_region() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update config set valor = array_to_string(array(
      select case when trim(x) = old.region_id then new.region_id else trim(x) end
      from unnest(string_to_array(valor, ',')) as x), ',')
    where clave = 'REGIONES_TECNICO_OBLIGATORIO';
  perform renombrar_en_operaciones(old.region_id, new.region_id);
  perform anotar_renombre('Región', old.region_id, new.region_id);
  return new;
end $$;
create trigger regiones_renombrar after update of region_id on regiones
  for each row when (old.region_id is distinct from new.region_id) execute function renombrar_region();

create function renombrar_tecnico() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update ot set tecnico = new.tecnico_id where tecnico = old.tecnico_id;
  update ot set tecnico_2 = new.tecnico_id where tecnico_2 = old.tecnico_id;
  update taller set tecnico = new.tecnico_id where tecnico = old.tecnico_id;
  perform renombrar_en_operaciones(old.tecnico_id, new.tecnico_id);
  perform anotar_renombre('Técnico', old.tecnico_id, new.tecnico_id);
  return new;
end $$;
create trigger tecnicos_renombrar after update of tecnico_id on tecnicos
  for each row when (old.tecnico_id is distinct from new.tecnico_id) execute function renombrar_tecnico();

create function renombrar_codigo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update ot_lineas set codigo_retirado = new.codigo where codigo_retirado = old.codigo;
  perform renombrar_en_operaciones(old.codigo, new.codigo);
  perform anotar_renombre('Código', old.codigo, new.codigo);
  return new;
end $$;
create trigger catalogo_renombrar after update of codigo on catalogo
  for each row when (old.codigo is distinct from new.codigo) execute function renombrar_codigo();

create function renombrar_modelo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform anotar_renombre('Modelo', old.modelo, new.modelo);
  return new;
end $$;
create trigger modelos_renombrar after update of modelo on modelos
  for each row when (old.modelo is distinct from new.modelo) execute function renombrar_modelo();

-- La serie de una máquina no se cambia (la usan el historial, los clientes y las OT).
create function serie_fija() returns trigger language plpgsql as $$
begin
  if new.serie is distinct from old.serie then
    raise exception 'La serie de una máquina no se cambia (la usan su historial y las OT). Si se cargó mal y todavía no tiene movimientos, borrala y cargala de nuevo.';
  end if;
  return new;
end $$;
create trigger maquinas_serie_fija before update of serie on maquinas for each row execute function serie_fija();

revoke execute on function renombrar_en_operaciones(text, text), anotar_renombre(text, text, text) from public, anon, authenticated;
