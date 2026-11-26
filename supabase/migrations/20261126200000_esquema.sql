-- =============================================================================
--  SISTEMA FADEFIL · Base de datos (Supabase / PostgreSQL)
--  Migración 1: tablas.
--
--  Viene del esquema de las planillas (sistema v1.5, CO₂ v2.4), con estos cambios:
--  - Una sola base: las tablas que estaban repetidas en las planillas Interior y AMBA
--    quedan en una sola tabla (la región sale del cliente o del depósito).
--  - Región, plaza, zona, depósito, técnico, modelo y código del catálogo se siguen
--    identificando por su nombre. Las referencias tienen ON UPDATE CASCADE: renombrar
--    uno actualiza todas las tablas que lo usan.
--  - Booleanos, fechas, números y JSON con su tipo real (no texto).
--  - Los identificadores de operaciones (OT-000001, REM-000001…) los da la base
--    (tabla contadores, función siguiente_id), sin repetirse aunque guarden varios a la vez.
-- =============================================================================

-- ---------------------------------------------------------------------------
--  Contadores de identificadores
-- ---------------------------------------------------------------------------
create table contadores (
  prefijo text primary key,
  ultimo  bigint not null default 0
);

-- Próximo identificador de un prefijo: siguiente_id('OT') → 'OT-000001'.
create function siguiente_id(p_prefijo text, p_digitos int default 6)
returns text language plpgsql as $$
declare n bigint;
begin
  insert into contadores (prefijo, ultimo) values (p_prefijo, 1)
  on conflict (prefijo) do update set ultimo = contadores.ultimo + 1
  returning ultimo into n;
  return p_prefijo || '-' || lpad(n::text, p_digitos, '0');
end $$;

-- ---------------------------------------------------------------------------
--  Maestros
-- ---------------------------------------------------------------------------
create table config (
  clave       text primary key,
  valor       text not null default '',
  descripcion text not null default ''
);

