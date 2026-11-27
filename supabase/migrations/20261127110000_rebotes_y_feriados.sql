-- =============================================================================
--  SISTEMA FADEFIL · v2.4: rebotes como registro propio y feriados (pedido de Facu, 27/11).
--
--  Rebote = ir al cliente y NO hacer el trabajo (no atendieron, no estaban las condiciones…).
--  Es tiempo perdido, se haga o no el trabajo después: se registra solo, con su fecha, cliente,
--  técnico, el trabajo que se iba a hacer y el motivo. No depende de ninguna OT (por eso deja de
--  ser un número dentro de la OT, como en la v2.3). No cambia el estado: se guarda por la función
--  del servidor y se anula con motivo (nada se borra).
--
--  Feriados: el tiempo de respuesta del seguimiento se cuenta en días hábiles (lunes a viernes,
--  sin los días de esta tabla). Se editan en Datos → Feriados (ADMIN).
-- =============================================================================

create table rebotes (
  rebote_id      text primary key,
  fecha          date not null,
  cliente_id     text references clientes on update cascade,
  cliente_nombre text not null default '',          -- si todavía no es cliente (p. ej. una instalación que no se pudo hacer)
  plaza_id       text not null references plazas on update cascade,
  tipo_trabajo   text not null references reglas_trabajo (tipo_ot),
  tecnico        text not null default '',
  tecnico_2      text not null default '',
  motivo         text not null check (motivo <> ''),
  ot_persat      text not null default '',
  comentarios    text not null default '',
  estado         text not null default 'VIGENTE' check (estado in ('VIGENTE', 'ANULADO')),
  anulacion      text not null default '',
  created_by     text not null,
  created_at     timestamptz not null default now(),
  check (cliente_id is not null or cliente_nombre <> ''),
  check (tipo_trabajo <> 'ALTA_INICIAL')
);
create index on rebotes (fecha);
create index on rebotes (cliente_id);
alter table rebotes enable row level security;
create policy leer on rebotes for select to authenticated using (es_usuario());
grant select on rebotes to authenticated;

-- Lo que se haya cargado como "rebotes" dentro de una OT (v2.3) pasa a la tabla nueva: un registro por OT,
-- con la fecha de la solicitud (o la de la OT) como aproximada. Después se quitan esas columnas.
insert into rebotes (rebote_id, fecha, cliente_id, plaza_id, tipo_trabajo, tecnico, tecnico_2, motivo, ot_persat, comentarios, created_by)
select siguiente_id('REB'), coalesce(o.fecha_solicitud, o.fecha), o.cliente_id, z.plaza_id, o.tipo, o.tecnico, o.tecnico_2,
       coalesce(nullif(o.rebote_motivo, ''), 'Sin motivo'), o.ot_persat,
       'Pasado desde ' || o.ot_id || ' (' || o.rebotes || ' rebote' || case when o.rebotes > 1 then 's' else '' end || '; fecha aproximada)', o.revisada_por
from ot o join zonas z on z.zona_id = o.zona_id
where o.rebotes > 0 order by o.fecha, o.ot_id;
alter table ot drop column rebotes, drop column rebote_motivo;

-- Renombrar un técnico también actualiza los rebotes.
create or replace function renombrar_tecnico() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update ot set tecnico = new.tecnico_id where tecnico = old.tecnico_id;
  update ot set tecnico_2 = new.tecnico_id where tecnico_2 = old.tecnico_id;
  update taller set tecnico = new.tecnico_id where tecnico = old.tecnico_id;
  update rebotes set tecnico = new.tecnico_id where tecnico = old.tecnico_id;
  update rebotes set tecnico_2 = new.tecnico_id where tecnico_2 = old.tecnico_id;
  perform renombrar_en_operaciones(old.tecnico_id, new.tecnico_id);
  perform anotar_renombre('Técnico', old.tecnico_id, new.tecnico_id);
  return new;
end $$;

-- ---------------------------------------------------------------- feriados
create table feriados (
  fecha  date primary key,
  nombre text not null default ''
);
alter table feriados enable row level security;
create policy leer on feriados for select to authenticated using (es_usuario());
grant select, insert, update, delete on feriados to authenticated;
create policy admin_agrega on feriados for insert to authenticated with check (es_admin());
create policy admin_edita on feriados for update to authenticated using (es_admin()) with check (es_admin());
create policy admin_borra on feriados for delete to authenticated using (es_admin());

-- Feriados nacionales 2026 (calendario oficial, con los trasladados) y 2027 (los inamovibles y los
-- trasladables según la ley 27.399; el 20/11/2027 cae sábado y queda ahí hasta que se publique si se traslada). No se cargan los días no laborables
-- (con fines turísticos, Jueves Santo): si ese día no se trabaja, se agregan en Datos → Feriados.
insert into feriados (fecha, nombre) values
  ('2026-01-01', 'Año Nuevo'),
  ('2026-02-16', 'Carnaval'),
  ('2026-02-17', 'Carnaval'),
  ('2026-03-24', 'Día de la Memoria por la Verdad y la Justicia'),
  ('2026-04-02', 'Día del Veterano y de los Caídos en Malvinas'),
  ('2026-04-03', 'Viernes Santo'),
  ('2026-05-01', 'Día del Trabajador'),
  ('2026-05-25', 'Revolución de Mayo'),
  ('2026-06-15', 'Paso a la Inmortalidad de Güemes (trasladado del 17/6)'),
  ('2026-06-20', 'Paso a la Inmortalidad de Belgrano'),
  ('2026-07-09', 'Día de la Independencia'),
  ('2026-08-17', 'Paso a la Inmortalidad de San Martín'),
  ('2026-10-12', 'Día del Respeto a la Diversidad Cultural'),
  ('2026-11-23', 'Día de la Soberanía Nacional (trasladado del 20/11)'),
  ('2026-12-08', 'Inmaculada Concepción de María'),
  ('2026-12-25', 'Navidad'),
  ('2027-01-01', 'Año Nuevo'),
  ('2027-02-08', 'Carnaval'),
  ('2027-02-09', 'Carnaval'),
  ('2027-03-24', 'Día de la Memoria por la Verdad y la Justicia'),
  ('2027-03-26', 'Viernes Santo'),
  ('2027-04-02', 'Día del Veterano y de los Caídos en Malvinas'),
  ('2027-05-01', 'Día del Trabajador'),
  ('2027-05-25', 'Revolución de Mayo'),
  ('2027-06-20', 'Paso a la Inmortalidad de Belgrano'),
  ('2027-06-21', 'Paso a la Inmortalidad de Güemes (trasladado del 17/6)'),
  ('2027-07-09', 'Día de la Independencia'),
  ('2027-08-16', 'Paso a la Inmortalidad de San Martín (trasladado del 17/8)'),
  ('2027-10-11', 'Día del Respeto a la Diversidad Cultural (trasladado del 12/10)'),
  ('2027-11-20', 'Día de la Soberanía Nacional'),
  ('2027-12-08', 'Inmaculada Concepción de María'),
  ('2027-12-25', 'Navidad')
on conflict do nothing;

update config set valor = '2.4' where clave = 'VERSION';
