// =============================================================================
//  SISTEMA FADEFIL · Puente entre la base y el motor (antes Estado.gs + Datos.gs).
//  - maestros → contexto del motor;
//  - tablas de estado → estado del motor (W), sin repetir el historial;
//  - estado del motor → solo las filas que cambiaron;
//  - guardar un lote, anular una operación y auditar (rearmar todo desde el registro).
//  Recibe la conexión (postgres.js) desde afuera: la usan la función del servidor
//  (Deno) y las pruebas (Node). Todo lo que escribe va dentro de una transacción.
// =============================================================================
import {
  estadoInicial, simularLote, reconstruir, validarAnulacion, construirSistemas_, detectarAlertas,
  fijarDepositoCentral, depositoCentral, normalizarSerie, normalizarCodigo, defSistema_, cilindrosDeOT_,
  SLOTS_SIS, EST_CLI, SALDO, leerEsquemaMant, textoEsquemaMant, normalizarTipoMant, TIPOS_AJUSTE, RES_ITEM, DIAS_ANTICIPO_FILTROS_DEFECTO, co2VaACobranza_
} from './motor.js';
import { PREFIJO_OP, detalleOperacion_, textoPlanSistema_, simularLotePreparado_, lineasDeOT_ } from './carga.js';

import {
  OPCIONES_POSTGRES, BLOQUEO, hoyArgentina, fechaHora, iso, nulo, num, ErrorDeUsuario, exigirRol, insertar, contadores, anotar
} from './base.js';
import { co2Contexto, loteTocaCo2, simularCilindrosOT, co2Escribir, co2PrepararAnulacion, co2AplicarAnulacion } from './co2_estado.js';

export { OPCIONES_POSTGRES, ErrorDeUsuario, hoyArgentina };
const MAX_OPS = 50;

/* ---------------------------------------------------------------------------
 *  Maestros → contexto
 * ------------------------------------------------------------------------ */
const COLUMNA_CATEGORIA = { insumo: 'INSUMO', adicional: 'ADICIONAL', repuesto: 'REPUESTO', filtro: 'FILTRO', recambio_filtro: 'RECAMBIO_FILTRO' };

export async function contexto(sql) {
  const [config, regionesF, depositosF, plazasF, zonasF, clientesF, maquinasF, modelosF, catalogoF, reglasF, tecnicosF, sistemasF] = await Promise.all([
    sql`select clave, valor from config`,
    sql`select region_id from regiones`,
    sql`select * from depositos`,
    sql`select * from plazas`,
    sql`select * from zonas`,
    sql`select * from clientes`,
    sql`select * from maquinas`,
    sql`select * from modelos`,
    sql`select * from catalogo`,
    sql`select * from reglas_trabajo`,
    sql`select * from tecnicos`,
    sql`select * from sistemas_purificacion order by id`
  ]);
  const listas = await sql`select tipo, valor, orden from listas order by orden, valor`;
  const cfg = {};
  config.forEach((r) => { cfg[r.clave] = r.valor; });
  const conf = (k, def) => (cfg[k] === '' || cfg[k] == null ? def : String(cfg[k]));
  fijarDepositoCentral(conf('DEPOSITO_CENTRAL', 'Depósito CABA'));

  const regiones = {}, plazas = {}, zonas = {}, depositos = {}, clientes = {}, maquinas = {}, catalogo = {}, reglas = {}, modelos = {}, tecnicos = {};
  regionesF.forEach((r) => { regiones[r.region_id] = { id: r.region_id, nombre: r.region_id }; });
  depositosF.forEach((r) => {
    depositos[r.deposito_id] = { id: r.deposito_id, nombre: r.deposito_id, direccion: r.direccion, controlaStock: r.controla_stock, activo: r.activo, plaza: '', plazas: [], region: '' };
  });
  plazasF.forEach((r) => {
    plazas[r.plaza_id] = { plaza: r.plaza_id, id: r.plaza_id, nombre: r.plaza_id, region: r.region_id, deposito: r.deposito_id, provincia: r.provincia,
      tecnicos: r.responsable, responsable: r.responsable, activa: r.activa };
    const d = depositos[r.deposito_id];
    if (d) { d.plazas.push(r.plaza_id); if (!d.plaza) d.plaza = r.plaza_id; if (!d.region) d.region = r.region_id; }
  });
  zonasF.forEach((r) => { zonas[r.zona_id] = { id: r.zona_id, nombre: r.zona_id, plaza: r.plaza_id, activa: r.activa }; });
  clientesF.forEach((r) => {
    const z = zonas[r.zona_id] || null, p = z ? plazas[z.plaza] : null;
    clientes[r.cliente_id] = { id: r.cliente_id, nombre: r.nombre_fantasia || r.cliente_id, razon: r.razon_social_cuit, sector: r.sector, tipoCliente: r.tipo_cliente,
      modalidad: r.modalidad, zonaId: r.zona_id, zona: z ? z.nombre : '', plaza: p ? p.plaza : '', region: p ? p.region : '',
      esquemaMant: r.esquema_mant || '', comentarios: r.comentarios };
  });
  maquinasF.forEach((r) => { maquinas[r.serie] = { serie: r.serie, modelo: r.modelo || '', fechaAlta: iso(r.fecha_alta), depositoInicial: r.deposito_inicial_id }; });
  modelosF.forEach((r) => { modelos[r.modelo] = { modelo: r.modelo, linea: r.linea }; });
  catalogoF.forEach((r) => { catalogo[r.codigo] = { codigo: r.codigo, descripcion: r.descripcion || r.codigo, categoria: r.categoria, unidad: r.unidad, activo: r.activo }; });
  reglasF.forEach((r) => { reglas[r.tipo_ot] = Object.keys(COLUMNA_CATEGORIA).filter((c) => r[c] === true).map((c) => COLUMNA_CATEGORIA[c]); });
  tecnicosF.forEach((r) => { const p = plazas[r.plaza_id]; tecnicos[r.tecnico_id] = { id: r.tecnico_id, plaza: r.plaza_id, region: p ? p.region : '', activo: r.activo }; });
  const sis = construirSistemas_(sistemasF.map((r) => ({ sistema: r.sistema, tipo: r.tipo, codigoFiltro: r.codigo_filtro || '', codigoComponente: r.codigo_componente || '',
    componente: r.componente, rol: r.rol, unidades: r.unidades, meses: r.meses, siFalla: r.si_falla, activo: r.activo })), catalogo);
  const anticipo = conf('DIAS_ANTICIPO_FILTROS', '20');
  return {
    hoy: hoyArgentina(), regiones, plazas, zonas, depositos, clientes, maquinas, modelos, catalogo, tecnicos,
    reglas: Object.keys(reglas).length ? reglas : null, sistemas: sis.sistemas, sistemasIncompletos: sis.incompletos,
    regionesTecnicoObligatorio: conf('REGIONES_TECNICO_OBLIGATORIO', 'AMBA').split(/[,;]/).map((x) => x.trim().toUpperCase()).filter(String),
    diasRetrabajo: Number(conf('DIAS_RETRABAJO', '30')) || 30,
    esquemaMant: conf('ESQUEMA_MANTENIMIENTO', '-;-;E;-;-;P'),
    diasAviso: Number(conf('DIAS_AVISO_MANTENIMIENTO', '15')) || 15,
    diasAnticipoFiltros: anticipo !== '' && Number(anticipo) >= 0 ? Number(anticipo) : DIAS_ANTICIPO_FILTROS_DEFECTO,
    depositoCentral: depositoCentral(), config: cfg, listas
  };
}

