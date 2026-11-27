// =============================================================================
//  SISTEMA FADEFIL · Motor de reglas de CO₂ (cilindros, remitos de LINDE, trabajos).
//  Pasado tal cual desde co2_Motor.gs (Sheets, CO₂ v2.4): mismas reglas y mensajes.
//  No toca la base. Cambio respecto del original: es un módulo (export al final).
// =============================================================================
/* eslint-disable */
/**
 * ============================================================================
 *  SISTEMA FADEFIL — Módulo CO₂ (v2.1, integrado al sistema unificado)
 *  Archivo: co2_Motor.gs
 *  Motor de reglas. NO lee ni escribe la planilla: recibe el estado actual,
 *  simula cada operación y devuelve errores, advertencias y movimientos.
 *  Por eso se puede probar sin tocar datos reales (ver Pruebas.gs).
 * ============================================================================
 */

var co2_ESTADO = {
  LLENO: 'LLENO_DISPONIBLE',
  EN_USO: 'EN_USO',
  VACIO: 'VACIO_DISPONIBLE',
  LINDE: 'ENTREGADO_LINDE'
};

var co2_ESTADO_TEXTO = {
  LLENO_DISPONIBLE: 'Lleno disponible',
  EN_USO: 'En uso',
  VACIO_DISPONIBLE: 'Vacío disponible',
  ENTREGADO_LINDE: 'Devuelto al proveedor'
};

/* ---------------------------------------------------------------------------
 *  Proveedores (v2.1, pedido 26/11/2026): LINDE y Gases Nordelta (GN).
 *  ctx.proveedores = { LINDE: { id, nombre }, GN: {...} }; ctx.plazas[id].proveedor.
 *  Un cilindro es de un proveedor para siempre (como su carga). Los movimientos y
 *  el estado "*_LINDE" quieren decir "en el proveedor" (el de la serie).
 *  Sin ctx.proveedores (como en las pruebas originales) todo es LINDE.
 * ------------------------------------------------------------------------ */
var co2_PROVEEDOR_DEFECTO = 'LINDE';
function co2_provDe_(s) { return (s && s.proveedor) || co2_PROVEEDOR_DEFECTO; }
function co2_nombreProveedor_(ctx, id) {
  var p = ctx && ctx.proveedores && ctx.proveedores[id || co2_PROVEEDOR_DEFECTO];
  return p ? p.nombre : (id || co2_PROVEEDOR_DEFECTO);
}
/** Proveedor con el que trabaja la plaza del cliente. */
function co2_proveedorCliente_(cli, ctx) {
  var p = cli && ctx.plazas && ctx.plazas[cli.plazaId];
  return (p && p.proveedor) || co2_PROVEEDOR_DEFECTO;
}
/** El proveedor de una serie no cambia. */
function co2_validarProveedor_(res, serie, prov, s, ctx) {
  if (s && co2_provDe_(s) !== prov) {
    co2_err_(res, 'PROVEEDOR_DISTINTO', 'La serie ' + serie + ' es de ' + co2_nombreProveedor_(ctx, co2_provDe_(s)) + ' y ahora figura como de ' + co2_nombreProveedor_(ctx, prov) +
      '. Un cilindro no cambia de proveedor: revisá la serie o el proveedor.', serie);
    return false;
  }
  return true;
}

var co2_UBIC = { DEPOSITO: 'DEPOSITO', CLIENTE: 'CLIENTE', LINDE: 'LINDE', INVENTARIO: 'INVENTARIO' };

var co2_MOV = {
  ENTREGA_LINDE: 'ENTREGA_LINDE',     // LINDE → depósito (abre circuito)
  RETIRO_LINDE: 'RETIRO_LINDE',       // depósito → LINDE (cierra circuito)
  ENTREGA_CLIENTE: 'ENTREGA_CLIENTE', // depósito → cliente
  RETIRO_CLIENTE: 'RETIRO_CLIENTE',   // cliente → depósito de origen del circuito
  ALTA_INICIAL: 'ALTA_INICIAL'        // inventario inicial (abre circuito sin remito)
};

/* ---------------------------------------------------------------------------
 *  Normalización
 * ------------------------------------------------------------------------ */

/** Serie en mayúsculas y sin espacios: "a 1754410 " → "A1754410". */
function co2_normalizarSerie(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/\s+/g, '');
}

/** Número de remito comparable: "0001-00012345" y "1-12345" son el mismo. */
function co2_normalizarNroRemito(s) {
  var partes = String(s == null ? '' : s).split(/\D+/).filter(function (p) { return p !== ''; });
  return partes.map(function (p) { return String(parseInt(p, 10)); }).join('-');
}

/** true si es una fecha real con formato AAAA-MM-DD. */
function co2_esFechaValida(f) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f || ''))) return false;
  var p = f.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

