// =============================================================================
//  SISTEMA FADEFIL · Reglas de carga de un lote (antes de simular y al guardar).
//  Pasado tal cual desde Datos.gs (Sheets v1.5): alta de clientes nuevos dentro de
//  la instalación, envíos y ajustes automáticos del alta inicial, numeración y
//  armado de las líneas de OT. Sin acceso a la base.
// =============================================================================
/* eslint-disable */
import {
  CAT,
  EST_MAQ,
  MODALIDAD_CO2,
  MOV_ITEM,
  RES_TALLER_TEXTO,
  TIPOS_AJUSTE,
  TIPOS_COMODATO,
  TIPOS_SIN_COBRANZA,
  TIPO_OT,
  TIPO_OT_TEXTO,
  UBIC,
  cant_,
  cilindrosDeOT_,
  defSistema_,
  esFechaValida,
  fechaTexto,
  hayMaestroSistemas_,
  normalizarCodigo,
  normalizarSerie,
  normalizarTipoOT,
  simularLote,
  depositoCentral
} from './motor.js';

/**
 * Si quien llama no cargó el estado de los cilindros (ctx.simularCilindros), una OT con cilindros no se guarda:
 * se avisa con un error en vez de guardar la OT sin sus cilindros.
 */
function sinCilindros_(ops, sim) {
  ops.forEach(function (op, k) {
    if (op.clase !== 'OT' || op._auto) return;
    var cil = cilindrosDeOT_(op.datos);
    if (!cil.entregadas.length && !cil.retiradas.length) return;
    sim.resultados[k].errores.push({ codigo: 'CO2_NO_DISPONIBLE', mensaje: 'No se pudo validar los cilindros de CO₂ de esta OT. Volvé a intentar.' });
    sim.ok = false;
  });
  return null;
}

var PREFIJO_OP = { OT: 'OT', INGRESO: 'ING', CIERRE: 'CIE', REVISION_ITEMS: 'REV', ENVIO: 'ENV', RECEPCION: 'REC', AJUSTE: 'AJU', REPARACION_DEPOSITO: 'REP' };

/** Texto corto de una operación para operaciones.detalle y el log. */
function detalleOperacion_(op, ctx) {
  var d = op.datos || {};
  switch (op.clase) {
    case 'OT':
      var cil = cilindrosDeOT_(d), mod = MODALIDAD_CO2[String(d.modalidadCo2 || '').toUpperCase()];
      return (TIPO_OT_TEXTO[normalizarTipoOT(d.tipo)] || d.tipo) + (mod ? ' (' + mod.toLowerCase() + ')' : '') + ' · ' + ((ctx.clientes[d.idCliente] || {}).nombre || d.idCliente) +
        ' (' + d.idCliente + ')' + (d.clienteNuevo ? ' · alta de cliente' : '') +
        (cil.entregadas.length ? ' · CO₂ entrega ' + cil.entregadas.join(', ') : '') + (cil.retiradas.length ? ' · CO₂ retira ' + cil.retiradas.join(', ') : '');
    case 'INGRESO': return 'Ingreso a revisión · ' + normalizarSerie(d.serie);
    case 'CIERRE': return 'Cierre de revisión · ' + normalizarSerie(d.serie || d.idIngreso) + ' · ' + (RES_TALLER_TEXTO[String(d.resultado).toUpperCase()] || d.resultado);
    case 'REVISION_ITEMS': return 'Revisión de ítems · ' + d.deposito;
    case 'ENVIO': return 'Envío ' + (d.origen || depositoCentral()) + ' → ' + d.destino;
    case 'RECEPCION': return 'Recepción del envío ' + d.idEnvio;
    case 'AJUSTE': return 'Ajuste' + (TIPOS_AJUSTE[String(d.tipo || '').toUpperCase()] ? ' (' + TIPOS_AJUSTE[String(d.tipo).toUpperCase()].texto + ')' : '') + ' · ' + d.deposito + ' · ' + d.codigo + ' ' + d.cantidad;
    case 'REPARACION_DEPOSITO': return 'Reparación en depósito · ' + normalizarSerie(d.serie);
  }
  return op.clase;
}