/* ---------------------------------------------------------------------------
 *  Entidades del motor ↔ filas de la base
 * ------------------------------------------------------------------------ */
const SALDOS_CLIENTE = { COMODATO: 'comodato', ADICIONALES: 'adicionales', FALTANTE: 'faltante', DEVUELTO_DE_MAS: 'devueltoDeMas' };

function clienteVacio(id) {
  return { id, estado: EST_CLI.SIN_DATOS, serie: '', tieneOT: false, fechaInstalacion: '', fechaCambio: '', fechaDesinstalacion: '', ultimaVisita: '',
    tipoUltimaVisita: '', ultimaFechaOT: '', fechaBase: '', ultimoMantenimiento: '', mantMes: 0, tipoUltimoMant: '', pendiente: '', sistema: '', prefiltro: '',
    comodato: {}, adicionales: {}, faltante: {}, devueltoDeMas: {}, comentarioDesinstalacion: '', sis: { SISTEMA: null, PREFILTRO: null } };
}

/** Filas de un cliente (estado, ítems, sistemas y componentes) en un orden fijo, para comparar y escribir. */
function filasCliente(c) {
  const estado = { cliente_id: c.id, estado: c.estado, serie_instalada: c.serie || '', fecha_instalacion: nulo(c.fechaInstalacion), fecha_cambio: nulo(c.fechaCambio),
    fecha_desinstalacion: nulo(c.fechaDesinstalacion), fecha_base: nulo(c.fechaBase), ultimo_mantenimiento: nulo(c.ultimoMantenimiento),
    mant_mes: Number(c.mantMes) || 0, tipo_ultimo_mant: c.tipoUltimoMant || '',
    ultima_visita: nulo(c.ultimaVisita), tipo_ultima_visita: c.tipoUltimaVisita || '', fecha_ultima_ot: nulo(c.ultimaFechaOT), pendiente: c.pendiente || '',
    comentario_desinstalacion: c.comentarioDesinstalacion || '' };
  const items = [];
  Object.keys(SALDOS_CLIENTE).forEach((saldo) => {
    const mapa = c[SALDOS_CLIENTE[saldo]] || {};
    Object.keys(mapa).sort().forEach((cod) => { if (mapa[cod] > 0) items.push({ cliente_id: c.id, codigo: cod, saldo, cantidad: mapa[cod] }); });
  });
  const sistemas = [], componentes = [];
  SLOTS_SIS.forEach((slot) => {
    const s = c.sis && c.sis[slot];
    if (!s) return;
    sistemas.push({ cliente_id: c.id, slot, sistema: s.nombre, desde: nulo(s.desde) });
    Object.keys(s.partes || {}).sort().forEach((cod) => { if (s.partes[cod] > 0) componentes.push({ cliente_id: c.id, slot, codigo: cod, tipo: 'PARTE', unidades: s.partes[cod], ultimo_cambio: nulo(s.desde) }); });
    Object.keys(s.ult || {}).sort().forEach((cod) => { componentes.push({ cliente_id: c.id, slot, codigo: cod, tipo: 'ULTIMO_CAMBIO', unidades: null, ultimo_cambio: nulo(s.ult[cod]) }); });
  });
  return { estado, items, sistemas, componentes };
}

const maquinaAFila = (m) => ({ serie: m.serie, estado: m.estado, ubicacion_tipo: m.ubicTipo, ubicacion_id: m.ubicId || '', fecha_ultimo_mov: nulo(m.ultimaFecha),
  revision_abierta_id: m.ingresoAbierto || '', enviar_a_caba: !!m.paraCaba, carrito_destino_id: m.carrito || null });
const revisionAFila = (i) => ({ revision_id: i.id, serie: i.serie, deposito_id: i.deposito, fecha: i.fecha, origen_op_id: i.origen || '', falla: i.falla || '', estado: i.estado,
  resultado: i.resultado || '', fecha_cierre: nulo(i.fechaCierre), cierre_id: i.idCierre || '', diagnostico: i.diagnostico || '', tecnico: i.tecnico || '',
  cliente_id: i.idCliente || '', tipo_ot: i.tipoOT || '' });
const loteAFila = (l) => ({ lote_id: l.id, deposito_id: l.deposito, codigo: l.codigo, cantidad: l.cantidad, fecha: l.fecha, cliente_id: l.idCliente || '', tipo_ot: l.tipoOT || '', op_id: l.origen || '' });
const stockAFila = (dep, cod, s) => ({ deposito_id: dep, codigo: cod, disponible: s.DISPONIBLE, a_revisar: s.A_REVISAR, para_caba: s.PARA_CABA, reservado: s.RESERVADO || 0 });
/** Carrito de envío (v2.2): cabecera y líneas en un orden fijo (las máquinas van en maquinas_estado.carrito_destino_id). */
const carritoAFila = (c) => ({ origen_deposito_id: c.origen, destino_deposito_id: c.destino, desde: c.desde,
  lineas: Object.keys(c.lineas).sort().filter((k) => c.lineas[k].cantidad > 0).map((k) => ({ origen_deposito_id: c.origen, destino_deposito_id: c.destino, codigo: c.lineas[k].codigo,
    desde_saldo: c.lineas[k].desde, cantidad: c.lineas[k].cantidad })) });
async function escribirCarrito(sql, f) {
  await sql`insert into envio_carritos ${sql({ origen_deposito_id: f.origen_deposito_id, destino_deposito_id: f.destino_deposito_id, desde: f.desde })}
    on conflict (origen_deposito_id, destino_deposito_id) do update set desde = excluded.desde`;
  await sql`delete from envio_carrito_lineas where origen_deposito_id = ${f.origen_deposito_id} and destino_deposito_id = ${f.destino_deposito_id}`;
  if (f.lineas.length) await insertar(sql, 'envio_carrito_lineas', f.lineas);
}
const envioAFila = (e) => ({ envio_id: e.id, estado: e.estado, fecha_recepcion: nulo(e.fechaRecepcion), recepcion_id: e.idRecepcion || '' });

