-- =============================================================================
--  SISTEMA FADEFIL · Migración 3: datos iniciales.
--  Los mismos que sembraba el instalador de las planillas (sistema v1.5, CO₂ v2.4).
--  Se pueden cambiar desde la sección Datos de la app.
-- =============================================================================

insert into config (clave, valor, descripcion) values
  ('DIAS_MANTENIMIENTO', '90', 'Días entre mantenimientos por defecto (interior: trimestral). Cada cliente puede tener su frecuencia propia.'),
  ('DIAS_AVISO_MANTENIMIENTO', '15', 'Días antes del vencimiento en que el mantenimiento pasa a "Próximo".'),
  ('DIAS_ANTICIPO_FILTROS', '20', 'En un mantenimiento se cambian los recambios vencidos y los que vencen hasta estos días después de la visita.'),
  ('REGIONES_TECNICO_OBLIGATORIO', 'AMBA', 'Regiones en las que la OT pide elegir el técnico de la lista (separadas por coma). En las demás es opcional y de texto libre.'),
  ('DIAS_RETRABAJO', '30', 'Informe de técnicos: una reparación en el mismo cliente dentro de estos días después de un trabajo cuenta como retrabajo de quien lo hizo.'),
  ('DEPOSITO_CENTRAL', 'Depósito CABA', 'Depósito central: desde acá salen los envíos al interior y adonde vuelve lo que no se repara en la plaza.'),
  ('VERSION', '2.0', 'Versión del sistema (app nueva con base de datos).');

insert into regiones (region_id) values ('AMBA'), ('INTERIOR');

insert into depositos (deposito_id, direccion, controla_stock, activo) values ('Depósito CABA', '', false, true);

insert into plazas (plaza_id, region_id, deposito_id, provincia, responsable, activa) values
  ('CABA', 'AMBA', 'Depósito CABA', 'CABA', '', true),
  ('GBA', 'AMBA', 'Depósito CABA', 'Buenos Aires', '', true);

insert into listas (tipo, valor, orden) values
  ('TIPO_CLIENTE', 'AQA', 1), ('TIPO_CLIENTE', 'Office', 2), ('TIPO_CLIENTE', 'Hielogic', 3),
  ('MODALIDAD', 'Comodato', 4), ('MODALIDAD', 'Venta sin fee', 5), ('MODALIDAD', 'Venta con fee', 6);

insert into reglas_trabajo (tipo_ot, descripcion, insumo, adicional, repuesto, filtro, recambio_filtro) values
  ('ALTA_INICIAL', 'Alta inicial', true, true, false, false, false),
  ('INSTALACION', 'Instalación', true, true, true, true, false),
  ('MANTENIMIENTO', 'Mantenimiento preventivo', false, false, false, true, true),
  ('REPARACION', 'Reparación', true, false, true, true, true),
  ('REPARACION_BACKUP', 'Reparación con backup', true, false, true, true, true),
  ('CAMBIO_MODELO', 'Cambio de modelo', true, true, false, false, false),
  ('ENTREGA_ADICIONALES', 'Entrega de adicionales', false, true, false, false, false),
  ('DESINSTALACION_MOMENTANEA', 'Desinstalación momentánea', true, true, false, false, false),
  ('DESINSTALACION', 'Desinstalación', true, true, false, false, false),
  ('ENTREGA_CO2', 'Entrega de CO₂', false, false, false, false, false);

insert into catalogo (codigo, descripcion, categoria, unidad, activo) values
  ('F4E', 'Filtro 4 Etapas', 'FILTRO', 'u', true),
  ('F6C', 'Filtro 6 etapas (Chico)', 'FILTRO', 'u', true),
  ('F6G', 'Filtro 6 etapas (Grande)', 'FILTRO', 'u', true),
  ('FARG', 'Mochila Argenfil completa', 'FILTRO', 'u', true),
  ('FHLG', 'Filtro Hielogic Grandes', 'FILTRO', 'u', true),
  ('F3EO', 'Filtro 3 Etapas Office', 'FILTRO', 'u', true),
  ('PWG', 'Cartucho PWG HP PRO', 'FILTRO', 'u', true),
  ('PWGR', 'Cartucho PWG HP PRO R', 'FILTRO', 'u', true),
  ('PWGSTEAM', 'Cartucho PWG HP PRO (STEAM)', 'FILTRO', 'u', true),
  ('PWGICE', 'Cartucho PWG HP PRO (ICE)', 'FILTRO', 'u', true),
  ('PWGESP', 'Cartucho PWG HP PRO (ESPRESSO)', 'FILTRO', 'u', true),
  ('PWGRES', 'Cartucho PWG HP PRO (RESINA HP-002)', 'FILTRO', 'u', true),
  ('PF1020', 'Prefiltro 10 y 20 micrones', 'FILTRO', 'u', true),
  ('PF1020P', 'Prefiltro 10 y 20 micrones + Polifosfato', 'FILTRO', 'u', true),
  ('SED1', 'Sedimento 1 micrón', 'RECAMBIO_FILTRO', 'u', true),
  ('CGRA', 'Carbón granular', 'RECAMBIO_FILTRO', 'u', true),
  ('CBLO', 'Carbón en bloque', 'RECAMBIO_FILTRO', 'u', true),
  ('MIN', 'Mineralizador', 'RECAMBIO_FILTRO', 'u', true),
  ('PUL', 'Pulidor carbón granular', 'RECAMBIO_FILTRO', 'u', true),
  ('MEMC', 'Membrana chica', 'RECAMBIO_FILTRO', 'u', true),
  ('MEMG', 'Membrana grande', 'RECAMBIO_FILTRO', 'u', true),
  ('SEDARG', 'Sedimento Argenfil', 'RECAMBIO_FILTRO', 'u', true),
  ('CBLARG', 'Carbón en bloque Argenfil', 'RECAMBIO_FILTRO', 'u', true),
  ('P10', 'Cartucho 10 micrones', 'RECAMBIO_FILTRO', 'u', true),
  ('P20', 'Cartucho 20 micrones', 'RECAMBIO_FILTRO', 'u', true),
  ('POLI', 'Polifosfato', 'RECAMBIO_FILTRO', 'u', true),
  ('CAB', 'Cabezal PWG', 'REPUESTO', 'u', true),
  ('TANQ', 'Tanque hidroneumático', 'REPUESTO', 'u', true);

