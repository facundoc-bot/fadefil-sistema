-- =============================================================================
--  SISTEMA FADEFIL · v2.3: seguimiento de las OT (pedido de Facu, 27/11).
--
--  Lo completa, OT por OT, una persona distinta de la que carga las OT (pantalla
--  "Seguimiento de OT"). No cambia el estado de clientes, máquinas ni stock: son
--  datos para medir, y se guardan por la función del servidor (apiGuardarSeguimiento).
--
--    fecha_solicitud    cuándo se pidió el trabajo. Tiempo de respuesta = fecha de la OT − solicitud (días corridos).
--    excluir_respuesta  no cuenta para la métrica (p. ej. el cliente pidió una fecha más adelante,
--                       o no se puede ir hasta presentar documentación). Lleva motivo.
--    emergencia         pedido urgente porque afecta el funcionamiento del equipo: solo en
--                       mantenimientos, reparaciones y entregas. La entrega de CO₂ "de emergencia"
--                       (con o sin costo) queda marcada sola.
--    rebotes            veces que se fue al cliente a hacer este trabajo y hubo que reprogramar la visita.
--    demora_min         minutos que se demoró el técnico pudiendo hacer el trabajo (no lo atendían,
--                       no estaban las condiciones…).
--    revisada_por/_at   quién completó el seguimiento y cuándo (las que faltan revisar, sin fecha).
-- =============================================================================

alter table ot
  add column fecha_solicitud   date,
  add column excluir_respuesta boolean not null default false,
  add column excluir_motivo    text not null default '',
  add column emergencia        boolean not null default false,
  add column rebotes           int not null default 0,
  add column rebote_motivo     text not null default '',
  add column demora_min        int not null default 0,
  add column demora_motivo     text not null default '',
  add column revisada_por      text not null default '',
  add column revisada_at       timestamptz;

-- La entrega de CO₂ de emergencia ya cargada queda marcada.
update ot set emergencia = true where tipo = 'ENTREGA_CO2' and modalidad_co2 like 'EMERGENCIA%';

alter table ot
  add constraint ot_solicitud_no_posterior check (fecha_solicitud is null or fecha_solicitud <= fecha),
  add constraint ot_emergencia_tipo check (not emergencia or tipo in ('MANTENIMIENTO', 'REPARACION', 'REPARACION_BACKUP', 'ENTREGA_ADICIONALES', 'ENTREGA_CO2')),
  add constraint ot_emergencia_co2 check (not (tipo = 'ENTREGA_CO2' and modalidad_co2 like 'EMERGENCIA%') or emergencia),
  add constraint ot_rebotes check (rebotes between 0 and 20),
  add constraint ot_demora check (demora_min between 0 and 1440),
  add constraint ot_excluir_motivo check (not excluir_respuesta or excluir_motivo <> '');

create index on ot (revisada_at) where revisada_at is null;

-- Motivos que se sugieren en la pantalla (se editan en Datos → Listas; igual se puede escribir otro).
insert into listas (tipo, valor, orden) values
  ('MOTIVO_REBOTE', 'No atendieron', 1),
  ('MOTIVO_REBOTE', 'Local cerrado', 2),
  ('MOTIVO_REBOTE', 'No estaban las condiciones (agua, luz, espacio)', 3),
  ('MOTIVO_REBOTE', 'Faltó material o repuesto', 4),
  ('MOTIVO_REBOTE', 'Falta documentación o permiso de ingreso', 5),
  ('MOTIVO_REBOTE', 'El cliente pidió reprogramar', 6),
  ('MOTIVO_DEMORA', 'No lo atendían', 1),
  ('MOTIVO_DEMORA', 'Esperando autorización o acceso', 2),
  ('MOTIVO_DEMORA', 'No estaban las condiciones (agua, luz, espacio)', 3),
  ('MOTIVO_DEMORA', 'El cliente pidió esperar', 4),
  ('MOTIVO_EXCLUSION', 'El cliente pidió una fecha más adelante', 1),
  ('MOTIVO_EXCLUSION', 'Falta documentación para ingresar', 2),
  ('MOTIVO_EXCLUSION', 'Trabajo programado (no es un pedido)', 3)
on conflict do nothing;

update config set valor = '2.3' where clave = 'VERSION';