/** Arma los clientes de W a partir de sus filas. */
function clientesDesdeFilas(W, f) {
  const cli = (id) => W.clientes[id] || (W.clientes[id] = clienteVacio(id));
  f.estado.forEach((r) => {
    const c = W.clientes[r.cliente_id] = clienteVacio(r.cliente_id);
    c.estado = r.estado; c.serie = r.serie_instalada; c.fechaInstalacion = iso(r.fecha_instalacion); c.fechaCambio = iso(r.fecha_cambio);
    c.fechaDesinstalacion = iso(r.fecha_desinstalacion); c.fechaBase = iso(r.fecha_base); c.ultimoMantenimiento = iso(r.ultimo_mantenimiento);
    c.mantMes = Number(r.mant_mes) || 0; c.tipoUltimoMant = r.tipo_ultimo_mant || '';
    c.ultimaVisita = iso(r.ultima_visita); c.tipoUltimaVisita = r.tipo_ultima_visita; c.ultimaFechaOT = iso(r.fecha_ultima_ot);
    c.tieneOT = !!c.ultimaFechaOT; c.pendiente = r.pendiente; c.comentarioDesinstalacion = r.comentario_desinstalacion;
  });
  f.items.forEach((r) => { const k = SALDOS_CLIENTE[r.saldo]; if (k && num(r.cantidad) > 0) cli(r.cliente_id)[k][r.codigo] = num(r.cantidad); });
  f.sistemas.forEach((r) => {
    const c = cli(r.cliente_id);
    c.sis[r.slot] = { nombre: r.sistema, desde: iso(r.desde), partes: {}, ult: {} };
    if (r.slot === 'SISTEMA') c.sistema = r.sistema; else c.prefiltro = r.sistema;
  });
  f.componentes.forEach((r) => {
    const s = W.clientes[r.cliente_id] && W.clientes[r.cliente_id].sis[r.slot];
    if (!s) return;
    if (r.tipo === 'PARTE') { if (num(r.unidades) > 0) s.partes[r.codigo] = num(r.unidades); }
    else s.ult[r.codigo] = iso(r.ultimo_cambio);
  });
}

/**
 * Lee las tablas de estado y arma W, más una foto de cada entidad para saber después qué cambió.
 * clientes: lista de IDs a leer, o null para todos. talleres: 'ABIERTOS' o 'TODOS'.
 */
export async function cargarEstado(sql, ctx, { clientes = null, talleres = 'ABIERTOS', codigos = [] } = {}) {
  const W = estadoInicial(ctx);
  W.kardex = []; W.lineaDisp = {}; W.movStock = [];
  const ids = clientes == null ? null : [...new Set(clientes.filter(Boolean))];
  const porCliente = (t) => (ids == null ? sql`select * from ${sql(t)}` : ids.length ? sql`select * from ${sql(t)} where cliente_id = any(${ids})` : Promise.resolve([]));
  const cods = [...new Set(codigos.filter(Boolean))];
  const [maq, env, envL, ce, ci, cs, cc, st, lo, ta, taL, mov, car, carL] = await Promise.all([
    sql`select * from maquinas_estado`,
    sql`select * from envios where estado = 'EN_TRANSITO'`,
    sql`select l.* from envio_lineas l join envios e using (envio_id) where e.estado = 'EN_TRANSITO' order by l.linea_id`,
    porCliente('clientes_estado'), porCliente('clientes_items'), porCliente('clientes_sistemas'), porCliente('clientes_componentes'),
    sql`select * from stock`,
    sql`select * from lotes_revision`,
    talleres === 'TODOS' ? sql`select * from taller` : sql`select * from taller where estado = 'ABIERTO'`,
    talleres === 'TODOS' ? sql`select * from taller_lineas order by linea_id` : sql`select l.* from taller_lineas l join taller t using (revision_id) where t.estado = 'ABIERTO' order by l.linea_id`,
    cods.length ? sql`select fecha, deposito_id, codigo, disponible from movimientos_stock where codigo = any(${cods}) and disponible <> 0 order by orden` : Promise.resolve([]),
    sql`select * from envio_carritos`,
    sql`select * from envio_carrito_lineas`
  ]);
  maq.forEach((r) => {
    W.maquinas[r.serie] = { serie: r.serie, estado: r.estado, ubicTipo: r.ubicacion_tipo, ubicId: r.ubicacion_id, ultimaFecha: iso(r.fecha_ultimo_mov),
      ingresoAbierto: r.revision_abierta_id, paraCaba: r.enviar_a_caba === true, carrito: r.carrito_destino_id || '' };
  });
  car.forEach((r) => { W.carritos[r.origen_deposito_id + '|' + r.destino_deposito_id] = { origen: r.origen_deposito_id, destino: r.destino_deposito_id, desde: iso(r.desde), lineas: {}, series: [] }; });
  carL.forEach((r) => { const c = W.carritos[r.origen_deposito_id + '|' + r.destino_deposito_id]; if (c) c.lineas[r.codigo + '|' + r.desde_saldo] = { codigo: r.codigo, desde: r.desde_saldo, cantidad: num(r.cantidad) }; });
  maq.slice().sort((a, b) => (a.serie < b.serie ? -1 : 1)).forEach((r) => { const c = r.carrito_destino_id && W.carritos[r.ubicacion_id + '|' + r.carrito_destino_id]; if (c) c.series.push(r.serie); });
  env.forEach((e) => {
    const ls = envL.filter((l) => l.envio_id === e.envio_id);
    W.envios[e.envio_id] = { id: e.envio_id, fecha: iso(e.fecha), origen: e.origen_deposito_id, destino: e.destino_deposito_id, estado: e.estado,
      fechaRecepcion: iso(e.fecha_recepcion), idRecepcion: e.recepcion_id,
      series: ls.filter((l) => l.serie).map((l) => l.serie),
      lineas: ls.filter((l) => !l.serie).map((l) => ({ codigo: l.codigo, cantidad: num(l.cantidad), desde: l.desde_saldo || SALDO.DISPONIBLE })) };
  });
  clientesDesdeFilas(W, { estado: ce, items: ci, sistemas: cs, componentes: cc });
  st.forEach((r) => { (W.stock[r.deposito_id] = W.stock[r.deposito_id] || {})[r.codigo] = { DISPONIBLE: num(r.disponible), A_REVISAR: num(r.a_revisar), PARA_CABA: num(r.para_caba), RESERVADO: num(r.reservado) }; });
  lo.forEach((r) => { if (num(r.cantidad) > 0) W.lotes[r.lote_id] = { id: r.lote_id, deposito: r.deposito_id, codigo: r.codigo, cantidad: num(r.cantidad), fecha: iso(r.fecha), idCliente: r.cliente_id, tipoOT: r.tipo_ot, origen: r.op_id }; });
  const itemsRev = {};
  taL.forEach((r) => { (itemsRev[r.revision_id] = itemsRev[r.revision_id] || []).push({ codigo: r.codigo, cantidad: num(r.cantidad) }); });
  const nItemsRevision = {};
  ta.forEach((r) => {
    W.ingresos[r.revision_id] = { id: r.revision_id, serie: r.serie, deposito: r.deposito_id, fecha: iso(r.fecha), origen: r.origen_op_id, falla: r.falla, estado: r.estado,
      resultado: r.resultado, fechaCierre: iso(r.fecha_cierre), idCierre: r.cierre_id, diagnostico: r.diagnostico, tecnico: r.tecnico, idCliente: r.cliente_id, tipoOT: r.tipo_ot,
      items: itemsRev[r.revision_id] || [] };
    nItemsRevision[r.revision_id] = (itemsRev[r.revision_id] || []).length;
  });
  mov.forEach((r) => { const k = r.deposito_id + '|' + r.codigo; (W.lineaDisp[k] = W.lineaDisp[k] || []).push([iso(r.fecha), num(r.disponible)]); });

  const foto = { clientes: {}, maquinas: {}, stock: {}, lotes: {}, revisiones: {}, envios: {}, carritos: {} };
  Object.keys(W.carritos).forEach((k) => { foto.carritos[k] = JSON.stringify(carritoAFila(W.carritos[k])); });
  Object.keys(W.clientes).forEach((id) => { foto.clientes[id] = JSON.stringify(filasCliente(W.clientes[id])); });
  Object.keys(W.maquinas).forEach((s) => { foto.maquinas[s] = maq.some((r) => r.serie === s) ? JSON.stringify(maquinaAFila(W.maquinas[s])) : ''; });
  Object.keys(W.stock).forEach((d) => Object.keys(W.stock[d]).forEach((c) => { foto.stock[d + '|' + c] = JSON.stringify(W.stock[d][c]); }));
  Object.keys(W.lotes).forEach((id) => { foto.lotes[id] = JSON.stringify(loteAFila(W.lotes[id])); });
  Object.keys(W.ingresos).forEach((id) => { foto.revisiones[id] = JSON.stringify(revisionAFila(W.ingresos[id])); });
  Object.keys(W.envios).forEach((id) => { foto.envios[id] = JSON.stringify(envioAFila(W.envios[id])); });
  return { W, foto, nItemsRevision };
}