/** Qué se hizo con el sistema o el prefiltro en una OT (columna sistema / prefiltro de ot). */
function textoPlanSistema_(plan, slot, nombre, ctx) {
  if (!hayMaestroSistemas_(ctx)) return String(nombre || '');
  var p = (plan || []).filter(function (x) { return x.slot === slot; });
  if (!p.length) return '';
  var inst = p.filter(function (x) { return x.accion === 'INSTALAR'; })[0];
  var ret = p.filter(function (x) { return x.accion === 'RETIRAR'; })[0], nd = p.filter(function (x) { return x.accion === 'NO_DEVUELTO'; })[0];
  if (inst && ret) return (inst.nombre === ret.nombre ? 'Backup: ' : 'Cambio a ') + inst.nombre;
  if (inst) return inst.nombre;
  return nd ? 'No devuelto' : 'Retirado';
}


/**
 * Antes de simular: da de alta en memoria los clientes nuevos que vienen dentro de una instalación (o alta inicial)
 * y controla las reglas que valen solo para cargas nuevas. Devuelve los errores por índice de operación.
 */
function aplicarReglasDeCarga_(ops, ctx) {
  var errores = {};
  var err = function (i, codigo, mensaje) { (errores[i] = errores[i] || []).push({ codigo: codigo, mensaje: mensaje }); };
  (ops || []).forEach(function (op, i) {
    if (op.clase !== 'OT') return;
    var d = op.datos || (op.datos = {});
    var tipo = normalizarTipoOT(d.tipo);
    if (d.clienteNuevo) {
      var cn = d.clienteNuevo, id = String(cn.id || '').trim();
      cn.id = id; d.idCliente = id;
      if (tipo !== TIPO_OT.INSTALACION && tipo !== TIPO_OT.ALTA_INICIAL) err(i, 'CLIENTE_NUEVO_NO_PERMITIDO', 'Un cliente nuevo se da de alta con una instalación (o con el alta inicial).');
      if (!id) err(i, 'FALTA_ID_CLIENTE', 'Falta el ID de Persat del cliente nuevo.');
      else if (ctx.clientes[id] && !ctx.clientes[id]._nuevo) err(i, 'CLIENTE_YA_EXISTE', 'Ya existe un cliente con el ID ' + id + ' (' + ctx.clientes[id].nombre + '). Si vuelve a tener equipo, cargalo como Reinstalación.');
      else if (ctx.clientes[id]) err(i, 'CLIENTE_REPETIDO_EN_LISTA', 'El cliente ' + id + ' ya se da de alta en otra OT de esta lista.');
      if (!String(cn.nombre || '').trim()) err(i, 'FALTA_NOMBRE', 'Falta el nombre de fantasía del cliente nuevo.');
      var z = ctx.zonas[String(cn.zonaId || '').trim()];
      if (!z) err(i, 'ZONA_INEXISTENTE', 'Elegí la zona del cliente nuevo (de ahí salen su plaza y su región).');
      else if (!z.activa) err(i, 'ZONA_INACTIVA', 'La zona ' + z.nombre + ' está inactiva.');
      else if (!ctx.plazas[z.plaza]) err(i, 'PLAZA_INEXISTENTE', 'La zona ' + z.nombre + ' apunta a la plaza "' + z.plaza + '", que no existe.');
      if (cn.frecuencia !== '' && cn.frecuencia != null && !(Number(cn.frecuencia) > 0)) err(i, 'FRECUENCIA_INVALIDA', 'La frecuencia de mantenimiento debe ser un número de días mayor que cero, o quedar vacía.');
      if (!errores[i]) {
        var p = ctx.plazas[z.plaza];
        ctx.clientes[id] = { id: id, nombre: String(cn.nombre).trim(), razon: String(cn.razon || ''), sector: String(cn.sector || ''), tipoCliente: String(cn.tipoCliente || ''),
          modalidad: String(cn.modalidad || ''), zonaId: z.id, zona: z.nombre, plaza: p.plaza, region: p.region,
          frecuencia: cn.frecuencia === '' || cn.frecuencia == null ? '' : Number(cn.frecuencia), comentarios: String(cn.comentarios || ''), _nuevo: true };
      }
    }
    if (tipo === TIPO_OT.INSTALACION && !String(d.sistema || '').trim()) err(i, 'FALTA_SISTEMA', 'Indicá el sistema de purificación que se instala.');
  });
  return errores;
}


