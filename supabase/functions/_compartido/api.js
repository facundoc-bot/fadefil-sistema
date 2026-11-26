// =============================================================================
//  SISTEMA FADEFIL · Lo que pide la app principal (antes WebApp.gs).
//  Mismos nombres y mismas respuestas que en Sheets, para que la pantalla no cambie:
//  la app llama api(fn, ...args) y recibe lo mismo que recibía de google.script.run.
//  Lee con SQL (rápido) y guarda por el mismo camino de siempre (estado.js).
// =============================================================================
import {
  TIPO_OT, TIPO_OT_TEXTO, EST_CLI, EST_CLI_TEXTO, EST_MAQ_TEXTO, UBIC, SALDO, TIPOS_AJUSTE, MODALIDAD_CO2, RES_TALLER_TEXTO,
  vistaClientes, vistaMantenimiento, vistaTaller, vistaLotesRevision, vistaStock, vistaStockMaquinas, vistaKardex,
  componentesCliente_, categoriasPermitidas_, nombreItem_, describirUbicacion_, normalizarSerie, normalizarCodigo, normalizarTipoOT,
  esFechaValida, sumarDias, diasEntre, cant_, depositoCentral
} from './motor.js';
import { co2_ESTADO, co2_UBIC } from './co2_motor.js';
import { contexto, cargarEstado, validarLote, guardarLote, anularOperacion, auditar } from './estado.js';
import { co2Contexto } from './co2_estado.js';
import { ErrorDeUsuario, exigirRol, iso, insertar, anotar, BLOQUEO, hoyArgentina } from './base.js';

export const VERSION_SISTEMA = '2.0';

const CLAVES_LISTAS = { TIPO_CLIENTE: 'tipoCliente', MODALIDAD: 'modalidad', PREFILTRO: 'prefiltro', TIPO_FALLA: 'falla', TRANSPORTE: 'transporte' };
function leerListas(ctx) {
  const l = { tipoCliente: [], modalidad: [], sistema: [], prefiltro: [], falla: [], transporte: [] };
  (ctx.listas || []).forEach((r) => {
    const k = CLAVES_LISTAS[String(r.tipo || '').toUpperCase().trim()], v = String(r.valor || '').trim();
    if (k && v && l[k].indexOf(v) < 0) l[k].push(v);
  });
  return l;
}
const ordenado = (o) => { const r = {}; Object.keys(o || {}).sort().forEach((k) => { r[k] = o[k]; }); return r; };
const plazaDeDeposito = (ctx, dep) => (dep && ctx.depositos[dep] ? String(ctx.depositos[dep].plaza || '') : '');
const plazaDeEnvio = (origen, destino, ctx) => (destino && destino !== depositoCentral() ? plazaDeDeposito(ctx, destino) : plazaDeDeposito(ctx, origen));
function plazaDeMaquina(m, W, ctx) {
  if (!m) return '';
  if (m.ubicTipo === UBIC.DEPOSITO) return plazaDeDeposito(ctx, m.ubicId);
  if (m.ubicTipo === UBIC.CABA) return plazaDeDeposito(ctx, depositoCentral());
  if (m.ubicTipo === UBIC.CLIENTE) return (ctx.clientes[m.ubicId] || {}).plaza || '';
  if (m.ubicTipo === UBIC.TRANSITO && W.envios[m.ubicId]) return plazaDeEnvio(W.envios[m.ubicId].origen, W.envios[m.ubicId].destino, ctx);
  return '';
}

/** Últimos envíos (y todos los que están en camino), con sus líneas. */
async function enviosRecientes(sql, ctx, W, n = 150) {
  const filas = await sql`select * from envios order by fecha desc, envio_id desc limit ${n}`;
  const ids = new Set(filas.map((e) => e.envio_id));
  Object.keys(W.envios).forEach((id) => {
    if (ids.has(id)) return;
    const e = W.envios[id];
    filas.push({ envio_id: id, fecha: e.fecha, origen_deposito_id: e.origen, destino_deposito_id: e.destino, estado: e.estado, fecha_recepcion: e.fechaRecepcion || '' });
  });
  const todas = filas.map((e) => e.envio_id);
  const lineas = {};
  if (todas.length) (await sql`select * from envio_lineas where envio_id = any(${todas}) order by linea_id`).forEach((l) => { (lineas[l.envio_id] = lineas[l.envio_id] || []).push(l); });
  return filas.map((e) => {
    const ls = lineas[e.envio_id] || [];
    return { id: e.envio_id, fecha: iso(e.fecha), origen: e.origen_deposito_id, destino: e.destino_deposito_id, estado: e.estado, fechaRecepcion: iso(e.fecha_recepcion),
      transporte: e.transporte || '', guia: e.guia || '', plaza: plazaDeEnvio(e.origen_deposito_id, e.destino_deposito_id, ctx),
      series: ls.filter((l) => l.serie).map((l) => l.serie),
      lineas: ls.filter((l) => !l.serie).map((l) => ({ codigo: l.codigo, descripcion: nombreItem_(ctx, l.codigo), cantidad: Number(l.cantidad) || 0, desde: l.desde_saldo || SALDO.DISPONIBLE })) };
  }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.id).localeCompare(String(a.id)));
}