/** Códigos de ítems que mueve un lote (para traer solo esos movimientos del disponible). */
function codigosDelLote(ops, ctx) {
  const cods = [];
  (ops || []).forEach((op) => {
    const d = op.datos || {};
    (d.items || []).forEach((l) => { cods.push(normalizarCodigo(l.codigo)); if (l.codigoRetirado) cods.push(normalizarCodigo(l.codigoRetirado)); });
    if (d.codigo) cods.push(normalizarCodigo(d.codigo));
    (d.consumos || []).forEach((l) => cods.push(normalizarCodigo(l.codigo)));
    ['sistema', 'prefiltro'].forEach((k) => { const def = d[k] && defSistema_(ctx, d[k]); if (def) def.partes.forEach((x) => cods.push(x.codigo)); });
  });
  return cods;
}

/* ---------------------------------------------------------------------------
 *  Escritura
 * ------------------------------------------------------------------------ */

/** Movimientos de stock (kárdex) e ingresos/salidas nuevos, con identificador estable: operación + número. */
function filasMovimientos(W) {
  const nK = {}, nIS = {};
  const kardex = (W.kardex || []).map((x) => {
    nK[x.op] = (nK[x.op] || 0) + 1;
    return { movimiento_id: x.op + '-' + nK[x.op], fecha: x.f, deposito_id: x.dep, codigo: x.cod, movimiento: x.mov, disponible: x.d.DISPONIBLE || 0,
      a_revisar: x.d.A_REVISAR || 0, para_caba: x.d.PARA_CABA || 0, reservado: x.d.RESERVADO || 0, cliente_id: x.cli || '', serie: x.serie || '', op_id: x.op || '', detalle: x.det || '' };
  });
  const is = (W.movStock || []).map((x) => {
    nIS[x.origen] = (nIS[x.origen] || 0) + 1;
    return { movimiento_id: x.origen + '-IS' + nIS[x.origen], fecha: x.fecha, deposito_id: x.deposito, codigo: x.codigo, sentido: x.sentido, tipo: x.tipo,
      cantidad: x.cantidad, cliente_id: x.idCliente || '', serie: x.serie || '', op_id: x.origen || '', detalle: x.detalle || '' };
  });
  return { kardex, is };
}

async function escribirCliente(sql, f, reemplazar) {
  await sql`insert into clientes_estado ${sql(f.estado)} on conflict (cliente_id) do update set
    estado = excluded.estado, serie_instalada = excluded.serie_instalada, fecha_instalacion = excluded.fecha_instalacion, fecha_cambio = excluded.fecha_cambio,
    fecha_desinstalacion = excluded.fecha_desinstalacion, fecha_base = excluded.fecha_base, ultimo_mantenimiento = excluded.ultimo_mantenimiento,
    mant_mes = excluded.mant_mes, tipo_ultimo_mant = excluded.tipo_ultimo_mant,
    ultima_visita = excluded.ultima_visita, tipo_ultima_visita = excluded.tipo_ultima_visita, fecha_ultima_ot = excluded.fecha_ultima_ot,
    pendiente = excluded.pendiente, comentario_desinstalacion = excluded.comentario_desinstalacion, updated_at = now()`;
  if (reemplazar) {
    const id = f.estado.cliente_id;
    await sql`delete from clientes_items where cliente_id = ${id}`;
    await sql`delete from clientes_sistemas where cliente_id = ${id}`;
    await sql`delete from clientes_componentes where cliente_id = ${id}`;
  }
  if (f.items.length) await insertar(sql, 'clientes_items', f.items);
  if (f.sistemas.length) await insertar(sql, 'clientes_sistemas', f.sistemas);
  if (f.componentes.length) await insertar(sql, 'clientes_componentes', f.componentes);
}

async function upsertMaquinas(sql, filas) {
  for (let i = 0; i < filas.length; i += 500) {
    await sql`insert into maquinas_estado ${sql(filas.slice(i, i + 500))} on conflict (serie) do update set estado = excluded.estado,
      ubicacion_tipo = excluded.ubicacion_tipo, ubicacion_id = excluded.ubicacion_id, fecha_ultimo_mov = excluded.fecha_ultimo_mov,
      revision_abierta_id = excluded.revision_abierta_id, enviar_a_caba = excluded.enviar_a_caba, carrito_destino_id = excluded.carrito_destino_id, updated_at = now()`;
  }
}

