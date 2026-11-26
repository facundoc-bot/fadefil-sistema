-- =============================================================================
--  SISTEMA FADEFIL · Migración 7: CO₂ en las OT.
--  Las líneas de una OT con cilindros llevan el código CO2 (una línea por entrega y
--  otra por retiro; las series quedan en co2_trabajo_lineas). CO2 es un código del
--  catálogo de categoría propia e inactivo: no se elige como ítem en una OT.
-- =============================================================================
alter table catalogo drop constraint catalogo_categoria_check;
alter table catalogo add constraint catalogo_categoria_check
  check (categoria in ('INSUMO', 'ADICIONAL', 'REPUESTO', 'FILTRO', 'RECAMBIO_FILTRO', 'CO2'));
insert into catalogo (codigo, descripcion, categoria, unidad, activo)
values ('CO2', 'Cilindro de CO₂', 'CO2', 'cilindro', false)
on conflict (codigo) do nothing;