/** Lo que necesita la OT para elegir cilindros: llenos de cada depósito (para entregar) y cilindros en cada cliente (para retirar). */
async function co2ParaApp(sql) {
  const cctx = await co2Contexto(sql);
  const llenos = {}, enCliente = {};
  Object.keys(cctx.cilindros).sort().forEach((sr) => {
    const c = cctx.cilindros[sr], x = { serie: sr, pesoKg: c.pesoKg || '', desde: c.ultimaFecha || '' };
    if (c.estado === co2_ESTADO.LLENO && c.ubicTipo === co2_UBIC.DEPOSITO) (llenos[c.ubicId] = llenos[c.ubicId] || []).push(x);
    else if (c.estado === co2_ESTADO.EN_USO && c.ubicTipo === co2_UBIC.CLIENTE) (enCliente[c.ubicId] = enCliente[c.ubicId] || []).push(x);
  });
  return { llenos, enCliente, cargas: cctx.cargasValidas };
}

/** Todo lo que la app necesita para arrancar. Los filtros de región, plaza y zona se aplican en la app. */
async function datosInicio(sql, u) {
  const ctx = await contexto(sql);
  const W = (await cargarEstado(sql, ctx, { clientes: null, talleres: 'TODOS' })).W;
  const plazas = Object.keys(ctx.plazas).sort().map((k) => {
    const p = ctx.plazas[k];
    return { plaza: p.plaza, nombre: p.nombre, region: p.region, provincia: p.provincia, deposito: p.deposito, activa: p.activa,
      tecnicos: String(p.tecnicos || '').split(/[;,\n]+/).map((t) => t.trim()).filter(String)
        .concat(Object.keys(ctx.tecnicos).filter((t) => ctx.tecnicos[t].plaza === p.plaza && ctx.tecnicos[t].activo !== false).sort())
        .filter((t, i, a) => a.indexOf(t) === i) };
  });
  const zonas = Object.values(ctx.zonas).map((z) => ({ id: z.id, nombre: z.nombre, plaza: z.plaza, activa: z.activa }))
    .sort((a, b) => String(a.plaza).localeCompare(String(b.plaza)) || String(a.nombre).localeCompare(String(b.nombre)));
  const depositos = Object.keys(ctx.depositos).sort().map((k) => { const d = ctx.depositos[k]; return { id: k, nombre: d.nombre, plaza: d.plaza, plazas: d.plazas, region: d.region, activo: d.activo, controlaStock: d.controlaStock }; });
  const clientes = Object.keys(ctx.clientes).map((id) => {
    const cm = ctx.clientes[id], c = W.clientes[id] || {}, m = c.serie ? ctx.maquinas[c.serie] || {} : {};
    return { id, nombre: cm.nombre, razon: cm.razon, sector: cm.sector, region: cm.region, plaza: cm.plaza, zonaId: cm.zonaId, zona: cm.zona,
      tipoCliente: cm.tipoCliente, modalidad: cm.modalidad, comentarios: cm.comentarios,
      estado: c.estado || EST_CLI.SIN_DATOS, serie: c.serie || '', modelo: m.modelo || '', comodato: ordenado(c.comodato), adicionales: ordenado(c.adicionales),
      faltante: ordenado(c.faltante), pendiente: c.pendiente || '', ultimaVisita: c.ultimaVisita || '', tipoUltimaVisita: c.tipoUltimaVisita || '', ultimaFechaOT: c.ultimaFechaOT || '',
      sistema: c.sistema || '', prefiltro: c.prefiltro || '', fechaInstalacion: c.fechaInstalacion || '',
      frecuencia: Number(cm.frecuencia) > 0 ? Number(cm.frecuencia) : ctx.diasMantenimiento, frecuenciaPropia: Number(cm.frecuencia) > 0 ? Number(cm.frecuencia) : '',
      filtros: componentesCliente_(c, ctx).map((x) => ({ slot: x.slot, codigo: x.codigo, descripcion: x.descripcion, rol: x.rol, unidades: x.unidades, ultimo: x.ultimo, vence: x.vence })) };
  }).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)) || String(a.id).localeCompare(String(b.id)));
  const maquinas = Object.keys(W.maquinas).sort().map((s) => {
    const m = W.maquinas[s];
    return { serie: s, modelo: (ctx.maquinas[s] || {}).modelo || '', estado: m.estado, ubicTipo: m.ubicTipo, ubicId: m.ubicId,
      plaza: plazaDeMaquina(m, W, ctx), ultimaFecha: m.ultimaFecha, ingresoAbierto: m.ingresoAbierto, paraCaba: !!m.paraCaba };
  });
  const reglas = {};
  Object.keys(TIPO_OT_TEXTO).forEach((t) => { reglas[t] = categoriasPermitidas_(ctx, t); });
  return {
    usuario: u, hoy: ctx.hoy, version: VERSION_SISTEMA, depositoCentral: depositoCentral(),
    regiones: Object.keys(ctx.regiones).sort().map((k) => ctx.regiones[k]), plazas, zonas, depositos, clientes, maquinas,
    catalogo: Object.values(ctx.catalogo).filter((c) => c.categoria !== 'CO2').sort((a, b) => String(a.descripcion).localeCompare(String(b.descripcion))),
    modelos: Object.keys(ctx.modelos).sort(),
    listas: leerListas(ctx), reglas, tipos: TIPO_OT_TEXTO, estadosCliente: EST_CLI_TEXTO, estadosMaquina: EST_MAQ_TEXTO,
    mantenimiento: vistaMantenimiento(W, ctx, { hoy: ctx.hoy, diasPorDefecto: ctx.diasMantenimiento, diasAviso: ctx.diasAviso }),
    taller: vistaTaller(W, ctx).map((t) => { t.plaza = plazaDeDeposito(ctx, t.deposito); return t; }),
    revisionPendiente: vistaLotesRevision(W, ctx),
    stock: vistaStock(W, ctx).map((f) => { ['ingresos30', 'ingresosTotal', 'salidas30', 'salidasTotal'].forEach((k) => delete f[k]); return f; }),
    tiposAjuste: TIPOS_AJUSTE,
    stockMaquinas: vistaStockMaquinas(W, ctx).map((f) => { f.plaza = plazaDeDeposito(ctx, f.deposito); return f; }),
    envios: await enviosRecientes(sql, ctx, W), diasAnticipoFiltros: ctx.diasAnticipoFiltros,
    sistemas: Object.keys(ctx.sistemas || {}).sort().map((n) => {
      const x = ctx.sistemas[n];
      return { nombre: n, tipo: x.tipo, activo: x.activo,
        partes: x.partes.map((p) => ({ codigo: p.codigo, descripcion: nombreItem_(ctx, p.codigo), unidades: p.unidades })),
        comps: x.comps.map((c) => ({ codigo: c.codigo, descripcion: nombreItem_(ctx, c.codigo), rol: c.rol, unidades: c.unidades, meses: c.meses })) };
    }),
    sistemasIncompletos: ctx.sistemasIncompletos || [],
    co2: await co2ParaApp(sql), modalidadesCo2: MODALIDAD_CO2, urlApp: 'co2.html',
    tecnicos: Object.keys(ctx.tecnicos).sort().map((k) => { const t = ctx.tecnicos[k]; return { id: t.id, plaza: t.plaza, region: t.region, activo: t.activo }; }),
    regionesTecnicoObligatorio: ctx.regionesTecnicoObligatorio || [], diasRetrabajo: ctx.diasRetrabajo
  };
}