/** Escribe solo las entidades que cambiaron respecto de la foto, más los movimientos nuevos. */
async function persistirCambios(sql, ctx, base, W) {
  for (const id of Object.keys(W.clientes)) {
    if (!ctx.clientes[id]) continue;
    const f = filasCliente(W.clientes[id]);
    if (base.foto.clientes[id] === JSON.stringify(f)) continue;
    await escribirCliente(sql, f, true);
  }
  const maq = Object.keys(W.maquinas).map((s) => maquinaAFila(W.maquinas[s])).filter((f) => base.foto.maquinas[f.serie] !== JSON.stringify(f));
  if (maq.length) await upsertMaquinas(sql, maq);
  const stock = [];
  Object.keys(W.stock).forEach((d) => Object.keys(W.stock[d]).forEach((c) => { if (base.foto.stock[d + '|' + c] !== JSON.stringify(W.stock[d][c])) stock.push(stockAFila(d, c, W.stock[d][c])); }));
  if (stock.length) {
    await sql`insert into stock ${sql(stock)} on conflict (deposito_id, codigo) do update set disponible = excluded.disponible, a_revisar = excluded.a_revisar,
      para_caba = excluded.para_caba, reservado = excluded.reservado, updated_at = now()`;
  }
  // Carritos (después de las máquinas: comparten el depósito de destino).
  for (const k of new Set(Object.keys(W.carritos || {}).concat(Object.keys(base.foto.carritos)))) {
    const c = (W.carritos || {})[k];
    if (!c) { const [o, d] = k.split('|'); await sql`delete from envio_carritos where origen_deposito_id = ${o} and destino_deposito_id = ${d}`; continue; }
    const f = carritoAFila(c);
    if (base.foto.carritos[k] !== JSON.stringify(f)) await escribirCarrito(sql, f);
  }
  const lotes = Object.keys(W.lotes).map((id) => loteAFila(W.lotes[id])).filter((f) => f.cantidad > 0 && base.foto.lotes[f.lote_id] !== JSON.stringify(f));
  if (lotes.length) await sql`insert into lotes_revision ${sql(lotes)} on conflict (lote_id) do update set cantidad = excluded.cantidad`;
  const sinLote = Object.keys(base.foto.lotes).filter((id) => !W.lotes[id] || !(W.lotes[id].cantidad > 0));
  if (sinLote.length) await sql`delete from lotes_revision where lote_id = any(${sinLote})`;
  for (const id of Object.keys(W.ingresos)) {
    const i = W.ingresos[id], f = revisionAFila(i);
    if (base.foto.revisiones[id] !== JSON.stringify(f)) {
      await sql`insert into taller ${sql(f)} on conflict (revision_id) do update set falla = excluded.falla, estado = excluded.estado, resultado = excluded.resultado,
        fecha_cierre = excluded.fecha_cierre, cierre_id = excluded.cierre_id, diagnostico = excluded.diagnostico, tecnico = excluded.tecnico`;
    }
    const desde = base.nItemsRevision[id] || 0;
    const nuevas = (i.items || []).slice(desde).map((x, j) => ({ linea_id: id + '-' + (desde + j + 1), revision_id: id, op_id: i.idCierre || '', codigo: x.codigo, cantidad: x.cantidad }));
    if (nuevas.length) await insertar(sql, 'taller_lineas', nuevas);
  }
  for (const id of Object.keys(base.foto.envios)) {
    const e = W.envios[id];
    if (!e) continue;
    const f = envioAFila(e);
    if (base.foto.envios[id] !== JSON.stringify(f)) await sql`update envios set estado = ${f.estado}, fecha_recepcion = ${f.fecha_recepcion}, recepcion_id = ${f.recepcion_id} where envio_id = ${id}`;
  }
  const m = filasMovimientos(W);
  if (m.kardex.length) await insertar(sql, 'movimientos_stock', m.kardex);
  if (m.is.length) await insertar(sql, 'ingresos_salidas', m.is);
}

/** Reescribe todas las tablas de estado con un W reconstruido desde el registro de operaciones. */
async function escribirEstadoCompleto(sql, ctx, W) {
  await sql`delete from clientes_componentes`;
  await sql`delete from clientes_sistemas`;
  await sql`delete from clientes_items`;
  await sql`delete from clientes_estado`;
  await sql`delete from stock`;
  await sql`delete from lotes_revision`;
  await sql`delete from taller`; // taller_lineas se borran en cascada
  await sql`delete from envio_carritos`; // y sus líneas
  await sql`delete from movimientos_stock`;
  await sql`delete from ingresos_salidas`;
  const estado = [], items = [], sistemas = [], componentes = [];
  Object.keys(W.clientes).sort().forEach((id) => {
    if (!ctx.clientes[id]) return;
    const f = filasCliente(W.clientes[id]);
    estado.push(f.estado); items.push(...f.items); sistemas.push(...f.sistemas); componentes.push(...f.componentes);
  });
  await insertar(sql, 'clientes_estado', estado);
  await insertar(sql, 'clientes_items', items);
  await insertar(sql, 'clientes_sistemas', sistemas);
  await insertar(sql, 'clientes_componentes', componentes);
  await upsertMaquinas(sql, Object.keys(W.maquinas).sort().map((s) => maquinaAFila(W.maquinas[s])));
  const stock = [];
  Object.keys(W.stock).sort().forEach((d) => Object.keys(W.stock[d]).sort().forEach((c) => stock.push(stockAFila(d, c, W.stock[d][c]))));
  await insertar(sql, 'stock', stock);
  for (const k of Object.keys(W.carritos || {}).sort()) await escribirCarrito(sql, carritoAFila(W.carritos[k]));
  await insertar(sql, 'lotes_revision', Object.keys(W.lotes).sort().map((id) => loteAFila(W.lotes[id])).filter((f) => f.cantidad > 0));
  const taller = [], tallerL = [];
  Object.keys(W.ingresos).sort().forEach((id) => {
    const i = W.ingresos[id];
    taller.push(revisionAFila(i));
    (i.items || []).forEach((x, j) => tallerL.push({ linea_id: id + '-' + (j + 1), revision_id: id, op_id: i.idCierre || '', codigo: x.codigo, cantidad: x.cantidad }));
  });
  await insertar(sql, 'taller', taller);
  await insertar(sql, 'taller_lineas', tallerL);
  const m = filasMovimientos(W);
  await insertar(sql, 'movimientos_stock', m.kardex);
  await insertar(sql, 'ingresos_salidas', m.is);
  // Envíos: estado y recepción según el registro (los anulados quedan como están).
  const envios = await sql`select envio_id, estado, fecha_recepcion, recepcion_id from envios where estado <> 'ANULADO'`;
  for (const r of envios) {
    const e = W.envios[r.envio_id];
    if (!e) continue;
    const f = envioAFila(e);
    if (r.estado !== f.estado || iso(r.fecha_recepcion) !== iso(f.fecha_recepcion) || r.recepcion_id !== f.recepcion_id) {
      await sql`update envios set estado = ${f.estado}, fecha_recepcion = ${f.fecha_recepcion}, recepcion_id = ${f.recepcion_id} where envio_id = ${r.envio_id}`;
    }
  }
}