insert into sistemas_purificacion (sistema, tipo, codigo_filtro, codigo_componente, componente, rol, unidades, meses, si_falla, activo) values
  ('4 Etapas', 'SISTEMA', 'F4E', 'SED1', 'Sedimento 1 micron', 'RECAMBIO', 1, 3, '', true),
  ('4 Etapas', 'SISTEMA', 'F4E', 'CGRA', 'Carbon Granular', 'RECAMBIO', 1, 6, '', true),
  ('4 Etapas', 'SISTEMA', 'F4E', 'CBLO', 'Carbon en Bloque', 'RECAMBIO', 1, 6, '', true),
  ('4 Etapas', 'SISTEMA', 'F4E', 'MIN', 'Mineralizador', 'RECAMBIO', 1, 12, '', true),
  ('PWG HP PRO R', 'SISTEMA', 'PWGR', 'PWGR', 'PWG HP PRO R', 'RECAMBIO', 1, 12, '', true),
  ('PWG HP PRO R', 'SISTEMA', 'PWGR', 'CAB', 'CABEZAL', 'INSTALACION', 1, null, 'DESCARTE', true),
  ('PWG HP PRO', 'SISTEMA', 'PWG', 'PWG', 'PWG HP PRO', 'RECAMBIO', 1, 12, '', true),
  ('PWG HP PRO', 'SISTEMA', 'PWG', 'CAB', 'CABEZAL', 'INSTALACION', 1, null, 'DESCARTE', true),
  ('3 ETAPAS OFFICE', 'SISTEMA', 'F3EO', 'F3EO', '3 ETAPAS OFFICE', 'RECAMBIO', 1, 12, '', true),
  ('Mochila Argenfil completa', 'SISTEMA', 'FARG', 'SEDARG', 'Sedimento Argenfil', 'RECAMBIO', 1, 12, '', true),
  ('Mochila Argenfil completa', 'SISTEMA', 'FARG', 'CBLARG', 'C. Bloque Argenfil', 'RECAMBIO', 1, 12, '', true),
  ('Filtro Hielogic Grandes', 'SISTEMA', 'FHLG', 'SED1', 'Sedimento 1 micron', 'RECAMBIO', 1, 12, '', true),
  ('Filtro Hielogic Grandes', 'SISTEMA', 'FHLG', 'CGRA', 'Carbon Granular', 'RECAMBIO', 1, 12, '', true),
  ('6 etapas (Chico)', 'SISTEMA', 'F6C', 'SED1', 'Sedimento 1 micron', 'RECAMBIO', 1, 3, '', true),
  ('6 etapas (Chico)', 'SISTEMA', 'F6C', 'CGRA', 'Carbon Granular', 'RECAMBIO', 1, 6, '', true),
  ('6 etapas (Chico)', 'SISTEMA', 'F6C', 'CBLO', 'Carbon en Bloque', 'RECAMBIO', 1, 6, '', true),
  ('6 etapas (Chico)', 'SISTEMA', 'F6C', 'MIN', 'Mineralizador', 'RECAMBIO', 1, 12, '', true),
  ('6 etapas (Chico)', 'SISTEMA', 'F6C', 'PUL', 'Pulidor Carbon granular', 'RECAMBIO', 1, 18, '', true),
  ('6 etapas (Chico)', 'SISTEMA', 'F6C', 'MEMC', 'Membrana Chica', 'RECAMBIO', 1, 24, '', true),
  ('6 etapas (Chico)', 'SISTEMA', 'F6C', 'TANQ', 'Tanque Hidroneumatico', 'INSTALACION', 1, null, 'REVISION', true),
  ('6 etapas (Grande)', 'SISTEMA', 'F6G', 'SED1', 'Sedimento 1 micron', 'RECAMBIO', 1, 3, '', true),
  ('6 etapas (Grande)', 'SISTEMA', 'F6G', 'CGRA', 'Carbon Granular', 'RECAMBIO', 1, 6, '', true),
  ('6 etapas (Grande)', 'SISTEMA', 'F6G', 'CBLO', 'Carbon en Bloque', 'RECAMBIO', 1, 6, '', true),
  ('6 etapas (Grande)', 'SISTEMA', 'F6G', 'MIN', 'Mineralizador', 'RECAMBIO', 1, 12, '', true),
  ('6 etapas (Grande)', 'SISTEMA', 'F6G', 'PUL', 'Pulidor Carbon granular', 'RECAMBIO', 1, 18, '', true),
  ('6 etapas (Grande)', 'SISTEMA', 'F6G', 'MEMG', 'Membrana Grande', 'RECAMBIO', 1, 24, '', true),
  ('6 etapas (Grande)', 'SISTEMA', 'F6G', 'TANQ', 'Tanque Hidroneumatico', 'INSTALACION', 1, null, 'REVISION', true),
  ('PWG HP PRO (STEAM)', 'SISTEMA', 'PWGSTEAM', 'PWGSTEAM', 'PWG HP PRO (STEAM)', 'RECAMBIO', 1, 12, '', true),
  ('PWG HP PRO (STEAM)', 'SISTEMA', 'PWGSTEAM', 'CAB', 'CABEZAL', 'INSTALACION', 1, null, 'DESCARTE', true),
  ('PWG HP PRO (ICE)', 'SISTEMA', 'PWGICE', 'PWGICE', 'PWG HP PRO (ICE)', 'RECAMBIO', 1, 12, '', true),
  ('PWG HP PRO (ICE)', 'SISTEMA', 'PWGICE', 'CAB', 'CABEZAL', 'INSTALACION', 1, null, 'DESCARTE', true),
  ('PWG HP PRO (ESPRESSO)', 'SISTEMA', 'PWGESP', 'PWGESP', 'PWG HP PRO (ESPRESSO)', 'RECAMBIO', 1, 12, '', true),
  ('PWG HP PRO (ESPRESSO)', 'SISTEMA', 'PWGESP', 'CAB', 'CABEZAL', 'INSTALACION', 1, null, 'DESCARTE', true),
  ('PWG HP PRO (RESINA HP-002)', 'SISTEMA', 'PWGRES', 'PWGRES', 'PWG HP PRO (RESINA HP-002)', 'RECAMBIO', 1, 12, '', true),
  ('PWG HP PRO (RESINA HP-002)', 'SISTEMA', 'PWGRES', 'CAB', 'CABEZAL', 'INSTALACION', 1, null, 'DESCARTE', true),
  ('Prefiltro 10 Y 20 Micrones', 'PREFILTRO', 'PF1020', 'P10', '10 micrones', 'RECAMBIO', 1, 3, '', true),
  ('Prefiltro 10 Y 20 Micrones', 'PREFILTRO', 'PF1020', 'P20', '20 micrones', 'RECAMBIO', 1, 3, '', true),
  ('Prefiltro 10 Y 20 Micrones + Polifosfato', 'PREFILTRO', 'PF1020P', 'P10', '10 micrones', 'RECAMBIO', 1, 3, '', true),
  ('Prefiltro 10 Y 20 Micrones + Polifosfato', 'PREFILTRO', 'PF1020P', 'P20', '20 micrones', 'RECAMBIO', 1, 3, '', true),
  ('Prefiltro 10 Y 20 Micrones + Polifosfato', 'PREFILTRO', 'PF1020P', 'POLI', 'Polifosfato', 'CONSUMO', 1, null, '', true);

insert into co2_config (clave, valor, descripcion) values
  ('CARGAS_KG', '5;10', 'Cargas posibles de un cilindro, en kg de CO₂, separadas por punto y coma (ej.: 5;10).'),
  ('DIAS_INMOVILIZADO_CLIENTE', '60', 'Días sin movimiento en un cliente para alertar. 0 = apagado.'),
  ('DIAS_VACIO_SIN_DEVOLVER', '30', 'Días de un vacío en depósito sin retiro de LINDE para alertar. 0 = apagado.'),
  ('PATRON_SERIE_PDF', '[A-Z]{1,3}-?[0-9]{4,9}[A-Z]{0,2}', 'Leer PDF: forma de las series de cilindros en los remitos de LINDE (expresión regular). Las series que ya están en el sistema se reconocen siempre.'),
  ('MESES_RECAMBIO', '6', 'Meses por defecto para el promedio de consumo y de días entre recambios.');
