-- =============================================================================
--  Esquema de mantenimientos (v2.1): en lugar de "cada N días", seis meses en los
--  que cada uno es Profundo (P), Express (E) o nada (-). Ej.: '-;-;E;-;-;P'.
--  - config.ESQUEMA_MANTENIMIENTO: el de todos los clientes.
--  - clientes.esquema_mant: el propio de un cliente (vacío = el de Configuración).
--  - clientes_estado.mant_mes: en qué mes del esquema quedó el cliente (0 = recién
--    reiniciado por un Profundo, backup, instalación, cambio de modelo o alta inicial).
--  - ot.tipo_mantenimiento: PROFUNDO o EXPRESS en las OT de mantenimiento.
--  Los clientes que ya existen arrancan con mant_mes = 0: su último mantenimiento
--  (o la instalación) cuenta como Profundo.
-- =============================================================================

insert into config (clave, valor, descripcion) values
  ('ESQUEMA_MANTENIMIENTO', '-;-;E;-;-;P', 'Qué mantenimiento toca en cada uno de los 6 meses siguientes al último Profundo: P (Profundo), E (Express) o - (nada). Se cuenta desde el último mantenimiento hecho. Cada cliente puede tener el suyo en su ficha.')
on conflict (clave) do nothing;
delete from config where clave = 'DIAS_MANTENIMIENTO';

alter table config add constraint config_esquema_mant_valido
  check (clave <> 'ESQUEMA_MANTENIMIENTO' or (valor ~ '^[PE-](;[PE-]){5}$' and valor ~ '[PE]'));

alter table clientes add column esquema_mant text not null default ''
  check (esquema_mant = '' or (esquema_mant ~ '^[PE-](;[PE-]){5}$' and esquema_mant ~ '[PE]'));
alter table clientes drop column frecuencia_mant_dias;
grant update (esquema_mant) on clientes to authenticated;  -- ADMIN y CARGA, como el resto de los datos del cliente (ver permisos)

alter table clientes_estado add column mant_mes int not null default 0 check (mant_mes between 0 and 6);
alter table clientes_estado add column tipo_ultimo_mant text not null default '' check (tipo_ultimo_mant in ('', 'PROFUNDO', 'EXPRESS'));

alter table ot add column tipo_mantenimiento text not null default '' check (tipo_mantenimiento in ('', 'PROFUNDO', 'EXPRESS'));