/* ---------------------------------------------------------------------------
 *  Servicios
 * ------------------------------------------------------------------------ */

/** Usuario habilitado a partir del email del login. */
export async function usuarioPorEmail(sql, email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) throw new ErrorDeUsuario('No se pudo identificar tu cuenta.');
  const [u] = await sql`select email, nombre, rol from usuarios where email = ${e} and activo`;
  if (!u) throw new ErrorDeUsuario('La cuenta ' + e + ' no está habilitada. Pedile a un administrador que la agregue en Datos → Usuarios.');
  return { email: u.email, nombre: u.nombre || u.email, rol: u.rol };
}

function validarPedido(usuario, ops) {
  if (!Array.isArray(ops) || !ops.length) throw new ErrorDeUsuario('No hay operaciones para guardar.');
  if (ops.length > MAX_OPS) throw new ErrorDeUsuario('Máximo ' + MAX_OPS + ' operaciones por envío.');
  exigirRol(usuario, ops.some((o) => o && o.clase === 'AJUSTE') ? ['ADMIN'] : ['ADMIN', 'CARGA']); // los ajustes de stock son solo de administradores
  return JSON.parse(JSON.stringify(ops)).map((o) => ({ clase: String((o && o.clase) || ''), datos: (o && o.datos) || {} }));
}

async function prepararContexto(sql, ops) {
  const ctx = await contexto(sql);
  const idsCliente = ops.map((o) => (o.datos && (o.datos.idCliente || (o.datos.clienteNuevo && o.datos.clienteNuevo.id))) || '').map((x) => String(x).trim());
  const base = await cargarEstado(sql, ctx, { clientes: idsCliente, codigos: codigosDelLote(ops, ctx) });
  ctx.estado = base.W;
  // Cilindros de CO₂ en las OT: se validan con el motor de CO₂ en el mismo lote.
  if (loteTocaCo2(ops)) {
    const cctx = await co2Contexto(sql);
    ctx.simularCilindros = (o, s, c) => simularCilindrosOT(o, s, c, cctx);
  }
  return { ctx, base };
}

const resumen = (p) => p.porOriginal.map((r) => ({ id: r.id, clase: r.clase, errores: r.errores, advertencias: r.advertencias }));

/** Valida un lote sin guardar nada. */
export async function validarLote(sql, usuario, opsPedido) {
  const ops = validarPedido(usuario, opsPedido);
  const { ctx } = await prepararContexto(sql, ops);
  const p = simularLotePreparado_(ops, ctx);
  return { ok: p.sim.ok, resultados: resumen(p).map(({ id, ...r }) => r) };
}

/**
 * Guarda un lote (único camino de escritura de operaciones): bajo bloqueo, lee el estado, valida con el motor y
 * escribe todo o nada. Si hay advertencias sin aceptar, no guarda y las devuelve para confirmar.
 */