function simularConReglasDeCarga_(ops, ctx) {
  var pre = aplicarReglasDeCarga_(ops, ctx);
  var sim = simularLote(ops, ctx);
  Object.keys(pre).forEach(function (k) {
    var r = sim.resultados[Number(k)];
    var altaFallida = ops[Number(k)].datos.clienteNuevo && pre[k].some(function (e) { return e.codigo !== 'FALTA_SISTEMA'; });
    r.errores = altaFallida ? pre[k] : pre[k].concat(r.errores);
    sim.ok = false;
  });
  return sim;
}


/** Depósito de la plaza de un cliente (existente o nuevo dentro del lote). */
function depositoDelCliente_(ctx, d) {
  var plaza = '';
  if (d.clienteNuevo) { var z = ctx.zonas[String(d.clienteNuevo.zonaId || '').trim()]; plaza = z ? z.plaza : ''; }
  else plaza = (ctx.clientes[String(d.idCliente || '').trim()] || {}).plaza || '';
  return (ctx.plazas[plaza] || {}).deposito || '';
}


/**
 * Alta inicial (migración):
 * - con una máquina que está en otro depósito o en CABA (o que no existe): se registran solos el envío y su recepción;
 * - lo que queda en el cliente (ítems y piezas del sistema) entra con un ajuste "Alta inicial" y sale como entrega.
 */