/** Movimientos de stock (registro) → la forma que usa vistaKardex. */
const kardexDesdeFilas = (filas) => filas.map((r) => {
  const d = {};
  if (Number(r.disponible)) d.DISPONIBLE = Number(r.disponible);
  if (Number(r.a_revisar)) d.A_REVISAR = Number(r.a_revisar);
  if (Number(r.para_caba)) d.PARA_CABA = Number(r.para_caba);
  return { f: iso(r.fecha), dep: r.deposito_id, cod: r.codigo, mov: r.movimiento, d, cli: r.cliente_id || '', serie: r.serie || '', det: r.detalle || '', op: r.op_id || '' };
});

/** Ficha de un cliente: datos, estado, cuenta (otros IDs con la misma razón social / CUIT), historial de OT y movimientos. */
async function fichaCliente(sql, idCliente) {
  const ctx = await contexto(sql);
  const id = String(idCliente || '').trim();
  const cm = ctx.clientes[id];
  if (!cm) throw new ErrorDeUsuario('El cliente ' + id + ' no existe.');
  const clave = String(cm.razon || '').trim().toUpperCase();
  const otros = !clave ? [] : Object.keys(ctx.clientes).filter((k) => k !== id && String(ctx.clientes[k].razon || '').trim().toUpperCase() === clave);
  const W = (await cargarEstado(sql, ctx, { clientes: [id].concat(otros) })).W;
  const ctxUno = { ...ctx, clientes: { [id]: cm } };
  const v = vistaClientes(W, ctxUno)[0];
  const cuenta = otros.map((k) => { const c = W.clientes[k] || {}; return { id: k, nombre: ctx.clientes[k].nombre, sector: ctx.clientes[k].sector, estado: EST_CLI_TEXTO[c.estado || 'SIN_DATOS'], serie: c.serie || '' }; });
  const ots = await sql`select * from ot where cliente_id = ${id}`;
  const lineas = await sql`select * from ot_lineas where cliente_id = ${id} order by linea_id`;
  const conCo2 = [...new Set(lineas.filter((l) => l.codigo === 'CO2').map((l) => l.ot_id))];
  const seriesCo2 = {};
  if (conCo2.length) (await sql`select trabajo_id, tipo, serie from co2_trabajo_lineas where trabajo_id = any(${conCo2}) order by linea_id`).forEach((l) => {
    const x = seriesCo2[l.trabajo_id] = seriesCo2[l.trabajo_id] || { ENTREGA: [], RETIRO: [] };
    x[l.tipo].push(l.serie);
  });
  const porOT = {};
  lineas.forEach((l) => {
    let t;
    if (l.codigo === 'CO2') {
      const sc = (seriesCo2[l.ot_id] || {})[l.movimiento === 'ENTREGADO' ? 'ENTREGA' : 'RETIRO'] || [];
      t = 'CO₂ ' + (l.movimiento === 'ENTREGADO' ? 'entregado' : 'retirado') + ': ' + (sc.length ? sc.join(', ') : l.cantidad + ' cilindro(s)') + (l.cobranza ? ' · a cobranzas' : '');
    } else {
      t = l.cantidad + ' ' + nombreItem_(ctx, l.codigo) + ' (' + String(l.movimiento).toLowerCase().replace('_', ' ') +
        (l.codigo_retirado && l.codigo_retirado !== l.codigo ? ' por ' + nombreItem_(ctx, l.codigo_retirado) : '') + ')' +
        (l.saldo === 'COMODATO' ? ' · comodato' : l.saldo === 'ADICIONAL' ? ' · adicional' : '') + (l.cobranza && l.dto ? ' · ' + l.dto : '');
    }
    (porOT[l.ot_id] = porOT[l.ot_id] || []).push(t);
  });
  const historial = ots.map((r) => ({ nOt: r.ot_id, fecha: iso(r.fecha), tipo: (TIPO_OT_TEXTO[r.tipo] || r.tipo) + (MODALIDAD_CO2[r.modalidad_co2] ? ' (' + MODALIDAD_CO2[r.modalidad_co2].toLowerCase() + ')' : ''),
    tecnico: [r.tecnico, r.tecnico_2].filter(String).join(' y '), serieRetirada: r.serie_retirada, serieInstalada: r.serie_instalada, falla: r.falla,
    sistema: r.sistema || '', prefiltro: r.prefiltro || '', comentarios: r.comentarios, pendiente: r.pendiente, estado: r.estado, otPersat: r.ot_persat || '',
    items: porOT[r.ot_id] || [], adicionales: [] }))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.nOt).localeCompare(String(a.nOt)));
  const mant = vistaMantenimiento(W, ctxUno, { hoy: ctx.hoy, diasPorDefecto: ctx.diasMantenimiento, diasAviso: ctx.diasAviso })[0] || null;
  const datos = {};
  Object.keys(cm).forEach((k) => { if (k.charAt(0) !== '_') datos[k] = cm[k]; });
  const movs = await sql`select * from movimientos_stock where cliente_id = ${id} order by fecha, orden`;
  const movimientos = vistaKardex({ kardex: kardexDesdeFilas(movs) }, ctx, { idCliente: id }).filas.reverse();
  const co2 = await co2ParaApp(sql);
  return { cliente: datos, vista: v, mantenimiento: mant, cuenta, historial, movimientos, cilindros: co2.enCliente[id] || [] };
}

