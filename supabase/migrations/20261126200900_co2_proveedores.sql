-- =============================================================================
--  CO₂ con más de un proveedor (v2.1): LINDE y Gases Nordelta (GN).
--  - Cada plaza dice con qué proveedor trabaja (AMBA: CABA con LINDE y GBA con GN;
--    el resto, LINDE). A un cliente se le entregan solo cilindros de ese proveedor.
--  - Un cilindro es de un proveedor para siempre (como su carga en kg): se fija
--    cuando entra (remito o inventario inicial).
--  - Remitos, facturas e inventario inicial dicen de qué proveedor son. El número de
--    remito y de factura no se repite dentro de cada proveedor.
--  - Los estados y movimientos siguen llamándose *_LINDE por compatibilidad: quieren
--    decir "en el proveedor"; el proveedor concreto queda en la columna proveedor.
-- =============================================================================

create table co2_proveedores (
  proveedor_id text primary key,
  nombre       text not null,
  lector_pdf   boolean not null default false,  -- "Leer PDF" sabe leer sus remitos y facturas
  activo       boolean not null default true
);
insert into co2_proveedores (proveedor_id, nombre, lector_pdf) values ('LINDE', 'LINDE', true), ('GN', 'Gases Nordelta', false);

alter table co2_proveedores enable row level security;
create policy leer on co2_proveedores for select to authenticated using (es_usuario());
grant insert, update, delete on co2_proveedores to authenticated;
create policy admin_agrega on co2_proveedores for insert to authenticated with check (es_admin());
create policy admin_edita on co2_proveedores for update to authenticated using (es_admin()) with check (es_admin());
create policy admin_borra on co2_proveedores for delete to authenticated using (es_admin());

alter table plazas add column proveedor_co2 text not null default 'LINDE' references co2_proveedores on update cascade;
update plazas set proveedor_co2 = 'GN' where plaza_id = 'GBA';

alter table co2_cilindros add column proveedor text not null default 'LINDE' references co2_proveedores on update cascade;
alter table co2_movimientos add column proveedor text not null default '';  -- en los que abren circuito (remito o inventario)
update co2_movimientos set proveedor = 'LINDE' where tipo in ('ENTREGA_LINDE', 'ALTA_INICIAL');
alter table co2_remitos add column proveedor text not null default 'LINDE' references co2_proveedores on update cascade;
alter table co2_altas add column proveedor text not null default 'LINDE' references co2_proveedores on update cascade;
alter table co2_facturas add column proveedor text not null default 'LINDE' references co2_proveedores on update cascade;

drop index co2_remitos_nro_unico;
create unique index co2_remitos_nro_unico on co2_remitos (proveedor, nro_normalizado) where estado <> 'ANULADO';
drop index co2_facturas_nro_unico;
create unique index co2_facturas_nro_unico on co2_facturas (proveedor, nro_normalizado) where estado <> 'ANULADA';

update co2_config set descripcion = 'Cargas posibles de un cilindro, en kg de CO₂, separadas por punto y coma (ej.: 5;6;10;25; con decimales: 2.5). La carga de cada serie queda fija desde que entra.'
  where clave = 'CARGAS_KG';

update config set valor = '2.1' where clave = 'VERSION';