function expandirLote_(ops, ctx) {
  var out = [], origen = [], errores = {}, avisos = {}, maquinasNuevas = [];
  var W = ctx.estado;
  (ops || []).forEach(function (op, i) {
    var d = op.datos || {};
    var esAlta = op.clase === 'OT' && normalizarTipoOT(d.tipo) === TIPO_OT.ALTA_INICIAL;
    var idCli = d.idCliente || (d.clienteNuevo || {}).id || '';
    if (esAlta && d.traerMaquina && d.serieInstalada) {
      var s = normalizarSerie(d.serieInstalada);
      d.serieInstalada = s;
      var dep = depositoDelCliente_(ctx, d);
      var fechaMov = esFechaValida(d.fechaInstalacion) ? d.fechaInstalacion : d.fecha;
      var m = W.maquinas[s];
      if (dep && ctx.depositos[dep] && !m) {
        var modelo = String((d.maquinaNueva || {}).modelo || '').trim();
        if (!modelo || !ctx.modelos[modelo]) {
          (errores[i] = errores[i] || []).push({ codigo: 'FALTA_MODELO', mensaje: 'La serie ' + s + ' no está en máquinas: elegí su modelo para darla de alta.' });
        } else {
          ctx.maquinas[s] = { serie: s, modelo: modelo, fechaAlta: fechaMov, depositoInicial: depositoCentral() };
          m = W.maquinas[s] = { serie: s, estado: EST_MAQ.NUEVA, ubicTipo: UBIC.DEPOSITO, ubicId: depositoCentral(), ultimaFecha: fechaMov, ingresoAbierto: '', paraCaba: false };
          maquinasNuevas.push({ serie: s, modelo: modelo, fecha_alta: fechaMov, deposito_inicial_id: depositoCentral(), comentarios: 'Alta por migración (alta inicial del cliente ' + idCli + ')' });
        }
      }
      if (dep && m && (m.ubicTipo === UBIC.CABA || (m.ubicTipo === UBIC.DEPOSITO && m.ubicId !== dep))) {
        var f = fechaMov;
        if (m.ultimaFecha && f < m.ultimaFecha) {
          f = m.ultimaFecha;
          (avisos[i] = avisos[i] || []).push({ codigo: 'FECHA_ENVIO_AJUSTADA', mensaje: 'La serie ' + s + ' tiene un movimiento del ' + fechaTexto(m.ultimaFecha) +
            ': el envío y la recepción se registran con esa fecha y no con la de instalación.' });
        }
        var nEnv = out.length;
        out.push({ clase: 'ENVIO', _auto: true, datos: { fecha: f, origen: m.ubicTipo === UBIC.CABA ? depositoCentral() : m.ubicId, destino: dep, series: [s],
          comentarios: 'Registrado por el alta inicial (migración) del cliente ' + idCli + '.' } });
        origen.push(i);
        out.push({ clase: 'RECEPCION', _auto: true, _envio: nEnv, datos: { fecha: f, idEnvio: '' } });
        origen.push(i);
      }
    }
    if (esAlta) {
      var depA = depositoDelCliente_(ctx, d);
      var fA = esFechaValida(d.fechaInstalacion) ? d.fechaInstalacion : d.fecha;
      var cant = {}, orden = [];
      var sumar = function (codigo, n) { codigo = normalizarCodigo(codigo); if (!codigo || !(Number(n) > 0)) return; if (!(codigo in cant)) { cant[codigo] = 0; orden.push(codigo); } cant[codigo] = cant_(cant[codigo] + Number(n)); };
      (d.items || []).forEach(function (l) { if (String(l.mov || 'ENTREGADO').toUpperCase() === 'ENTREGADO') sumar(l.codigo, l.cantidad); });
      [d.sistema, d.prefiltro].forEach(function (n) { var df = String(n || '').trim() && defSistema_(ctx, n); if (df) df.partes.forEach(function (x) { sumar(x.codigo, x.unidades); }); });
      if (depA && ctx.depositos[depA]) {
        d.conStock = true;
        orden.forEach(function (codigo) {
          out.push({ clase: 'AJUSTE', _auto: true, datos: { fecha: fA, deposito: depA, codigo: codigo, cantidad: cant[codigo], saldo: 'DISPONIBLE', tipo: 'ALTA_INICIAL',
            motivo: 'Por alta inicial del cliente ' + idCli + ' (se entrega en la misma fecha).' } });
          origen.push(i);
        });
      }
    }
    out.push(op);
    origen.push(i);
  });
  return { ops: out, origen: origen, errores: errores, avisos: avisos, maquinasNuevas: maquinasNuevas };
}