async function movimientosItem(sql, codigo, desde, hasta) {
  const ctx = await contexto(sql);
  const cod = normalizarCodigo(codigo);
  if (!ctx.catalogo[cod]) throw new ErrorDeUsuario('El ítem ' + codigo + ' no existe en el catálogo.');
  const filas = await sql`select * from movimientos_stock where codigo = ${cod} order by fecha, orden`;
  const k = vistaKardex({ kardex: kardexDesdeFilas(filas) }, ctx, { codigo: cod, desde: desde || '', hasta: hasta || '' });
  return { codigo: cod, descripcion: nombreItem_(ctx, cod), filas: k.filas, inicial: k.inicial };
}

async function ingresosSalidas(sql, desde, hasta) {
  const d = esFechaValida(desde) ? desde : '0001-01-01', h = esFechaValida(hasta) ? hasta : '9999-12-31';
  const filas = await sql`select deposito_id, codigo, fecha, sentido, tipo, sum(cantidad) as cantidad from ingresos_salidas
    where fecha between ${d} and ${h} group by deposito_id, codigo, fecha, sentido, tipo`;
  return filas.map((x) => ({ deposito: x.deposito_id, codigo: x.codigo, fecha: iso(x.fecha), sentido: x.sentido, tipo: x.tipo, cantidad: cant_(Number(x.cantidad)) }));
}