export async function guardarLote(sql, usuario, opsPedido, aceptarAdvertencias) {
  const opsIn = validarPedido(usuario, opsPedido);
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BLOQUEO})`;
    const { ctx, base } = await prepararContexto(tx, opsIn);
    const C = await contadores(tx);
    const prep = simularLotePreparado_(opsIn, ctx, (op) => C.siguiente(PREFIJO_OP[op.clase] || 'OP'));
    const sim = prep.sim, ops = prep.ops, res = resumen(prep);
    if (!sim.ok) return { ok: false, resultados: res, mensaje: 'Hay errores: no se guardó nada.' };
    if (!aceptarAdvertencias && sim.resultados.some((r) => r.advertencias.length)) {
      return { ok: false, requiereConfirmacion: true, resultados: res, mensaje: 'Revisá las advertencias y confirmá de nuevo.' };
    }
    const W = sim.estado;
    const reg = { operaciones: [], ot: [], ot_lineas: [], envios: [], envio_lineas: [], ajustes_stock: [], revision_lineas: [] };
    const clientesNuevos = [];
    const regionDeDep = (dep) => (ctx.depositos[dep] && ctx.depositos[dep].region) || null;
    sim.resultados.forEach((r, i) => {
      const op = ops[i], d = op.datos, ef = r.efectos || {}, id = op.id;
      const region = op.clase === 'OT' ? (ctx.clientes[ef.idCliente] || {}).region || null : op.clase === 'ENVIO' || op.clase === 'RECEPCION' ? null : regionDeDep(ef.deposito);
      reg.operaciones.push({ op_id: id, clase: op.clase, fecha: d.fecha, region_id: region, detalle: detalleOperacion_(op, ctx), estado: 'VIGENTE', datos: tx.json(d), created_by: usuario.email });
      if (op.clase === 'OT') {
        if (d.clienteNuevo) {
          const cn = d.clienteNuevo;
          clientesNuevos.push({ cliente_id: cn.id, nombre_fantasia: String(cn.nombre || '').trim(), razon_social_cuit: String(cn.razon || '').trim(), sector: String(cn.sector || '').trim(),
            tipo_cliente: String(cn.tipoCliente || '').trim(), modalidad: String(cn.modalidad || '').trim(), zona_id: String(cn.zonaId || '').trim(),
            esquema_mant: leerEsquemaMant(cn.esquemaMant) ? textoEsquemaMant(leerEsquemaMant(cn.esquemaMant)) : '', comentarios: String(cn.comentarios || '').trim() });
        }
        const cm = ctx.clientes[ef.idCliente];
        reg.ot.push({ ot_id: id, fecha: d.fecha, cliente_id: ef.idCliente, zona_id: cm.zonaId, tipo: ef.tipo, tecnico: d.tecnico || '', tecnico_2: d.tecnico2 || '',
          serie_retirada: ef.serieOut || '', serie_instalada: ef.serieIn || '', falla: d.falla || '',
          sistema: textoPlanSistema_(ef.plan, 'SISTEMA', d.sistema, ctx), prefiltro: textoPlanSistema_(ef.plan, 'PREFILTRO', d.prefiltro, ctx),
          comentarios: d.comentarios || '', pendiente: d.pendiente || '', ot_persat: d.nOtPersat || '', modalidad_co2: d.modalidadCo2 || '',
          tipo_mantenimiento: ef.tipo === 'MANTENIMIENTO' ? normalizarTipoMant(d.tipoMant) || 'PROFUNDO' : '',
          // La entrega de CO₂ de emergencia queda marcada como emergencia (el resto se marca en Seguimiento de OT).
          emergencia: ef.tipo === 'ENTREGA_CO2' && /^EMERGENCIA/.test(String(d.modalidadCo2 || '').toUpperCase()), estado: 'VIGENTE', created_by: usuario.email });
        const lineas = lineasDeOT_(id, ef, d, ctx);
        // Cilindros de CO₂: una línea por movimiento (código CO2); las series quedan en co2_trabajo_lineas (trabajo = esta OT).
        const cil = cilindrosDeOT_(d), cob = co2VaACobranza_(ef.tipo, String(d.modalidadCo2 || '').toUpperCase());
        [['ENTREGADO', cil.entregadas, cob], ['RETIRADO', cil.retiradas, false]].forEach((g) => {
          if (!g[1].length) return;
          lineas.push({ linea_id: id + '-' + (lineas.length + 1), ot_id: id, cliente_id: ef.idCliente, fecha: d.fecha, codigo: 'CO2', cantidad: g[1].length, movimiento: g[0],
            codigo_retirado: '', saldo: '', cobranza: g[2], dto: '', facturado: '' });
        });
        reg.ot_lineas.push(...lineas);
      } else if (op.clase === 'REVISION_ITEMS') {
        let n = 0;
        ef.lineas.forEach((l) => {
          const o = l.origenLote || {};
          reg.revision_lineas.push({ linea_id: id + '-' + (++n), revision_id: id, fecha: d.fecha, deposito_id: ef.deposito, codigo: l.codigo, cantidad: l.cantidad,
            resultado: l.resultado === RES_ITEM.DISPONIBLE ? 'DISPONIBLE' : l.resultado === RES_ITEM.DESCARTE ? 'DESCARTE' : 'ENVIAR_CABA', lote_id: l.lote || '', cliente_id: o.idCliente || '', origen: o.origen || '' });
        });
        (ef.consumos || []).forEach((l) => {
          reg.revision_lineas.push({ linea_id: id + '-' + (++n), revision_id: id, fecha: d.fecha, deposito_id: ef.deposito, codigo: l.codigo, cantidad: l.cantidad,
            resultado: 'REACONDICIONAMIENTO', lote_id: '', cliente_id: '', origen: '' });
        });
      } else if (op.clase === 'ENVIO') {
        const e = W.envios[id] || {};
        reg.envios.push({ envio_id: id, fecha: d.fecha, origen_deposito_id: ef.origen, destino_deposito_id: ef.destino, transporte: d.transporte || '', guia: d.guia || '',
          estado: e.estado || 'EN_TRANSITO', fecha_recepcion: nulo(e.fechaRecepcion), recepcion_id: e.idRecepcion || '', comentarios: d.comentarios || '', created_by: usuario.email });
        let k = 0;
        ef.series.forEach((s) => reg.envio_lineas.push({ linea_id: id + '-' + (++k), envio_id: id, codigo: null, serie: s, cantidad: 1, desde_saldo: 'DISPONIBLE' }));
        ef.lineas.forEach((l) => reg.envio_lineas.push({ linea_id: id + '-' + (++k), envio_id: id, codigo: l.codigo, serie: null, cantidad: l.cantidad, desde_saldo: l.desde }));
      } else if (op.clase === 'AJUSTE') {
        reg.ajustes_stock.push({ ajuste_id: id, fecha: d.fecha, deposito_id: ef.deposito, codigo: ef.codigo, cantidad: ef.cantidad, saldo: ef.saldo, tipo: ef.tipo || '',
          motivo: d.motivo || '', generada_por: d.generadaPor || '', created_by: usuario.email });
      }
      // INGRESO, CIERRE, REPARACION_DEPOSITO y RECEPCION solo cambian estado (taller, máquinas, envíos).
    });

    // Altas en los maestros primero, después el registro de operaciones (fuente de verdad), los registros de detalle y el estado.
    await insertar(tx, 'clientes', clientesNuevos);
    await insertar(tx, 'maquinas', prep.prep.maquinasNuevas);
    await insertar(tx, 'operaciones', reg.operaciones);
    for (const t of ['ot', 'ot_lineas', 'envios', 'envio_lineas', 'ajustes_stock', 'revision_lineas']) await insertar(tx, t, reg[t]);
    await persistirCambios(tx, ctx, base, W);
    // Los cilindros de las OT, con el número de la OT como trabajo de CO₂.
    if (prep.co2 && prep.co2.ops.length) {
      await co2Escribir(tx, prep.co2.ops, prep.co2.sim, prep.co2.ctx, usuario, { C, refIds: prep.co2.idx.map((k) => ops[k].id) });
    }
    await C.guardar();
    const ids = ops.map((o) => o.id);
    await tx`insert into log (usuario, accion, detalle, resultado) values (${usuario.email}, 'GUARDAR', ${ids.join(', ')}, 'OK')`;
    return { ok: true, resultados: res, ids, mensaje: 'Se guardó: ' + ids.join(', ') + '.' };
  });
}

/** Operaciones vigentes de todo el sistema, en el orden en que se cargaron. */
async function operacionesVigentes(sql) {
  const filas = await sql`select op_id, clase, datos from operaciones where estado = 'VIGENTE' order by orden`;
  return filas.map((r) => ({ id: r.op_id, clase: r.clase, datos: r.datos || {} }));
}

/** Anula una operación (y sus automáticas), solo si ninguna posterior depende de ella. Después rearma el estado. */
export async function anularOperacion(sql, usuario, idOp, motivo) {
  exigirRol(usuario, ['ADMIN']);
  const id = String(idOp || '').trim();
  if (!motivo || String(motivo).trim().length < 5) throw new ErrorDeUsuario('Indicá el motivo de la anulación.');
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BLOQUEO})`;
    const ctx = await contexto(tx);
    const ops = await operacionesVigentes(tx);
    const op = ops.find((o) => o.id === id);
    if (!op) return { ok: false, errores: [{ codigo: 'OPERACION_INEXISTENTE', mensaje: 'No hay una operación vigente ' + id + '.' }] };
    if (op.datos.generadaPor) {
      return { ok: false, errores: [{ codigo: 'OPERACION_AUTOMATICA', mensaje: id + ' se generó con ' + op.datos.generadaPor + ': se anula junto con ella (anulá ' + op.datos.generadaPor + ').' }] };
    }
    const ids = [id].concat(op.datos.operacionesAuto || []).filter((x) => ops.some((o) => o.id === x));
    const v = validarAnulacion(ids, ops, ctx);
    if (!v.ok) return { ok: false, errores: v.errores };
    // Si la OT tiene cilindros, su trabajo de CO₂ se anula junto con ella (solo si no hay movimientos posteriores de esas series).
    const co2Anular = [];
    for (const o of ops.filter((x) => ids.indexOf(x.id) >= 0 && x.clase === 'OT')) {
      const cil = cilindrosDeOT_(o.datos);
      if (!cil.entregadas.length && !cil.retiradas.length) continue;
      const p = await co2PrepararAnulacion(tx, o.id);
      if (p.propios.length) co2Anular.push({ id: o.id, prep: p });
    }
    const erroresCo2 = co2Anular.flatMap((x) => x.prep.v.errores.map((e) => ({ codigo: e.codigo, mensaje: 'CO₂: ' + e.mensaje })));
    if (erroresCo2.length) return { ok: false, errores: erroresCo2 };
    const nota = 'Anulada por ' + usuario.email + ' el ' + fechaHora() + '. Motivo: ' + String(motivo).trim() + (ids.length > 1 ? ' (junto con ' + ids.join(', ') + ')' : '');
    await tx`update operaciones set estado = 'ANULADA', anulacion = ${nota} where op_id = any(${ids})`;
    await tx`update ot set estado = 'ANULADA' where ot_id = any(${ids})`;
    await tx`update envios set estado = 'ANULADO' where envio_id = any(${ids})`;
    await tx`update ajustes_stock set estado = 'ANULADA' where ajuste_id = any(${ids})`;
    await escribirEstadoCompleto(tx, ctx, v.estado);
    for (const x of co2Anular) await co2AplicarAnulacion(tx, x.id, motivo, usuario, x.prep);
    await tx`insert into log (usuario, accion, detalle, resultado) values (${usuario.email}, 'ANULAR', ${ids.join(', ') + ' — ' + String(motivo).trim()}, 'OK')`;
    return { ok: true, ids, mensaje: 'Se anuló ' + ids.join(', ') + '.' };
  });
}

