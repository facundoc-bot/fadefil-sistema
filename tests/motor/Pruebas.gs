/**
 * ============================================================================
 *  SISTEMA FADEFIL — Pruebas.gs
 *  Pruebas del motor de reglas. NO tocan la planilla: trabajan con datos
 *  en memoria. Ejecutá ejecutarPruebas() desde el editor.
 * ============================================================================
 */

function ctxPrueba_() {
  var ctx = {
    hoy: '2026-10-20',
    plazas: {
      MENDOZA: { plaza: 'MENDOZA', provincia: 'Mendoza', deposito: 'Depósito Mendoza', activa: true },
      CORDOBA: { plaza: 'CORDOBA', provincia: 'Córdoba', deposito: 'Depósito Córdoba', activa: true }
    },
    depositos: {
      'Depósito Mendoza': { id: 'Depósito Mendoza', plaza: 'MENDOZA', activo: true },
      'Depósito Córdoba': { id: 'Depósito Córdoba', plaza: 'CORDOBA', activo: true },
      'Depósito CABA': { id: 'Depósito CABA', plaza: 'CABA', activo: true, controlaStock: false }
    },
    clientes: {
      C1: { id: 'C1', nombre: 'Bar Uno', plaza: 'MENDOZA', zona: 'Centro', frecuencia: '' },
      C2: { id: 'C2', nombre: 'Bar Dos', plaza: 'MENDOZA', zona: 'Godoy Cruz', frecuencia: 60 },
      C3: { id: 'C3', nombre: 'Hotel Tres', plaza: 'CORDOBA', zona: 'Nueva Córdoba', frecuencia: '' },
      C9: { id: 'C9', nombre: 'Sin plaza', plaza: 'SALTA', zona: '', frecuencia: '' }
    },
    maquinas: {
      S1: { serie: 'S1', modelo: 'AQA 200', fechaAlta: '2026-01-01', depositoInicial: 'Depósito Mendoza' },
      S2: { serie: 'S2', modelo: 'AQA 200', fechaAlta: '2026-01-01', depositoInicial: 'Depósito Mendoza' },
      S3: { serie: 'S3', modelo: 'AQA 300', fechaAlta: '2026-01-01', depositoInicial: 'Depósito Mendoza' },
      S4: { serie: 'S4', modelo: 'AQA 300', fechaAlta: '2026-01-01', depositoInicial: 'Depósito CABA' },
      S5: { serie: 'S5', modelo: 'HL 50', fechaAlta: '2026-01-01', depositoInicial: 'Depósito Córdoba' }
    },
    catalogo: {
      BOMBA: { codigo: 'BOMBA', descripcion: 'Bomba Starflo', categoria: 'INSUMO', activo: true },
      REG: { codigo: 'REG', descripcion: 'Regulador', categoria: 'INSUMO', activo: true },
      BOT: { codigo: 'BOT', descripcion: 'Botella', categoria: 'ADICIONAL', activo: true },
      CAJ: { codigo: 'CAJ', descripcion: 'Cajón', categoria: 'ADICIONAL', activo: true },
      FSED: { codigo: 'FSED', descripcion: 'Filtro sedimento', categoria: 'FILTRO', activo: true },
      FRENTE: { codigo: 'FRENTE', descripcion: 'Frente de equipo', categoria: 'REPUESTO', activo: true },
      RFIL: { codigo: 'RFIL', descripcion: 'Cartucho de recambio', categoria: 'RECAMBIO_FILTRO', activo: true },
      VIEJO: { codigo: 'VIEJO', descripcion: 'Ítem dado de baja', categoria: 'INSUMO', activo: false }
    },
    reglas: null
  };
  ctx.estado = estadoInicial(ctx);
  return ctx;
}

var N_OP_PRUEBA_ = 0;

function otP_(fecha, idCliente, tipo, extra) {
  var d = { fecha: fecha, idCliente: idCliente, tipo: tipo, items: [] };
  Object.keys(extra || {}).forEach(function (k) { d[k] = extra[k]; });
  return { clase: 'OT', datos: d };
}

function opP_(clase, datos) { return { clase: clase, datos: datos }; }

/** Simula y, si todo es válido, deja el estado confirmado en el contexto. Les pone id a las operaciones. */
function confirmarP_(ctx, ops) {
  ops.forEach(function (o) { if (!o.id) { N_OP_PRUEBA_++; o.id = 'T-' + N_OP_PRUEBA_; } });
  var sim = simularLote(ops, ctx);
  if (sim.ok) {
    ctx.estado = sim.estado;
    ctx.historial = (ctx.historial || []).concat(ops);
  }
  return sim;
}

function erroresP_(sim) {
  var c = [];
  sim.resultados.forEach(function (r) { r.errores.forEach(function (e) { c.push(e.codigo); }); });
  return c;
}

function advertenciasP_(sim) {
  var c = [];
  sim.resultados.forEach(function (r) { r.advertencias.forEach(function (e) { c.push(e.codigo); }); });
  return c;
}

/** C1 activo con S1 (instalada el 01/03/2026), 1 bomba y 6 botellas; stock inicial cargado. */
function ctxConC1Activo_() {
  var ctx = ctxPrueba_();
  var sim = confirmarP_(ctx, [
    opP_('AJUSTE', { fecha: '2026-02-01', deposito: 'Depósito Mendoza', codigo: 'BOMBA', cantidad: 5, motivo: 'Inventario inicial' }),
    opP_('AJUSTE', { fecha: '2026-02-01', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: 50, motivo: 'Inventario inicial' }),
    opP_('AJUSTE', { fecha: '2026-02-01', deposito: 'Depósito Mendoza', codigo: 'FRENTE', cantidad: 3, motivo: 'Inventario inicial' }),
    otP_('2026-03-01', 'C1', 'INSTALACION', { serieInstalada: 'S1', items: [{ codigo: 'BOMBA', cantidad: 1 }, { codigo: 'BOT', cantidad: 6 }] })
  ]);
  if (!sim.ok) throw new Error('Preparación inválida: ' + JSON.stringify(erroresP_(sim)));
  return ctx;
}

/** Contexto con sistemas de purificación (códigos provisorios) y stock cargado en Mendoza. */
function ctxSis_() {
  var ctx = ctxPrueba_();
  var cat = {
    F4E: ['Filtro 4 Etapas', 'FILTRO'], SED1: ['Sedimento 1 micrón', 'RECAMBIO_FILTRO'], CGRA: ['Carbón granular', 'RECAMBIO_FILTRO'], CBLO: ['Carbón en bloque', 'RECAMBIO_FILTRO'],
    MIN: ['Mineralizador', 'RECAMBIO_FILTRO'], PWGICE: ['PWG HP PRO (ICE)', 'FILTRO'], CAB: ['Cabezal PWG', 'REPUESTO'], F6G: ['Filtro 6 etapas grande', 'FILTRO'],
    PUL: ['Pulidor carbón granular', 'RECAMBIO_FILTRO'], MEMG: ['Membrana grande', 'RECAMBIO_FILTRO'], TANQ: ['Tanque hidroneumático', 'REPUESTO'],
    PF1020P: ['Prefiltro 10 y 20 + polifosfato', 'FILTRO'], P10: ['Cartucho 10 micrones', 'RECAMBIO_FILTRO'], P20: ['Cartucho 20 micrones', 'RECAMBIO_FILTRO'], POLI: ['Polifosfato', 'RECAMBIO_FILTRO']
  };
  Object.keys(cat).forEach(function (k) { ctx.catalogo[k] = { codigo: k, descripcion: cat[k][0], categoria: cat[k][1], activo: true }; });
  var f = function (sistema, tipo, filtro, comp, nombre, rol, meses, siFalla) { return { sistema: sistema, tipo: tipo, codigoFiltro: filtro, codigoComponente: comp, componente: nombre, rol: rol, unidades: 1, meses: meses, siFalla: siFalla || '' }; };
  var r = construirSistemas_([
    f('4 Etapas', 'SISTEMA', 'F4E', 'SED1', 'Sedimento 1 micron', 'RECAMBIO', 3), f('4 Etapas', 'SISTEMA', '', 'CGRA', 'Carbon Granular', 'RECAMBIO', 6),
    f('4 Etapas', 'SISTEMA', '', 'CBLO', 'Carbon en Bloque', 'RECAMBIO', 6), f('4 Etapas', 'SISTEMA', '', 'MIN', 'Mineralizador', 'RECAMBIO', 12),
    f('PWG HP PRO (ICE)', 'SISTEMA', 'PWGICE', '', 'PWG HP PRO (ICE)', 'RECAMBIO', 12), f('PWG HP PRO (ICE)', 'SISTEMA', '', 'CAB', 'CABEZAL', 'INSTALACION', '', 'DESCARTE'),
    f('6 etapas (Grande)', 'SISTEMA', 'F6G', 'SED1', 'Sedimento', 'RECAMBIO', 3), f('6 etapas (Grande)', 'SISTEMA', '', 'CGRA', 'Carbón granular', 'RECAMBIO', 6),
    f('6 etapas (Grande)', 'SISTEMA', '', 'CBLO', 'Carbón en bloque', 'RECAMBIO', 6), f('6 etapas (Grande)', 'SISTEMA', '', 'MIN', 'Mineralizador', 'RECAMBIO', 12),
    f('6 etapas (Grande)', 'SISTEMA', '', 'PUL', 'Pulidor', 'RECAMBIO', 18), f('6 etapas (Grande)', 'SISTEMA', '', 'MEMG', 'Membrana grande', 'RECAMBIO', 24),
    f('6 etapas (Grande)', 'SISTEMA', '', 'TANQ', 'Tanque', 'INSTALACION', '', 'REVISION'),
    f('Prefiltro 10 y 20 + Polifosfato', 'PREFILTRO', 'PF1020P', 'P10', '10 micrones', 'RECAMBIO', 3), f('Prefiltro 10 y 20 + Polifosfato', 'PREFILTRO', '', 'P20', '20 micrones', 'RECAMBIO', 3),
    f('Prefiltro 10 y 20 + Polifosfato', 'PREFILTRO', '', 'POLI', 'Polifosfato', 'CONSUMO', ''),
    f('Sin códigos', 'SISTEMA', '', '', 'Algo', 'RECAMBIO', 3)
  ], ctx.catalogo);
  ctx.sistemas = r.sistemas;
  ctx.sistemasIncompletos = r.incompletos;
  ctx.estado = estadoInicial(ctx);
  var stock = ['F4E', 'SED1', 'CGRA', 'CBLO', 'MIN', 'PWGICE', 'CAB', 'F6G', 'TANQ', 'PF1020P', 'P10', 'P20', 'POLI', 'MEMG', 'PUL'].map(function (k) {
    return opP_('AJUSTE', { fecha: '2026-01-10', deposito: 'Depósito Mendoza', codigo: k, cantidad: 10, tipo: 'INVENTARIO' });
  });
  var sim = confirmarP_(ctx, stock);
  if (!sim.ok) throw new Error('Preparación inválida: ' + JSON.stringify(erroresP_(sim)));
  return ctx;
}

/** C1 instalado el 01/02/2026 con S1, 4 Etapas y prefiltro con polifosfato. */
function ctxSisC1_() {
  var ctx = ctxSis_();
  var sim = confirmarP_(ctx, [otP_('2026-02-01', 'C1', 'INSTALACION', { serieInstalada: 'S1', sistema: '4 Etapas', prefiltro: 'Prefiltro 10 y 20 + Polifosfato' })]);
  if (!sim.ok) throw new Error('Preparación inválida: ' + JSON.stringify(erroresP_(sim)));
  return ctx;
}

function venc_(ctx, id) {
  var o = {};
  componentesCliente_(ctx.estado.clientes[id], ctx).forEach(function (x) { o[x.codigo] = x.vence || ('ult ' + x.ultimo); });
  return o;
}