/** Ficha de una máquina con todo lo que le pasó. */
async function fichaMaquina(sql, serie) {
  const s = normalizarSerie(serie);
  const ctx = await contexto(sql);
  const maestro = ctx.maquinas[s];
  if (!maestro) throw new ErrorDeUsuario('La serie ' + s + ' no existe en máquinas.');
  const [est] = await sql`select * from maquinas_estado where serie = ${s}`;
  const m = est ? { estado: est.estado, ubicTipo: est.ubicacion_tipo, ubicId: est.ubicacion_id, ingresoAbierto: est.revision_abierta_id, paraCaba: est.enviar_a_caba === true }
    : { estado: 'NUEVA', ubicTipo: UBIC.DEPOSITO, ubicId: maestro.depositoInicial, ingresoAbierto: '', paraCaba: false };
  const envios = (await sql`select distinct envio_id from envio_lineas where serie = ${s}`).map((r) => r.envio_id);
  const W = { envios: {} };
  if (m.ubicTipo === UBIC.TRANSITO) (await sql`select * from envios where envio_id = ${m.ubicId}`).forEach((e) => { W.envios[e.envio_id] = { origen: e.origen_deposito_id, destino: e.destino_deposito_id }; });
  const textos = ['%"' + s + '"%'].concat(envios.map((id) => '%"' + id + '"%'));
  const ops = await sql`select op_id, clase, fecha, estado, datos from operaciones where datos::text like any(${textos}) order by orden`;
  const eventos = [{ fecha: maestro.fechaAlta, id: '', anulada: false, texto: 'Alta en máquinas · depósito inicial ' + maestro.depositoInicial }];
  const itemsTexto = (items) => {
    const l = (items || []).filter((x) => x && x.codigo && Number(x.cantidad) > 0);
    return l.length ? ' · ítems: ' + l.map((x) => Number(x.cantidad) + ' ' + nombreItem_(ctx, normalizarCodigo(x.codigo))).join(', ') : '';
  };
  const otsCliente = [];
  ops.forEach((r) => {
    const d = r.datos || {}, id = r.op_id, anulada = r.estado === 'ANULADA';
    let t = '';
    if (r.clase === 'OT') {
      const cli = (ctx.clientes[d.idCliente] || {}).nombre || d.idCliente, tipo = normalizarTipoOT(d.tipo);
      if (normalizarSerie(d.serieInstalada) === s) { t = (TIPO_OT_TEXTO[tipo] || d.tipo) + ': instalada en ' + cli + ' (' + d.idCliente + ')'; if (!anulada) otsCliente.push({ cliente: String(d.idCliente), desde: d.fecha, hasta: '' }); }
      if (normalizarSerie(d.serieRetirada) === s) {
        t = (TIPO_OT_TEXTO[tipo] || d.tipo) + ': retirada de ' + cli + ' (' + d.idCliente + ')' + (d.falla ? ' · falla: ' + d.falla : '');
        if (!anulada) otsCliente.forEach((x) => { if (x.cliente === String(d.idCliente) && !x.hasta) x.hasta = d.fecha; });
      }
    } else if (r.clase === 'REPARACION_DEPOSITO') {
      t = 'Reparación en depósito' + (d.falla ? ' · falla: ' + d.falla : '') + (d.diagnostico ? ' · ' + d.diagnostico : '') + itemsTexto(d.items) + (d.tecnico ? ' · técnico: ' + d.tecnico : '');
    } else if (r.clase === 'ENVIO') t = 'Envío ' + (d.origen || depositoCentral()) + ' → ' + d.destino;
    else if (r.clase === 'RECEPCION') t = 'Recepción del envío ' + d.idEnvio;
    else if (r.clase === 'INGRESO') t = 'Ingreso a revisión' + (d.falla ? ' · falla: ' + d.falla : '');
    else if (r.clase === 'CIERRE') t = 'Revisión cerrada: ' + (RES_TALLER_TEXTO[String(d.resultado).toUpperCase()] || d.resultado) + (d.diagnostico ? ' · ' + d.diagnostico : '') + itemsTexto(d.items) + (d.tecnico ? ' · técnico: ' + d.tecnico : '');
    if (t) eventos.push({ fecha: iso(r.fecha), id, anulada, texto: t });
  });
  const clientes = [...new Set(otsCliente.map((x) => x.cliente))];
  if (clientes.length) {
    (await sql`select ot_id, fecha, cliente_id, tipo, falla, estado, serie_retirada, serie_instalada from ot where cliente_id = any(${clientes}) and tipo in ('MANTENIMIENTO', 'REPARACION')`).forEach((o) => {
      if (o.serie_retirada === s || o.serie_instalada === s) return;
      const f = iso(o.fecha);
      if (!otsCliente.some((x) => x.cliente === o.cliente_id && f >= x.desde && (!x.hasta || f <= x.hasta))) return;
      eventos.push({ fecha: f, id: o.ot_id, anulada: o.estado === 'ANULADA', texto: (TIPO_OT_TEXTO[o.tipo] || o.tipo) + ' en ' + ((ctx.clientes[o.cliente_id] || {}).nombre || o.cliente_id) + (o.falla ? ' · falla: ' + o.falla : '') });
    });
  }
  eventos.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  return { serie: s, modelo: maestro.modelo, fechaAlta: maestro.fechaAlta, depositoInicial: maestro.depositoInicial, estado: EST_MAQ_TEXTO[m.estado] || m.estado,
    ubicacion: describirUbicacion_(m, ctx), plaza: plazaDeMaquina(m, W, ctx), revision: m.ingresoAbierto || '', paraCaba: !!m.paraCaba, eventos };
}