create table usuarios (
  email      text primary key check (email = lower(trim(email)) and email like '%@%'),
  nombre     text not null default '',
  rol        text not null check (rol in ('ADMIN', 'CARGA', 'CONSULTA')),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

create table regiones (
  region_id text primary key check (trim(region_id) <> '')
);

create table depositos (
  deposito_id    text primary key check (trim(deposito_id) <> ''),
  direccion      text not null default '',
  controla_stock boolean not null default true,  -- el central (Depósito CABA) no avisa faltantes
  activo         boolean not null default true
);

create table plazas (
  plaza_id    text primary key check (trim(plaza_id) <> ''),
  region_id   text not null references regiones on update cascade,
  deposito_id text not null references depositos on update cascade,
  provincia   text not null default '',
  responsable text not null default '',
  activa      boolean not null default true
);

create table zonas (
  zona_id  text primary key check (trim(zona_id) <> ''),
  plaza_id text not null references plazas on update cascade,
  activa   boolean not null default true
);

create table tecnicos (
  tecnico_id text primary key check (trim(tecnico_id) <> ''),
  plaza_id   text not null references plazas on update cascade,
  activo     boolean not null default true
);

create table modelos (
  modelo      text primary key check (trim(modelo) <> ''),
  linea       text not null default '',
  comentarios text not null default ''
);

create table catalogo (
  codigo      text primary key check (codigo = upper(trim(codigo)) and codigo <> ''),
  descripcion text not null,
  categoria   text not null check (categoria in ('INSUMO', 'ADICIONAL', 'REPUESTO', 'FILTRO', 'RECAMBIO_FILTRO')),
  unidad      text not null default 'u',
  activo      boolean not null default true
);

-- Una fila por componente de cada sistema de purificación o prefiltro.
create table sistemas_purificacion (
  id                bigint generated always as identity primary key,
  sistema           text not null,
  tipo              text not null check (tipo in ('SISTEMA', 'PREFILTRO')),
  codigo_filtro     text references catalogo on update cascade,
  codigo_componente text references catalogo on update cascade,
  componente        text not null,
  rol               text not null check (rol in ('RECAMBIO', 'INSTALACION', 'CONSUMO')),
  unidades          numeric not null default 1 check (unidades > 0),
  meses             numeric check (meses is null or meses > 0),
  si_falla          text not null default '' check (si_falla in ('', 'REVISION', 'DESCARTE')),
  activo            boolean not null default true
);
create index on sistemas_purificacion (sistema);

-- Valores de listas desplegables (tipo de cliente, modalidad, tipo de falla, transporte…).
create table listas (
  tipo  text not null,
  valor text not null,
  orden int not null default 0,
  primary key (tipo, valor)
);

-- Qué categorías del catálogo se cargan en cada tipo de OT.
create table reglas_trabajo (
  tipo_ot         text primary key check (tipo_ot in ('ALTA_INICIAL', 'INSTALACION', 'MANTENIMIENTO', 'REPARACION', 'REPARACION_BACKUP',
                    'CAMBIO_MODELO', 'ENTREGA_ADICIONALES', 'DESINSTALACION_MOMENTANEA', 'DESINSTALACION', 'ENTREGA_CO2')),
  descripcion     text not null default '',
  insumo          boolean not null default false,
  adicional       boolean not null default false,
  repuesto        boolean not null default false,
  filtro          boolean not null default false,
  recambio_filtro boolean not null default false
);

create table clientes (
  cliente_id           text primary key check (trim(cliente_id) <> ''),  -- ID de Persat
  nombre_fantasia      text not null,
  razon_social_cuit    text not null default '',
  sector               text not null default '',
  tipo_cliente         text not null default '',
  modalidad            text not null default '',
  zona_id              text not null references zonas on update cascade,
  frecuencia_mant_dias int check (frecuencia_mant_dias is null or frecuencia_mant_dias > 0),
  comentarios          text not null default '',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index on clientes (zona_id);

create table maquinas (
  serie               text primary key check (serie = upper(serie) and serie !~ '\s' and serie <> ''),
  modelo              text references modelos on update cascade,
  fecha_alta          date not null,
  deposito_inicial_id text not null references depositos on update cascade,
  comentarios         text not null default ''
);

-- ---------------------------------------------------------------------------
--  Registro de operaciones (fuente de verdad) e inconsistencias
-- ---------------------------------------------------------------------------
create table operaciones (
  op_id      text primary key,
  orden      bigint generated always as identity unique,
  clase      text not null check (clase in ('OT', 'INGRESO', 'CIERRE', 'REVISION_ITEMS', 'ENVIO', 'RECEPCION', 'AJUSTE', 'REPARACION_DEPOSITO')),
  fecha      date not null,
  region_id  text references regiones on update cascade,
  detalle    text not null default '',
  estado     text not null default 'VIGENTE' check (estado in ('VIGENTE', 'ANULADA')),
  datos      jsonb not null,
  anulacion  text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);
create index on operaciones (fecha);
create index on operaciones (estado, orden);

create table inconsistencias (
  inconsistencia_id text primary key default siguiente_id('INC'),
  detectada_at      timestamptz not null default now(),
  codigo            text not null,
  ref_id            text not null default '',
  detalle           text not null default '',
  estado            text not null default 'ABIERTA' check (estado in ('ABIERTA', 'RESUELTA')),
  resolucion        text not null default '',
  usuario           text not null default ''
);

create table log (
  id        bigint generated always as identity primary key,
  fecha     timestamptz not null default now(),
  usuario   text not null default '',
  accion    text not null,
  detalle   text not null default '',
  resultado text not null default ''
);
create index on log (fecha);

-- ---------------------------------------------------------------------------
--  Estado actual (lo mantiene el guardado; la auditoría nocturna lo compara con el registro)
-- ---------------------------------------------------------------------------
create table maquinas_estado (
  serie               text primary key references maquinas on update cascade on delete cascade,
  estado              text not null check (estado in ('NUEVA', 'USADA', 'A_REVISAR', 'BAJA')),
  ubicacion_tipo      text not null check (ubicacion_tipo in ('DEPOSITO', 'CLIENTE', 'TRANSITO', 'CABA')),
  ubicacion_id        text not null default '',  -- depósito, cliente o envío
  fecha_ultimo_mov    date,
  revision_abierta_id text not null default '',
  enviar_a_caba       boolean not null default false,
  updated_at          timestamptz not null default now()
);
create index on maquinas_estado (ubicacion_tipo, ubicacion_id);

create table clientes_estado (
  cliente_id                text primary key references clientes on update cascade on delete cascade,
  estado                    text not null check (estado in ('ACTIVO', 'DESINSTALADO_MOMENTANEO', 'EX_CLIENTE', 'SIN_DATOS')),
  serie_instalada           text not null default '',
  fecha_instalacion         date,
  fecha_cambio              date,
  fecha_desinstalacion      date,
  fecha_base                date,
  ultimo_mantenimiento      date,
  ultima_visita             date,
  tipo_ultima_visita        text not null default '',
  fecha_ultima_ot           date,
  pendiente                 text not null default '',
  comentario_desinstalacion text not null default '',
  updated_at                timestamptz not null default now()
);

-- Lo que tiene cada cliente: saldo COMODATO, ADICIONALES o FALTANTE (no devuelto) / DEVUELTO_DE_MAS.
create table clientes_items (
  cliente_id text not null references clientes on update cascade on delete cascade,
  codigo     text not null references catalogo on update cascade,
  saldo      text not null check (saldo in ('COMODATO', 'ADICIONALES', 'FALTANTE', 'DEVUELTO_DE_MAS')),
  cantidad   numeric not null check (cantidad > 0),
  primary key (cliente_id, codigo, saldo)
);

-- Sistema de purificación y prefiltro instalados (slot SISTEMA / PREFILTRO).
create table clientes_sistemas (
  cliente_id text not null references clientes on update cascade on delete cascade,
  slot       text not null check (slot in ('SISTEMA', 'PREFILTRO')),
  sistema    text not null,
  desde      date,
  primary key (cliente_id, slot)
);

-- Componentes del sistema instalado: partes (tipo PARTE, con unidades) y último cambio de cada recambio (tipo ULTIMO_CAMBIO).
create table clientes_componentes (
  cliente_id    text not null references clientes on update cascade on delete cascade,
  slot          text not null check (slot in ('SISTEMA', 'PREFILTRO')),
  codigo        text not null references catalogo on update cascade,
  tipo          text not null check (tipo in ('PARTE', 'ULTIMO_CAMBIO')),
  unidades      numeric,
  ultimo_cambio date,
  primary key (cliente_id, slot, codigo, tipo)
);

create table stock (
  deposito_id text not null references depositos on update cascade,
  codigo      text not null references catalogo on update cascade,
  disponible  numeric not null default 0,
  a_revisar   numeric not null default 0,
  para_caba   numeric not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (deposito_id, codigo)
);

-- Ítems retirados que esperan revisión, con su origen (cliente, fecha, OT).
create table lotes_revision (
  lote_id     text primary key,
  deposito_id text not null references depositos on update cascade,
  codigo      text not null references catalogo on update cascade,
  cantidad    numeric not null check (cantidad > 0),
  fecha       date not null,
  cliente_id  text not null default '',
  tipo_ot     text not null default '',
  op_id       text not null default ''
);
create index on lotes_revision (deposito_id, codigo);

-- Revisiones de máquinas (taller): abiertas y cerradas.
create table taller (
  revision_id  text primary key,
  serie        text not null references maquinas on update cascade,
  deposito_id  text not null references depositos on update cascade,
  fecha        date not null,
  origen_op_id text not null default '',
  falla        text not null default '',
  estado       text not null check (estado in ('ABIERTO', 'CERRADO')),
  resultado    text not null default '' check (resultado in ('', 'APTA', 'REPARADA', 'ENVIAR_CABA', 'BAJA')),
  fecha_cierre date,
  cierre_id    text not null default '',
  diagnostico  text not null default '',
  tecnico      text not null default '',
  cliente_id   text not null default '',
  tipo_ot      text not null default ''
);
create index on taller (serie);
create index on taller (estado);

create table envios (
  envio_id            text primary key,
  fecha               date not null,
  origen_deposito_id  text not null references depositos on update cascade,
  destino_deposito_id text not null references depositos on update cascade,
  transporte          text not null default '',
  guia                text not null default '',
  estado              text not null check (estado in ('EN_TRANSITO', 'RECIBIDO', 'ANULADO')),
  fecha_recepcion     date,
  recepcion_id        text not null default '',
  comentarios         text not null default '',
  created_by          text not null default '',
  created_at          timestamptz not null default now()
);
create index on envios (estado);

create table envio_lineas (
  linea_id    text primary key,
  envio_id    text not null references envios on delete cascade,
  codigo      text references catalogo on update cascade,  -- ítem (o vacío si es una máquina)
  serie       text references maquinas on update cascade,  -- máquina (o vacío si es un ítem)
  cantidad    numeric not null default 1 check (cantidad > 0),
  desde_saldo text not null default 'DISPONIBLE' check (desde_saldo in ('DISPONIBLE', 'PARA_CABA')),
  check ((codigo is null) <> (serie is null))
);
create index on envio_lineas (envio_id);

-- ---------------------------------------------------------------------------
--  Registros por operación (se agregan; no se editan salvo las columnas indicadas)
-- ---------------------------------------------------------------------------
create table ot (
  ot_id           text primary key,
  fecha           date not null,
  cliente_id      text not null references clientes on update cascade,
  zona_id         text not null references zonas on update cascade,
  tipo            text not null references reglas_trabajo (tipo_ot),
  tecnico         text not null default '',
  tecnico_2       text not null default '',
  serie_retirada  text not null default '',
  serie_instalada text not null default '',
  falla           text not null default '',
  sistema         text not null default '',
  prefiltro       text not null default '',
  comentarios     text not null default '',
  pendiente       text not null default '',
  ot_persat       text not null default '',
  modalidad_co2   text not null default '',
  estado          text not null default 'VIGENTE' check (estado in ('VIGENTE', 'ANULADA')),
  created_by      text not null,
  created_at      timestamptz not null default now()
);
create index on ot (cliente_id, fecha);
create index on ot (fecha);

-- Líneas de ítems de cada OT. dto y facturado se editan (cobranzas).
create table ot_lineas (
  linea_id        text primary key,
  ot_id           text not null references ot on delete cascade,
  cliente_id      text not null references clientes on update cascade,
  fecha           date not null,
  codigo          text not null references catalogo on update cascade,
  cantidad        numeric not null,
  movimiento      text not null,
  codigo_retirado text not null default '',
  saldo           text not null default '',
  cobranza        boolean not null default false,
  dto             text not null default '',
  facturado       text not null default ''
);
create index on ot_lineas (ot_id);
create index on ot_lineas (cliente_id);
create index on ot_lineas (cobranza, fecha);

-- Kárdex: cada cambio de stock (todos los saldos), con su origen.
create table movimientos_stock (
  movimiento_id text primary key,
  fecha         date not null,
  deposito_id   text not null references depositos on update cascade,
  codigo        text not null references catalogo on update cascade,
  movimiento    text not null,
  disponible    numeric not null default 0,
  a_revisar     numeric not null default 0,
  para_caba     numeric not null default 0,
  cliente_id    text not null default '',
  serie         text not null default '',
  op_id         text not null default '',
  detalle       text not null default ''
);
create index on movimientos_stock (deposito_id, codigo, fecha);
create index on movimientos_stock (op_id);

-- Ingresos y salidas por tipo (para los informes por período).
create table ingresos_salidas (
  movimiento_id text primary key,
  fecha         date not null,
  deposito_id   text not null references depositos on update cascade,
  codigo        text not null references catalogo on update cascade,
  sentido       text not null check (sentido in ('INGRESO', 'SALIDA')),
  tipo          text not null,
  cantidad      numeric not null,
  cliente_id    text not null default '',
  serie         text not null default '',
  op_id         text not null default '',
  detalle       text not null default ''
);
create index on ingresos_salidas (deposito_id, fecha);

create table revision_lineas (
  linea_id    text primary key,
  revision_id text not null,
  fecha       date not null,
  deposito_id text not null references depositos on update cascade,
  codigo      text not null references catalogo on update cascade,
  cantidad    numeric not null,
  resultado   text not null check (resultado in ('DISPONIBLE', 'ENVIAR_CABA', 'DESCARTE')),
  lote_id     text not null default '',
  cliente_id  text not null default '',
  origen      text not null default ''
);
create index on revision_lineas (revision_id);

create table taller_lineas (
  linea_id    text primary key,
  revision_id text not null references taller on delete cascade,
  op_id       text not null,
  codigo      text not null references catalogo on update cascade,
  cantidad    numeric not null
);

create table ajustes_stock (
  ajuste_id    text primary key,
  fecha        date not null,
  deposito_id  text not null references depositos on update cascade,
  codigo       text not null references catalogo on update cascade,
  cantidad     numeric not null,
  saldo        text not null check (saldo in ('DISPONIBLE', 'A_REVISAR', 'PARA_CABA')),
  tipo         text not null default '',
  motivo       text not null default '',
  generada_por text not null default '',
  created_by   text not null default '',
  created_at   timestamptz not null default now()
);
create index on ajustes_stock (deposito_id, fecha);

-- =============================================================================
--  Módulo CO₂ (cilindros)
-- =============================================================================
create table co2_config (
  clave       text primary key,
  valor       text not null default '',
  descripcion text not null default ''
);

-- Amplía el maestro de depósitos. plaza_linde: cómo reconoce "Leer PDF" al depósito
-- (el CODIGO de LINDE del lugar de entrega; varios valores separados por ";").
create table co2_depositos (
  deposito_id text primary key references depositos on update cascade,
  plaza_linde text not null default '',
  activo      boolean not null default true
);

create table co2_cilindros (
  serie              text primary key,
  peso_kg            numeric,
  estado             text not null check (estado in ('LLENO_DISPONIBLE', 'EN_USO', 'VACIO_DISPONIBLE', 'ENTREGADO_LINDE')),
  ubicacion_tipo     text not null check (ubicacion_tipo in ('DEPOSITO', 'CLIENTE', 'LINDE')),
  ubicacion_id       text not null default '',
  deposito_origen_id text not null default '',
  circuito_id        text not null default '',
  fecha_alta         date,
  fecha_ultimo_mov   date,
  updated_at         timestamptz not null default now()
);
create index on co2_cilindros (ubicacion_tipo, ubicacion_id);

create table co2_circuitos (
  circuito_id        text primary key,
  serie              text not null,
  deposito_origen_id text not null,
  fecha_inicio       date not null,
  ref_entrada        text not null default '',
  fecha_cierre       date,
  ref_salida         text not null default '',
  estado             text not null check (estado in ('ABIERTO', 'CERRADO'))
);
create index on co2_circuitos (serie);
create index on co2_circuitos (deposito_origen_id, estado);

create table co2_remitos (
  remito_id       text primary key,
  nro_remito      text not null,
  nro_normalizado text not null,
  fecha           date not null,
  deposito_id     text not null references depositos on update cascade,
  tipo_copia      text not null default '',
  plaza_texto     text not null default '',
  origen_carga    text not null default 'MANUAL',  -- MANUAL, PDF, IMPORTACION
  archivo_ruta    text not null default '',        -- ruta en el almacenamiento de archivos (Supabase Storage)
  archivo_hash    text not null default '',
  observaciones   text not null default '',
  estado          text not null check (estado in ('BORRADOR', 'CON_ERROR', 'PENDIENTE_APROBACION', 'CONFIRMADO', 'ANULADO')),
  errores         text not null default '',
  created_by      text not null default '',
  created_at      timestamptz not null default now(),
  confirmado_at   timestamptz
);
-- Un número de remito no se repite (salvo anulados).
create unique index co2_remitos_nro_unico on co2_remitos (nro_normalizado) where estado <> 'ANULADO';
create index on co2_remitos (fecha);

create table co2_remito_lineas (
  linea_id       text primary key,
  remito_id      text not null references co2_remitos on delete cascade,
  tipo           text not null check (tipo in ('ENTREGA', 'RETIRO')),
  serie          text not null,
  peso_kg        numeric,
  serie_leida    text not null default '',  -- como figura en el documento
  movimiento_id  text not null default '',
  revision       text not null default ''   -- DUDOSA:<sugerida> o APROBADA: …
);
create index on co2_remito_lineas (remito_id);

create table co2_facturas (
  factura_id      text primary key,
  nro_factura     text not null,
  nro_normalizado text not null,
  fecha           date not null,
  total_kg        numeric,
  archivo_ruta    text not null default '',
  archivo_hash    text not null default '',
  observaciones   text not null default '',
  estado          text not null check (estado in ('VALIDADA', 'CON_DIFERENCIAS', 'ANULADA')),
  resumen         text not null default '',
  created_by      text not null default '',
  created_at      timestamptz not null default now(),
  anulada_por     text not null default '',
  anulada_at      timestamptz
);
create unique index co2_facturas_nro_unico on co2_facturas (nro_normalizado) where estado <> 'ANULADA';

create table co2_factura_lineas (
  linea_id        text primary key,
  factura_id      text not null references co2_facturas on delete cascade,
  nro_remito      text not null,
  nro_normalizado text not null,
  fecha_remito    date,
  kg_factura      numeric,
  remito_id       text references co2_remitos,
  kg_sistema      numeric,
  resultado       text not null check (resultado in ('VALIDADO', 'DIFERENCIA_KG', 'NO_CONFIRMADO', 'NO_ENCONTRADO', 'YA_FACTURADO', 'SIN_KG')),
  detalle         text not null default ''
);
create index on co2_factura_lineas (remito_id);

-- Trabajos en clientes (vienen de las OT: llevan el número de la OT).
create table co2_trabajos (
  trabajo_id    text primary key,
  fecha         date not null,
  tipo          text not null check (tipo in ('ENTREGA', 'RETIRO', 'RECAMBIO')),
  cliente_id    text not null references clientes on update cascade,
  zona_id       text not null default '',
  observaciones text not null default '',
  estado        text not null check (estado in ('CONFIRMADO', 'ANULADO')),
  created_by    text not null default '',
  created_at    timestamptz not null default now()
);
create index on co2_trabajos (cliente_id);

create table co2_trabajo_lineas (
  linea_id      text primary key,
  trabajo_id    text not null references co2_trabajos on delete cascade,
  tipo          text not null check (tipo in ('ENTREGA', 'RETIRO')),
  serie         text not null,
  movimiento_id text not null default ''
);
create index on co2_trabajo_lineas (trabajo_id);

-- Inventario inicial (cilindros que ya estaban en un depósito o en un cliente).
create table co2_altas (
  alta_id            text primary key,
  fecha              date not null,
  serie              text not null,
  peso_kg            numeric,
  deposito_origen_id text not null references depositos on update cascade,
  ubicacion          text not null check (ubicacion in ('DEPOSITO', 'CLIENTE')),
  cliente_id         text references clientes on update cascade,
  estado_cilindro    text not null default '',
  observaciones      text not null default '',
  estado             text not null check (estado in ('CONFIRMADO', 'ANULADO')),
  created_by         text not null default '',
  created_at         timestamptz not null default now()
);

-- Fuente de verdad de CO₂: el estado de los cilindros se reconstruye desde acá.
create table co2_movimientos (
  movimiento_id      text primary key,
  orden              bigint generated always as identity unique,
  fecha              date not null,
  serie              text not null,
  peso_kg            numeric,
  tipo               text not null,
  origen_tipo        text not null default '',
  origen_id          text not null default '',
  destino_tipo       text not null default '',
  destino_id         text not null default '',
  estado_anterior    text not null default '',
  estado_nuevo       text not null,
  circuito_id        text not null default '',
  deposito_origen_id text not null default '',
  zona_id            text not null default '',
  ref_tipo           text not null check (ref_tipo in ('REMITO', 'TRABAJO', 'INVENTARIO')),
  ref_id             text not null,
  anulado            boolean not null default false,
  created_by         text not null default '',
  created_at         timestamptz not null default now()
);
create index on co2_movimientos (serie, orden);
create index on co2_movimientos (ref_id);
create index on co2_movimientos (zona_id, fecha);

create table co2_inconsistencias (
  inconsistencia_id text primary key default siguiente_id('CINC'),
  detectada_at      timestamptz not null default now(),
  codigo            text not null,
  serie             text not null default '',
  ref_id            text not null default '',
  detalle           text not null default '',
  estado            text not null default 'ABIERTA' check (estado in ('ABIERTA', 'RESUELTA')),
  resolucion        text not null default '',
  usuario           text not null default ''
);

-- ---------------------------------------------------------------------------
--  Fecha de actualización automática
-- ---------------------------------------------------------------------------
create function tocar_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger clientes_updated before update on clientes for each row execute function tocar_updated_at();

-- Una máquina nueva arranca "Nueva" en su depósito inicial, con la fecha de alta.
create function maquina_nueva_estado() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into maquinas_estado (serie, estado, ubicacion_tipo, ubicacion_id, fecha_ultimo_mov)
  values (new.serie, 'NUEVA', 'DEPOSITO', new.deposito_inicial_id, new.fecha_alta)
  on conflict (serie) do nothing;
  return new;
end $$;

create trigger maquinas_estado_inicial after insert on maquinas for each row execute function maquina_nueva_estado();