/** Prepara y simula un lote tal como se va a guardar (con los envíos y ajustes automáticos y la numeración). */
function simularLotePreparado_(ops, ctx, numerar) {
  var prep = expandirLote_(ops, ctx);
  var ops2 = prep.ops;
  ops2.forEach(function (op, k) { op.id = numerar ? numerar(op) : 'VAL-' + (k + 1); });
  ops2.forEach(function (op) { if (op._envio != null) op.datos.idEnvio = ops2[op._envio].id; });
  ops2.forEach(function (op, k) {
    if (op._auto) return;
    var autos = ops2.filter(function (x, j) { return x._auto && prep.origen[j] === prep.origen[k]; });
    if (!autos.length) return;
    op.datos.operacionesAuto = autos.map(function (x) { return x.id; });
    autos.forEach(function (x) { x.datos.generadaPor = op.id; });
  });
  var sim = simularConReglasDeCarga_(ops2, ctx);
  ops2.forEach(function (op, k) {
    if (op._auto) return;
    var i = prep.origen[k];
    if (prep.errores[i]) { sim.resultados[k].errores = prep.errores[i].concat(sim.resultados[k].errores); sim.ok = false; }
    if (prep.avisos[i]) sim.resultados[k].advertencias = prep.avisos[i].concat(sim.resultados[k].advertencias);
  });
  // v1.1: los cilindros de CO₂ de las OT se validan con el motor de CO₂, en el mismo lote.
  var co2 = (ctx.simularCilindros || sinCilindros_)(ops2, sim, ctx); // lo arma el servidor con el estado de los cilindros
  if (co2) {
    co2.idx.forEach(function (k, j) {
      var r = co2.sim.resultados[j];
      r.errores.forEach(function (e) { sim.resultados[k].errores.push({ codigo: e.codigo, mensaje: 'CO₂: ' + e.mensaje }); });
      r.advertencias.forEach(function (e) { sim.resultados[k].advertencias.push({ codigo: e.codigo, mensaje: 'CO₂: ' + e.mensaje }); });
      if (r.errores.length) sim.ok = false;
    });
    co2.pendientes.forEach(function (p) { sim.resultados[p.k].advertencias.push({ codigo: 'CO2_PENDIENTE_EN_CLIENTE', mensaje: p.mensaje }); });
  }
  var porOriginal = [];
  sim.resultados.forEach(function (r, k) {
    var i = prep.origen[k], op = ops2[k];
    var o = porOriginal[i] = porOriginal[i] || { id: '', clase: '', errores: [], advertencias: [] };
    var pref = op._auto ? (op.clase === 'ENVIO' ? 'Envío automático ' + op.id + ': ' : op.clase === 'AJUSTE' ? 'Ajuste automático (alta inicial): ' : 'Recepción automática: ') : '';
    r.errores.forEach(function (e) { o.errores.push({ codigo: e.codigo, mensaje: pref + e.mensaje }); });
    r.advertencias.forEach(function (e) { o.advertencias.push({ codigo: e.codigo, mensaje: pref + e.mensaje }); });
    if (!op._auto) { o.id = r.id; o.clase = r.clase; }
  });
  return { sim: sim, ops: ops2, prep: prep, porOriginal: porOriginal, co2: co2 };
}


/** Líneas de una OT para ot_lineas: saldo (comodato o adicional) y si van a cobranzas. */
function lineasDeOT_(id, ef, d, ctx) {
  return (ef.lineas || []).map(function (l, n) {
    var cat = l.categoria || (ctx.catalogo[l.codigo] || {}).categoria;
    var deCliente = cat === CAT.INSUMO || cat === CAT.ADICIONAL;
    var cobranza = deCliente && TIPOS_SIN_COBRANZA.indexOf(ef.tipo) < 0;
    var saldo = '';
    if (deCliente && (l.mov === MOV_ITEM.ENTREGADO || l.mov === MOV_ITEM.CAMBIO)) saldo = TIPOS_COMODATO.indexOf(ef.tipo) >= 0 ? 'COMODATO' : 'ADICIONAL';
    return { linea_id: id + '-' + (n + 1), ot_id: id, cliente_id: ef.idCliente, fecha: d.fecha, codigo: l.codigo, cantidad: l.cantidad, movimiento: l.mov,
      codigo_retirado: l.mov === MOV_ITEM.CAMBIO ? (l.codigoRetirado || l.codigo) : '', saldo: saldo, cobranza: cobranza,
      dto: cobranza ? (l.dto != null && l.dto !== '' ? l.dto : (cat === CAT.INSUMO ? 'Sin cargo' : '')) : '', facturado: '' };
  });
}


export { PREFIJO_OP, detalleOperacion_, textoPlanSistema_, aplicarReglasDeCarga_, simularConReglasDeCarga_, depositoDelCliente_, expandirLote_, simularLotePreparado_, lineasDeOT_ };