async function recientes(sql) {
  const ctx = await contexto(sql);
  const filas = await sql`select op_id, clase, fecha, detalle, estado, created_by, region_id, anulacion, datos from operaciones order by orden desc limit 80`;
  return filas.map((r) => {
    const d = r.datos || {};
    const plaza = d.idCliente ? (ctx.clientes[d.idCliente] || {}).plaza || '' : plazaDeDeposito(ctx, d.deposito || d.destino || '');
    return { id: r.op_id, clase: r.clase, fecha: iso(r.fecha), detalle: r.detalle, estado: r.estado, por: r.created_by, region: r.region_id || '', plaza, anulacion: r.anulacion || '' };
  });
}

/** Edición de un cliente existente (el alta se hace en la OT de instalación). El ID no se cambia; la zona define plaza y región. */
async function guardarCliente(sql, u, datos) {
  exigirRol(u, ['ADMIN', 'CARGA']);
  const d = datos || {};
  const id = String(d.id || '').trim();
  if (!id) throw new ErrorDeUsuario('Falta el ID de Persat.');
  if (!String(d.nombre || '').trim()) throw new ErrorDeUsuario('Falta el nombre de fantasía.');
  const ctx = await contexto(sql);
  const z = ctx.zonas[String(d.zonaId || '').trim()];
  if (!z) throw new ErrorDeUsuario('Elegí una zona de la lista.');
  if (d.frecuencia !== '' && d.frecuencia != null && !(Number(d.frecuencia) > 0)) throw new ErrorDeUsuario('La frecuencia de mantenimiento debe ser un número de días mayor que cero, o quedar vacía.');
  const actual = ctx.clientes[id];
  if (!actual) throw new ErrorDeUsuario('El cliente ' + id + ' no existe. Los clientes nuevos se dan de alta en la OT de instalación.');
  const regNueva = (ctx.plazas[z.plaza] || {}).region;
  if (actual.region && regNueva && regNueva !== actual.region) throw new ErrorDeUsuario('La zona ' + z.nombre + ' es de otra región (' + regNueva + '). Un cliente no se pasa de región desde la ficha: pedíselo a un administrador.');
  await sql`update clientes set nombre_fantasia = ${String(d.nombre).trim()}, razon_social_cuit = ${String(d.razon || '').trim()}, sector = ${String(d.sector || '').trim()},
    tipo_cliente = ${String(d.tipoCliente || '').trim()}, modalidad = ${String(d.modalidad || '').trim()}, zona_id = ${z.id},
    frecuencia_mant_dias = ${d.frecuencia === '' || d.frecuencia == null ? null : Number(d.frecuencia)}, comentarios = ${String(d.comentarios || '').trim()} where cliente_id = ${id}`;
  await anotar(sql, u.email, 'EDITAR_CLIENTE', id + ' — ' + d.nombre);
  return { id };
}