function co2_fechaTexto(f) {
  if (!co2_esFechaValida(f)) return String(f || '');
  var p = f.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

/* ---------------------------------------------------------------------------
 *  Utilidades internas
 * ------------------------------------------------------------------------ */

function co2_clonarEstados_(cilindros) {
  var copia = {};
  Object.keys(cilindros || {}).forEach(function (k) {
    var c = cilindros[k];
    copia[k] = {
      serie: c.serie, estado: c.estado, ubicTipo: c.ubicTipo, ubicId: c.ubicId,
      idCircuito: c.idCircuito, depOrigen: c.depOrigen, ultimaFecha: c.ultimaFecha || '', pesoKg: c.pesoKg || '', proveedor: c.proveedor || ''
    };
  });
  return copia;
}

function co2_nombreDeposito_(ctx, id) {
  var d = ctx.depositos[id];
  return d ? d.nombre : (id ? id + ' (inexistente)' : '(sin asignar)');
}

function co2_describirUbicacion_(s, ctx) {
  if (!s) return 'sin registro';
  if (s.ubicTipo === co2_UBIC.DEPOSITO) {
    var d = ctx.depositos[s.ubicId];
    return 'depósito ' + (d ? d.nombre : s.ubicId);
  }
  if (s.ubicTipo === co2_UBIC.CLIENTE) {
    var c = ctx.clientes[s.ubicId];
    return 'cliente ' + (c ? c.nombre + ' (' + c.id + ')' : s.ubicId);
  }
  if (s.ubicTipo === co2_UBIC.LINDE) return co2_nombreProveedor_(ctx, s.proveedor || (s.ubicId !== 'LINDE' ? s.ubicId : ''));
  return s.ubicTipo || 'desconocida';
}

function co2_nuevoResultado_() {
  return { errores: [], advertencias: [], movimientos: [] };
}

function co2_err_(res, codigo, mensaje, serie) {
  res.errores.push({ codigo: codigo, mensaje: mensaje, serie: serie || '' });
}

function co2_adv_(res, codigo, mensaje, serie) {
  res.advertencias.push({ codigo: codigo, mensaje: mensaje, serie: serie || '' });
}

function co2_validarFecha_(res, fecha, ctx) {
  if (!co2_esFechaValida(fecha)) {
    co2_err_(res, 'FECHA_INVALIDA', 'La fecha "' + (fecha || '') + '" no es válida. Revisá el campo Fecha.');
    return false;
  }
  if (ctx.hoy && fecha > ctx.hoy) {
    co2_err_(res, 'FECHA_FUTURA', 'La fecha ' + co2_fechaTexto(fecha) + ' es posterior a hoy. Revisá el campo Fecha.');
    return false;
  }
  return true;
}

/** Ningún movimiento puede quedar antes del último movimiento de la serie. */
function co2_validarCronologia_(res, s, fecha, serie) {
  if (s && s.ultimaFecha && fecha < s.ultimaFecha) {
    co2_err_(res, 'FECHA_ANTERIOR_A_HISTORIAL',
      'La serie ' + serie + ' tiene un movimiento del ' + co2_fechaTexto(s.ultimaFecha) +
      ', posterior a ' + co2_fechaTexto(fecha) + '. Cargá los movimientos en orden cronológico o revisá la fecha.', serie);
    return false;
  }
  return true;
}

function co2_aplicar_(W, mov) {
  var s = W[mov.serie] || { serie: mov.serie };
  s.estado = mov.estadoNuevo;
  s.ubicTipo = mov.destinoTipo;
  s.ubicId = mov.destinoId;
  s.idCircuito = mov.idCircuito;
  s.depOrigen = mov.depOrigen;
  s.ultimaFecha = mov.fecha;
  if (mov.pesoKg) s.pesoKg = mov.pesoKg; // la carga se fija al entrar y acompaña a la serie
  if (mov.proveedor) s.proveedor = mov.proveedor; // el proveedor también
  W[mov.serie] = s;
}

function co2_movimiento_(base) {
  return {
    serie: base.serie, tipoMov: base.tipoMov, fecha: base.fecha,
    origenTipo: base.origenTipo, origenId: base.origenId || '',
    destinoTipo: base.destinoTipo, destinoId: base.destinoId || '',
    estadoAnterior: base.estadoAnterior || '', estadoNuevo: base.estadoNuevo,
    idCircuito: base.idCircuito || '', depOrigen: base.depOrigen || '',
    circuitoNuevo: !!base.circuitoNuevo, circuitoCierra: !!base.circuitoCierra, pesoKg: base.pesoKg || '', zonaId: base.zonaId || '',
    proveedor: base.proveedor || ''
  };
}

/**
 * Carga del cilindro (kg de CO₂): obligatoria al entrar al sistema y fija para siempre.
 * ctx.cargasValidas = [5, 10]; si no viene, no se controla el valor (compatibilidad).
 */
function co2_validarCarga_(res, serie, pesoKg, s, ctx) {
  var peso = Number(pesoKg) || 0;
  if (ctx.cargasValidas && ctx.cargasValidas.indexOf(peso) < 0) {
    co2_err_(res, 'CARGA_INVALIDA', (peso ? 'La carga de ' + peso + ' kg de la serie ' + serie + ' no está en Configuración CO₂ (CARGAS_KG)' : 'Falta la carga de la serie ' + serie) +
      ': elegí ' + ctx.cargasValidas.join(', ').replace(/, ([^,]*)$/, ' o $1') + ' kg.', serie);
    return false;
  }
  if (s && s.pesoKg && peso && Number(s.pesoKg) !== peso) {
    co2_err_(res, 'CARGA_DISTINTA', 'La serie ' + serie + ' está registrada con ' + s.pesoKg + ' kg y ahora figura con ' + peso + ' kg. ' +
      'Un cilindro no cambia de carga: revisá la serie o la carga.', serie);
    return false;
  }
  return true;
}

/** Detecta series repetidas dentro de una lista. Devuelve las repetidas. */
function co2_repetidas_(lista) {
  var vistas = {}, rep = [];
  lista.forEach(function (s) {
    if (vistas[s] && rep.indexOf(s) < 0) rep.push(s);
    vistas[s] = true;
  });
  return rep;
}

/* ---------------------------------------------------------------------------
 *  Remito LINDE
 *  r = { nroRemito, fecha, idDeposito, plazaTexto, tipoCopia, archivoHash,
 *        lineas: [{ tipo: 'ENTREGA'|'RETIRO', serie, pesoKg }] }
 * ------------------------------------------------------------------------ */
/**
 * v2.3 · Series dudosas (Leer PDF: no figuran igual en los números de lote). El remito no se guarda hasta que
 * un administrador indica a qué cilindro corresponde cada una. ctx.rolUsuario: rol de quien valida o guarda.
 */
function co2_validarDudosas_(res, r, ctx) {
  (r.lineas || []).forEach(function (l) {
    if (!l.dudosa) return;
    var s = co2_normalizarSerie(l.serie), leida = l.serieLeidaIA || s;
    if (!l.aprobada) {
      co2_err_(res, 'SERIE_DUDOSA', 'La serie ' + leida + ' es dudosa' + (l.sugerida ? ' (en los números de lote figura ' + l.sugerida + ')' : '') +
        ': un administrador tiene que indicar a qué cilindro corresponde.' + (ctx.rolUsuario === 'ADMIN' ? '' : ' Enviá el remito a aprobación.'), s);
    } else if (ctx.rolUsuario !== 'ADMIN') {
      co2_err_(res, 'APROBACION_SOLO_ADMIN', 'La serie ' + leida + ' solo la puede aprobar un administrador. Enviá el remito a aprobación.', s);
    }
  });
}

function co2_validarRemito_(r, W, ctx, lote) {
  var res = co2_nuevoResultado_();
  co2_validarDudosas_(res, r, ctx);
  var nroNorm = co2_normalizarNroRemito(r.nroRemito);

  if (!nroNorm) co2_err_(res, 'REMITO_SIN_NUMERO', 'El remito no tiene número. Revisá el campo Número de remito.');
  var fechaOk = co2_validarFecha_(res, r.fecha, ctx);

  var dep = ctx.depositos[r.idDeposito];
  if (!dep) co2_err_(res, 'DEPOSITO_INEXISTENTE', 'El depósito "' + (r.idDeposito || '') + '" no existe. Elegí el depósito que recibió el remito.');
  else if (!dep.activo) co2_err_(res, 'DEPOSITO_INACTIVO', 'El depósito ' + dep.nombre + ' está inactivo.');
  var prov = String(r.proveedor || co2_PROVEEDOR_DEFECTO).toUpperCase(), nomProv = co2_nombreProveedor_(ctx, prov);
  if (ctx.proveedores && !ctx.proveedores[prov]) co2_err_(res, 'PROVEEDOR_INEXISTENTE', 'El proveedor "' + prov + '" no existe. Elegí LINDE o Gases Nordelta.');
  else if (dep && ctx.plazas && !Object.keys(ctx.plazas).some(function (k) { var p = ctx.plazas[k]; return p.depositoId === r.idDeposito && (p.proveedor || co2_PROVEEDOR_DEFECTO) === prov; })) {
    co2_adv_(res, 'PROVEEDOR_NO_USADO', 'Ninguna plaza del ' + dep.nombre + ' trabaja con ' + nomProv + ' (Datos → Plazas). Revisá el proveedor o el depósito.');
  }

  // Doble registro del mismo remito (validación 10). Copias duplicado/triplicado = mismo remito.
  if (nroNorm) {
    (ctx.remitos || []).concat(lote.remitos).forEach(function (x) {
      if (x.estado === 'ANULADO' || x.nroNorm !== nroNorm || (x.proveedor || co2_PROVEEDOR_DEFECTO) !== prov) return; // cada proveedor numera los suyos
      if (r.idPendiente && x.idRemito === String(r.idPendiente)) return; // v2.3: el mismo remito, que estaba esperando aprobación
      if (x.idDeposito === r.idDeposito) {
        co2_err_(res, 'REMITO_DUPLICADO',
          'El remito ' + r.nroRemito + ' ya está registrado para este depósito' + (x.idRemito ? ' (' + x.idRemito + ')' : ' en esta misma carga') +
          '. Si es un duplicado o triplicado, no se vuelve a cargar.');
      } else { // v1.6: un número de remito no se repite en ninguna plaza
        co2_err_(res, 'REMITO_DUPLICADO',
          'El remito ' + r.nroRemito + ' ya está registrado en el depósito ' + x.idDeposito + (x.idRemito ? ' (' + x.idRemito + ')' : ' en esta misma carga') +
          '. Un número de remito no se puede repetir.');
      }
    });
  }
  if (r.archivoHash) {
    (ctx.remitos || []).forEach(function (x) {
      if (r.idPendiente && x.idRemito === String(r.idPendiente)) return; // v2.3: es el mismo remito que esperaba aprobación
      if (x.estado !== 'ANULADO' && x.hash && x.hash === r.archivoHash) {
        co2_adv_(res, 'ARCHIVO_YA_CARGADO', 'Este mismo archivo ya se usó para el remito ' + x.idRemito + '.');
      }
    });
  }
  var copia = String(r.tipoCopia || '').toUpperCase();
  if (copia === 'DUPLICADO' || copia === 'TRIPLICADO') {
    co2_adv_(res, 'COPIA_NO_ORIGINAL', 'El documento es un ' + copia.toLowerCase() + '. Se registra una sola vez por número de remito.');
  }

  var lineas = (r.lineas || []).map(function (l) {
    return { tipo: String(l.tipo || '').toUpperCase(), serie: co2_normalizarSerie(l.serie), pesoKg: Number(l.pesoKg) || 0 };
  });
  var cargaDe = {};
  lineas.forEach(function (l) { if (l.tipo === 'ENTREGA') cargaDe[l.serie] = l.pesoKg; });
  if (!lineas.length) co2_err_(res, 'REMITO_SIN_CILINDROS', 'El remito no tiene cilindros cargados.');

  lineas.forEach(function (l, i) {
    if (!l.serie) co2_err_(res, 'SERIE_VACIA', 'La línea ' + (i + 1) + ' no tiene número de serie.');
    if (l.tipo !== 'ENTREGA' && l.tipo !== 'RETIRO') co2_err_(res, 'TIPO_LINEA_INVALIDO', 'La línea ' + (i + 1) + ' debe ser ENTREGA o RETIRO.');
  });

  var entregas = lineas.filter(function (l) { return l.tipo === 'ENTREGA' && l.serie; }).map(function (l) { return l.serie; });
  var retiros = lineas.filter(function (l) { return l.tipo === 'RETIRO' && l.serie; }).map(function (l) { return l.serie; });

  // Series duplicadas dentro del remito (validación 11).
  co2_repetidas_(entregas).concat(co2_repetidas_(retiros)).forEach(function (s) {
    co2_err_(res, 'SERIE_DUPLICADA_EN_REMITO', 'La serie ' + s + ' aparece dos veces en el mismo grupo del remito.', s);
  });
  entregas.forEach(function (s) {
    if (retiros.indexOf(s) >= 0) {
      co2_adv_(res, 'SERIE_ENTREGADA_Y_RETIRADA', 'La serie ' + s + ' figura entregada y retirada en el mismo remito. Se procesa primero el retiro y después la entrega (nuevo circuito).', s);
    }
  });

  if (res.errores.length || !fechaOk || !dep) return res; // sin datos de cabecera confiables no se simula

  // Primero los retiros (cierran circuitos), después las entregas (abren circuitos).
  retiros.forEach(function (serie) {
    var s = W[serie];
    if (!s) {
      co2_err_(res, 'RETIRO_LINDE_SERIE_INEXISTENTE',
        nomProv + ' retira la serie ' + serie + ', que no figura en el sistema. Si el cilindro estaba antes de empezar a usar el sistema, cargalo primero con Inventario inicial.', serie);
      return;
    }
    if (s.estado === co2_ESTADO.LINDE) {
      co2_err_(res, 'RETIRO_LINDE_CIRCUITO_CERRADO', 'La serie ' + serie + ' ya figura devuelta a ' + co2_nombreProveedor_(ctx, co2_provDe_(s)) + ' (circuito cerrado).', serie);
      return;
    }
    if (co2_provDe_(s) !== prov) {
      co2_err_(res, 'RETIRO_OTRO_PROVEEDOR', nomProv + ' retira la serie ' + serie + ', que es de ' + co2_nombreProveedor_(ctx, co2_provDe_(s)) + '. Revisá la serie o el proveedor del remito.', serie);
      return;
    }
    if (s.ubicTipo === co2_UBIC.CLIENTE) { // validación 6
      co2_err_(res, 'RETIRO_LINDE_EN_CLIENTE',
        nomProv + ' retira la serie ' + serie + ', pero figura en el ' + co2_describirUbicacion_(s, ctx) + '. Registrá primero el retiro del cliente o revisá la serie.', serie);
      return;
    }
    if (s.ubicTipo !== co2_UBIC.DEPOSITO || s.ubicId !== r.idDeposito) { // validación 7
      co2_err_(res, 'RETIRO_LINDE_OTRO_DEPOSITO',
        nomProv + ' retira la serie ' + serie + ' en ' + dep.nombre + ', pero el cilindro figura en ' + co2_describirUbicacion_(s, ctx) + '.', serie);
      return;
    }
    if (!co2_validarCronologia_(res, s, r.fecha, serie)) return;
    if (s.estado === co2_ESTADO.LLENO) {
      co2_adv_(res, 'RETIRO_LINDE_LLENO', nomProv + ' retira la serie ' + serie + ', que figura llena (nunca se entregó a un cliente en este circuito). Queda registrada para revisión.', serie);
    }
    var mov = co2_movimiento_({
      serie: serie, tipoMov: co2_MOV.RETIRO_LINDE, fecha: r.fecha,
      origenTipo: co2_UBIC.DEPOSITO, origenId: r.idDeposito, destinoTipo: co2_UBIC.LINDE, destinoId: prov,
      estadoAnterior: s.estado, estadoNuevo: co2_ESTADO.LINDE,
      idCircuito: s.idCircuito, depOrigen: s.depOrigen, circuitoCierra: true
    });
    res.movimientos.push(mov);
    co2_aplicar_(W, mov);
  });

  entregas.forEach(function (serie) {
    var s = W[serie];
    if (s && s.estado !== co2_ESTADO.LINDE) { // validación 8
      co2_err_(res, 'CIRCUITO_ABIERTO',
        nomProv + ' entrega la serie ' + serie + ', pero ese cilindro tiene un circuito abierto (' + co2_ESTADO_TEXTO[s.estado] + ', en ' + co2_describirUbicacion_(s, ctx) +
        '). No se puede iniciar un circuito nuevo sin cerrar el anterior.', serie);
      return;
    }
    if (!co2_validarCronologia_(res, s, r.fecha, serie)) return;
    if (!co2_validarCarga_(res, serie, cargaDe[serie], s, ctx)) return;
    if (!co2_validarProveedor_(res, serie, prov, s, ctx)) return;
    var mov = co2_movimiento_({
      serie: serie, tipoMov: co2_MOV.ENTREGA_LINDE, fecha: r.fecha,
      origenTipo: co2_UBIC.LINDE, origenId: prov, destinoTipo: co2_UBIC.DEPOSITO, destinoId: r.idDeposito,
      estadoAnterior: s ? s.estado : '', estadoNuevo: co2_ESTADO.LLENO,
      idCircuito: ctx.nuevoIdCircuito(), depOrigen: r.idDeposito, circuitoNuevo: true, pesoKg: cargaDe[serie], proveedor: prov
    });
    res.movimientos.push(mov);
    co2_aplicar_(W, mov);
  });

  lote.remitos.push({ nroNorm: nroNorm, idDeposito: r.idDeposito, estado: 'PENDIENTE', proveedor: prov });
  return res;
}

/* ---------------------------------------------------------------------------
 *  Trabajo en cliente
 *  t = { fecha, tipo: 'ENTREGA'|'RETIRO'|'RECAMBIO', idCliente, entregadas: [], retiradas: [] }
 * ------------------------------------------------------------------------ */
function co2_validarTrabajo_(t, W, ctx) {
  var res = co2_nuevoResultado_();
  var tipo = String(t.tipo || '').toUpperCase();
  var fechaOk = co2_validarFecha_(res, t.fecha, ctx);

  var cli = ctx.clientes[t.idCliente];
  if (!cli) co2_err_(res, 'CLIENTE_INEXISTENTE', 'El cliente "' + (t.idCliente || '') + '" no existe. Elegí un cliente de la lista.');

  var entregadas = (t.entregadas || []).map(co2_normalizarSerie).filter(String);
  var retiradas = (t.retiradas || []).map(co2_normalizarSerie).filter(String);

  // Un cliente inactivo puede devolver cilindros, pero no recibir.
  if (cli && !cli.activo && entregadas.length) {
    co2_err_(res, 'CLIENTE_INACTIVO', 'El cliente ' + cli.nombre + ' está inactivo: se le pueden retirar cilindros, pero no entregar.');
  }

  if (['ENTREGA', 'RETIRO', 'RECAMBIO'].indexOf(tipo) < 0) {
    co2_err_(res, 'TIPO_TRABAJO_INVALIDO', 'El tipo de trabajo debe ser Entrega, Retiro o Recambio.');
  } else {
    if (tipo === 'ENTREGA' && (!entregadas.length || retiradas.length))
      co2_err_(res, 'TIPO_INCOMPATIBLE', 'Una Entrega lleva al menos una serie entregada y ninguna retirada. Si también retirás, usá Recambio.');
    if (tipo === 'RETIRO' && (!retiradas.length || entregadas.length))
      co2_err_(res, 'TIPO_INCOMPATIBLE', 'Un Retiro lleva al menos una serie retirada y ninguna entregada. Si también entregás, usá Recambio.');
    if (tipo === 'RECAMBIO' && (!retiradas.length || !entregadas.length))
      co2_err_(res, 'TIPO_INCOMPATIBLE', 'Un Recambio lleva al menos una serie entregada y una retirada.');
  }

  co2_repetidas_(entregadas).concat(co2_repetidas_(retiradas)).forEach(function (s) { // validación 1
    co2_err_(res, 'SERIE_DUPLICADA_EN_TRABAJO', 'La serie ' + s + ' está cargada dos veces en el mismo grupo.', s);
  });
  entregadas.forEach(function (s) {
    if (retiradas.indexOf(s) >= 0) co2_err_(res, 'SERIE_ENTREGADA_Y_RETIRADA', 'La serie ' + s + ' figura como entregada y retirada en la misma visita.', s);
  });

  if (res.errores.length || !fechaOk || !cli) return res;

  // Primero los retiros (vuelven vacíos al depósito de origen), después las entregas.
  retiradas.forEach(function (serie) {
    var s = W[serie];
    if (!s) { co2_err_(res, 'SERIE_INEXISTENTE', 'La serie ' + serie + ' no existe en el sistema.', serie); return; }
    if (s.ubicTipo !== co2_UBIC.CLIENTE || s.ubicId !== t.idCliente) { // validación 5
      co2_err_(res, 'RETIRO_NO_FIGURA_EN_CLIENTE',
        'La serie ' + serie + ' no figura en ' + cli.nombre + '; figura en ' + co2_describirUbicacion_(s, ctx) + '. Revisá la serie o el cliente.', serie);
      return;
    }
    if (!s.depOrigen || !ctx.depositos[s.depOrigen]) {
      co2_err_(res, 'UBICACION_IMPOSIBLE', 'La serie ' + serie + ' no tiene depósito de origen de circuito; no se puede determinar a dónde vuelve.', serie);
      return;
    }
    if (!co2_validarCronologia_(res, s, t.fecha, serie)) return;
    var mov = co2_movimiento_({
      serie: serie, tipoMov: co2_MOV.RETIRO_CLIENTE, fecha: t.fecha,
      origenTipo: co2_UBIC.CLIENTE, origenId: t.idCliente, destinoTipo: co2_UBIC.DEPOSITO, destinoId: s.depOrigen,
      estadoAnterior: s.estado, estadoNuevo: co2_ESTADO.VACIO, idCircuito: s.idCircuito, depOrigen: s.depOrigen, zonaId: cli.zonaId
    });
    res.movimientos.push(mov);
    co2_aplicar_(W, mov);
  });

  entregadas.forEach(function (serie) {
    var s = W[serie];
    if (!s) { co2_err_(res, 'SERIE_INEXISTENTE', 'La serie ' + serie + ' no existe en el sistema. Revisá el número o cargá el remito del proveedor.', serie); return; } // validación 2
    if (s.estado === co2_ESTADO.EN_USO) { // validación 4
      var mismo = s.ubicId === t.idCliente;
      co2_err_(res, 'ENTREGA_YA_EN_CLIENTE',
        'La serie ' + serie + (mismo ? ' ya figura en este cliente.' : ' ya está en el ' + co2_describirUbicacion_(s, ctx) + '.'), serie);
      return;
    }
    if (s.estado === co2_ESTADO.VACIO) { // validación 3
      co2_err_(res, 'ENTREGA_CILINDRO_VACIO', 'La serie ' + serie + ' figura vacía en ' + co2_describirUbicacion_(s, ctx) + '. Solo se entregan cilindros llenos.', serie);
      return;
    }
    if (s.estado === co2_ESTADO.LINDE) { // validación 12
      co2_err_(res, 'ENTREGA_FUERA_DE_CIRCUITO', 'La serie ' + serie + ' figura devuelta a ' + co2_nombreProveedor_(ctx, co2_provDe_(s)) + '. No está disponible en ningún depósito.', serie);
      return;
    }
    if (s.ubicTipo !== co2_UBIC.DEPOSITO || !ctx.depositos[s.ubicId]) { // validación 13
      co2_err_(res, 'UBICACION_IMPOSIBLE', 'La serie ' + serie + ' figura llena pero no está en un depósito válido (' + co2_describirUbicacion_(s, ctx) + ').', serie);
      return;
    }
    var dep = ctx.depositos[s.ubicId];
    // validación 9 (v2): el depósito del cliente sale de su zona → plaza → depósito. Un cilindro solo cambia de depósito mediante LINDE.
    if (!cli.depositoId) {
      co2_err_(res, 'CLIENTE_SIN_DEPOSITO', 'El cliente ' + cli.nombre + ' no tiene depósito: revisá su zona y que la plaza de esa zona tenga depósito asignado.', serie);
      return;
    }
    if (cli.depositoId !== s.ubicId) {
      co2_err_(res, 'CAMBIO_DEPOSITO_SIN_LINDE',
        'La serie ' + serie + ' está en el depósito ' + dep.nombre + ' y el cliente se abastece del depósito ' + co2_nombreDeposito_(ctx, cli.depositoId) +
        '. Un cilindro solo cambia de depósito mediante el proveedor.', serie);
      return;
    }
    var provCli = co2_proveedorCliente_(cli, ctx);
    if (co2_provDe_(s) !== provCli) { // v2.1: cada plaza trabaja con un proveedor (AMBA: CABA con LINDE, GBA con Gases Nordelta)
      co2_err_(res, 'PROVEEDOR_NO_CORRESPONDE', 'La serie ' + serie + ' es de ' + co2_nombreProveedor_(ctx, co2_provDe_(s)) + ' y ' + cli.nombre +
        ' trabaja con ' + co2_nombreProveedor_(ctx, provCli) + ' (su plaza, en Datos → Plazas). Entregale un cilindro de ' + co2_nombreProveedor_(ctx, provCli) + '.', serie);
      return;
    }
    if (!co2_validarCronologia_(res, s, t.fecha, serie)) return;
    var mov = co2_movimiento_({
      serie: serie, tipoMov: co2_MOV.ENTREGA_CLIENTE, fecha: t.fecha,
      origenTipo: co2_UBIC.DEPOSITO, origenId: s.ubicId, destinoTipo: co2_UBIC.CLIENTE, destinoId: t.idCliente,
      estadoAnterior: s.estado, estadoNuevo: co2_ESTADO.EN_USO, idCircuito: s.idCircuito, depOrigen: s.depOrigen, zonaId: cli.zonaId
    });
    res.movimientos.push(mov);
    co2_aplicar_(W, mov);
  });

  return res;
}

/* ---------------------------------------------------------------------------
 *  Inventario inicial (solo administradores)
 *  a = { fecha, serie, idDepositoOrigen, ubicacion: 'DEPOSITO'|'CLIENTE', idCliente, estado }
 * ------------------------------------------------------------------------ */
function co2_validarAltaInicial_(a, W, ctx) {
  var res = co2_nuevoResultado_();
  var serie = co2_normalizarSerie(a.serie);
  var fechaOk = co2_validarFecha_(res, a.fecha, ctx);
  if (!serie) co2_err_(res, 'SERIE_VACIA', 'Falta el número de serie.');

  var dep = ctx.depositos[a.idDepositoOrigen];
  if (!dep) co2_err_(res, 'DEPOSITO_INEXISTENTE', 'Elegí el depósito de origen del circuito.');

  var ubic = String(a.ubicacion || '').toUpperCase();
  var estado = String(a.estado || '').toUpperCase();
  var cli = null;
  var prov = String(a.proveedor || (ubic === co2_UBIC.CLIENTE && ctx.clientes[a.idCliente] ? co2_proveedorCliente_(ctx.clientes[a.idCliente], ctx) : co2_PROVEEDOR_DEFECTO)).toUpperCase();
  if (ctx.proveedores && !ctx.proveedores[prov]) co2_err_(res, 'PROVEEDOR_INEXISTENTE', 'El proveedor "' + prov + '" no existe. Elegí LINDE o Gases Nordelta.');
  if (ubic === co2_UBIC.CLIENTE) {
    cli = ctx.clientes[a.idCliente];
    if (!cli) co2_err_(res, 'CLIENTE_INEXISTENTE', 'Elegí el cliente donde está el cilindro.');
    else if (dep && cli.depositoId !== a.idDepositoOrigen)
      co2_err_(res, 'CAMBIO_DEPOSITO_SIN_LINDE', 'El cliente se abastece del depósito ' + co2_nombreDeposito_(ctx, cli.depositoId) + ' y el depósito de origen elegido es ' + dep.nombre + '.', serie);
    if (estado !== co2_ESTADO.EN_USO) co2_err_(res, 'ESTADO_INVALIDO', 'Un cilindro en cliente se registra En uso.', serie);
    if (cli && co2_proveedorCliente_(cli, ctx) !== prov) co2_err_(res, 'PROVEEDOR_NO_CORRESPONDE', 'El cliente ' + cli.nombre + ' trabaja con ' + co2_nombreProveedor_(ctx, co2_proveedorCliente_(cli, ctx)) +
      ' y el cilindro es de ' + co2_nombreProveedor_(ctx, prov) + '.', serie);
  } else if (ubic === co2_UBIC.DEPOSITO) {
    if (estado !== co2_ESTADO.LLENO && estado !== co2_ESTADO.VACIO) co2_err_(res, 'ESTADO_INVALIDO', 'Un cilindro en depósito se registra Lleno disponible o Vacío disponible.', serie);
  } else {
    co2_err_(res, 'UBICACION_INVALIDA', 'La ubicación debe ser Depósito o Cliente.');
  }

  if (res.errores.length || !fechaOk) return res;

  var s = W[serie];
  if (s && s.estado !== co2_ESTADO.LINDE) {
    co2_err_(res, 'CIRCUITO_ABIERTO', 'La serie ' + serie + ' ya tiene un circuito abierto (' + co2_ESTADO_TEXTO[s.estado] + ', en ' + co2_describirUbicacion_(s, ctx) + ').', serie);
    return res;
  }
  if (!co2_validarCronologia_(res, s, a.fecha, serie)) return res;
  if (!co2_validarCarga_(res, serie, a.pesoKg, s, ctx)) return res;
  if (!co2_validarProveedor_(res, serie, prov, s, ctx)) return res;
  co2_adv_(res, 'ALTA_SIN_REMITO', 'La serie ' + serie + ' entra al sistema sin remito de ' + co2_nombreProveedor_(ctx, prov) + ' (inventario inicial).', serie);

  var mov = co2_movimiento_({
    serie: serie, tipoMov: co2_MOV.ALTA_INICIAL, fecha: a.fecha,
    origenTipo: co2_UBIC.INVENTARIO, origenId: 'INVENTARIO',
    destinoTipo: ubic, destinoId: ubic === co2_UBIC.CLIENTE ? a.idCliente : a.idDepositoOrigen,
    estadoAnterior: s ? s.estado : '', estadoNuevo: estado,
    idCircuito: ctx.nuevoIdCircuito(), depOrigen: a.idDepositoOrigen, circuitoNuevo: true, pesoKg: Number(a.pesoKg) || '',
    zonaId: cli ? cli.zonaId : '', proveedor: prov
  });
  res.movimientos.push(mov);
  co2_aplicar_(W, mov);
  return res;
}

/* ---------------------------------------------------------------------------
 *  Punto de entrada: simula un lote de operaciones en orden.
 *  ops = [{ clase: 'REMITO'|'TRABAJO'|'ALTA', datos: {...} }, ...]
 *  ctx = { hoy, depositos, clientes, cilindros, remitos, nuevoIdCircuito }
 *  Devuelve { ok, resultados: [...], estadosFinales }
 *  Si alguna operación tiene errores, ok = false y no se debe confirmar nada.
 * ------------------------------------------------------------------------ */
function co2_simularLote(ops, ctx) {
  var W = co2_clonarEstados_(ctx.cilindros);
  var lote = { remitos: [] };
  var resultados = (ops || []).map(function (op) {
    var res;
    if (op.clase === 'REMITO') res = co2_validarRemito_(op.datos, W, ctx, lote);
    else if (op.clase === 'TRABAJO') res = co2_validarTrabajo_(op.datos, W, ctx);
    else if (op.clase === 'ALTA') res = co2_validarAltaInicial_(op.datos, W, ctx);
    else { res = co2_nuevoResultado_(); co2_err_(res, 'OPERACION_DESCONOCIDA', 'Tipo de operación desconocido: ' + op.clase); }
    res.clase = op.clase;
    return res;
  });
  var ok = resultados.every(function (r) { return r.errores.length === 0; });
  return { ok: ok, resultados: resultados, estadosFinales: W };
}

/* ---------------------------------------------------------------------------
 *  Reconstrucción por historial (auditoría y anulaciones)
 *  movs: movimientos NO anulados de UNA serie, en orden de registro.
 *  Devuelve { estado, circuitos, inconsistencias }
 * ------------------------------------------------------------------------ */
function co2_reconstruirSerie(serie, movs) {
  var estado = null, circuitos = {}, inconsistencias = [], peso = '', prov = '';
  movs.forEach(function (m) {
    var anterior = estado ? estado.estado : '';
    if ((m.estadoAnterior || '') !== anterior) {
      inconsistencias.push({
        codigo: 'HISTORIAL_INCOHERENTE', serie: serie,
        mensaje: 'El movimiento ' + (m.idMov || '') + ' (' + m.tipoMov + ', ' + co2_fechaTexto(m.fecha) + ') esperaba estado "' +
          (m.estadoAnterior || 'sin registro') + '" pero la serie estaba "' + (anterior || 'sin registro') + '".'
      });
    }
    if (m.tipoMov === co2_MOV.ENTREGA_LINDE || m.tipoMov === co2_MOV.ALTA_INICIAL) {
      circuitos[m.idCircuito] = {
        idCircuito: m.idCircuito, serie: serie, depOrigen: m.depOrigen, fechaInicio: m.fecha,
        refEntrada: m.refId || '', fechaCierre: '', refSalida: '', estado: 'ABIERTO'
      };
    }
    if (m.tipoMov === co2_MOV.RETIRO_LINDE && circuitos[m.idCircuito]) {
      circuitos[m.idCircuito].fechaCierre = m.fecha;
      circuitos[m.idCircuito].refSalida = m.refId || '';
      circuitos[m.idCircuito].estado = 'CERRADO';
    }
    if (m.pesoKg) peso = Number(m.pesoKg);
    if (m.proveedor) prov = m.proveedor;
    estado = {
      serie: serie, estado: m.estadoNuevo, ubicTipo: m.destinoTipo, ubicId: m.destinoId, pesoKg: peso, proveedor: prov || co2_PROVEEDOR_DEFECTO,
      idCircuito: m.idCircuito, depOrigen: m.depOrigen, ultimaFecha: m.fecha
    };
  });
  return { estado: estado, circuitos: circuitos, inconsistencias: inconsistencias };
}

/**
 * Una operación solo se puede anular si, para cada serie que tocó, sus
 * movimientos son los últimos vigentes. Así nunca se "borra" un hecho del
 * que dependen movimientos posteriores.
 * movsPorSerie: { serie: [movimientos vigentes en orden] }
 */
function co2_validarAnulacion(refId, movsPorSerie) {
  var errores = [];
  var afectadas = [];
  Object.keys(movsPorSerie).forEach(function (serie) {
    var lista = movsPorSerie[serie];
    var idx = [];
    lista.forEach(function (m, i) { if (m.refId === refId) idx.push(i); });
    if (!idx.length) return;
    afectadas.push(serie);
    var ultimoAjeno = -1;
    lista.forEach(function (m, i) { if (m.refId !== refId) ultimoAjeno = i; });
    if (ultimoAjeno > idx[0]) {
      var m = lista[ultimoAjeno];
      errores.push({
        codigo: 'ANULACION_CON_MOVIMIENTOS_POSTERIORES', serie: serie,
        mensaje: 'La serie ' + serie + ' tiene un movimiento posterior (' + m.tipoMov + ', ' + co2_fechaTexto(m.fecha) + ', ' + m.refId +
          '). Anulá primero esa operación.'
      });
    }
  });
  if (!afectadas.length) errores.push({ codigo: 'REFERENCIA_SIN_MOVIMIENTOS', serie: '', mensaje: 'La operación ' + refId + ' no tiene movimientos vigentes.' });
  return { ok: errores.length === 0, errores: errores, series: afectadas };
}

/* ---------------------------------------------------------------------------
 *  Alertas por número de serie (v1.1)
 *  No son errores de carga: son situaciones físicas que conviene revisar.
 *  - CILINDRO_INMOVILIZADO: en un cliente sin movimientos hace más de N días.
 *  - VACIO_SIN_DEVOLVER: vacío en el depósito sin que LINDE lo retire hace más de N días.
 *  estados: mapa serie → estado actual (como ctx.cilindros).
 *  op = { hoy, diasCliente, diasVacio, clientes, depositos }
 * ------------------------------------------------------------------------ */
function co2_diasEntre(desdeIso, hastaIso) {
  if (!co2_esFechaValida(desdeIso) || !co2_esFechaValida(hastaIso)) return 0;
  var a = desdeIso.split('-').map(Number), b = hastaIso.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

function co2_detectarAlertas(estados, op) {
  var alertas = [];
  var ctx = { clientes: op.clientes || {}, depositos: op.depositos || {} };
  Object.keys(estados).sort().forEach(function (serie) {
    var s = estados[serie];
    var dias = co2_diasEntre(s.ultimaFecha, op.hoy);
    if (s.estado === co2_ESTADO.EN_USO && op.diasCliente > 0 && dias > op.diasCliente) {
      alertas.push({
        codigo: 'CILINDRO_INMOVILIZADO', serie: serie, idCircuito: s.idCircuito, dias: dias,
        ubicacion: co2_describirUbicacion_(s, ctx), ubicId: s.ubicId, desde: s.ultimaFecha,
        mensaje: 'La serie ' + serie + ' está en el ' + co2_describirUbicacion_(s, ctx) + ' desde el ' + co2_fechaTexto(s.ultimaFecha) +
          ' (' + dias + ' días, límite ' + op.diasCliente + '). Verificar si sigue ahí y si se está usando.'
      });
    }
    if (s.estado === co2_ESTADO.VACIO && op.diasVacio > 0 && dias > op.diasVacio) {
      alertas.push({
        codigo: 'VACIO_SIN_DEVOLVER', serie: serie, idCircuito: s.idCircuito, dias: dias,
        ubicacion: co2_describirUbicacion_(s, ctx), ubicId: s.ubicId, desde: s.ultimaFecha,
        mensaje: 'La serie ' + serie + ' está vacía en el ' + co2_describirUbicacion_(s, ctx) + ' desde el ' + co2_fechaTexto(s.ultimaFecha) +
          ' (' + dias + ' días, límite ' + op.diasVacio + '). Pedir el retiro a ' + co2_nombreProveedor_(op, co2_provDe_(s)) + ' o verificar si ya se lo llevó sin remito cargado.'
      });
    }
  });
  // Referencias rotas: el cilindro apunta a un depósito o cliente que ya no existe en las hojas maestras.
  Object.keys(estados).sort().forEach(function (serie) {
    var s = estados[serie];
    if (s.estado === co2_ESTADO.LINDE) return;
    if (s.depOrigen && !ctx.depositos[s.depOrigen]) {
      alertas.push({
        codigo: 'DEPOSITO_INEXISTENTE', serie: serie, idCircuito: s.idCircuito, dias: 0, ubicacion: co2_describirUbicacion_(s, ctx), ubicId: s.depOrigen, desde: s.ultimaFecha,
        mensaje: 'La serie ' + serie + ' tiene como depósito de origen "' + s.depOrigen + '", que no está en depositos (Maestros). ¿Se cambió o borró el depósito?'
      });
    }
    if (s.ubicTipo === co2_UBIC.CLIENTE && !ctx.clientes[s.ubicId]) {
      alertas.push({
        codigo: 'CLIENTE_INEXISTENTE', serie: serie, idCircuito: s.idCircuito, dias: 0, ubicacion: 'cliente ' + s.ubicId, ubicId: s.ubicId, desde: s.ultimaFecha,
        mensaje: 'La serie ' + serie + ' figura en el cliente "' + s.ubicId + '", que no está en clientes (Maestros). ¿Se cambió o borró el cliente?'
      });
    }
  });
  return alertas.sort(function (a, b) { return b.dias - a.dias; });
}

/* ---------------------------------------------------------------------------
 *  Recambios y consumo por cliente (v1.5)
 *  Consumo = carga (kg) de cada vacío retirado del cliente: se supone que el
 *  cilindro se usó entero. Un "recambio" es una visita con retiro (un trabajo,
 *  aunque retire varios cilindros). La predicción del próximo recambio es
 *  último recambio + días promedio entre recambios.
 *  movs: movimientos vigentes en orden. op: { hoy, meses (0 = todo el historial),
 *  cilindros, clientes, mesesGrafico }.
 * ------------------------------------------------------------------------ */
function co2_sumarDiasIso(iso, n) {
  var p = String(iso).split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

function co2_restarMesesIso(iso, n) {
  var p = String(iso).split('-').map(Number);
  var ultimoDia = new Date(Date.UTC(p[0], p[1] - 1 - n + 1, 0)).getUTCDate();
  var d = new Date(Date.UTC(p[0], p[1] - 1 - n, Math.min(p[2], ultimoDia)));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

function co2_analizarRecambios(movs, op) {
  var hoy = op.hoy, meses = Number(op.meses) || 0;
  var desde = meses ? co2_restarMesesIso(hoy, meses) : '';
  var cils = op.cilindros || {}, clientes = op.clientes || {};
  var pesoDe = function (m) { return Number((cils[m.serie] || {}).pesoKg) || Number(m.pesoKg) || 0; };
  var porCli = {};
  var cli = function (id) {
    if (!porCli[id]) porCli[id] = { primerMov: '', eventos: {}, zonaId: '' };
    return porCli[id];
  };
  movs.forEach(function (m) {
    if (!co2_esFechaValida(m.fecha)) return;
    var id = m.destinoTipo === co2_UBIC.CLIENTE ? m.destinoId : (m.origenTipo === co2_UBIC.CLIENTE ? m.origenId : '');
    if (!id) return;
    var c = cli(id);
    if (!c.primerMov || m.fecha < c.primerMov) c.primerMov = m.fecha;
    if (m.zonaId) c.zonaId = m.zonaId; // la zona del último movimiento, por si el cliente ya no existe
    if (m.tipoMov === co2_MOV.RETIRO_CLIENTE) {
      var k = (m.refId || '') + '|' + m.fecha;
      var e = c.eventos[k] || (c.eventos[k] = { fecha: m.fecha, kg: 0, cilindros: 0, sinCarga: 0 });
      var kg = pesoDe(m);
      e.kg += kg; e.cilindros++; if (!kg) e.sinCarga++;
    }
  });

  // Consumo mensual de los últimos N meses (incluye el mes en curso).
  var nGraf = Number(op.mesesGrafico) || 12;
  var mesHoy = String(hoy).slice(0, 7), listaMeses = [];
  for (var i = nGraf - 1; i >= 0; i--) listaMeses.push(co2_restarMesesIso(mesHoy + '-01', i).slice(0, 7));
  var mensual = {};
  listaMeses.forEach(function (mm) { mensual[mm] = { mes: mm, porZona: {}, total: 0, enCurso: mm === mesHoy }; });

  var filas = Object.keys(porCli).map(function (id) {
    var c = porCli[id], info = clientes[id];
    var zonaId = info ? info.zonaId : c.zonaId;
    var eventos = Object.keys(c.eventos).map(function (k) { return c.eventos[k]; })
      .sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
    eventos.forEach(function (e) {
      var mm = e.fecha.slice(0, 7);
      if (mensual[mm]) { mensual[mm].porZona[zonaId] = (mensual[mm].porZona[zonaId] || 0) + e.kg; mensual[mm].total += e.kg; }
    });
    var enPeriodo = eventos.filter(function (e) { return !desde || e.fecha >= desde; });
    var kgPeriodo = enPeriodo.reduce(function (a, e) { return a + e.kg; }, 0);
    var inicio = (desde && desde > c.primerMov) ? desde : c.primerMov;
    var diasMedidos = co2_diasEntre(inicio, hoy);
    // Ciclos: del primer movimiento al primer recambio, y entre recambios (en días distintos).
    var hitos = [c.primerMov].concat(eventos.map(function (e) { return e.fecha; }))
      .filter(function (f, i, a) { return i === 0 || f !== a[i - 1]; });
    var intervalos = [];
    for (var j = 1; j < hitos.length; j++) if (!desde || hitos[j] >= desde) intervalos.push(co2_diasEntre(hitos[j - 1], hitos[j]));
    var intervalo = intervalos.length ? Math.round(intervalos.reduce(function (a, b) { return a + b; }, 0) / intervalos.length) : null;
    var ultimo = eventos.length ? eventos[eventos.length - 1].fecha : '';
    var proximo = (ultimo && intervalo) ? co2_sumarDiasIso(ultimo, intervalo) : '';
    var enCliente = Object.keys(cils).filter(function (s) { var x = cils[s]; return x.ubicTipo === co2_UBIC.CLIENTE && x.ubicId === id && x.estado === co2_ESTADO.EN_USO; });
    return {
      id: id, nombre: info ? info.nombre : 'Cliente inexistente: ' + id, zonaId: zonaId, activo: info ? info.activo : false,
      recambios: enPeriodo.length, kg: kgPeriodo, sinCarga: enPeriodo.reduce(function (a, e) { return a + e.sinCarga; }, 0),
      kgMes: diasMedidos >= 30 ? Math.round(kgPeriodo / diasMedidos * 30.44 * 10) / 10 : null,
      diasMedidos: diasMedidos, intervalo: intervalo, ciclos: intervalos.length,
      ultimo: ultimo, proximo: proximo, diasParaProximo: proximo ? co2_diasEntre(hoy, proximo) : null,
      cilindrosEnCliente: enCliente.length,
      kgEnCliente: enCliente.reduce(function (a, s) { return a + (Number(cils[s].pesoKg) || 0); }, 0)
    };
  });
  filas.sort(function (a, b) {
    var pa = a.proximo || '9999', pb = b.proximo || '9999';
    return pa < pb ? -1 : pa > pb ? 1 : String(a.nombre).localeCompare(String(b.nombre));
  });
  return { hoy: hoy, desde: desde, meses: meses, clientes: filas, mensual: listaMeses.map(function (mm) { return mensual[mm]; }) };
}

/* ---------------------------------------------------------------------------
 *  Carga inicial en borrador (v1.6)
 *  Mientras se cargan remitos históricos de varias plazas, un remito se guarda
 *  como borrador sin simular circuitos: solo se controla lo que no depende del
 *  orden de carga (datos del encabezado, líneas, carga y número no repetido).
 *  Los circuitos se validan al procesar todos juntos por fecha.
 *  borradores: [{ id, nroNorm, idDeposito, estado, hash, entregas: [series] }]
 * ------------------------------------------------------------------------ */
function co2_validarBorradorRemito(r, ctx, borradores) {
  var res = co2_nuevoResultado_();
  co2_validarDudosas_(res, r, ctx);
  var nroNorm = co2_normalizarNroRemito(r.nroRemito);
  if (!nroNorm) co2_err_(res, 'REMITO_SIN_NUMERO', 'El remito no tiene número. Revisá el campo Número de remito.');
  co2_validarFecha_(res, r.fecha, ctx);
  var dep = ctx.depositos[r.idDeposito];
  if (!dep) co2_err_(res, 'DEPOSITO_INEXISTENTE', 'El depósito "' + (r.idDeposito || '') + '" no existe. Elegí el depósito que recibió el remito.');
  else if (!dep.activo) co2_err_(res, 'DEPOSITO_INACTIVO', 'El depósito ' + dep.nombre + ' está inactivo.');

  var otros = (borradores || []).filter(function (b) { return b.id !== r.idBorrador && b.estado !== 'PROCESADO'; });
  if (nroNorm) {
    (ctx.remitos || []).forEach(function (x) {
      if (x.estado === 'ANULADO' || x.nroNorm !== nroNorm) return;
      co2_err_(res, 'REMITO_DUPLICADO', 'El remito ' + r.nroRemito + ' ya está registrado en el depósito ' + x.idDeposito + (x.idRemito ? ' (' + x.idRemito + ')' : '') + '. Un número de remito no se puede repetir.');
    });
    otros.forEach(function (b) {
      if (b.nroNorm !== nroNorm) return;
      co2_err_(res, 'REMITO_DUPLICADO', 'El remito ' + r.nroRemito + ' ya está cargado como borrador (' + b.id + ', depósito ' + b.idDeposito + '). Un número de remito no se puede repetir.');
    });
  }
  if (r.archivoHash) {
    (ctx.remitos || []).concat(otros.map(function (b) { return { idRemito: b.id, hash: b.hash }; })).forEach(function (x) {
      if (x.estado !== 'ANULADO' && x.hash && x.hash === r.archivoHash) co2_adv_(res, 'ARCHIVO_YA_CARGADO', 'Este mismo archivo ya se usó para ' + x.idRemito + '.');
    });
  }

  var lineas = (r.lineas || []).map(function (l) {
    return { tipo: String(l.tipo || '').toUpperCase(), serie: co2_normalizarSerie(l.serie), pesoKg: Number(l.pesoKg) || 0 };
  });
  if (!lineas.length) co2_err_(res, 'REMITO_SIN_CILINDROS', 'El remito no tiene cilindros cargados.');
  lineas.forEach(function (l, i) {
    if (!l.serie) co2_err_(res, 'SERIE_VACIA', 'La línea ' + (i + 1) + ' no tiene número de serie.');
    if (l.tipo !== 'ENTREGA' && l.tipo !== 'RETIRO') co2_err_(res, 'TIPO_LINEA_INVALIDO', 'La línea ' + (i + 1) + ' debe ser ENTREGA o RETIRO.');
  });
  var entregas = lineas.filter(function (l) { return l.tipo === 'ENTREGA' && l.serie; });
  var retiros = lineas.filter(function (l) { return l.tipo === 'RETIRO' && l.serie; }).map(function (l) { return l.serie; });
  co2_repetidas_(entregas.map(function (l) { return l.serie; })).concat(co2_repetidas_(retiros)).forEach(function (s) {
    co2_err_(res, 'SERIE_DUPLICADA_EN_REMITO', 'La serie ' + s + ' aparece dos veces en el mismo grupo del remito.', s);
  });
  entregas.forEach(function (l) { co2_validarCarga_(res, l.serie, l.pesoKg, ctx.cilindros[l.serie], ctx); });

  // Aviso temprano: un retiro de una serie que no aparece en ningún lado va a fallar al procesar.
  var conocidas = {};
  Object.keys(ctx.cilindros || {}).forEach(function (s) { conocidas[s] = true; });
  otros.forEach(function (b) { (b.entregas || []).forEach(function (s) { conocidas[s] = true; }); });
  entregas.forEach(function (l) { conocidas[l.serie] = true; });
  retiros.forEach(function (s) {
    if (!conocidas[s]) co2_adv_(res, 'RETIRO_SIN_ENTREGA_PREVIA',
      'La serie ' + s + ' no figura en el sistema ni en otros borradores. Al procesar va a fallar, salvo que antes se cargue su entrega en otro remito o en Inventario inicial.', s);
  });
  return res;
}

/** Orden de proceso de la carga inicial: por fecha y, a igual fecha, por número de remito. */
function co2_ordenarBorradores(borradores) {
  return borradores.slice().sort(function (a, b) {
    return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.nroNorm < b.nroNorm ? -1 : a.nroNorm > b.nroNorm ? 1 : 0);
  });
}

/**
 * Simula la carga inicial en memoria: procesa los borradores en orden y, si
 * alguno falla, vuelve a intentarlo después (a igual fecha el orden puede
 * importar). Devuelve los aceptados en un orden válido y los que fallaron.
 * opDe(b) arma la operación REMITO de cada borrador.
 */
function co2_simularCargaInicial(borradores, ctx, opDe) {
  var pendientes = co2_ordenarBorradores(borradores), aceptados = [], errores = {};
  var hubo = true;
  while (hubo && pendientes.length) {
    hubo = false;
    var siguen = [];
    pendientes.forEach(function (b) {
      var op = opDe(b);
      var sim = co2_simularLote([op], ctx);
      if (sim.ok) {
        ctx.cilindros = sim.estadosFinales;
        ctx.remitos = (ctx.remitos || []).concat([{ idRemito: b.id, nroNorm: b.nroNorm, idDeposito: op.datos.idDeposito, hash: op.datos.archivoHash, estado: 'CONFIRMADO' }]);
        aceptados.push(b); delete errores[b.id]; hubo = true;
      } else {
        errores[b.id] = sim.resultados[0].errores;
        siguen.push(b);
      }
    });
    pendientes = siguen;
  }
  return { aceptados: aceptados, fallidos: pendientes.map(function (b) { return { borrador: b, errores: errores[b.id] || [] }; }) };
}


export {
  co2_PROVEEDOR_DEFECTO,
  co2_provDe_,
  co2_nombreProveedor_,
  co2_proveedorCliente_,
  co2_ESTADO,
  co2_ESTADO_TEXTO,
  co2_MOV,
  co2_UBIC,
  co2_adv_,
  co2_analizarRecambios,
  co2_aplicar_,
  co2_clonarEstados_,
  co2_describirUbicacion_,
  co2_detectarAlertas,
  co2_diasEntre,
  co2_err_,
  co2_esFechaValida,
  co2_fechaTexto,
  co2_movimiento_,
  co2_nombreDeposito_,
  co2_normalizarNroRemito,
  co2_normalizarSerie,
  co2_nuevoResultado_,
  co2_ordenarBorradores,
  co2_reconstruirSerie,
  co2_repetidas_,
  co2_restarMesesIso,
  co2_simularCargaInicial,
  co2_simularLote,
  co2_sumarDiasIso,
  co2_validarAltaInicial_,
  co2_validarAnulacion,
  co2_validarBorradorRemito,
  co2_validarCarga_,
  co2_validarCronologia_,
  co2_validarDudosas_,
  co2_validarFecha_,
  co2_validarRemito_,
  co2_validarTrabajo_
};