function casosDePrueba_() {
  return [
    {
      nombre: 'Instalación: cliente activo, máquina en el cliente, lo entregado queda en comodato, stock descontado',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        var c = ctx.estado.clientes.C1;
        t.igual(c.estado, EST_CLI.ACTIVO, 'C1 queda Activo');
        t.igual(c.serie, 'S1', 'con la serie S1');
        t.igual(c.comodato.BOMBA, 1, '1 bomba en comodato');
        t.igual(c.comodato.BOT, 6, '6 botellas en comodato (v0.9.4: todo lo de la instalación)');
        t.igual(Object.keys(c.adicionales).length, 0, 'sin adicionales');
        t.igual(ctx.estado.maquinas.S1.ubicTipo, UBIC.CLIENTE, 'S1 queda en el cliente');
        t.igual(ctx.estado.maquinas.S1.estado, EST_MAQ.USADA, 'S1 deja de ser Nueva');
        t.igual(ctx.estado.stock['Depósito Mendoza'].BOT.DISPONIBLE, 44, 'quedan 44 botellas en Mendoza');
        t.igual(c.fechaBase, '2026-03-01', 'la instalación es la fecha base del mantenimiento');
      }
    },
    {
      nombre: 'Instalación: la serie tiene que estar disponible en el depósito de la plaza',
      fn: function (t) {
        var ctx = ctxPrueba_();
        t.contiene(erroresP_(simularLote([otP_('2026-03-01', 'C1', 'INSTALACION', { serieInstalada: 'S5' })], ctx)), 'MAQUINA_FUERA_DEL_DEPOSITO', 'S5 está en Córdoba, C1 es de Mendoza');
        t.contiene(erroresP_(simularLote([otP_('2026-03-01', 'C1', 'INSTALACION', { serieInstalada: 'S4' })], ctx)), 'MAQUINA_FUERA_DEL_DEPOSITO', 'S4 está en CABA');
        t.contiene(erroresP_(simularLote([otP_('2026-03-01', 'C1', 'INSTALACION', { serieInstalada: 'ZZ' })], ctx)), 'SERIE_INEXISTENTE', 'serie que no existe');
        t.contiene(erroresP_(simularLote([otP_('2026-03-01', 'C1', 'INSTALACION', {})], ctx)), 'FALTA_SERIE_INSTALADA', 'sin serie');
        t.contiene(erroresP_(simularLote([otP_('2026-03-01', 'C9', 'INSTALACION', { serieInstalada: 'S1' })], ctx)), 'PLAZA_INEXISTENTE', 'cliente con plaza que no existe');
        t.contiene(erroresP_(simularLote([otP_('2026-03-01', 'NOEXISTE', 'INSTALACION', { serieInstalada: 'S1' })], ctx)), 'CLIENTE_INEXISTENTE', 'cliente que no existe');
      }
    },
    {
      nombre: 'Instalación sobre un cliente ya activo se rechaza (se usa Cambio de modelo o Backup)',
      fn: function (t) {
        var sim = simularLote([otP_('2026-04-01', 'C1', 'INSTALACION', { serieInstalada: 'S2' })], ctxConC1Activo_());
        t.contiene(erroresP_(sim), 'CLIENTE_YA_ACTIVO', 'código correcto');
      }
    },
    {
      nombre: 'Mantenimiento: exige equipo instalado y reinicia el contador',
      fn: function (t) {
        t.contiene(erroresP_(simularLote([otP_('2026-04-01', 'C2', 'MANTENIMIENTO', {})], ctxPrueba_())), 'CLIENTE_SIN_EQUIPO', 'C2 no tiene equipo');
        var ctx = ctxConC1Activo_();
        confirmarP_(ctx, [otP_('2026-05-10', 'C1', 'MANTENIMIENTO', { items: [{ codigo: 'FSED', cantidad: 1 }] })]);
        t.igual(ctx.estado.clientes.C1.fechaBase, '2026-05-10', 'nueva fecha base');
        var v = vistaMantenimiento(ctx.estado, ctx, { hoy: '2026-07-20', diasPorDefecto: 90, diasAviso: 15 });
        t.igual(v[0].proximo, '2026-08-08', 'próximo = 10/05 + 90 días');
        t.igual(v[0].dias, 19, 'faltan 19 días');
        t.igual(v[0].semaforo, 'Al día', 'al día');
        t.igual(vistaMantenimiento(ctx.estado, ctx, { hoy: '2026-07-28', diasPorDefecto: 90, diasAviso: 15 })[0].semaforo, 'Próximo', 'a 11 días: próximo');
        t.igual(vistaMantenimiento(ctx.estado, ctx, { hoy: '2026-08-09', diasPorDefecto: 90, diasAviso: 15 })[0].semaforo, 'Vencido', 'pasada la fecha: vencido');
        t.igual(ctx.estado.stock['Depósito Mendoza'].FSED.DISPONIBLE, -1, 'el filtro sale del stock (queda negativo: no había)');
      }
    },
    {
      nombre: 'Mantenimiento: frecuencia propia del cliente (60 días)',
      fn: function (t) {
        var ctx = ctxPrueba_();
        confirmarP_(ctx, [otP_('2026-03-01', 'C2', 'INSTALACION', { serieInstalada: 'S2' })]);
        var v = vistaMantenimiento(ctx.estado, ctx, { hoy: '2026-03-02', diasPorDefecto: 90, diasAviso: 15 });
        t.igual(v[0].frecuencia, 60, 'usa 60');
        t.igual(v[0].proximo, '2026-04-30', '01/03 + 60 días');
      }
    },
    {
      nombre: 'Reparación: exige falla y NO reinicia el contador',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        t.contiene(erroresP_(simularLote([otP_('2026-04-01', 'C1', 'REPARACION', {})], ctx)), 'FALTA_FALLA', 'sin falla');
        var sim = confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'REPARACION', { falla: 'Pérdida', items: [{ codigo: 'FRENTE', cantidad: 1 }] })]);
        t.igual(sim.ok, true, 'con falla es válida');
        t.igual(ctx.estado.clientes.C1.fechaBase, '2026-03-01', 'la fecha base sigue siendo la instalación');
        t.igual(ctx.estado.stock['Depósito Mendoza'].FRENTE.DISPONIBLE, 2, 'usa un frente del stock');
      }
    },
    {
      nombre: 'Reparación con backup: la retirada queda A revisar con su ingreso, el backup queda y reinicia el contador',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        t.contiene(erroresP_(simularLote([otP_('2026-04-01', 'C1', 'REPARACION_BACKUP', { serieRetirada: 'S3', serieInstalada: 'S2', falla: 'No enfría' })], ctx)), 'RETIRO_NO_COINCIDE', 'S3 no es la instalada');
        var op = otP_('2026-04-01', 'C1', 'REPARACION_BACKUP', { serieRetirada: 's1 ', serieInstalada: 'S2', falla: 'No enfría' });
        var sim = confirmarP_(ctx, [op]);
        t.igual(sim.ok, true, 'válida (normaliza "s1 " = "S1")');
        var m = ctx.estado.maquinas.S1;
        t.igual(m.estado, EST_MAQ.A_REVISAR, 'S1 A revisar');
        t.igual(m.ubicId, 'Depósito Mendoza', 'S1 vuelve al depósito de la plaza');
        t.igual(ctx.estado.ingresos['ING-' + op.id].falla, 'No enfría', 'el ingreso trae la falla de la OT');
        t.igual(ctx.estado.clientes.C1.serie, 'S2', 'el backup queda definitivo');
        t.igual(ctx.estado.clientes.C1.fechaBase, '2026-04-01', 'reinicia el contador');
        t.igual(ctx.estado.clientes.C1.fechaCambio, '2026-04-01', 'registra la fecha de cambio');
      }
    },
    {
      nombre: 'Cambio de modelo: retirada A revisar, nueva en el cliente',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        var sim = confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'CAMBIO_MODELO', { serieRetirada: 'S1', serieInstalada: 'S3' })]);
        t.igual(sim.ok, true, 'válido');
        t.igual(ctx.estado.maquinas.S1.estado, EST_MAQ.A_REVISAR, 'toda máquina retirada pasa por revisión');
        t.igual(ctx.estado.maquinas.S3.ubicId, 'C1', 'S3 en el cliente');
      }
    },
    {
      nombre: 'Cambio de modelo: entrega y retiro de insumos y adicionales, con stock; lo retirado queda A revisar con su origen',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        var op = otP_('2026-04-01', 'C1', 'CAMBIO_MODELO', { serieRetirada: 'S1', serieInstalada: 'S3', items: [
          { codigo: 'BOMBA', cantidad: 1, mov: 'RETIRADO' }, { codigo: 'REG', cantidad: 1 }, { codigo: 'BOT', cantidad: 2, mov: 'RETIRADO' }] });
        var sim = confirmarP_(ctx, [op]);
        t.igual(sim.ok, true, 'válido');
        var c = ctx.estado.clientes.C1;
        t.igual(c.comodato.REG, 1, 'el regulador nuevo queda en comodato (para la próxima desinstalación)');
        t.igual(c.comodato.BOMBA, undefined, 'la bomba retirada sale del comodato');
        t.igual(c.comodato.BOT, 4, 'quedan 4 botellas en comodato');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'REG').DISPONIBLE, -1, 'el regulador sale del stock');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'BOMBA').A_REVISAR, 1, 'la bomba queda A revisar');
        var lotes = vistaLotesRevision(ctx.estado, ctx);
        t.igual(lotes.length, 2, 'dos lotes a revisar (bomba y botellas)');
        t.igual(lotes[0].cliente + '|' + lotes[0].fecha + '|' + lotes[0].tipoOT + '|' + lotes[0].nOt, 'Bar Uno|2026-04-01|Cambio de modelo|' + op.id, 'cada lote dice cliente, fecha, tipo y N° de OT');
        t.igual(repartirLineasOT('CAMBIO_MODELO', sim.resultados[0].efectos.lineas, ctx).adicionales.length, 0, 'no va a cobranzas');
        t.contiene(erroresP_(simularLote([otP_('2026-04-02', 'C1', 'CAMBIO_MODELO', { serieRetirada: 'S3', serieInstalada: 'S2', items: [{ codigo: 'FSED', cantidad: 1 }] })], ctx)), 'ITEM_NO_PERMITIDO', 'sin filtros: el sistema se mantiene');
      }
    },
    {
      nombre: 'Lotes a revisar: se resuelven por lote o del más viejo; un ajuste negativo descuenta del más viejo',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        confirmarP_(ctx, [otP_('2026-03-02', 'C2', 'INSTALACION', { serieInstalada: 'S2', items: [{ codigo: 'BOT', cantidad: 5 }] })]);
        var r1 = otP_('2026-04-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 3, mov: 'RETIRADO' }] });
        var r2 = otP_('2026-04-05', 'C2', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 2, mov: 'RETIRADO' }] });
        confirmarP_(ctx, [r1, r2]);
        var lotes = vistaLotesRevision(ctx.estado, ctx);
        t.igual(lotes.map(function (l) { return l.cliente + ':' + l.cantidad; }).join(','), 'Bar Uno:3,Bar Dos:2', 'dos lotes, del más viejo al más nuevo');
        t.contiene(erroresP_(simularLote([opP_('REVISION_ITEMS', { fecha: '2026-04-06', deposito: 'Depósito Mendoza', items: [{ codigo: 'BOT', cantidad: 3, resultado: 'DISPONIBLE', lote: r2.id + '-1' }] })], ctx)), 'REVISION_SUPERA', 'del lote de Bar Dos no se resuelven 3');
        t.contiene(erroresP_(simularLote([opP_('REVISION_ITEMS', { fecha: '2026-04-06', deposito: 'Depósito Mendoza', items: [{ codigo: 'BOT', cantidad: 1, resultado: 'DISPONIBLE', lote: 'NO-EXISTE' }] })], ctx)), 'LOTE_INEXISTENTE', 'lote inexistente');
        confirmarP_(ctx, [opP_('REVISION_ITEMS', { fecha: '2026-04-06', deposito: 'Depósito Mendoza', items: [{ codigo: 'BOT', cantidad: 2, resultado: 'ENVIAR_CABA', lote: r2.id + '-1' }] })]);
        t.igual(vistaLotesRevision(ctx.estado, ctx).map(function (l) { return l.cliente + ':' + l.cantidad; }).join(','), 'Bar Uno:3', 'el lote de Bar Dos se resolvió entero');
        confirmarP_(ctx, [opP_('REVISION_ITEMS', { fecha: '2026-04-07', deposito: 'Depósito Mendoza', items: [{ codigo: 'BOT', cantidad: 1, resultado: 'DISPONIBLE' }] })]);
        t.igual(vistaLotesRevision(ctx.estado, ctx)[0].cantidad, 2, 'sin lote indicado descuenta del más viejo');
        confirmarP_(ctx, [opP_('AJUSTE', { fecha: '2026-04-08', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: -2, saldo: 'A_REVISAR', motivo: 'Rotas' })]);
        t.igual(vistaLotesRevision(ctx.estado, ctx).length, 0, 'el ajuste (descarte) vacía el lote');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'BOT').A_REVISAR, 0, 'saldo A revisar en cero');
        confirmarP_(ctx, [opP_('AJUSTE', { fecha: '2026-04-09', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: 4, saldo: 'A_REVISAR', motivo: 'Conteo' })]);
        t.igual(vistaLotesRevision(ctx.estado, ctx)[0].tipoOT, 'Ajuste de stock', 'un ajuste positivo crea un lote de origen "Ajuste"');
      }
    },
    {
      nombre: 'Máquinas a revisar: indican cliente, fecha y tipo de OT',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'REPARACION_BACKUP', { serieRetirada: 'S1', serieInstalada: 'S2', falla: 'No enfría' }), opP_('INGRESO', { fecha: '2026-04-02', serie: 'S3', falla: 'Golpe' })]);
        var v = vistaTaller(ctx.estado, ctx);
        var s1 = v.filter(function (x) { return x.serie === 'S1'; })[0], s3 = v.filter(function (x) { return x.serie === 'S3'; })[0];
        t.igual(s1.cliente + '|' + s1.fecha + '|' + s1.tipoOT, 'Bar Uno|2026-04-01|Reparación con backup', 'S1: cliente, fecha y tipo de OT');
        t.igual(s3.tipoOT + '|' + s3.cliente, 'Ingreso manual|', 'S3: ingreso manual, sin cliente');
      }
    },
    {
      nombre: 'Reglas por tipo (v0.5): entrega solo adicionales, mantenimiento filtros y recambios, instalación con repuestos y filtros',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        t.contiene(erroresP_(simularLote([otP_('2026-04-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOMBA', cantidad: 1 }] })], ctx)), 'ITEM_NO_PERMITIDO', 'en una entrega no van insumos');
        t.igual(simularLote([otP_('2026-04-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 2 }] })], ctx).ok, true, 'adicionales sí');
        t.contiene(erroresP_(simularLote([otP_('2026-04-01', 'C1', 'ENTREGA_ADICIONALES', {})], ctx)), 'SIN_ITEMS', 'una entrega sin ítems');
        t.igual(simularLote([otP_('2026-04-01', 'C1', 'MANTENIMIENTO', { items: [{ codigo: 'FSED', cantidad: 1 }, { codigo: 'RFIL', cantidad: 2 }] })], ctx).ok, true, 'mantenimiento con filtro y recambio');
        t.contiene(erroresP_(simularLote([otP_('2026-04-01', 'C1', 'MANTENIMIENTO', { items: [{ codigo: 'BOT', cantidad: 1 }] })], ctx)), 'ITEM_NO_PERMITIDO', 'en un mantenimiento no van adicionales');
        t.contiene(erroresP_(simularLote([otP_('2026-04-01', 'C1', 'REPARACION', { falla: 'X', items: [{ codigo: 'BOT', cantidad: 1 }] })], ctx)), 'ITEM_NO_PERMITIDO', 'en una reparación no van adicionales');
        var inst = simularLote([otP_('2026-04-01', 'C2', 'INSTALACION', { serieInstalada: 'S2', items: [{ codigo: 'FRENTE', cantidad: 1 }, { codigo: 'FSED', cantidad: 1 }] })], ctx);
        t.igual(inst.ok, true, 'instalación con repuesto y filtro');
        t.igual(inst.estado.clientes.C2.comodato.FRENTE, undefined, 'el repuesto no queda en la ficha del cliente');
        ctx.reglas = { ENTREGA_ADICIONALES: ['ADICIONAL', 'INSUMO'] };
        t.igual(simularLote([otP_('2026-04-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOMBA', cantidad: 1 }] })], ctx).ok, true, 'si REGLAS_TRABAJO lo habilita, se acepta');
      }
    },
    {
      nombre: 'Tipos: "Entrega de insumos" se lee como "Entrega de adicionales"',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        var sim = simularLote([otP_('2026-04-01', 'C1', 'ENTREGA_INSUMOS', { items: [{ codigo: 'BOT', cantidad: 1 }] })], ctx);
        t.igual(sim.ok, true, 'nombre viejo aceptado');
        t.igual(sim.estado.clientes.C1.tipoUltimaVisita, 'ENTREGA_ADICIONALES', 'queda con el nombre nuevo');
        t.contiene(erroresP_(simularLote([otP_('2026-04-01', 'C1', 'CUALQUIERA', {})], ctx)), 'TIPO_OT_INVALIDO', 'un tipo inexistente se rechaza');
      }
    },
    {
      nombre: 'v1.3 Técnicos: en el AMBA se eligen de la lista (uno o dos); en el Interior son texto libre',
      fn: function (t) {
        var ctx = ctxPrueba_();
        ctx.plazas.CABA = { plaza: 'CABA', region: 'AMBA', deposito: 'Depósito CABA', activa: true };
        ctx.plazas.MENDOZA.region = 'INTERIOR';
        ctx.clientes.A1 = { id: 'A1', nombre: 'Oficina', plaza: 'CABA', region: 'AMBA', zona: 'Palermo', frecuencia: '' };
        ctx.clientes.C1.region = 'INTERIOR';
        ctx.maquinas.S9 = { serie: 'S9', modelo: 'AQA 200', fechaAlta: '2026-01-01', depositoInicial: 'Depósito CABA' };
        ctx.estado = estadoInicial(ctx);
        ctx.regionesTecnicoObligatorio = ['AMBA'];
        var inst = function (tec, tec2) { return otP_('2026-03-01', 'A1', 'INSTALACION', { serieInstalada: 'S9', tecnico: tec, tecnico2: tec2 }); };
        t.igual(erroresP_(simularLote([inst('', '')], ctx)).length, 0, 'sin técnicos cargados todavía, no se exige');
        ctx.tecnicos = { 'Juan Pérez': { id: 'Juan Pérez', plaza: 'CABA', region: 'AMBA', activo: true }, 'Ana Gómez': { id: 'Ana Gómez', plaza: 'CABA', region: 'AMBA', activo: true },
          'Ex Técnico': { id: 'Ex Técnico', plaza: 'CABA', region: 'AMBA', activo: false } };
        t.contiene(erroresP_(simularLote([inst('', '')], ctx)), 'FALTA_TECNICO', 'en el AMBA, el técnico es obligatorio');
        t.contiene(erroresP_(simularLote([inst('Pedro', '')], ctx)), 'TECNICO_INEXISTENTE', 'tiene que ser de la lista');
        t.contiene(erroresP_(simularLote([inst('Ex Técnico', '')], ctx)), 'TECNICO_INEXISTENTE', 'y estar activo');
        t.contiene(erroresP_(simularLote([inst('Juan Pérez', 'Juan Pérez')], ctx)), 'TECNICO_REPETIDO', 'el segundo no puede ser el mismo');
        t.igual(erroresP_(simularLote([inst('Juan Pérez', 'Ana Gómez')], ctx)).length, 0, 'de a dos, válido');
        t.igual(erroresP_(simularLote([otP_('2026-03-01', 'C1', 'INSTALACION', { serieInstalada: 'S1', tecnico: 'Cualquiera' })], ctx)).length, 0, 'en el Interior, texto libre');
      }
    },
    {
      nombre: 'v1.2.2 Revisión de ítems retirados: disponible, a CABA y descarte (sale del stock)',
      fn: function (t) {
        var ctx = ctxPrueba_();
        confirmarP_(ctx, [otP_('2026-03-01', 'C1', 'INSTALACION', { serieInstalada: 'S1' })]);
        confirmarP_(ctx, [otP_('2026-05-01', 'C1', 'DESINSTALACION_MOMENTANEA', { serieRetirada: 'S1', items: [{ codigo: 'BOT', cantidad: 5, mov: 'RETIRADO' }] })]);
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'BOT').A_REVISAR, 5, '5 botellas a revisar');
        var rev = opP_('REVISION_ITEMS', { fecha: '2026-05-03', deposito: 'Depósito Mendoza', items: [{ codigo: 'BOT', cantidad: 2, resultado: 'DISPONIBLE' }, { codigo: 'BOT', cantidad: 1, resultado: 'ENVIAR_CABA' }, { codigo: 'BOT', cantidad: 2, resultado: 'DESCARTE' }] });
        t.igual(confirmarP_(ctx, [rev]).ok, true, 'revisión con descarte');
        var sb = saldo_(ctx.estado, 'Depósito Mendoza', 'BOT');
        t.igual([sb.A_REVISAR, sb.DISPONIBLE, sb.PARA_CABA].join(), '0,2,1', 'quedan 2 disponibles, 1 para CABA y 2 descartadas fuera del stock');
        t.contiene(erroresP_(simularLote([opP_('REVISION_ITEMS', { fecha: '2026-05-04', deposito: 'Depósito Mendoza', items: [{ codigo: 'BOT', cantidad: 1, resultado: 'DESCARTE' }] })], ctx)), 'REVISION_SUPERA', 'no se descarta más de lo que hay a revisar');
      }
    },
    {
      nombre: 'v1.2.1 Desinstalación: se puede retirar cualquier ítem; si no figura en el cliente, avisa y va a revisión',
      fn: function (t) {
        var ctx = ctxPrueba_();
        t.igual(confirmarP_(ctx, [otP_('2026-03-01', 'C1', 'INSTALACION', { serieInstalada: 'S1' })]).ok, true, 'cliente instalado sin insumos ni adicionales (como en la carga masiva)');
        var mom = otP_('2026-05-01', 'C1', 'DESINSTALACION_MOMENTANEA', { serieRetirada: 'S1', items: [{ codigo: 'BOMBA', cantidad: 1, mov: 'RETIRADO' }, { codigo: 'FRENTE', cantidad: 1, mov: 'RETIRADO' }] });
        var sim = simularLote([mom], ctx);
        t.igual(erroresP_(sim).length, 0, 'retira una bomba que no figura y un repuesto suelto sin frenar');
        t.igual(advertenciasP_(sim).filter(function (c) { return c === 'RETIRO_SIN_REGISTRO'; }).length, 2, 'avisa por cada ítem que no figura');
        confirmarP_(ctx, [mom]);
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'BOMBA').A_REVISAR, 1, 'la bomba va a revisión en el depósito');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'FRENTE').A_REVISAR, 1, 'el repuesto también');
        t.igual(JSON.stringify(ctx.estado.clientes.C1.comodato || {}), '{}', 'el comodato no queda negativo');
        var def = otP_('2026-06-01', 'C1', 'DESINSTALACION', { items: [{ codigo: 'BOT', cantidad: 2, mov: 'RETIRADO' }, { codigo: 'FRENTE', cantidad: 1, mov: 'RETIRADO' }] });
        var sim2 = confirmarP_(ctx, [def]);
        t.igual(sim2.ok, true, 'desinstalación definitiva con ítems que no figuran');
        t.igual(JSON.stringify(ctx.estado.clientes.C1.devueltoDeMas || {}), '{"BOT":2}', 'el repuesto suelto no cuenta como "retirado de más" (solo insumos y adicionales)');
        t.contiene(erroresP_(simularLote([otP_('2026-06-05', 'C1', 'MANTENIMIENTO', { items: [{ codigo: 'FRENTE', cantidad: 1, mov: 'RETIRADO' }] })], ctxConC1Activo_())), 'ITEM_NO_PERMITIDO', 'fuera de una desinstalación, las reglas siguen igual');
      }
    },
    {
      nombre: 'v1.1 CO₂ en las OT: quién recibe, en qué OT van los cilindros y tipo de entrega',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        var co2 = function (fecha, cli, tipo, ent, ret, extra) { var d = { co2: { entregadas: ent || [], retiradas: ret || [] } }; Object.keys(extra || {}).forEach(function (k) { d[k] = extra[k]; }); return otP_(fecha, cli, tipo, d); };
        t.contiene(erroresP_(simularLote([co2('2026-04-01', 'C1', 'ENTREGA_CO2')], ctx)), 'CO2_SIN_CILINDROS', 'una Entrega de CO₂ lleva cilindros');
        t.contiene(erroresP_(simularLote([co2('2026-04-01', 'C1', 'ENTREGA_CO2', ['K1'])], ctx)), 'FALTA_MODALIDAD_CO2', 'con entregas pide el tipo de entrega');
        var ok = simularLote([co2('2026-04-01', 'C1', 'ENTREGA_CO2', ['K1'], [], { modalidadCo2: 'EMERGENCIA_CON_COSTO' })], ctx);
        t.igual(ok.ok, true, 'entrega válida (las series las valida el motor de CO₂)');
        t.igual(ok.estado.clientes.C1.tipoUltimaVisita, 'ENTREGA_CO2', 'cuenta como visita');
        t.igual(ok.estado.clientes.C1.comodato.BOT, 6, 'no toca el comodato');
        t.igual(co2VaACobranza_('ENTREGA_CO2', 'EMERGENCIA_CON_COSTO') && !co2VaACobranza_('ENTREGA_CO2', 'TRADICIONAL') && !co2VaACobranza_('ENTREGA_CO2', 'EMERGENCIA_SIN_COSTO'), true, 'solo la emergencia con costo va a cobranzas');
        t.contiene(erroresP_(simularLote([co2('2026-04-01', 'C1', 'MANTENIMIENTO', ['K1'])], ctx)), 'CO2_NO_PERMITIDO', 'un mantenimiento no lleva cilindros');
        t.contiene(erroresP_(simularLote([co2('2026-04-01', 'C1', 'REPARACION', [], ['K1'], { falla: 'X' })], ctx)), 'CO2_NO_PERMITIDO', 'una reparación tampoco');
        t.contiene(erroresP_(simularLote([co2('2026-04-01', 'C1', 'DESINSTALACION', ['K1'], [], { serieRetirada: 'S1' })], ctx)), 'CO2_NO_PERMITIDO', 'en una desinstalación no se entregan');
        t.igual(simularLote([co2('2026-04-01', 'C1', 'DESINSTALACION', [], ['K1'], { serieRetirada: 'S1', items: [{ codigo: 'BOMBA', cantidad: 1, mov: 'RETIRADO' }, { codigo: 'BOT', cantidad: 6, mov: 'RETIRADO' }] })], ctx).ok, true, 'pero sí se retiran');
        t.contiene(erroresP_(simularLote([co2('2026-04-01', 'C1', 'ENTREGA_CO2', ['K1'], [], { modalidadCo2: 'TRADICIONAL', items: [{ codigo: 'BOT', cantidad: 1 }] })], ctx)), 'ITEM_NO_PERMITIDO', 'una Entrega de CO₂ no lleva ítems');
        // Ex cliente: solo retiros
        confirmarP_(ctx, [otP_('2026-05-01', 'C1', 'DESINSTALACION', { serieRetirada: 'S1', items: [{ codigo: 'BOMBA', cantidad: 1, mov: 'RETIRADO' }, { codigo: 'BOT', cantidad: 6, mov: 'RETIRADO' }] })]);
        t.contiene(erroresP_(simularLote([co2('2026-05-10', 'C1', 'ENTREGA_CO2', ['K1'], [], { modalidadCo2: 'TRADICIONAL' })], ctx)), 'CLIENTE_SIN_ENTREGAS', 'a un ex cliente no se le entrega CO₂');
        t.igual(simularLote([co2('2026-05-10', 'C1', 'ENTREGA_CO2', [], ['K1'])], ctx).ok, true, 'pero se le retiran cilindros');
        // Hielogic: no recibe CO₂
        ctx.clientes.C2.tipoCliente = 'Hielogic';
        confirmarP_(ctx, [otP_('2026-03-02', 'C2', 'INSTALACION', { serieInstalada: 'S2' })]);
        t.contiene(erroresP_(simularLote([co2('2026-05-10', 'C2', 'ENTREGA_CO2', ['K1'], [], { modalidadCo2: 'TRADICIONAL' })], ctx)), 'CO2_HIELOGIC', 'un cliente Hielogic no recibe CO₂');
      }
    },
    {
      nombre: 'Ítems: inexistente, inactivo, cantidad cero, movimiento no permitido',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        t.contiene(erroresP_(simularLote([otP_('2026-04-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'NADA', cantidad: 1 }] })], ctx)), 'ITEM_INEXISTENTE', 'inexistente');
        t.contiene(erroresP_(simularLote([otP_('2026-04-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'VIEJO', cantidad: 1 }] })], ctx)), 'ITEM_INACTIVO', 'inactivo');
        t.contiene(erroresP_(simularLote([otP_('2026-04-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 0 }] })], ctx)), 'CANTIDAD_INVALIDA', 'cantidad cero');
        t.contiene(erroresP_(simularLote([otP_('2026-04-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 1, mov: 'NO_DEVUELTO' }] })], ctx)), 'MOVIMIENTO_NO_PERMITIDO', '"no devuelto" solo en la desinstalación');
        t.contiene(erroresP_(simularLote([otP_('2026-04-01', 'C1', 'MANTENIMIENTO', { items: [{ codigo: 'FSED', cantidad: 1, mov: 'RETIRADO' }] })], ctx)), 'MOVIMIENTO_NO_PERMITIDO', 'un filtro no se retira');
      }
    },
    {
      nombre: 'Adicionales posteriores: entrega, retiro y cambio actualizan cliente y stock',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        var sim7 = simularLote([otP_('2026-04-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 7, mov: 'RETIRADO' }] })], ctx);
        t.igual(erroresP_(sim7).length, 0, 'v1.2.1: retirar 7 si tiene 6 no frena');
        t.contiene(advertenciasP_(sim7), 'RETIRO_SIN_REGISTRO', 'v1.2.1: avisa que no figura todo en el cliente');
        var sim = confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 4 }, { codigo: 'BOT', cantidad: 2, mov: 'RETIRADO' }] }),
          otP_('2026-04-01', 'C1', 'REPARACION', { falla: 'Bomba rota', items: [{ codigo: 'BOMBA', cantidad: 1, mov: 'CAMBIO' }] })]);
        t.igual(sim.ok, true, 'válido');
        var c = ctx.estado.clientes.C1, s = ctx.estado.stock['Depósito Mendoza'];
        t.igual(c.adicionales.BOT, 2, 'v0.9.4: recibe 4 adicionales y devuelve 2: quedan 2 adicionales');
        t.igual(c.comodato.BOT, 6, 'el retiro no toca el comodato');
        t.igual(c.comodato.BOMBA, 1, 'el cambio de bomba deja 1 bomba en comodato');
        t.igual(s.BOT.DISPONIBLE, 40, 'salen 4 botellas del disponible');
        t.igual(s.BOT.A_REVISAR, 2, 'las 2 devueltas quedan A revisar');
        t.igual(s.BOMBA.DISPONIBLE, 3, 'sale una bomba nueva');
        t.igual(s.BOMBA.A_REVISAR, 1, 'la bomba retirada queda A revisar');
      }
    },
    {
      nombre: 'ENTREGA_ADICIONALES: qué líneas van a cobranzas, cambios en dos filas, insumos "Sin cargo"',
      fn: function (t) {
        var ctx = ctxPrueba_();
        var lin = [
          { codigo: 'BOT', cantidad: 4, mov: 'ENTREGADO', categoria: 'ADICIONAL' },
          { codigo: 'BOMBA', cantidad: 1, mov: 'CAMBIO', codigoRetirado: 'BOMBA', categoria: 'INSUMO' },
          { codigo: 'FSED', cantidad: 1, mov: 'ENTREGADO', categoria: 'FILTRO' },
          { codigo: 'REG', cantidad: 1, mov: 'ENTREGADO', categoria: 'INSUMO', dto: 'Se cobra 50%' }
        ];
        var r = repartirLineasOT('REPARACION', lin, ctx);
        t.igual(r.otItems.length, 1, 'el filtro va a OT_ITEMS');
        t.igual(r.adicionales.length, 4, 'botellas + cambio (2 filas) + regulador');
        t.igual(r.adicionales[1].tipo, 'Cambio (entregado)', 'fila de lo entregado');
        t.igual(r.adicionales[2].tipo, 'Cambio (retirado)', 'fila de lo retirado');
        t.igual(r.adicionales[1].dto, 'Sin cargo', 'insumo: Sin cargo por defecto');
        t.igual(r.adicionales[0].dto, '', 'adicional: Dto vacío');
        t.igual(r.adicionales[3].dto, 'Se cobra 50%', 'el Dto cargado se respeta');
        var inst = repartirLineasOT('INSTALACION', lin.slice(0, 1), ctx);
        t.igual(inst.adicionales.length, 0, 'en la instalación no va a cobranzas');
        t.igual(repartirLineasOT('CAMBIO_MODELO', lin.slice(0, 2), ctx).adicionales.length, 0, 'en un cambio de modelo tampoco');
        t.igual(repartirLineasOT('DESINSTALACION', [{ codigo: 'BOT', cantidad: 2, mov: 'NO_DEVUELTO', categoria: 'ADICIONAL' }], ctx).adicionales.length, 0, 'lo no devuelto tampoco');
      }
    },
    {
      nombre: 'Desinstalación (carga anterior a v0.9.4, con No devuelto): sigue siendo válida y deja el comentario de lo no devuelto',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        var op = otP_('2026-06-01', 'C1', 'DESINSTALACION', { serieRetirada: 'S1', items: [
          { codigo: 'BOT', cantidad: 4, mov: 'RETIRADO' }, { codigo: 'BOT', cantidad: 2, mov: 'NO_DEVUELTO' }, { codigo: 'BOMBA', cantidad: 1, mov: 'RETIRADO' }] });
        var sim = confirmarP_(ctx, [op]);
        t.igual(sim.ok, true, 'válida');
        var c = ctx.estado.clientes.C1;
        t.igual(c.estado, EST_CLI.EX, 'queda Ex cliente');
        t.igual(Object.keys(c.adicionales).length + Object.keys(c.comodato).length, 0, 'el cliente queda sin nada');
        t.igual(c.comentarioDesinstalacion, 'Desinstalación 01/06/2026 (' + op.id + '): no devolvió 2 Botella.', 'comentario para cobranzas');
        t.igual(ctx.estado.stock['Depósito Mendoza'].BOT.A_REVISAR, 4, 'las 4 devueltas quedan A revisar');
        t.igual(ctx.estado.maquinas.S1.estado, EST_MAQ.A_REVISAR, 'la máquina queda A revisar');
        t.igual(vistaMantenimiento(ctx.estado, ctx, {}).length, 0, 'sale del listado de mantenimiento');
      }
    },
    {
      nombre: 'v0.9.4 Desinstalación: solo se espera el comodato; se puede retirar más o menos y queda asentado en la ficha',
      fn: function (t) {
        var avisos = function (sim) { return sim.resultados[0].advertencias.map(function (a) { return a.codigo; }).join(); };
        var ctx = ctxConC1Activo_(); // comodato: 1 bomba y 6 botellas
        t.igual(confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 6 }] })]).ok, true, 'entrega de 6 adicionales');
        t.igual(ctx.estado.clientes.C1.comodato.BOT + '|' + ctx.estado.clientes.C1.adicionales.BOT, '6|6', '6 en comodato y 6 adicionales');
        t.igual(vistaClientes(ctx.estado, ctx)[0].aRetirar, 'Retirar: máquina serie S1, 1 Bomba Starflo, 6 Botella', 'a retirar: solo máquina y comodato');
        var justo = simularLote([otP_('2026-06-01', 'C1', 'DESINSTALACION', { serieRetirada: 'S1', items: [{ codigo: 'BOMBA', cantidad: 1, mov: 'RETIRADO' }, { codigo: 'BOT', cantidad: 6, mov: 'RETIRADO' }] })], ctx);
        t.igual(justo.ok && avisos(justo), '', 'retirando el comodato justo: sin avisos (los adicionales no se piden)');
        t.igual(justo.estado.clientes.C1.adicionales.BOT, 6, 'los 6 adicionales siguen siendo del cliente');
        t.igual(justo.estado.clientes.C1.comentarioDesinstalacion, '', 'sin faltantes');
        var op = otP_('2026-06-01', 'C1', 'DESINSTALACION', { serieRetirada: 'S1', items: [{ codigo: 'BOT', cantidad: 8, mov: 'RETIRADO' }] });
        var sim = simularLote([op], ctx);
        t.igual(sim.ok, true, 'se puede retirar más o menos que el comodato');
        t.igual(avisos(sim), 'FALTANTE_COMODATO,RETIRO_DE_MAS', 'avisa el faltante y lo retirado de más');
        sim = confirmarP_(ctx, [op]);
        var c = ctx.estado.clientes.C1;
        t.igual(JSON.stringify(c.comodato), '{}', 'el comodato queda en cero');
        t.igual(JSON.stringify(c.faltante) + JSON.stringify(c.devueltoDeMas), '{"BOMBA":1}{"BOT":2}', 'faltante y devuelto de más');
        t.igual(c.adicionales.BOT, 4, 'lo retirado de más sale de los adicionales');
        t.igual(c.comentarioDesinstalacion, 'Desinstalación 01/06/2026 (' + op.id + '): no devolvió 1 Bomba Starflo; devolvió de más 2 Botella.', 'queda asentado en la ficha');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'BOT').A_REVISAR, 8, 'todo lo retirado va a revisión');
      }
    },
    {
      nombre: 'v0.9.4 Ejemplo de Facu (instala con 20 botellas, entrega 20 adicionales): al desinstalar se esperan 20',
      fn: function (t) {
        var ctx = ctxPrueba_();
        var sim = confirmarP_(ctx, [opP_('AJUSTE', { fecha: '2026-09-01', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: 50, motivo: 'Inventario inicial' }),
          otP_('2026-09-10', 'C1', 'INSTALACION', { serieInstalada: 'S1', items: [{ codigo: 'BOT', cantidad: 20 }] }),
          otP_('2026-09-12', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 20 }] })]);
        t.igual(sim.ok, true, 'instalación y entrega');
        t.igual(vistaClientes(ctx.estado, ctx)[0].comodato + ' / ' + vistaClientes(ctx.estado, ctx)[0].adicionales, '20 Botella / 20 Botella', 'ficha: 20 en comodato y 20 adicionales');
        var d = simularLote([otP_('2026-09-29', 'C1', 'DESINSTALACION', { serieRetirada: 'S1', items: [{ codigo: 'BOT', cantidad: 20, mov: 'RETIRADO' }] })], ctx);
        t.igual(d.ok && d.resultados[0].advertencias.length, 0, 'retira 20: sin avisos');
      }
    },
    {
      nombre: 'v0.9.4 Comodato: la reparación con cambio no lo modifica; un cambio por otro código queda en el mismo saldo',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        confirmarP_(ctx, [opP_('AJUSTE', { fecha: '2026-02-01', deposito: 'Depósito Mendoza', codigo: 'REG', cantidad: 3, motivo: 'Inventario inicial' })]);
        var sim = confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'REPARACION', { falla: 'Pierde', items: [{ codigo: 'BOMBA', cantidad: 1, mov: 'CAMBIO', codigoRetirado: 'BOMBA' }] }),
          otP_('2026-04-02', 'C1', 'REPARACION', { falla: 'Otra', items: [{ codigo: 'REG', cantidad: 1, mov: 'CAMBIO', codigoRetirado: 'BOMBA' }] })]);
        t.igual(sim.ok, true, 'válidas');
        var c = ctx.estado.clientes.C1;
        t.igual(JSON.stringify(c.comodato), '{"BOT":6,"REG":1}', 'la bomba cambiada por un regulador: el regulador queda en comodato');
        t.igual(JSON.stringify(c.adicionales), '{}', 'nada en adicionales');
      }
    },
    {
      nombre: 'v0.9.4 Stock a la fecha: avisa si se usa algo antes de que haya llegado al depósito',
      fn: function (t) {
        var avisos = function (sim) { return sim.resultados.map(function (r) { return r.advertencias.map(function (a) { return a.codigo + ':' + a.mensaje; }).join('|'); }).join('||'); };
        var ctx = ctxConC1Activo_(); // BOT: +50 el 01/02, -6 el 01/03
        confirmarP_(ctx, [opP_('AJUSTE', { fecha: '2026-05-10', deposito: 'Depósito Mendoza', codigo: 'REG', cantidad: 2, motivo: 'Llegó' })]);
        var antes = simularLote([otP_('2026-04-01', 'C1', 'REPARACION', { falla: 'X', items: [{ codigo: 'REG', cantidad: 1 }] })], ctx);
        t.igual(antes.ok, true, 'es advertencia, no error');
        t.contiene([avisos(antes)], 'STOCK_A_ESA_FECHA:Al 01/04/2026 había 0 Regulador disponibles en el Depósito Mendoza y se usan 1. Lo que alcanza ingresó después (10/05/2026). Revisá la fecha de esta operación o la del envío o ajuste.', 'avisa con la fecha de llegada');
        var despues = simularLote([otP_('2026-05-15', 'C1', 'REPARACION', { falla: 'X', items: [{ codigo: 'REG', cantidad: 1 }] })], ctx);
        t.igual(avisos(despues), '', 'con fecha posterior a la llegada: sin aviso');
        var mismoDia = simularLote([otP_('2026-05-10', 'C1', 'REPARACION', { falla: 'X', items: [{ codigo: 'REG', cantidad: 1 }] })], ctx);
        t.igual(avisos(mismoDia), '', 'el mismo día de la llegada: sin aviso');
        confirmarP_(ctx, [otP_('2026-05-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 40 }] }),
          opP_('AJUSTE', { fecha: '2026-07-01', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: 20, motivo: 'Llegó' })]); // BOT: 44 → 4 → 24
        var medio = simularLote([opP_('AJUSTE', { fecha: '2026-04-01', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: -10, motivo: 'Rotura en el depósito' })], ctx);
        t.contiene([avisos(medio)], 'STOCK_A_ESA_FECHA:Con esto, el stock de Botella en el Depósito Mendoza queda en -6 el 01/05/2026 (hay salidas cargadas después). Revisá las fechas.', 'avisa si deja sin stock a una salida posterior');
        var hoyFalta = simularLote([otP_('2026-08-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 30 }] })], ctx);
        t.igual(avisos(hoyFalta).indexOf('STOCK_A_ESA_FECHA') < 0 && avisos(hoyFalta).indexOf('STOCK_INSUFICIENTE') === 0, true, 'si hoy tampoco alcanza: solo el aviso de siempre');
      }
    },
    {
      nombre: 'v1.0 Ex cliente o desinstalado momentáneo: no se le entrega nada, pero se le puede retirar lo pendiente',
      fn: function (t) {
        var ctx = ctxConC1Activo_(); // comodato: 1 bomba y 6 botellas
        var op = otP_('2026-06-01', 'C1', 'DESINSTALACION', { serieRetirada: 'S1', items: [{ codigo: 'BOMBA', cantidad: 1, mov: 'RETIRADO' }, { codigo: 'BOT', cantidad: 4, mov: 'RETIRADO' }] });
        t.igual(confirmarP_(ctx, [op]).ok, true, 'desinstalación con 2 botellas sin devolver');
        t.igual(JSON.stringify(ctx.estado.clientes.C1.faltante), '{"BOT":2}', 'quedan 2 botellas pendientes');
        t.contiene(erroresP_(simularLote([otP_('2026-06-10', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 1 }] })], ctx)), 'CLIENTE_SIN_ENTREGAS', 'a un ex cliente no se le entrega');
        t.contiene(advertenciasP_(simularLote([otP_('2026-06-10', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 3, mov: 'RETIRADO' }] })], ctx)), 'RETIRO_SIN_REGISTRO', 'v1.2.1: retirar más de lo pendiente avisa');
        var ret = otP_('2026-06-10', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 2, mov: 'RETIRADO' }] });
        t.igual(confirmarP_(ctx, [ret]).ok, true, 'se retiran las 2 pendientes');
        var c = ctx.estado.clientes.C1;
        t.igual(JSON.stringify(c.faltante), '{}', 'ya no falta nada');
        t.igual(/Retiro posterior 10\/06\/2026 \(T-\d+\): 2 Botella\. Ya no falta nada\./.test(c.comentarioDesinstalacion), true, 'queda anotado en la ficha');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'BOT').A_REVISAR, 6, 'las botellas retiradas van a revisión');
        var ctx2 = ctxConC1Activo_();
        confirmarP_(ctx2, [otP_('2026-06-01', 'C1', 'DESINSTALACION_MOMENTANEA', { serieRetirada: 'S1', items: [{ codigo: 'BOMBA', cantidad: 1, mov: 'RETIRADO' }] })]);
        t.contiene(erroresP_(simularLote([otP_('2026-06-10', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 1 }] })], ctx2)), 'CLIENTE_SIN_ENTREGAS', 'momentáneo: tampoco');
        t.igual(simularLote([otP_('2026-06-10', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 2, mov: 'RETIRADO' }] })], ctx2).ok, true, 'momentáneo: retiro permitido');
        // Un insumo que quedó sin devolver (la bomba) también se puede retirar después; uno que no falta, no.
        var ctx3 = ctxConC1Activo_();
        confirmarP_(ctx3, [otP_('2026-06-01', 'C1', 'DESINSTALACION', { serieRetirada: 'S1', items: [{ codigo: 'BOT', cantidad: 6, mov: 'RETIRADO' }] })]);
        t.contiene(erroresP_(simularLote([otP_('2026-06-10', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'REG', cantidad: 1, mov: 'RETIRADO' }] })], ctx3)), 'ITEM_NO_PERMITIDO', 'un insumo que no estaba pendiente, no');
        t.igual(confirmarP_(ctx3, [otP_('2026-06-10', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOMBA', cantidad: 1, mov: 'RETIRADO' }] })]).ok, true, 'la bomba pendiente se retira después');
        t.igual(JSON.stringify(ctx3.estado.clientes.C1.faltante), '{}', 'y ya no falta nada');
      }
    },
    {
      nombre: 'v1.0 Depósito central: registra ingresos y salidas, sin avisar faltantes',
      fn: function (t) {
        var ctx = ctxPrueba_();
        var sim = confirmarP_(ctx, [opP_('ENVIO', { fecha: '2026-03-01', origen: 'Depósito CABA', destino: 'Depósito Mendoza', items: [{ codigo: 'BOT', cantidad: 30 }] })]);
        t.igual(sim.ok && sim.resultados[0].advertencias.length, 0, 'sale sin stock cargado y no avisa');
        t.igual(saldo_(ctx.estado, 'Depósito CABA', 'BOT').DISPONIBLE, -30, 'el central registra la salida');
        var aj = simularLote([opP_('AJUSTE', { fecha: '2026-03-02', deposito: 'Depósito CABA', codigo: 'BOT', cantidad: -5, motivo: 'Rotura en CABA' })], ctx);
        t.igual(aj.ok && aj.resultados[0].advertencias.length, 0, 'un ajuste negativo en el central tampoco avisa');
        var mza = simularLote([opP_('AJUSTE', { fecha: '2026-03-02', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: -5, motivo: 'Rotura' })], ctx);
        t.contiene(mza.resultados[0].advertencias.map(function (a) { return a.codigo; }), 'STOCK_INSUFICIENTE', 'en una plaza sí avisa');
      }
    },
    {
      nombre: 'Desinstalación momentánea: retira solo lo que se lleva, pausa el mantenimiento; la reinstalación reinicia',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        var sim = confirmarP_(ctx, [otP_('2026-06-01', 'C1', 'DESINSTALACION_MOMENTANEA', { serieRetirada: 'S1', items: [{ codigo: 'BOMBA', cantidad: 1, mov: 'RETIRADO' }] })]);
        t.igual(sim.ok, true, 'válida aunque queden botellas');
        t.igual(ctx.estado.clientes.C1.estado, EST_CLI.MOMENTANEO, 'desinstalado momentáneo');
        t.igual(ctx.estado.clientes.C1.comodato.BOT, 6, 'las botellas siguen en comodato');
        t.igual(ctx.estado.clientes.C1.comodato.BOMBA, undefined, 'la bomba retirada sale del comodato (la reinstalación la vuelve a entregar)');
        t.igual(vistaMantenimiento(ctx.estado, ctx, {}).length, 0, 'no figura en mantenimiento');
        t.igual(vistaClientes(ctx.estado, ctx)[0].aRetirar, 'Retirar: 6 Botella', 'la lista de retiro sigue calculada');
        t.contiene(erroresP_(simularLote([otP_('2026-06-05', 'C1', 'MANTENIMIENTO', {})], ctx)), 'CLIENTE_SIN_EQUIPO', 'no se le hace mantenimiento');
        var re = confirmarP_(ctx, [otP_('2026-07-01', 'C1', 'INSTALACION', { serieInstalada: 'S2' })]);
        t.igual(re.ok, true, 'se reinstala con otra máquina');
        t.igual(ctx.estado.clientes.C1.fechaBase, '2026-07-01', 'el contador arranca de cero');
      }
    },
    {
      nombre: 'Desinstalación definitiva de un cliente que estaba desinstalado momentáneamente (sin serie)',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        confirmarP_(ctx, [otP_('2026-06-01', 'C1', 'DESINSTALACION_MOMENTANEA', { serieRetirada: 'S1', items: [{ codigo: 'BOMBA', cantidad: 1, mov: 'RETIRADO' }] })]);
        t.contiene(erroresP_(simularLote([otP_('2026-07-01', 'C1', 'DESINSTALACION', { serieRetirada: 'S1', items: [{ codigo: 'BOT', cantidad: 6, mov: 'RETIRADO' }] })], ctx)), 'SERIE_SOBRANTE', 'la máquina ya se retiró');
        var sim = confirmarP_(ctx, [otP_('2026-07-01', 'C1', 'DESINSTALACION', { items: [{ codigo: 'BOT', cantidad: 6, mov: 'RETIRADO' }] })]);
        t.igual(sim.ok, true, 'válida');
        t.igual(ctx.estado.clientes.C1.estado, EST_CLI.EX, 'ex cliente');
      }
    },
    {
      nombre: 'Pendientes: aparecen en Trabajos a realizar y se borran con la siguiente OT',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'MANTENIMIENTO', { pendiente: 'Cambio de frente de equipo por estar roto' })]);
        t.igual(vistaMantenimiento(ctx.estado, ctx, {})[0].trabajos, 'Cambio de frente de equipo por estar roto', 'aparece el pendiente');
        confirmarP_(ctx, [otP_('2026-05-01', 'C1', 'REPARACION', { falla: 'Frente roto' })]);
        t.igual(vistaMantenimiento(ctx.estado, ctx, {})[0].trabajos, '', 'la siguiente OT lo borra');
      }
    },
    {
      nombre: 'Cronología y fechas: OT anterior a la última del cliente, fecha futura, fecha inválida',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        t.contiene(erroresP_(simularLote([otP_('2026-02-15', 'C1', 'MANTENIMIENTO', {})], ctx)), 'FECHA_ANTERIOR_A_HISTORIAL', 'antes de la instalación');
        t.contiene(erroresP_(simularLote([otP_('2027-01-01', 'C1', 'MANTENIMIENTO', {})], ctx)), 'FECHA_FUTURA', 'futura');
        t.contiene(erroresP_(simularLote([otP_('2026-02-30', 'C1', 'MANTENIMIENTO', {})], ctx)), 'FECHA_INVALIDA', '30 de febrero');
        t.contiene(erroresP_(simularLote([otP_('2026-04-01', 'C1', 'OTRA_COSA', {})], ctx)), 'TIPO_OT_INVALIDO', 'tipo inexistente');
      }
    },
    {
      nombre: 'Revisión de máquina: Apta vuelve a Usada y se puede reinstalar; con ítems solo si es Reparada',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'REPARACION_BACKUP', { serieRetirada: 'S1', serieInstalada: 'S2', falla: 'No enfría' })]);
        t.contiene(erroresP_(simularLote([otP_('2026-04-05', 'C2', 'INSTALACION', { serieInstalada: 'S1' })], ctx)), 'MAQUINA_A_REVISAR', 'A revisar no se instala');
        t.contiene(erroresP_(simularLote([opP_('CIERRE', { fecha: '2026-04-05', serie: 'S1', resultado: 'APTA', items: [{ codigo: 'FRENTE', cantidad: 1 }] })], ctx)), 'ITEMS_SIN_REPARACION', 'Apta no lleva repuestos');
        t.contiene(erroresP_(simularLote([opP_('CIERRE', { fecha: '2026-03-20', serie: 'S1', resultado: 'APTA' })], ctx)), 'FECHA_ANTERIOR_A_HISTORIAL', 'no se cierra antes de abrir');
        var sim = confirmarP_(ctx, [opP_('CIERRE', { fecha: '2026-04-05', serie: 'S1', resultado: 'APTA' })]);
        t.igual(sim.ok, true, 'cierre válido');
        t.igual(ctx.estado.maquinas.S1.estado, EST_MAQ.USADA, 'S1 Usada');
        t.igual(confirmarP_(ctx, [otP_('2026-04-06', 'C2', 'INSTALACION', { serieInstalada: 'S1' })]).ok, true, 'S1 se instala en C2');
        t.contiene(erroresP_(simularLote([opP_('CIERRE', { fecha: '2026-04-07', serie: 'S1', resultado: 'APTA' })], ctx)), 'SIN_INGRESO_ABIERTO', 'no hay revisión abierta');
      }
    },
    {
      nombre: 'Revisión de máquina: Reparada descuenta repuestos e insumos del depósito; Baja no se instala',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'REPARACION_BACKUP', { serieRetirada: 'S1', serieInstalada: 'S2', falla: 'Frente roto' })]);
        var sim = confirmarP_(ctx, [opP_('CIERRE', { fecha: '2026-04-05', serie: 'S1', resultado: 'REPARADA', diagnostico: 'Se cambió el frente', items: [{ codigo: 'FRENTE', cantidad: 1 }, { codigo: 'BOMBA', cantidad: 1 }] })]);
        t.igual(sim.ok, true, 'válido');
        t.igual(ctx.estado.stock['Depósito Mendoza'].FRENTE.DISPONIBLE, 2, 'usa un frente');
        t.igual(ctx.estado.stock['Depósito Mendoza'].BOMBA.DISPONIBLE, 3, 'usa una bomba (insumo)');
        t.contiene(erroresP_(simularLote([opP_('CIERRE', { fecha: '2026-04-05', serie: 'S3', resultado: 'BAJA' })], ctx)), 'SIN_INGRESO_ABIERTO', 'S3 no está en revisión');
        confirmarP_(ctx, [opP_('INGRESO', { fecha: '2026-04-06', serie: 'S3', falla: 'Golpeada' })]);
        t.igual(ctx.estado.maquinas.S3.estado, EST_MAQ.A_REVISAR, 'ingreso manual: A revisar');
        confirmarP_(ctx, [opP_('CIERRE', { fecha: '2026-04-07', serie: 'S3', resultado: 'BAJA' })]);
        t.igual(ctx.estado.maquinas.S3.estado, EST_MAQ.BAJA, 'Logística la da de baja');
        t.contiene(erroresP_(simularLote([otP_('2026-04-08', 'C2', 'INSTALACION', { serieInstalada: 'S3' })], ctx)), 'MAQUINA_BAJA', 'una Baja no se instala');
      }
    },
    {
      nombre: 'Enviar a CABA: retorno a CABA, sale del interior; si vuelve reparada llega como Usada',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'REPARACION_BACKUP', { serieRetirada: 'S1', serieInstalada: 'S2', falla: 'Compresor' })]);
        t.contiene(erroresP_(simularLote([opP_('ENVIO', { fecha: '2026-04-02', origen: 'Depósito Mendoza', destino: 'Depósito CABA', series: ['S1'] })], ctx)), 'MAQUINA_EN_REVISION', 'no sale con la revisión abierta');
        confirmarP_(ctx, [opP_('CIERRE', { fecha: '2026-04-03', serie: 'S1', resultado: 'ENVIAR_CABA' })]);
        t.contiene(advertenciasP_(simularLote([opP_('ENVIO', { fecha: '2026-04-04', origen: 'Depósito Mendoza', destino: 'Depósito Córdoba', series: ['S1'] })], ctx)), 'MAQUINA_PARA_CABA', 'avisa si se manda a otra plaza');
        var env = opP_('ENVIO', { fecha: '2026-04-04', origen: 'Depósito Mendoza', destino: 'Depósito CABA', series: ['S1'] });
        t.igual(confirmarP_(ctx, [env]).ok, true, 'retorno a CABA');
        t.igual(ctx.estado.maquinas.S1.ubicTipo, UBIC.TRANSITO, 'en tránsito');
        t.contiene(erroresP_(simularLote([otP_('2026-04-05', 'C2', 'INSTALACION', { serieInstalada: 'S1' })], ctx)), 'MAQUINA_A_REVISAR', 'no se instala');
        confirmarP_(ctx, [opP_('RECEPCION', { fecha: '2026-04-08', idEnvio: env.id })]);
        t.igual(vistaMaquinas(ctx.estado, ctx).filter(function (m) { return m.serie === 'S1'; })[0].deposito, 'Depósito CABA', 'v1.0: queda en el depósito central');
        var vuelta = opP_('ENVIO', { fecha: '2026-05-01', origen: 'Depósito CABA', destino: 'Depósito Mendoza', series: ['S1'] });
        t.igual(confirmarP_(ctx, [vuelta, opP_('RECEPCION', { fecha: '2026-05-05', idEnvio: '' })]).ok, false, 'una recepción sin envío frena todo el lote');
        t.igual(confirmarP_(ctx, [vuelta]).ok, true, 'CABA devuelve la máquina');
        var rec = confirmarP_(ctx, [opP_('RECEPCION', { fecha: '2026-05-05', idEnvio: vuelta.id })]);
        t.igual(rec.ok, true, 'recibe la vuelta');
        t.igual(ctx.estado.maquinas.S1.estado, EST_MAQ.USADA, 'llega desde CABA como Usada');
        t.igual(ctx.estado.maquinas.S1.ubicId, 'Depósito Mendoza', 'en Mendoza');
      }
    },
    {
      nombre: 'Envíos CABA → plaza: el stock suma recién al recibir; mientras, figura en camino',
      fn: function (t) {
        var ctx = ctxPrueba_();
        var env = opP_('ENVIO', { fecha: '2026-03-01', origen: 'Depósito CABA', destino: 'Depósito Mendoza', items: [{ codigo: 'BOT', cantidad: 30 }, { codigo: 'BOMBA', cantidad: 2 }], series: ['S4'] });
        t.igual(confirmarP_(ctx, [env]).ok, true, 'envío válido');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'BOT').DISPONIBLE, 0, 'todavía no suma');
        var st = vistaStock(ctx.estado, ctx).filter(function (f) { return f.codigo === 'BOT' && f.deposito === 'Depósito Mendoza'; })[0];
        t.igual(st.enCamino, 30, '30 en camino');
        t.igual(vistaStockMaquinas(ctx.estado, ctx).filter(function (f) { return f.modelo === 'AQA 300'; })[0].enCamino, 1, 'S4 en camino');
        t.contiene(erroresP_(simularLote([otP_('2026-03-02', 'C1', 'INSTALACION', { serieInstalada: 'S4' })], ctx)), 'MAQUINA_FUERA_DEL_DEPOSITO', 'en tránsito no se instala');
        t.contiene(erroresP_(simularLote([opP_('RECEPCION', { fecha: '2026-02-20', idEnvio: env.id })], ctx)), 'FECHA_ANTERIOR_A_HISTORIAL', 'no se recibe antes de salir');
        confirmarP_(ctx, [opP_('RECEPCION', { fecha: '2026-03-04', idEnvio: env.id })]);
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'BOT').DISPONIBLE, 30, 'suma al recibir');
        t.igual(ctx.estado.maquinas.S4.ubicId, 'Depósito Mendoza', 'S4 en Mendoza');
        t.igual(ctx.estado.maquinas.S4.estado, EST_MAQ.NUEVA, 'sigue Nueva');
        t.contiene(erroresP_(simularLote([opP_('RECEPCION', { fecha: '2026-03-05', idEnvio: env.id })], ctx)), 'ENVIO_YA_RECIBIDO', 'no se recibe dos veces');
      }
    },
    {
      nombre: 'Envíos: validaciones (vacío, mismo origen y destino, serie que no está en el origen, serie repetida)',
      fn: function (t) {
        var ctx = ctxPrueba_();
        t.contiene(erroresP_(simularLote([opP_('ENVIO', { fecha: '2026-03-01', origen: 'Depósito CABA', destino: 'Depósito Mendoza' })], ctx)), 'ENVIO_VACIO', 'vacío');
        t.contiene(erroresP_(simularLote([opP_('ENVIO', { fecha: '2026-03-01', origen: 'Depósito Mendoza', destino: 'Depósito Mendoza', series: ['S1'] })], ctx)), 'ORIGEN_IGUAL_DESTINO', 'mismo depósito');
        t.contiene(erroresP_(simularLote([opP_('ENVIO', { fecha: '2026-03-01', origen: 'Depósito CABA', destino: 'Depósito Mendoza', series: ['S1'] })], ctx)), 'MAQUINA_FUERA_DEL_DEPOSITO', 'S1 no está en CABA');
        t.contiene(erroresP_(simularLote([opP_('ENVIO', { fecha: '2026-03-01', origen: 'Depósito CABA', destino: 'Depósito Mendoza', series: ['S4', 's4'] })], ctx)), 'SERIE_DUPLICADA', 'serie repetida');
        t.contiene(erroresP_(simularLote([opP_('ENVIO', { fecha: '2026-03-01', origen: 'Depósito CABA', destino: 'SALTA', series: ['S4'] })], ctx)), 'DEPOSITO_INEXISTENTE', 'destino inexistente');
      }
    },
    {
      nombre: 'Revisión de insumos y adicionales retirados: Disponible o Para CABA, y retorno desde Para CABA',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 5, mov: 'RETIRADO' }] })]);
        t.contiene(erroresP_(simularLote([opP_('REVISION_ITEMS', { fecha: '2026-04-02', deposito: 'Depósito Mendoza', items: [{ codigo: 'BOT', cantidad: 6, resultado: 'DISPONIBLE' }] })], ctx)), 'REVISION_SUPERA', 'no se resuelven más de las que hay');
        var sim = confirmarP_(ctx, [opP_('REVISION_ITEMS', { fecha: '2026-04-02', deposito: 'Depósito Mendoza', items: [
          { codigo: 'BOT', cantidad: 3, resultado: 'DISPONIBLE' }, { codigo: 'BOT', cantidad: 2, resultado: 'ENVIAR_CABA' }] })]);
        t.igual(sim.ok, true, 'válido');
        var s = saldo_(ctx.estado, 'Depósito Mendoza', 'BOT');
        t.igual(s.A_REVISAR, 0, 'nada a revisar');
        t.igual(s.DISPONIBLE, 47, '44 + 3 disponibles');
        t.igual(s.PARA_CABA, 2, '2 para CABA');
        var ret = confirmarP_(ctx, [opP_('ENVIO', { fecha: '2026-04-03', origen: 'Depósito Mendoza', destino: 'Depósito CABA', items: [{ codigo: 'BOT', cantidad: 2, desde: 'PARA_CABA' }] })]);
        t.igual(ret.ok, true, 'retorno de ítems');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'BOT').PARA_CABA, 0, 'salen del saldo Para CABA');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'BOT').DISPONIBLE, 47, 'el disponible no se toca');
      }
    },
    {
      nombre: 'Ajustes de stock: no van a CABA, no pueden ser cero y piden motivo',
      fn: function (t) {
        var ctx = ctxPrueba_();
        t.contiene(erroresP_(simularLote([opP_('AJUSTE', { fecha: '2026-03-01', deposito: 'CABA', codigo: 'BOT', cantidad: 5, motivo: 'Conteo' })], ctx)), 'DEPOSITO_INEXISTENTE', 'CABA no se controla');
        t.contiene(erroresP_(simularLote([opP_('AJUSTE', { fecha: '2026-03-01', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: 0, motivo: 'Conteo' })], ctx)), 'CANTIDAD_INVALIDA', 'cero');
        t.contiene(erroresP_(simularLote([opP_('AJUSTE', { fecha: '2026-03-01', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: 5 })], ctx)), 'FALTA_MOTIVO', 'sin motivo');
        t.contiene(advertenciasP_(simularLote([opP_('AJUSTE', { fecha: '2026-03-01', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: -5, motivo: 'Rotura' })], ctx)), 'STOCK_INSUFICIENTE', 'avisa si queda negativo');
        var sim = confirmarP_(ctx, [opP_('AJUSTE', { fecha: '2026-03-01', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: 3, saldo: 'A_REVISAR', motivo: 'Conteo' })]);
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'BOT').A_REVISAR, 3, 'ajusta el saldo indicado');
        t.igual(sim.ok, true, 'válido');
      }
    },
    {
      nombre: 'Alta inicial: estado de migración sin tocar stock; una sola por cliente',
      fn: function (t) {
        var ctx = ctxPrueba_();
        var sim = confirmarP_(ctx, [otP_('2026-10-01', 'C1', 'ALTA_INICIAL', { serieInstalada: 'S1', fechaInstalacion: '2024-05-10', fechaBase: '2026-08-15',
          fechaUltimaVisita: '2026-08-15', tipoUltimaVisita: 'MANTENIMIENTO', items: [{ codigo: 'BOMBA', cantidad: 1 }, { codigo: 'BOT', cantidad: 12 }] })]);
        t.igual(sim.ok, true, 'válida');
        var c = ctx.estado.clientes.C1;
        t.igual(c.fechaInstalacion, '2024-05-10', 'fecha de instalación real');
        t.igual(c.fechaBase, '2026-08-15', 'fecha base migrada');
        t.igual(c.comodato.BOT, 12, 'v0.9.4: lo del alta inicial queda en comodato');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'BOT').DISPONIBLE, 0, 'no descuenta stock');
        t.igual(vistaClientes(ctx.estado, ctx)[0].ultimaVisita, '2026-08-15', 'última visita migrada');
        t.contiene(erroresP_(simularLote([otP_('2026-10-02', 'C1', 'ALTA_INICIAL', { serieInstalada: 'S2' })], ctx)), 'ALTA_INICIAL_CON_HISTORIAL', 'no se repite');
        t.contiene(erroresP_(simularLote([otP_('2026-10-02', 'C2', 'ALTA_INICIAL', { serieInstalada: 'S1' })], ctx)), 'MAQUINA_EN_OTRO_CLIENTE', 'S1 ya está en C1');
        t.contiene(erroresP_(simularLote([otP_('2026-10-02', 'C2', 'ALTA_INICIAL', { serieInstalada: 'S5' })], ctx)), 'MAQUINA_FUERA_DEL_DEPOSITO', 'v0.9.1: S5 está en el depósito de Córdoba y C2 es de Mendoza');
        t.contiene(erroresP_(simularLote([otP_('2026-10-02', 'C2', 'ALTA_INICIAL', { serieInstalada: 'S4' })], ctx)), 'MAQUINA_FUERA_DEL_DEPOSITO', 'v0.9.1: S4 está en CABA');
        t.igual(simularLote([otP_('2026-10-02', 'C2', 'ALTA_INICIAL', { estadoInicial: 'EX_CLIENTE' })], ctx).ok, true, 'ex cliente sin serie');
        t.contiene(erroresP_(simularLote([otP_('2026-10-02', 'C2', 'ALTA_INICIAL', { estadoInicial: 'EX_CLIENTE', serieInstalada: 'S2' })], ctx)), 'SERIE_SOBRANTE', 'ex cliente con serie');
      }
    },
    {
      nombre: 'Lote: si una operación falla, no se confirma nada',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        var sim = simularLote([otP_('2026-04-01', 'C1', 'MANTENIMIENTO', {}), otP_('2026-04-01', 'C2', 'MANTENIMIENTO', {})], ctx);
        t.igual(sim.ok, false, 'lote rechazado');
        t.igual(sim.resultados[0].errores.length, 0, 'la primera estaba bien');
        t.igual(ctx.estado.clientes.C1.fechaBase, '2026-03-01', 'el estado del contexto no cambió');
      }
    },
    {
      nombre: 'Una operación con error no modifica el estado (validación antes de aplicar)',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        var sim = simularLote([otP_('2026-04-01', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 2 }, { codigo: 'NADA', cantidad: 1 }] })], ctx);
        t.igual(sim.ok, false, 'rechazada');
        t.igual(sim.estado.clientes.C1.adicionales.BOT, undefined, 'no se sumaron las 2 botellas válidas');
      }
    },
    {
      nombre: 'Reconstrucción: repetir el historial da el mismo estado que la carga',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        confirmarP_(ctx, [
          otP_('2026-04-01', 'C1', 'REPARACION_BACKUP', { serieRetirada: 'S1', serieInstalada: 'S2', falla: 'X' }),
          opP_('CIERRE', { fecha: '2026-04-02', serie: 'S1', resultado: 'APTA' }),
          otP_('2026-04-03', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 2, mov: 'RETIRADO' }] }),
          opP_('REVISION_ITEMS', { fecha: '2026-04-04', deposito: 'Depósito Mendoza', items: [{ codigo: 'BOT', cantidad: 1, resultado: 'DISPONIBLE' }] })
        ]);
        var rec = reconstruir(ctx.historial, ctx);
        t.igual(rec.inconsistencias.length, 0, 'historial coherente');
        t.igual(JSON.stringify(rec.estado), JSON.stringify(ctx.estado), 'estado idéntico');
      }
    },
    {
      nombre: 'Anulación: solo si nada posterior depende de la operación',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        var inst = ctx.historial[3];
        var mant = otP_('2026-04-01', 'C1', 'MANTENIMIENTO', {});
        confirmarP_(ctx, [mant]);
        var v = validarAnulacion(inst.id, ctx.historial, ctx);
        t.igual(v.ok, false, 'no se anula la instalación si después hubo un mantenimiento');
        t.igual(v.errores[0].codigo, 'ANULACION_CON_OPERACIONES_POSTERIORES', 'código correcto');
        t.igual(validarAnulacion(mant.id, ctx.historial, ctx).ok, true, 'sí se anula el mantenimiento');
        t.igual(validarAnulacion('NO-EXISTE', ctx.historial, ctx).ok, false, 'operación inexistente');
        var sinMant = ctx.historial.filter(function (o) { return o.id !== mant.id; });
        t.igual(reconstruir(sinMant, ctx).estado.clientes.C1.fechaBase, '2026-03-01', 'anulado el mantenimiento, la fecha base vuelve a la instalación');
      }
    },
    {
      nombre: 'Vistas: lista de retiro, stock de máquinas y alertas de maestros',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        var cli = vistaClientes(ctx.estado, ctx).filter(function (c) { return c.id === 'C1'; })[0];
        t.igual(cli.aRetirar, 'Retirar: máquina serie S1, 1 Bomba Starflo, 6 Botella', 'texto listo para copiar');
        t.igual(cli.modelo, 'AQA 200', 'modelo desde el maestro');
        t.igual(cli.estado, 'Activo', 'estado en palabras');
        var sm = vistaStockMaquinas(ctx.estado, ctx).filter(function (f) { return f.deposito === 'Depósito Mendoza' && f.modelo === 'AQA 200'; })[0];
        t.igual(sm.nuevas, 1, 'S2 nueva en Mendoza (S1 está en el cliente)');
        var al = detectarAlertas(ctx.estado, ctx).map(function (a) { return a.codigo + ':' + a.ref; });
        t.contiene(al, 'PLAZA_INEXISTENTE:C9', 'cliente con plaza inexistente');
        ctx.maquinas.S9 = { serie: 'S9', modelo: 'X', fechaAlta: '2026-01-01', depositoInicial: 'ROSARIO' };
        t.contiene(detectarAlertas(estadoInicial(ctx), ctx).map(function (a) { return a.codigo + ':' + a.ref; }), 'DEPOSITO_INICIAL_INEXISTENTE:S9', 'depósito inicial inexistente');
      }
    },
    {
      nombre: 'Sistema de purificación y prefiltro: la OT los actualiza',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'MANTENIMIENTO', { sistema: 'Ósmosis', prefiltro: 'Sedimento 5µ' })]);
        var v = vistaMantenimiento(ctx.estado, ctx, {})[0];
        t.igual(v.sistema, 'Ósmosis', 'sistema actualizado');
        t.igual(v.prefiltro, 'Sedimento 5µ', 'prefiltro actualizado');
        confirmarP_(ctx, [otP_('2026-05-01', 'C1', 'MANTENIMIENTO', {})]);
        t.igual(vistaMantenimiento(ctx.estado, ctx, {})[0].sistema, 'Ósmosis', 'una OT sin el dato no lo borra');
      }
    },
    {
      nombre: 'Ingresos y salidas (v0.7): envíos recibidos, revisión OK y ajustes entran; clientes, máquinas y ajustes salen',
      fn: function (t) {
        var ctx = ctxConC1Activo_(); // 3 ajustes de inventario + instalación con 1 bomba y 6 botellas
        var env = opP_('ENVIO', { fecha: '2026-10-11', origen: 'Depósito Mendoza', destino: 'Depósito Córdoba', items: [{ codigo: 'BOT', cantidad: 5 }] });
        confirmarP_(ctx, [
          otP_('2026-04-01', 'C1', 'REPARACION', { falla: 'Pérdida', items: [{ codigo: 'FRENTE', cantidad: 1 }] }),
          otP_('2026-10-10', 'C1', 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 2 }, { codigo: 'BOT', cantidad: 3, mov: 'RETIRADO' }] }),
          env,
          otP_('2026-10-12', 'C2', 'ALTA_INICIAL', { serieInstalada: 'S2', items: [{ codigo: 'BOT', cantidad: 4 }] }),
          opP_('REVISION_ITEMS', { fecha: '2026-10-13', deposito: 'Depósito Mendoza', items: [{ codigo: 'BOT', cantidad: 2, resultado: 'DISPONIBLE' }, { codigo: 'BOT', cantidad: 1, resultado: 'ENVIAR_CABA' }] }),
          opP_('AJUSTE', { fecha: '2026-10-14', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: 1, tipo: 'PERDIDA' })
        ]);
        confirmarP_(ctx, [opP_('RECEPCION', { fecha: '2026-10-15', idEnvio: env.id })]);
        var movs = ctx.estado.movStock.map(function (x) { return x.sentido.charAt(0) + ':' + x.tipo + ':' + x.deposito + ':' + x.codigo + ':' + x.cantidad; });
        t.igual(movs.join(','), ['I:AJUSTE:Depósito Mendoza:BOMBA:5', 'I:AJUSTE:Depósito Mendoza:BOT:50', 'I:AJUSTE:Depósito Mendoza:FRENTE:3', 'S:CLIENTE:Depósito Mendoza:BOMBA:1', 'S:CLIENTE:Depósito Mendoza:BOT:6',
          'S:MAQUINA:Depósito Mendoza:FRENTE:1', 'S:CLIENTE:Depósito Mendoza:BOT:2', 'I:REVISION:Depósito Mendoza:BOT:2', 'S:AJUSTE:Depósito Mendoza:BOT:1', 'I:ENVIO:Depósito Córdoba:BOT:5'].join(','),
          'cada movimiento con su sentido y tipo (sin retiros, despachos ni alta inicial; lo enviado a CABA no es ingreso)');
        var fila = vistaStock(ctx.estado, ctx).filter(function (f) { return f.deposito === 'Depósito Mendoza' && f.codigo === 'BOT'; })[0];
        t.igual(fila.salidasTotal + ':' + fila.salidas30, '9:3', 'botellas: 9 salidas en total, 3 en los últimos 30 días (2 entregadas y 1 perdida)');
        t.igual(fila.ingresosTotal + ':' + fila.ingresos30, '52:2', 'botellas: 52 ingresos en total, 2 en 30 días (la revisión)');
        var cba = vistaStock(ctx.estado, ctx).filter(function (f) { return f.deposito === 'Depósito Córdoba' && f.codigo === 'BOT'; })[0];
        t.igual(cba.ingresos30 + ':' + cba.disponible, '5:5', 'Córdoba: el envío recibido es ingreso');
        var ag = movimientosAgrupados(ctx.estado).filter(function (g) { return g.codigo === 'FRENTE' && g.sentido === 'SALIDA'; })[0];
        t.igual(ag.tipo + ':' + ag.fecha, 'MAQUINA:2026-04-01', 'agrupados por fecha, sentido y tipo para filtrar por período');
        var v = vistaMovimientosStock(ctx.estado, ctx);
        t.igual(v[0].sentido + ' · ' + v[0].tipo + ' · ' + v[0].detalle, 'Ingreso · Recepción de envío · Envío ' + env.id + ' desde Depósito Mendoza', 'la vista va del más nuevo al más viejo, con detalle');
        t.igual(v.filter(function (x) { return x.tipo === 'Ajuste' && x.sentido === 'Salida'; })[0].detalle, 'Pérdida', 'el ajuste dice su tipo');
        t.igual(JSON.stringify(reconstruir(ctx.historial, ctx).estado.movStock), JSON.stringify(ctx.estado.movStock), 'la reconstrucción da los mismos movimientos');
      }
    },
    {
      nombre: 'Ajuste con tipo (v0.6): pérdida y rotura descuentan aunque se cargue en positivo; inventario y compra solo suman',
      fn: function (t) {
        var ctx = ctxPrueba_();
        var sim = confirmarP_(ctx, [
          opP_('AJUSTE', { fecha: '2026-03-01', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: 10, tipo: 'INVENTARIO' }),
          opP_('AJUSTE', { fecha: '2026-03-02', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: 3, tipo: 'PERDIDA', motivo: 'Se cayeron del camión' }),
          opP_('AJUSTE', { fecha: '2026-03-03', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: -1, tipo: 'ROTURA' }),
          opP_('AJUSTE', { fecha: '2026-03-04', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: -2, tipo: 'CONTEO' })
        ]);
        t.igual(sim.ok, true, 'con tipo, el motivo es opcional');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'BOT').DISPONIBLE, 4, '10 - 3 - 1 - 2 = 4');
        t.igual(sim.resultados[1].efectos.cantidad, -3, 'la pérdida queda registrada en negativo');
        t.contiene(erroresP_(simularLote([opP_('AJUSTE', { fecha: '2026-03-05', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: -2, tipo: 'COMPRA' })], ctx)), 'CANTIDAD_INVALIDA', 'compra en negativo');
        t.contiene(erroresP_(simularLote([opP_('AJUSTE', { fecha: '2026-03-05', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: 2, tipo: 'REGALO' })], ctx)), 'TIPO_AJUSTE_INVALIDO', 'tipo inexistente');
        t.contiene(advertenciasP_(simularLote([opP_('AJUSTE', { fecha: '2026-03-05', deposito: 'Depósito Mendoza', codigo: 'BOT', cantidad: 9, tipo: 'PERDIDA' })], ctx)), 'STOCK_INSUFICIENTE', 'pérdida mayor al stock avisa');
        var st = vistaStock(ctx.estado, ctx).filter(function (f) { return f.codigo === 'BOT'; })[0];
        t.igual(st.salidasTotal + ':' + st.ingresosTotal, '6:10', 'v0.7: pérdida, rotura y conteo negativo son salidas por ajuste; el inventario es ingreso');
      }
    },
    {
      nombre: 'Reparación en depósito (v0.6): máquina sin revisión, ítems como en cliente, stock, salida e historial',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        confirmarP_(ctx, [opP_('AJUSTE', { fecha: '2026-03-01', deposito: 'Depósito Mendoza', codigo: 'FSED', cantidad: 4, tipo: 'COMPRA' })]);
        var op = opP_('REPARACION_DEPOSITO', { fecha: '2026-04-05', serie: 's2', falla: 'Golpe', diagnostico: 'Cambio de frente y filtro', tecnico: 'Juan',
          items: [{ codigo: 'FRENTE', cantidad: 1 }, { codigo: 'FSED', cantidad: 1 }, { codigo: 'BOMBA', cantidad: 1 }] });
        var sim = confirmarP_(ctx, [op]);
        t.igual(sim.ok, true, 'válida');
        var ing = ctx.estado.ingresos[op.id];
        t.igual(ing.estado + ':' + ing.resultado, 'CERRADO:REPARADA', 'queda una revisión cerrada como Reparada');
        t.igual(ing.items.length, 3, 'con los ítems usados');
        t.igual(ctx.estado.maquinas.S2.estado, EST_MAQ.NUEVA, 'una Nueva reparada sigue Nueva (nunca se instaló)');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'FRENTE').DISPONIBLE, 2, 'descuenta el frente');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'FSED').DISPONIBLE, 3, 'descuenta el filtro');
        var v = vistaTaller(ctx.estado, ctx).filter(function (x) { return x.id === op.id; })[0];
        t.igual(v.tipoOT, 'Reparación en depósito', 'el origen dice Reparación en depósito');
        t.igual(v.items, '1 Frente de equipo, 1 Filtro sedimento, 1 Bomba Starflo', 'ítems usados en la vista');
        t.igual(v.tecnico, 'Juan', 'técnico');
        t.igual(ctx.estado.movStock.filter(function (x) { return x.origen === op.id && x.sentido === 'SALIDA' && x.tipo === 'MAQUINA'; }).length, 3, 'las 3 cuentan como salida en máquinas');
      }
    },
    {
      nombre: 'Reparación en depósito (v0.6): cierra la revisión abierta; validaciones de ubicación, ítems y fecha',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        var bk = otP_('2026-04-01', 'C1', 'REPARACION_BACKUP', { serieRetirada: 'S1', serieInstalada: 'S2', falla: 'No enfría' });
        confirmarP_(ctx, [bk]);
        t.contiene(erroresP_(simularLote([opP_('REPARACION_DEPOSITO', { fecha: '2026-04-02', serie: 'S2', diagnostico: 'X' })], ctx)), 'MAQUINA_FUERA_DEL_DEPOSITO', 'S2 está en el cliente');
        t.igual(simularLote([opP_('REPARACION_DEPOSITO', { fecha: '2026-04-02', serie: 'S4', diagnostico: 'X' })], ctx).ok, true, 'v1.0: en el depósito central también se repara');
        t.contiene(erroresP_(simularLote([opP_('REPARACION_DEPOSITO', { fecha: '2026-04-02', serie: 'S1' })], ctx)), 'FALTA_DIAGNOSTICO', 'sin trabajo realizado');
        t.contiene(erroresP_(simularLote([opP_('REPARACION_DEPOSITO', { fecha: '2026-03-15', serie: 'S1', diagnostico: 'X' })], ctx)), 'FECHA_ANTERIOR_A_HISTORIAL', 'antes del ingreso');
        t.contiene(erroresP_(simularLote([opP_('REPARACION_DEPOSITO', { fecha: '2026-04-02', serie: 'S1', diagnostico: 'X', items: [{ codigo: 'BOT', cantidad: 1 }] })], ctx)), 'ITEM_NO_PERMITIDO', 'un adicional no se usa en una reparación');
        var rep = opP_('REPARACION_DEPOSITO', { fecha: '2026-04-03', serie: 'S1', diagnostico: 'Cambio de bomba', items: [{ codigo: 'BOMBA', cantidad: 1 }] });
        t.igual(confirmarP_(ctx, [rep]).ok, true, 'válida');
        var ing = ctx.estado.ingresos['ING-' + bk.id];
        t.igual(ing.estado + ':' + ing.resultado + ':' + ing.idCierre, 'CERRADO:REPARADA:' + rep.id, 'cierra la revisión que venía de la OT');
        t.igual(ing.falla, 'No enfría', 'conserva la falla de la OT');
        t.igual(ctx.estado.maquinas.S1.estado, EST_MAQ.USADA, 'A revisar pasa a Usada');
        t.igual(ctx.estado.ingresos[rep.id], undefined, 'no crea otra revisión');
        var rec = reconstruir(ctx.historial, ctx);
        t.igual(JSON.stringify(rec.estado), JSON.stringify(ctx.estado), 'la reconstrucción da lo mismo');
        t.igual(validarAnulacion(rep.id, ctx.historial, ctx).ok, true, 'se puede anular');
      }
    },
    {
      nombre: 'Cierre de revisión Reparada (v0.6): admite los ítems de reparación (filtros y recambio también)',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'REPARACION_BACKUP', { serieRetirada: 'S1', serieInstalada: 'S2', falla: 'X' })]);
        var sim = confirmarP_(ctx, [opP_('CIERRE', { fecha: '2026-04-02', serie: 'S1', resultado: 'REPARADA', tecnico: 'Ana', items: [{ codigo: 'FSED', cantidad: 1 }, { codigo: 'RFIL', cantidad: 1 }] })]);
        t.igual(sim.ok, true, 'válido (con aviso de stock)');
        t.contiene(advertenciasP_(sim), 'STOCK_INSUFICIENTE', 'avisa que no hay filtros');
        var v = vistaTaller(ctx.estado, ctx).filter(function (x) { return x.serie === 'S1'; })[0];
        t.igual(v.items, '1 Filtro sedimento, 1 Cartucho de recambio', 'los ítems quedan en la revisión');
        t.igual(v.tecnico, 'Ana', 'con el técnico');
      }
    },
    {
      nombre: 'Sistemas (v0.9): fechas en meses de calendario y armado del maestro',
      fn: function (t) {
        t.igual(sumarMeses('2026-01-31', 1), '2026-02-28', '31/01 + 1 mes = 28/02');
        t.igual(sumarMeses('2027-11-30', 3), '2028-02-29', 'año bisiesto');
        t.igual(sumarMeses('2026-02-01', 24), '2028-02-01', '24 meses');
        var ctx = ctxSis_();
        t.igual(ctx.sistemas['PWG HP PRO (ICE)'].comps[0].codigo, 'PWGICE', 'PWG: el componente con el nombre del sistema usa el código del filtro (filtro = recambio)');
        t.igual(ctx.sistemas['PWG HP PRO (ICE)'].partes.map(function (x) { return x.codigo; }).join(), 'PWGICE,CAB', 'PWG: queda instalado el cartucho + el cabezal');
        t.igual(ctx.sistemas['6 etapas (Grande)'].partes.map(function (x) { return x.codigo; }).join(), 'F6G,TANQ', '6 etapas: el filtro + el tanque');
        t.igual(ctx.sistemasIncompletos.join(), 'Sin códigos', 'los sistemas sin códigos quedan afuera y se avisan');
        t.contiene(detectarAlertas(ctx.estado, ctx).map(function (a) { return a.codigo; }), 'SISTEMAS_SIN_CODIGO', 'la auditoría avisa los sistemas incompletos');
      }
    },
    {
      nombre: 'Sistemas (v0.9): la instalación descuenta solo el filtro y arranca los vencimientos de cada componente',
      fn: function (t) {
        var ctx = ctxSisC1_();
        var W = ctx.estado;
        t.igual(saldo_(W, 'Depósito Mendoza', 'F4E').DISPONIBLE + ':' + saldo_(W, 'Depósito Mendoza', 'PF1020P').DISPONIBLE, '9:9', 'sale 1 filtro 4 Etapas y 1 prefiltro');
        t.igual(saldo_(W, 'Depósito Mendoza', 'SED1').DISPONIBLE + ':' + saldo_(W, 'Depósito Mendoza', 'P10').DISPONIBLE, '10:10', 'los recambios no se descuentan (vienen en el filtro)');
        var v = venc_(ctx, 'C1');
        t.igual([v.SED1, v.CGRA, v.CBLO, v.MIN, v.P10, v.P20].join(), '2026-05-01,2026-08-01,2026-08-01,2027-02-01,2026-05-01,2026-05-01', 'vencimientos: 3, 6, 6 y 12 meses; prefiltro 3 meses');
        t.igual(v.POLI, 'ult 2026-02-01', 'el polifosfato no vence');
        t.igual(W.clientes.C1.sistema + ' / ' + W.clientes.C1.prefiltro, '4 Etapas / Prefiltro 10 y 20 + Polifosfato', 'sistema y prefiltro del cliente');
        var m = vistaMantenimiento(W, ctx, { hoy: '2026-04-20', diasPorDefecto: 90 })[0];
        t.igual(m.proximo, '2026-05-02', 'próximo mantenimiento 02/05');
        t.igual(m.trabajos, 'Cambiar: Sedimento 1 micrón (vence 01/05/2026), Cartucho 10 micrones (vence 01/05/2026), Cartucho 20 micrones (vence 01/05/2026) · Revisar nivel de polifosfato',
          'trabajos a realizar: lo que vence antes de la visita siguiente, y el polifosfato');
        t.igual(m.proximoVencFiltros, '2026-05-01', 'próximo vencimiento de filtros');
        t.igual(W.movStock.filter(function (x) { return x.codigo === 'F4E' && x.sentido === 'SALIDA'; })[0].tipo, 'CLIENTE', 'el filtro instalado cuenta como entregado a cliente');
      }
    },
    {
      nombre: 'Sistemas (v0.9): el mantenimiento con recambios reinicia sus vencimientos; avisa lo que vence antes de la visita siguiente',
      fn: function (t) {
        var ctx = ctxSisC1_();
        var sim = confirmarP_(ctx, [otP_('2026-05-02', 'C1', 'MANTENIMIENTO', { items: [{ codigo: 'SED1', cantidad: 1 }, { codigo: 'P10', cantidad: 1 }, { codigo: 'P20', cantidad: 1 }] })]);
        t.igual(sim.ok, true, 'válido');
        t.igual(advertenciasP_(sim).length, 0, 'sin avisos (son componentes del sistema)');
        var v = venc_(ctx, 'C1');
        t.igual([v.SED1, v.P10, v.CGRA].join(), '2026-08-02,2026-08-02,2026-08-01', 'sedimento y prefiltro vuelven a contar desde el 02/05; el carbón sigue igual');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'SED1').DISPONIBLE, 9, 'el recambio sale del stock');
        var m = vistaMantenimiento(ctx.estado, ctx, { hoy: '2026-07-20', diasPorDefecto: 90 })[0];
        t.igual(m.trabajos.indexOf('Carbón granular (vence 01/08/2026)') > 0 && m.trabajos.indexOf('Carbón en bloque') > 0 && m.trabajos.indexOf('Mineralizador') < 0, true, 'en la visita del 31/07 se cambian también los carbones (vencen el 01/08, dentro de los 20 días)');
        var vv = vistaVencimientos(ctx.estado, ctx, { hoy: '2026-07-20', diasPorDefecto: 90 });
        var min = vv.filter(function (x) { return x.codigo === 'MIN'; })[0], sed = vv.filter(function (x) { return x.codigo === 'SED1'; })[0];
        t.igual(min.estado + '|' + min.cambiar, 'Al día|false', 'el mineralizador está al día');
        t.igual(sed.estado + '|' + sed.cambiar + '|' + sed.proximo, 'Cambiar en el próximo mantenimiento|true|2026-07-31', 'el sedimento se cambia en la próxima visita');
        t.igual(vv.filter(function (x) { return x.codigo === 'POLI'; })[0].estado, 'Revisar nivel', 'polifosfato: revisar nivel');
        var noEs = simularLote([otP_('2026-07-31', 'C1', 'MANTENIMIENTO', { items: [{ codigo: 'MEMG', cantidad: 1 }] })], ctx);
        t.contiene(advertenciasP_(noEs), 'NO_ES_DEL_SISTEMA', 'un recambio que no es del sistema del cliente avisa');
      }
    },
    {
      nombre: 'Sistemas (v0.9): se anticipa el recambio hasta 20 días después de la visita; lo que vence más tarde queda para la siguiente',
      fn: function (t) {
        var comps = [{ codigo: 'A', rol: 'RECAMBIO', vence: '2026-11-02' }, { codigo: 'B', rol: 'RECAMBIO', vence: '2026-11-20' },
          { codigo: 'C', rol: 'RECAMBIO', vence: '2026-11-09' }, { codigo: 'D', rol: 'RECAMBIO', vence: '2026-10-01' }, { codigo: 'E', rol: 'CONSUMO', vence: '' }];
        t.igual(aCambiarEnVisita_(comps, '2026-10-20').map(function (x) { return x.codigo; }).join(), 'A,C,D',
          'visita 20/10: se cambia lo que vence el 02/11 y hasta el 09/11 (20 días) y lo vencido; lo del 20/11 queda para la siguiente');
        t.igual(aCambiarEnVisita_(comps, '2026-10-20', 0).map(function (x) { return x.codigo; }).join(), 'D', 'con 0 días de anticipo, solo lo vencido');
        var ctx = ctxSisC1_();
        ctx.diasAnticipoFiltros = 20;
        // Instalado el 01/02: sedimento y prefiltro vencen el 01/05, carbones el 01/08. Próximo mantenimiento: 02/05.
        var m = vistaMantenimiento(ctx.estado, ctx, { hoy: '2026-04-20', diasPorDefecto: 90 })[0];
        t.igual(/Carbón/.test(m.trabajos), false, 'en la visita del 02/05 no se anticipan los carbones (vencen 3 meses después)');
        var vencido = vistaMantenimiento(ctx.estado, ctx, { hoy: '2026-07-20', diasPorDefecto: 90 })[0];
        t.igual(/Carbón granular \(vence 01\/08\/2026\)/.test(vencido.trabajos), true, 'con el mantenimiento vencido se calcula desde hoy (20/07): el carbón del 01/08 entra');
      }
    },
    {
      nombre: 'Sistemas (v0.9): PWG HP PRO: se instala cartucho + cabezal; el recambio es el mismo cartucho; el cabezal que falla se descarta',
      fn: function (t) {
        var ctx = ctxSis_();
        confirmarP_(ctx, [otP_('2026-03-01', 'C2', 'INSTALACION', { serieInstalada: 'S2', sistema: 'PWG HP PRO (ICE)' })]);
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'PWGICE').DISPONIBLE + ':' + saldo_(ctx.estado, 'Depósito Mendoza', 'CAB').DISPONIBLE, '9:9', 'sale 1 cartucho y 1 cabezal');
        t.igual(venc_(ctx, 'C2').PWGICE, '2027-03-01', 'el cartucho vence a los 12 meses');
        t.igual(Object.keys(venc_(ctx, 'C2')).join(), 'PWGICE', 'el cabezal no vence');
        var sim = confirmarP_(ctx, [otP_('2026-09-01', 'C2', 'MANTENIMIENTO', { items: [{ codigo: 'PWGICE', cantidad: 1 }] })]);
        t.igual(sim.ok && venc_(ctx, 'C2').PWGICE, '2027-09-01', 'recambio del cartucho: vuelve a contar 12 meses');
        confirmarP_(ctx, [otP_('2026-09-10', 'C2', 'REPARACION', { falla: 'Pierde agua', items: [{ codigo: 'CAB', cantidad: 1 }] })]);
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'CAB').DISPONIBLE + ':' + saldo_(ctx.estado, 'Depósito Mendoza', 'CAB').A_REVISAR, '8:0', 'cabezal nuevo del stock; el roto se descarta');
      }
    },
    {
      nombre: 'Sistemas (v0.9): cambio de 4 Etapas por 6 etapas; falla del tanque; backup del mismo sistema',
      fn: function (t) {
        var ctx = ctxSisC1_();
        var op = otP_('2026-04-01', 'C1', 'MANTENIMIENTO', { accionSistema: 'CAMBIAR', sistema: '6 etapas (Grande)' });
        t.igual(confirmarP_(ctx, [op]).ok, true, 'cambio de sistema en un mantenimiento');
        var W = ctx.estado;
        var lote = vistaLotesRevision(W, ctx).filter(function (l) { return l.codigo === 'F4E'; })[0];
        t.igual(lote && lote.cliente + '|' + lote.tipoOT + '|' + lote.fecha, 'Bar Uno|Mantenimiento preventivo|2026-04-01', 'el 4 Etapas retirado queda a revisar con cliente, tipo y fecha');
        t.igual(saldo_(W, 'Depósito Mendoza', 'F6G').DISPONIBLE + ':' + saldo_(W, 'Depósito Mendoza', 'TANQ').DISPONIBLE, '9:9', 'sale el 6 etapas con su tanque');
        t.igual(W.clientes.C1.sistema, '6 etapas (Grande)', 'el cliente queda con el 6 etapas');
        t.igual(venc_(ctx, 'C1').MEMG + ' ' + venc_(ctx, 'C1').PUL, '2028-04-01 2027-10-01', 'membrana 24 meses, pulidor 18');
        t.igual(W.clientes.C1.prefiltro, 'Prefiltro 10 y 20 + Polifosfato', 'el prefiltro sigue');
        confirmarP_(ctx, [otP_('2026-05-01', 'C1', 'REPARACION', { falla: 'Tanque pinchado', items: [{ codigo: 'TANQ', cantidad: 1 }] })]);
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'TANQ').DISPONIBLE + ':' + saldo_(ctx.estado, 'Depósito Mendoza', 'TANQ').A_REVISAR, '8:1', 'tanque nuevo del stock; el que falló pasa a revisión');
        var bk = otP_('2026-06-01', 'C1', 'MANTENIMIENTO', { accionSistema: 'BACKUP' });
        t.igual(confirmarP_(ctx, [bk]).ok, true, 'backup del mismo sistema');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'F6G').A_REVISAR + ':' + saldo_(ctx.estado, 'Depósito Mendoza', 'TANQ').A_REVISAR + ':' + saldo_(ctx.estado, 'Depósito Mendoza', 'F6G').DISPONIBLE, '1:2:8', 'backup: el 6 etapas y su tanque a revisión, sale otro');
        t.igual(venc_(ctx, 'C1').SED1 + ' ' + venc_(ctx, 'C1').MEMG, '2026-09-01 2028-06-01', 'backup: todos los vencimientos desde cero');
        t.igual(JSON.stringify(reconstruir(ctx.historial, ctx).estado), JSON.stringify(ctx.estado), 'la reconstrucción da lo mismo');
      }
    },
    {
      nombre: 'Sistemas (v0.9): validaciones de cambio, backup e instalación',
      fn: function (t) {
        var ctx = ctxSisC1_();
        var e = function (d) { return erroresP_(simularLote([otP_(d.fecha || '2026-04-01', d.cli || 'C1', d.tipo, d)], ctx)); };
        t.contiene(e({ tipo: 'MANTENIMIENTO', accionSistema: 'CAMBIAR', sistema: '4 Etapas' }), 'MISMO_SISTEMA', 'cambiar por el mismo: usar backup');
        t.contiene(e({ tipo: 'MANTENIMIENTO', accionSistema: 'CAMBIAR', sistema: 'Ósmosis inventada' }), 'SISTEMA_INEXISTENTE', 'sistema que no está en el maestro');
        t.contiene(e({ tipo: 'MANTENIMIENTO', accionSistema: 'CAMBIAR', sistema: 'Prefiltro 10 y 20 + Polifosfato' }), 'SISTEMA_INEXISTENTE', 'un prefiltro no va como sistema');
        t.contiene(e({ tipo: 'MANTENIMIENTO', accionSistema: 'CAMBIAR', sistema: 'Sin códigos' }), 'SISTEMA_INEXISTENTE', 'un sistema sin códigos no se instala');
        t.contiene(e({ tipo: 'ENTREGA_ADICIONALES', accionSistema: 'BACKUP', items: [{ codigo: 'BOT', cantidad: 1 }] }), 'CAMBIO_SISTEMA_NO_PERMITIDO', 'en una entrega de adicionales no se cambia el sistema');
        t.contiene(e({ tipo: 'MANTENIMIENTO', accionSistema: 'CAMBIAR', sistema: '6 etapas (Grande)', items: [{ codigo: 'F6G', cantidad: 1 }] }), 'YA_INCLUIDO_EN_SISTEMA', 'el filtro que se instala no se carga además como ítem');
        t.contiene(e({ tipo: 'INSTALACION', cli: 'C2', serieInstalada: 'S2', sistema: '4 Etapas', items: [{ codigo: 'F4E', cantidad: 1 }] }), 'YA_INCLUIDO_EN_SISTEMA', 'idem en la instalación');
        t.contiene(e({ tipo: 'MANTENIMIENTO', cli: 'C2', accionSistema: 'BACKUP' }), 'CLIENTE_SIN_EQUIPO', 'cliente sin equipo');
        ctx.sistemas['6 etapas (Grande)'].activo = false;
        t.contiene(e({ tipo: 'MANTENIMIENTO', accionSistema: 'CAMBIAR', sistema: '6 etapas (Grande)' }), 'SISTEMA_INACTIVO', 'un sistema inactivo ya no se instala');
      }
    },
    {
      nombre: 'Sistemas (v0.9): desinstalaciones: la momentánea retira según indique Logística; la definitiva retira o registra no devuelto',
      fn: function (t) {
        var ctx = ctxSisC1_();
        confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'DESINSTALACION_MOMENTANEA', { serieRetirada: 'S1', retirarSistema: false })]);
        var W = ctx.estado;
        t.igual(W.clientes.C1.sistema + ' | ' + W.clientes.C1.prefiltro, '4 Etapas | ', 'el sistema queda instalado; el prefiltro se retiró (por defecto)');
        t.igual(saldo_(W, 'Depósito Mendoza', 'PF1020P').A_REVISAR, 1, 'el prefiltro retirado queda a revisar');
        var sim = confirmarP_(ctx, [otP_('2026-05-01', 'C1', 'INSTALACION', { serieInstalada: 'S2', sistema: '4 Etapas', prefiltro: 'Prefiltro 10 y 20 + Polifosfato' })]);
        t.igual(sim.ok, true, 'reinstalación');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'F4E').DISPONIBLE + ':' + saldo_(ctx.estado, 'Depósito Mendoza', 'PF1020P').DISPONIBLE, '9:8', 'el sistema que seguía instalado no se descuenta de nuevo; el prefiltro sí');
        t.igual(venc_(ctx, 'C1').SED1 + ' ' + venc_(ctx, 'C1').P10, '2026-05-01 2026-08-01', 'el sistema conserva sus vencimientos; el prefiltro nuevo arranca de cero');
        confirmarP_(ctx, [otP_('2026-06-01', 'C1', 'DESINSTALACION', { serieRetirada: 'S2', sistemaNoDevuelto: true })]);
        var c = ctx.estado.clientes.C1;
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'F4E').A_REVISAR + ':' + saldo_(ctx.estado, 'Depósito Mendoza', 'PF1020P').A_REVISAR, '0:2', 'definitiva: el prefiltro se retira; el sistema no devuelto no entra a revisión');
        t.igual(/no devolvió 1 Filtro 4 Etapas/.test(c.comentarioDesinstalacion) && !c.sistema && !c.prefiltro, true, 'el no devuelto queda en el comentario y el cliente sin sistema');
      }
    },
    {
      nombre: 'Sistemas (v0.9): alta inicial con la fecha del último cambio de cada componente, sin mover stock',
      fn: function (t) {
        var ctx = ctxSis_();
        var sim = confirmarP_(ctx, [otP_('2026-10-01', 'C1', 'ALTA_INICIAL', { serieInstalada: 'S1', fechaInstalacion: '2024-05-10', fechaBase: '2026-08-15', sistema: '4 Etapas',
          fechasSistema: { SED1: '2026-08-15', CGRA: '2026-05-20', MIN: '2025-11-02' } })]);
        t.igual(sim.ok, true, 'válida');
        var v = venc_(ctx, 'C1');
        t.igual([v.SED1, v.CGRA, v.CBLO, v.MIN].join(), '2026-11-15,2026-11-20,2027-02-15,2026-11-02', 'cada componente con su fecha; el que falta toma la fecha base');
        t.igual(saldo_(ctx.estado, 'Depósito Mendoza', 'F4E').DISPONIBLE, 10, 'no descuenta stock');
        t.contiene(erroresP_(simularLote([otP_('2026-10-01', 'C2', 'ALTA_INICIAL', { serieInstalada: 'S2', sistema: '4 Etapas', fechasSistema: { SED1: '2026-12-01' } })], ctx)), 'FECHA_INVALIDA', 'fecha posterior al alta');
      }
    },
    {
      nombre: 'Sistemas (v0.9): revisión del filtro retirado con los cartuchos usados para reacondicionarlo',
      fn: function (t) {
        var ctx = ctxSisC1_();
        confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'MANTENIMIENTO', { accionSistema: 'CAMBIAR', sistema: '6 etapas (Grande)' })]);
        var lote = vistaLotesRevision(ctx.estado, ctx).filter(function (l) { return l.codigo === 'F4E'; })[0].lote;
        var sim = confirmarP_(ctx, [opP_('REVISION_ITEMS', { fecha: '2026-04-05', deposito: 'Depósito Mendoza', items: [{ codigo: 'F4E', cantidad: 1, resultado: 'DISPONIBLE', lote: lote }],
          consumos: [{ codigo: 'SED1', cantidad: 1 }, { codigo: 'CGRA', cantidad: 1 }] })]);
        t.igual(sim.ok, true, 'válida');
        var W = ctx.estado;
        t.igual(saldo_(W, 'Depósito Mendoza', 'F4E').DISPONIBLE + ':' + saldo_(W, 'Depósito Mendoza', 'SED1').DISPONIBLE + ':' + saldo_(W, 'Depósito Mendoza', 'CGRA').DISPONIBLE, '10:9:9', 'el filtro vuelve disponible y se descuentan los cartuchos usados');
        t.igual(W.movStock.filter(function (x) { return x.tipo === 'REACONDICIONAMIENTO'; }).length, 2, 'los cartuchos cuentan como salida "usado para reacondicionar"');
      }
    },
    {
      nombre: 'Sistemas (v0.9): sin maestro de sistemas, el sistema sigue siendo solo un nombre (como antes)',
      fn: function (t) {
        var ctx = ctxConC1Activo_();
        var sim = confirmarP_(ctx, [otP_('2026-04-01', 'C1', 'MANTENIMIENTO', { sistema: 'Ósmosis', accionSistema: '' })]);
        t.igual(sim.ok && ctx.estado.clientes.C1.sistema, 'Ósmosis', 'se guarda el nombre');
        t.igual(vistaVencimientos(ctx.estado, ctx, {}).length, 0, 'sin vencimientos');
      }
    }
  ];
}