/** Todas las filas de estado de un W, por tabla y clave, para comparar. */
function filasPorTabla(ctx, W) {
  const t = { clientes_estado: {}, clientes_items: {}, clientes_sistemas: {}, clientes_componentes: {}, maquinas_estado: {}, stock: {}, lotes_revision: {}, taller: {}, envio_carritos: {} };
  Object.keys(W.carritos || {}).forEach((k) => { t.envio_carritos[k] = JSON.stringify(carritoAFila(W.carritos[k])); });
  Object.keys(W.clientes).forEach((id) => {
    if (!ctx.clientes[id]) return;
    const f = filasCliente(W.clientes[id]);
    if (f.estado.estado !== EST_CLI.SIN_DATOS || f.items.length || f.sistemas.length) t.clientes_estado[id] = JSON.stringify(f.estado);
    f.items.forEach((x) => { t.clientes_items[x.cliente_id + '|' + x.saldo + '|' + x.codigo] = JSON.stringify(x); });
    f.sistemas.forEach((x) => { t.clientes_sistemas[x.cliente_id + '|' + x.slot] = JSON.stringify(x); });
    f.componentes.forEach((x) => { t.clientes_componentes[x.cliente_id + '|' + x.slot + '|' + x.codigo + '|' + x.tipo] = JSON.stringify(x); });
  });
  Object.keys(W.maquinas).forEach((s) => { t.maquinas_estado[s] = JSON.stringify(maquinaAFila(W.maquinas[s])); });
  Object.keys(W.stock).forEach((d) => Object.keys(W.stock[d]).forEach((c) => { t.stock[d + '|' + c] = JSON.stringify(stockAFila(d, c, W.stock[d][c])); }));
  Object.keys(W.lotes).forEach((id) => { if (W.lotes[id].cantidad > 0) t.lotes_revision[id] = JSON.stringify(loteAFila(W.lotes[id])); });
  Object.keys(W.ingresos).forEach((id) => { t.taller[id] = JSON.stringify(revisionAFila(W.ingresos[id])); });
  return t;
}

/**
 * Auditoría: rearma todo el estado desde el registro de operaciones y lo compara con las tablas de estado.
 * Si alguien las tocó a mano o algo quedó distinto, lo corrige y lo anota en inconsistencias (con las alertas de los maestros).
 */
export async function auditar(sql, usuario) {
  exigirRol(usuario, ['ADMIN']);
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BLOQUEO})`;
    const ctx = await contexto(tx);
    const ops = await operacionesVigentes(tx);
    const rec = reconstruir(ops, ctx);
    const actual = await cargarEstado(tx, ctx, { clientes: null, talleres: 'TODOS' });
    const a = filasPorTabla(ctx, actual.W), n = filasPorTabla(ctx, rec.estado);
    const dif = [];
    Object.keys(n).forEach((tabla) => {
      let c = 0;
      Object.keys(n[tabla]).forEach((k) => { if (a[tabla][k] !== n[tabla][k]) c++; });
      Object.keys(a[tabla]).forEach((k) => { if (!(k in n[tabla])) c++; });
      if (c) dif.push({ tabla, filas: c });
    });
    // Envíos: estado y recepción.
    const env = await tx`select envio_id, estado, fecha_recepcion, recepcion_id from envios where estado <> 'ANULADO'`;
    const cEnv = env.filter((r) => { const e = rec.estado.envios[r.envio_id]; return e && (r.estado !== e.estado || iso(r.fecha_recepcion) !== (e.fechaRecepcion || '') || r.recepcion_id !== (e.idRecepcion || '')); }).length;
    if (cEnv) dif.push({ tabla: 'envios', filas: cEnv });
    await escribirEstadoCompleto(tx, ctx, rec.estado); // también rearma los movimientos de stock
    ctx.estado = rec.estado;
    const hallazgos = rec.inconsistencias.concat(detectarAlertas(rec.estado, ctx));
    dif.forEach((x) => hallazgos.push({ codigo: 'ESTADO_CORREGIDO', ref: x.tabla, mensaje: 'La tabla ' + x.tabla + ' no coincidía con el registro de operaciones en ' + x.filas + ' fila(s): se corrigió.' }));
    const abiertas = new Set((await tx`select codigo, ref_id from inconsistencias where estado = 'ABIERTA'`).map((r) => r.codigo + '|' + r.ref_id));
    const nuevas = hallazgos.filter((h) => h.codigo === 'ESTADO_CORREGIDO' || !abiertas.has(h.codigo + '|' + h.ref))
      .map((h) => ({ codigo: h.codigo, ref_id: h.ref || '', detalle: h.mensaje, usuario: usuario.email }));
    await insertar(tx, 'inconsistencias', nuevas);
    await tx`insert into log (usuario, accion, detalle, resultado) values (${usuario.email}, 'AUDITAR', ${'Operaciones: ' + ops.length + '; tablas corregidas: ' + dif.length}, ${nuevas.length + ' hallazgos nuevos'})`;
    return { operaciones: ops.length, corregidas: dif, nuevas: nuevas.length };
  });
}

export { TIPOS_AJUSTE };
