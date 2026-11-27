-- =============================================================================
--  Carrito de envíos (v2.2). Un carrito abierto por origen → destino, compartido.
--  - Lo que entra al carrito queda RESERVADO en el depósito de origen (sale del
--    disponible o de lo revisado Para CABA) hasta que se despacha.
--  - En las plazas, lo que se revisa como "Enviar a CABA" (máquinas e ítems) entra
--    solo al carrito hacia el depósito central; también se puede agregar a mano.
--  - Despachar el carrito = el envío de siempre (queda en camino hasta la recepción).
--  Como todo el estado, se rearma desde el registro de operaciones (clase CARRITO).
-- =============================================================================

alter table operaciones drop constraint operaciones_clase_check;
alter table operaciones add constraint operaciones_clase_check
  check (clase in ('OT', 'INGRESO', 'CIERRE', 'REVISION_ITEMS', 'ENVIO', 'RECEPCION', 'AJUSTE', 'REPARACION_DEPOSITO', 'CARRITO'));

alter table stock add column reservado numeric not null default 0;
alter table movimientos_stock add column reservado numeric not null default 0;

alter table envio_lineas drop constraint envio_lineas_desde_saldo_check;
alter table envio_lineas add constraint envio_lineas_desde_saldo_check check (desde_saldo in ('DISPONIBLE', 'PARA_CABA', 'RESERVADO'));

create table envio_carritos (
  origen_deposito_id  text not null references depositos on update cascade,
  destino_deposito_id text not null references depositos on update cascade,
  desde               date not null,
  primary key (origen_deposito_id, destino_deposito_id)
);
create table envio_carrito_lineas (
  origen_deposito_id  text not null,
  destino_deposito_id text not null,
  codigo              text not null references catalogo on update cascade,
  desde_saldo         text not null check (desde_saldo in ('DISPONIBLE', 'PARA_CABA')),
  cantidad            numeric not null check (cantidad > 0),
  primary key (origen_deposito_id, destino_deposito_id, codigo, desde_saldo),
  foreign key (origen_deposito_id, destino_deposito_id) references envio_carritos on update cascade on delete cascade
);
-- Máquina en un carrito: el destino (el origen es el depósito donde está).
alter table maquinas_estado add column carrito_destino_id text references depositos on update cascade;

alter table envio_carritos enable row level security;
alter table envio_carrito_lineas enable row level security;
create policy leer on envio_carritos for select to authenticated using (es_usuario());
create policy leer on envio_carrito_lineas for select to authenticated using (es_usuario());

update config set valor = '2.2' where clave = 'VERSION';