/** Ejecutá esta función desde el editor de Apps Script. */
function ejecutarPruebas() {
  var log = (typeof Logger !== 'undefined') ? function (m) { Logger.log(m); } : function (m) { console.log(m); };
  var pasadas = 0, fallidas = 0, comprobaciones = 0, detalle = [];
  casosDePrueba_().forEach(function (caso) {
    var fallas = [];
    var t = {
      igual: function (a, b, msg) { comprobaciones++; if (a !== b) fallas.push(msg + ' (obtuvo ' + JSON.stringify(a) + ', esperaba ' + JSON.stringify(b) + ')'); },
      distinto: function (a, b, msg) { comprobaciones++; if (a === b) fallas.push(msg + ' (ambos ' + JSON.stringify(a) + ')'); },
      contiene: function (lista, x, msg) { comprobaciones++; if (lista.indexOf(x) < 0) fallas.push(msg + ' (no apareció ' + x + '; hubo ' + JSON.stringify(lista) + ')'); }
    };
    try { caso.fn(t); } catch (e) { fallas.push('Excepción: ' + e.message); }
    if (fallas.length) { fallidas++; detalle.push('✗ ' + caso.nombre + '\n    - ' + fallas.join('\n    - ')); }
    else { pasadas++; detalle.push('✓ ' + caso.nombre); }
  });
  log(detalle.join('\n'));
  log('Resultado: ' + pasadas + ' pruebas OK, ' + fallidas + ' con fallas (' + comprobaciones + ' comprobaciones).');
  return { pasadas: pasadas, fallidas: fallidas, comprobaciones: comprobaciones, detalle: detalle };
}