/** Alta de máquinas en el maestro. Quedan Nuevas en su depósito inicial. */
async function altaMaquinas(sql, u, datos) {
  exigirRol(u, ['ADMIN', 'CARGA']);
  const d = datos || {};
  const series = (d.series || []).map(normalizarSerie).filter(String);
  if (!series.length) throw new ErrorDeUsuario('Cargá al menos una serie.');
  const rep = series.filter((s, i) => series.indexOf(s) !== i);
  if (rep.length) throw new ErrorDeUsuario('Series repetidas en la lista: ' + rep.join(', '));
  const ctx = await contexto(sql);
  if (!ctx.modelos[String(d.modelo || '').trim()]) throw new ErrorDeUsuario('Elegí un modelo de la lista.');
  if (!ctx.depositos[String(d.deposito || '').trim()]) throw new ErrorDeUsuario('Elegí el depósito inicial.');
  if (!esFechaValida(d.fecha) || d.fecha > hoyArgentina()) throw new ErrorDeUsuario('La fecha de alta no es válida.');
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BLOQUEO})`;
    const ya = (await tx`select serie from maquinas where serie = any(${series})`).map((r) => r.serie);
    if (ya.length) throw new ErrorDeUsuario('Ya existen en máquinas: ' + ya.join(', '));
    await insertar(tx, 'maquinas', series.map((s) => ({ serie: s, modelo: String(d.modelo).trim(), fecha_alta: d.fecha, deposito_inicial_id: String(d.deposito).trim(), comentarios: String(d.comentarios || '') })));
    await anotar(tx, u.email, 'ALTA_MAQUINAS', series.join(', '));
    return { series };
  });
}

async function inconsistencias(sql) {
  return (await sql`select * from inconsistencias where estado <> 'RESUELTA' order by detectada_at desc`)
    .map((r) => ({ id: r.inconsistencia_id, codigo: r.codigo, ref: r.ref_id || '', detalle: r.detalle, fecha: r.detectada_at }));
}
async function resolverInconsistencia(sql, u, id, resolucion) {
  exigirRol(u, ['ADMIN', 'CARGA']);
  if (!resolucion || String(resolucion).trim().length < 5) throw new ErrorDeUsuario('Escribí cómo se resolvió.');
  const [r] = await sql`update inconsistencias set estado = 'RESUELTA', resolucion = ${String(resolucion)}, usuario = ${u.email} where inconsistencia_id = ${String(id)} returning inconsistencia_id`;
  if (!r) throw new ErrorDeUsuario('No se encontró ' + id);
  await anotar(sql, u.email, 'RESOLVER_INC', id, resolucion);
  return true;
}

/** Informe de técnicos: OT del período con sus técnicos y los retrabajos (reparación en el mismo cliente dentro de DIAS_RETRABAJO días). */
const TIPOS_QUE_EVALUAN_RETRABAJO = ['INSTALACION', 'MANTENIMIENTO', 'REPARACION', 'REPARACION_BACKUP', 'CAMBIO_MODELO'];
async function tecnicos(sql, desde, hasta) {
  if (!esFechaValida(desde) || !esFechaValida(hasta) || desde > hasta) throw new ErrorDeUsuario('Elegí un período válido.');
  const ctx = await contexto(sql), dias = ctx.diasRetrabajo || 30;
  const limite = sumarDias(hasta, dias);
  const filas = await sql`select ot_id, fecha, cliente_id, tipo, tecnico, tecnico_2 from ot where estado <> 'ANULADA' and tipo <> 'ALTA_INICIAL' and fecha between ${desde} and ${limite}`;
  const ots = filas.map((r) => {
    const c = ctx.clientes[r.cliente_id] || {};
    return { id: r.ot_id, fecha: iso(r.fecha), idCliente: r.cliente_id, cliente: c.nombre || r.cliente_id, plaza: c.plaza || '', region: c.region || '', tipo: r.tipo,
      t1: String(r.tecnico || '').trim(), t2: String(r.tecnico_2 || '').trim() };
  }).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : String(a.id).localeCompare(String(b.id))));
  const porCliente = {};
  ots.forEach((o) => { (porCliente[o.idCliente] = porCliente[o.idCliente] || []).push(o); });
  const retrabajos = [];
  ots.forEach((o) => {
    if (o.fecha > hasta || TIPOS_QUE_EVALUAN_RETRABAJO.indexOf(o.tipo) < 0) return;
    const lim = sumarDias(o.fecha, dias);
    const rep = (porCliente[o.idCliente] || []).find((x) => (x.tipo === 'REPARACION' || x.tipo === 'REPARACION_BACKUP') && x.fecha > o.fecha && x.fecha <= lim);
    if (rep) retrabajos.push({ ot: o.id, reparacion: rep.id, fechaReparacion: rep.fecha, dias: diasEntre(o.fecha, rep.fecha) });
  });
  return { desde, hasta, diasRetrabajo: dias, ots: ots.filter((o) => o.fecha <= hasta), retrabajos };
}

/** Despacho de lo que pide la app: api(fn, ...args) → lo mismo que devolvía la función de Apps Script. */
export async function api(sql, u, fn, args) {
  const a = Array.isArray(args) ? args : [];
  switch (fn) {
    case 'apiInicio': case 'apiActualizarMaestros': return datosInicio(sql, u);
    case 'apiValidar': return validarLote(sql, u, a[0]);
    case 'apiConfirmar': {
      const r = await guardarLote(sql, u, a[0], !!a[1]);
      if (r.ok) r.ini = await datosInicio(sql, u); // la app se actualiza con esta respuesta, sin otra llamada
      return r;
    }
    case 'apiFichaCliente': return fichaCliente(sql, a[0]);
    case 'apiMovimientosItem': return movimientosItem(sql, a[0], a[1], a[2]);
    case 'apiIngresosSalidas': return ingresosSalidas(sql, a[0], a[1]);
    case 'apiFichaMaquina': return fichaMaquina(sql, a[0]);
    case 'apiRecientes': return recientes(sql);
    case 'apiGuardarCliente': return guardarCliente(sql, u, a[0]);
    case 'apiAltaMaquinas': return altaMaquinas(sql, u, a[0]);
    case 'apiInconsistencias': return inconsistencias(sql);
    case 'apiResolverInconsistencia': return resolverInconsistencia(sql, u, a[0], a[1]);
    case 'apiTecnicos': return tecnicos(sql, a[0], a[1]);
    case 'apiAnular': {
      const r = await anularOperacion(sql, u, a[0], a[1]);
      if (r.ok) r.ini = await datosInicio(sql, u);
      return r;
    }
    case 'apiAuditar': {
      const r = await auditar(sql, u);
      r.ini = await datosInicio(sql, u);
      return r;
    }
  }
  throw new ErrorDeUsuario('La app pidió algo que el servidor no conoce: ' + fn);
}
