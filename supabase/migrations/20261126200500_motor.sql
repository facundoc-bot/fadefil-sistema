-- =============================================================================
--  SISTEMA FADEFIL · Migración 6: ajustes para el motor de reglas en el servidor.
--  · Los ajustes de stock se pueden anular (como las OT y los envíos).
--  · La revisión de ítems registra también los cartuchos usados para reacondicionar.
--  · Los movimientos de stock guardan el orden en que se cargaron (para el kárdex
--    y para el aviso de stock a la fecha cuando hay varios el mismo día).
-- =============================================================================

alter table ajustes_stock add column estado text not null default 'VIGENTE' check (estado in ('VIGENTE', 'ANULADA'));

alter table revision_lineas drop constraint revision_lineas_resultado_check;
alter table revision_lineas add constraint revision_lineas_resultado_check
  check (resultado in ('DISPONIBLE', 'ENVIAR_CABA', 'DESCARTE', 'REACONDICIONAMIENTO'));

alter table movimientos_stock add column orden bigint generated always as identity;
create index on movimientos_stock (codigo, orden);
alter table ingresos_salidas add column orden bigint generated always as identity;
