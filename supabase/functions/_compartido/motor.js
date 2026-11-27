// =============================================================================
//  SISTEMA FADEFIL · Motor de reglas (equipos, stock, envíos, taller).
//  Pasado tal cual desde Motor.gs (Sheets v1.5): mismas reglas, mismos mensajes.
//  No toca la base: recibe el contexto (maestros) y el estado, simula y devuelve
//  errores, advertencias y efectos. Lo usan la función del servidor y las pruebas.
//  Cambios respecto del original: es un módulo (export al final) y el nombre del
//  depósito central se fija con fijarDepositoCentral().
// =============================================================================
/* eslint-disable */
/**
 * ============================================================================
 *  SISTEMA FADEFIL — Motor.gs
 *  Motor de reglas. NO lee ni escribe planillas: recibe el estado actual,
 *  simula cada operación y devuelve errores, advertencias y efectos.
 *  El estado se puede rearmar repitiendo todas las operaciones vigentes en
 *  orden (el registro de operaciones es la fuente de verdad); al guardar se
 *  parte del estado guardado en tablas (Estado.gs).
 *  Se prueba sin tocar datos reales (ver Pruebas.gs).
 * ============================================================================
 */

// VERSION_SISTEMA se define en Esquema.gs (sistema unificado).

/** CABA siempre va separado: es solo origen o destino de envíos. Su stock no se controla acá. */
/** Depósito central (CABA). Lo fija la configuración (DEPOSITO_CENTRAL) al armar el contexto. Registra ingresos y salidas, sin avisar faltantes. */
var DEPOSITO_CABA = 'Depósito CABA'; // v1.1: el nombre del depósito central (config DEPOSITO_CENTRAL)

/** ¿El depósito avisa faltantes de stock? El central (y cualquiera con controla_stock = FALSE) no. */
function controlaStock_(ctx, dep) {
  var d = ctx && ctx.depositos && ctx.depositos[dep];
  if (!dep) return false;
  if (d && d.controlaStock === false) return false;
  return dep !== DEPOSITO_CABA || !!(d && d.controlaStock === true);
}

var TIPO_OT = {
  ALTA_INICIAL: 'ALTA_INICIAL',
  INSTALACION: 'INSTALACION',
  MANTENIMIENTO: 'MANTENIMIENTO',
  REPARACION: 'REPARACION',
  REPARACION_BACKUP: 'REPARACION_BACKUP',
  CAMBIO_MODELO: 'CAMBIO_MODELO',
  ENTREGA_ADICIONALES: 'ENTREGA_ADICIONALES',
  DESINST_MOMENTANEA: 'DESINSTALACION_MOMENTANEA',
  DESINSTALACION: 'DESINSTALACION',
  ENTREGA_CO2: 'ENTREGA_CO2'
};

var TIPO_OT_TEXTO = {
  ALTA_INICIAL: 'Alta inicial',
  INSTALACION: 'Instalación',
  MANTENIMIENTO: 'Mantenimiento preventivo',
  REPARACION: 'Reparación',
  REPARACION_BACKUP: 'Reparación con backup',
  CAMBIO_MODELO: 'Cambio de modelo',
  ENTREGA_ADICIONALES: 'Entrega de adicionales',
  DESINSTALACION_MOMENTANEA: 'Desinstalación momentánea',
  DESINSTALACION: 'Desinstalación',
  ENTREGA_CO2: 'Entrega de CO₂'
};

/*
 * v1.1: cilindros de CO₂ en las OT (decidido el 22/10). Las series se validan con el motor de CO₂ (co2_Motor.gs);
 * acá se controla quién puede recibir y en qué OT van.
 * - Entrega de CO₂: entrega, retiro o recambio. Con entregas lleva el tipo de entrega.
 * - Instalación: se pueden dejar cilindros. Desinstalaciones: se retiran.
 * - Mantenimiento, reparación y el resto no llevan cilindros: se carga otra OT en la misma visita.
 */
var MODALIDAD_CO2 = { TRADICIONAL: 'Tradicional', EMERGENCIA_CON_COSTO: 'Emergencia con costo', EMERGENCIA_SIN_COSTO: 'Emergencia sin costo' };
var CO2_EN_OT = {
  ENTREGA_CO2: { entrega: true, retiro: true },
  INSTALACION: { entrega: true, retiro: false },
  DESINSTALACION_MOMENTANEA: { entrega: false, retiro: true },
  DESINSTALACION: { entrega: false, retiro: true }
};
/** Solo la entrega de emergencia con costo va a cobranzas (decidido el 22/10). */
function co2VaACobranza_(tipo, modalidad) { return tipo === 'ENTREGA_CO2' && modalidad === 'EMERGENCIA_CON_COSTO'; }

/** Series de CO₂ de una OT, normalizadas. */
function cilindrosDeOT_(d) {
  var x = (d && d.co2) || {};
  var lista = function (l) { return (l || []).map(normalizarSerie).filter(String); };
  return { entregadas: lista(x.entregadas), retiradas: lista(x.retiradas) };
}

/** Nombres viejos de tipos de OT (v0.4): se leen como el tipo actual. */
var TIPO_OT_ALIAS = { ENTREGA_INSUMOS: 'ENTREGA_ADICIONALES' };

function normalizarTipoOT(t) {
  var x = String(t || '').toUpperCase().trim();
  return TIPO_OT_ALIAS[x] || x;
}

var EST_CLI = { ACTIVO: 'ACTIVO', MOMENTANEO: 'DESINSTALADO_MOMENTANEO', EX: 'EX_CLIENTE', SIN_DATOS: 'SIN_DATOS' };
var EST_CLI_TEXTO = { ACTIVO: 'Activo', DESINSTALADO_MOMENTANEO: 'Desinstalado momentáneo', EX_CLIENTE: 'Ex cliente', SIN_DATOS: 'Sin datos (falta alta inicial)' };

var EST_MAQ = { NUEVA: 'NUEVA', USADA: 'USADA', A_REVISAR: 'A_REVISAR', BAJA: 'BAJA' };
var EST_MAQ_TEXTO = { NUEVA: 'Nueva', USADA: 'Usada', A_REVISAR: 'A revisar', BAJA: 'Baja' };

var UBIC = { DEPOSITO: 'DEPOSITO', CLIENTE: 'CLIENTE', TRANSITO: 'TRANSITO', CABA: 'CABA' };

var CAT = { INSUMO: 'INSUMO', ADICIONAL: 'ADICIONAL', REPUESTO: 'REPUESTO', FILTRO: 'FILTRO', RECAMBIO_FILTRO: 'RECAMBIO_FILTRO' };
var CATEGORIAS = ['INSUMO', 'ADICIONAL', 'REPUESTO', 'FILTRO', 'RECAMBIO_FILTRO'];
var CAT_TEXTO = { INSUMO: 'insumo', ADICIONAL: 'adicional', REPUESTO: 'repuesto', FILTRO: 'filtro', RECAMBIO_FILTRO: 'recambio de filtros' };

/** Movimientos de una línea de ítem dentro de una OT. */
var MOV_ITEM = { ENTREGADO: 'ENTREGADO', RETIRADO: 'RETIRADO', CAMBIO: 'CAMBIO', NO_DEVUELTO: 'NO_DEVUELTO' };

/** Saldos de stock por depósito y código. */
var SALDO = { DISPONIBLE: 'DISPONIBLE', A_REVISAR: 'A_REVISAR', PARA_CABA: 'PARA_CABA' };

var RES_TALLER = { APTA: 'APTA', REPARADA: 'REPARADA', ENVIAR_CABA: 'ENVIAR_CABA', BAJA: 'BAJA' };
var RES_TALLER_TEXTO = { APTA: 'Apta', REPARADA: 'Reparada', ENVIAR_CABA: 'Enviar a CABA', BAJA: 'Baja' };
var RES_ITEM = { DISPONIBLE: 'DISPONIBLE', ENVIAR_CABA: 'ENVIAR_CABA', DESCARTE: 'DESCARTE' }; // v1.2.2: descarte (sale del stock)
var SALDO_TEXTO = { DISPONIBLE: 'Disponible', A_REVISAR: 'A revisar', PARA_CABA: 'Para CABA' };

/** Tipos de ajuste de stock: el tipo define si suma (1), resta (-1) o puede ser cualquiera de los dos (0). */
var TIPOS_AJUSTE = {
  INVENTARIO: { texto: 'Inventario inicial', signo: 1 },
  COMPRA: { texto: 'Compra local', signo: 1 },
  PERDIDA: { texto: 'Pérdida', signo: -1 },
  ROTURA: { texto: 'Rotura / descarte', signo: -1 },
  CONTEO: { texto: 'Diferencia de conteo', signo: 0 },
  // Lo genera el sistema en el alta inicial (no se elige a mano): ingresa lo que se entrega al cliente migrado.
  ALTA_INICIAL: { texto: 'Alta inicial (migración)', signo: 1, automatico: true }
};

/** Origen de una revisión de máquina que no viene de una OT. */
var ORIGEN_TALLER_TEXTO = { MANUAL: 'Ingreso manual', REPARACION_DEPOSITO: 'Reparación en depósito' };

/**
 * Categorías de ítem que permite cada tipo de trabajo (v0.5). La hoja REGLAS_TRABAJO puede cambiarlas.
 * Insumos: instalación y reparación. Repuestos: instalación y reparación. Adicionales: instalación y entregas.
 * Filtros: instalación, mantenimiento y reparación. Recambio de filtros: mantenimiento y reparación.
 * Cambio de modelo: entrega y retiro de insumos y adicionales según el modelo nuevo.
 * Desinstalaciones: retiro de lo que tiene el cliente.
 */
var REGLAS_POR_DEFECTO = {
  ALTA_INICIAL: ['INSUMO', 'ADICIONAL'],
  INSTALACION: ['INSUMO', 'REPUESTO', 'ADICIONAL', 'FILTRO'],
  MANTENIMIENTO: ['FILTRO', 'RECAMBIO_FILTRO'],
  REPARACION: ['INSUMO', 'REPUESTO', 'FILTRO', 'RECAMBIO_FILTRO'],
  REPARACION_BACKUP: ['INSUMO', 'REPUESTO', 'FILTRO', 'RECAMBIO_FILTRO'],
  CAMBIO_MODELO: ['INSUMO', 'ADICIONAL'],
  ENTREGA_ADICIONALES: ['ADICIONAL'],
  DESINSTALACION_MOMENTANEA: ['INSUMO', 'ADICIONAL'],
  DESINSTALACION: ['INSUMO', 'ADICIONAL'],
  ENTREGA_CO2: [] // solo cilindros
};

/** v1.2.1: OT en las que se puede retirar cualquier ítem del catálogo (con aviso si no figura en el cliente). */
var TIPOS_RETIRO_LIBRE = ['DESINSTALACION_MOMENTANEA', 'DESINSTALACION'];

/** Códigos que forman parte del sistema y el prefiltro que tiene hoy el cliente (filtro, componentes y piezas). */
function sistemaDelCliente_(ctx, c) {
  var out = {};
  ['SISTEMA', 'PREFILTRO'].forEach(function (s) {
    var df = c && c.sis && c.sis[s] ? defSistema_(ctx, c.sis[s].nombre) : null;
    if (df) { out[df.filtro] = true; df.comps.forEach(function (x) { out[x.codigo] = true; }); df.partes.forEach(function (x) { out[x.codigo] = true; }); }
  });
  return out;
}

/** Tipos en los que insumos y adicionales NO van a ENTREGA_ADICIONALES (son la instalación o el retiro final). */
var TIPOS_SIN_COBRANZA = ['ALTA_INICIAL', 'INSTALACION', 'CAMBIO_MODELO', 'DESINSTALACION_MOMENTANEA', 'DESINSTALACION'];

/**
 * v0.9.4: lo que tiene el cliente se separa en dos saldos.
 * - En comodato: lo entregado en la instalación, el alta inicial y el cambio de modelo. Es lo que se espera retirar al desinstalar.
 * - Adicionales: lo entregado en cualquier otra OT (ya cobrado, es del cliente). No se pide devolverlo.
 * Los cambios y los retiros en otras OT no tocan el comodato (un cambio deja lo nuevo en el mismo saldo que lo retirado).
 */
var TIPOS_COMODATO = ['ALTA_INICIAL', 'INSTALACION', 'CAMBIO_MODELO'];

/* ---------------------------------------------------------------------------
 *  Normalización y fechas
 * ------------------------------------------------------------------------ */

/** Serie o código en mayúsculas y sin espacios: "ab 123 " → "AB123". */
function normalizarSerie(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/\s+/g, '');
}

function normalizarCodigo(s) {
  return String(s == null ? '' : s).toUpperCase().trim();
}

function esFechaValida(f) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f || ''))) return false;
  var p = f.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

function fechaTexto(f) {
  if (!esFechaValida(f)) return String(f || '');
  var p = f.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

function diasEntre(desdeIso, hastaIso) {
  if (!esFechaValida(desdeIso) || !esFechaValida(hastaIso)) return 0;
  var a = desdeIso.split('-').map(Number), b = hastaIso.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

function sumarDias(iso, n) {
  if (!esFechaValida(iso)) return '';
  var p = iso.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + Number(n || 0)));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

function maxFecha_() {
  var m = '';
  for (var i = 0; i < arguments.length; i++) if (esFechaValida(arguments[i]) && arguments[i] > m) m = arguments[i];
  return m;
}

/** Suma meses de calendario (31/01 + 1 mes = 28/02 o 29/02). */
function sumarMeses(iso, n) {
  if (!esFechaValida(iso)) return '';
  var p = iso.split('-').map(Number);
  var total = p[0] * 12 + (p[1] - 1) + Number(n || 0);
  var y = Math.floor(total / 12), m = total - y * 12;
  var ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return y + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + Math.min(p[2], ultimo)).slice(-2);
}

/* ---------------------------------------------------------------------------
 *  Sistemas de purificación (v0.9). Reglas: clientes/SISTEMAS_PURIFICACION.md
 *  ctx.sistemas = { nombre: { nombre, tipo: SISTEMA | PREFILTRO, filtro,
 *                             partes: [{ codigo, unidades }],   ← lo que queda instalado: el filtro + cabezal / tanque
 *                             comps:  [{ codigo, rol, unidades, meses, siFalla }] } }
 *  Solo están los sistemas completos (todos sus códigos en el CATÁLOGO). Si no hay ninguno, el sistema y el
 *  prefiltro de una OT son solo un nombre, como antes.
 *  En el cliente: c.sis = { SISTEMA: slot, PREFILTRO: slot }; slot = { nombre, desde, partes: {codigo: cant}, ult: {codigo: fecha} }
 * ------------------------------------------------------------------------ */
var SLOT_SIS = { SISTEMA: 'SISTEMA', PREFILTRO: 'PREFILTRO' };
var SLOTS_SIS = ['SISTEMA', 'PREFILTRO'];
var SLOT_TEXTO = { SISTEMA: 'Sistema', PREFILTRO: 'Prefiltro' };
var ROL_COMP = { RECAMBIO: 'RECAMBIO', INSTALACION: 'INSTALACION', CONSUMO: 'CONSUMO' };
var SI_FALLA = { REVISION: 'REVISION', DESCARTE: 'DESCARTE' };
/** OT en las que se puede cambiar el sistema o hacer backup del mismo (además de la instalación). */
var TIPOS_CAMBIO_SISTEMA = ['MANTENIMIENTO', 'REPARACION', 'REPARACION_BACKUP', 'CAMBIO_MODELO'];
var ACCION_SIS = { CAMBIAR: 'CAMBIAR', BACKUP: 'BACKUP' };

/**
 * Arma ctx.sistemas desde las filas de SISTEMAS_PURIFICACION (una fila por componente).
 * filas: [{ sistema, tipo, codigoFiltro, codigoComponente, componente, rol, unidades, meses, siFalla, activo }]
 * Un componente sin código cuyo nombre es el del sistema (PWG, 3 Etapas Office) usa el código del filtro: el filtro es el recambio.
 * Devuelve { sistemas, incompletos: [nombres sin todos sus códigos en el catálogo] }.
 */
function construirSistemas_(filas, catalogo) {
  var g = {}, orden = [];
  (filas || []).forEach(function (r) {
    var n = String(r.sistema || '').trim();
    if (!n) return;
    if (!g[n]) { g[n] = { nombre: n, tipo: '', filtro: '', activo: true, filas: [] }; orden.push(n); }
    var x = g[n];
    var t = String(r.tipo || '').toUpperCase().trim();
    if (t && !x.tipo) x.tipo = t === 'PREFILTRO' ? SLOT_SIS.PREFILTRO : SLOT_SIS.SISTEMA;
    var cf = normalizarCodigo(r.codigoFiltro);
    if (cf && !x.filtro) x.filtro = cf;
    if (r.activo === false) x.activo = false;
    x.filas.push(r);
  });
  var sistemas = {}, incompletos = [];
  orden.forEach(function (n) {
    var x = g[n];
    var ok = !!x.filtro && !!catalogo[x.filtro];
    var comps = x.filas.map(function (r) {
      var cod = normalizarCodigo(r.codigoComponente);
      if (!cod && String(r.componente || '').trim().toUpperCase() === n.toUpperCase()) cod = x.filtro;
      var meses = Number(r.meses) > 0 ? Number(r.meses) : 0;
      var rol = String(r.rol || '').toUpperCase().trim();
      if (!ROL_COMP[rol]) rol = meses ? ROL_COMP.RECAMBIO : ROL_COMP.INSTALACION;
      if (!cod || !catalogo[cod]) ok = false;
      return { codigo: cod, rol: rol, unidades: Number(r.unidades) > 0 ? Number(r.unidades) : 1, meses: rol === ROL_COMP.RECAMBIO ? meses : 0,
        siFalla: String(r.siFalla || '').toUpperCase().trim() === SI_FALLA.REVISION ? SI_FALLA.REVISION : SI_FALLA.DESCARTE };
    });
    if (!ok) { incompletos.push(n); return; }
    sistemas[n] = { nombre: n, tipo: x.tipo || SLOT_SIS.SISTEMA, filtro: x.filtro, activo: x.activo, comps: comps,
      partes: [{ codigo: x.filtro, unidades: 1 }].concat(comps.filter(function (c) { return c.rol === ROL_COMP.INSTALACION; }).map(function (c) { return { codigo: c.codigo, unidades: c.unidades }; })) };
  });
  return { sistemas: sistemas, incompletos: incompletos };
}

function hayMaestroSistemas_(ctx) { return !!ctx.sistemas && Object.keys(ctx.sistemas).length > 0; }
function defSistema_(ctx, nombre) { return (ctx.sistemas || {})[String(nombre || '').trim()] || null; }
function slotsCliente_(c) { if (!c.sis) c.sis = { SISTEMA: null, PREFILTRO: null }; return c.sis; }

/**
 * Qué pasa con el sistema y el prefiltro del cliente en una OT: lista de acciones RETIRAR / NO_DEVUELTO / INSTALAR.
 * Campos de la OT: sistema, accionSistema (CAMBIAR | BACKUP), retirarSistema (momentánea), sistemaNoDevuelto (definitiva),
 * fechasSistema (alta inicial: { codigo: fecha del último cambio }); lo mismo para el prefiltro.
 */
function planSistemas_(res, d, c, ctx, tipo) {
  var plan = [];
  if (!hayMaestroSistemas_(ctx)) return plan;
  var sis = c.sis || {};
  var campos = {
    SISTEMA: { nombre: d.sistema, accion: d.accionSistema, retirar: d.retirarSistema, noDevuelto: d.sistemaNoDevuelto, fechas: d.fechasSistema },
    PREFILTRO: { nombre: d.prefiltro, accion: d.accionPrefiltro, retirar: d.retirarPrefiltro, noDevuelto: d.prefiltroNoDevuelto, fechas: d.fechasPrefiltro }
  };
  SLOTS_SIS.forEach(function (slot) {
    var x = campos[slot], nombre = String(x.nombre || '').trim(), actual = sis[slot] || null;
    var accion = String(x.accion || '').toUpperCase().trim();
    var txt = slot === SLOT_SIS.SISTEMA ? 'el sistema de purificación' : 'el prefiltro';
    var def = function () {
      var df = defSistema_(ctx, nombre);
      if (!df) { err_(res, 'SISTEMA_INEXISTENTE', '"' + nombre + '" no está en SISTEMAS_PURIFICACION (o le faltan códigos del CATÁLOGO).'); return null; }
      if (df.tipo !== slot) { err_(res, 'SISTEMA_INEXISTENTE', '"' + nombre + '" figura como ' + SLOT_TEXTO[df.tipo].toLowerCase() + ', no como ' + SLOT_TEXTO[slot].toLowerCase() + '.'); return null; }
      if (!df.activo) { err_(res, 'SISTEMA_INACTIVO', '"' + nombre + '" está inactivo en SISTEMAS_PURIFICACION: ya no se instala.'); return null; }
      return df;
    };
    if (tipo === TIPO_OT.INSTALACION || tipo === TIPO_OT.ALTA_INICIAL) {
      if (!nombre || !def()) return;
      if (actual && actual.nombre === nombre) return; // sigue instalado desde antes (reinstalación)
      if (tipo === TIPO_OT.ALTA_INICIAL) {
        Object.keys(x.fechas || {}).forEach(function (k) {
          var fx = x.fechas[k];
          if (fx && (!esFechaValida(fx) || fx > d.fecha)) err_(res, 'FECHA_INVALIDA', 'La fecha del último cambio de ' + nombreItem_(ctx, k) + ' no es válida o es posterior al alta.');
        });
      }
      if (actual) plan.push({ slot: slot, accion: 'RETIRAR', nombre: actual.nombre });
      plan.push({ slot: slot, accion: 'INSTALAR', nombre: nombre, migracion: tipo === TIPO_OT.ALTA_INICIAL, fechas: x.fechas || {} });
      return;
    }
    if (tipo === TIPO_OT.DESINST_MOMENTANEA) { if (actual && x.retirar !== false) plan.push({ slot: slot, accion: 'RETIRAR', nombre: actual.nombre }); return; }
    if (tipo === TIPO_OT.DESINSTALACION) { if (actual) plan.push({ slot: slot, accion: x.noDevuelto ? 'NO_DEVUELTO' : 'RETIRAR', nombre: actual.nombre }); return; }
    if (!accion && nombre && (!actual || actual.nombre !== nombre)) accion = ACCION_SIS.CAMBIAR; // indicó otro sistema
    if (!accion) return;
    if (TIPOS_CAMBIO_SISTEMA.indexOf(tipo) < 0) { err_(res, 'CAMBIO_SISTEMA_NO_PERMITIDO', 'En una ' + TIPO_OT_TEXTO[tipo] + ' no se cambia ' + txt + '.'); return; }
    if (accion === ACCION_SIS.BACKUP) {
      if (!actual) { err_(res, 'SIN_SISTEMA', 'El cliente no tiene ' + txt + ' instalado: no hay backup que hacer.'); return; }
      var dfa = defSistema_(ctx, actual.nombre);
      if (!dfa) { err_(res, 'SISTEMA_INEXISTENTE', '"' + actual.nombre + '" ya no está completo en SISTEMAS_PURIFICACION.'); return; }
      if (!dfa.activo) { err_(res, 'SISTEMA_INACTIVO', '"' + actual.nombre + '" está inactivo en SISTEMAS_PURIFICACION: para el backup elegí Cambiar por otro.'); return; }
      plan.push({ slot: slot, accion: 'RETIRAR', nombre: actual.nombre });
      plan.push({ slot: slot, accion: 'INSTALAR', nombre: actual.nombre });
      return;
    }
    if (accion !== ACCION_SIS.CAMBIAR) { err_(res, 'ACCION_INVALIDA', 'La acción sobre ' + txt + ' debe ser Cambiar por otro o Backup del mismo.'); return; }
    if (!nombre) { err_(res, 'FALTA_SISTEMA', 'Indicá ' + txt + ' nuevo.'); return; }
    if (actual && actual.nombre === nombre) { err_(res, 'MISMO_SISTEMA', 'El cliente ya tiene ' + nombre + '. Para reemplazarlo por otro igual usá Backup del mismo.'); return; }
    if (!def()) return;
    if (actual) plan.push({ slot: slot, accion: 'RETIRAR', nombre: actual.nombre });
    plan.push({ slot: slot, accion: 'INSTALAR', nombre: nombre });
  });
  return plan;
}

/** Componentes con vencimiento (recambios) o por consumo del sistema y del prefiltro instalados en el cliente. */
function componentesCliente_(c, ctx) {
  var out = [];
  var sis = (c && c.sis) || {};
  SLOTS_SIS.forEach(function (s) {
    var slot = sis[s];
    if (!slot) return;
    var def = defSistema_(ctx, slot.nombre);
    (def ? def.comps : []).forEach(function (x) {
      if (x.rol === ROL_COMP.INSTALACION) return;
      var ult = slot.ult[x.codigo] || slot.desde;
      out.push({ slot: s, sistema: slot.nombre, codigo: x.codigo, descripcion: nombreItem_(ctx, x.codigo), rol: x.rol, unidades: x.unidades, meses: x.meses,
        ultimo: ult, vence: x.rol === ROL_COMP.RECAMBIO && x.meses ? sumarMeses(ult, x.meses) : '' });
    });
  });
  return out;
}

/** Días que se anticipa un recambio: en una visita se cambia lo vencido y lo que vence hasta N días después (decidido 21/10: 20). */
var DIAS_ANTICIPO_FILTROS_DEFECTO = 20;

/** En una visita del día `fecha`, se cambia lo que vence hasta `diasAnticipo` días después; lo que vence más tarde queda para la visita siguiente. */
function aCambiarEnVisita_(comps, fecha, diasAnticipo) {
  var limite = sumarDias(fecha, diasAnticipo == null || diasAnticipo === '' ? DIAS_ANTICIPO_FILTROS_DEFECTO : Number(diasAnticipo));
  return comps.filter(function (x) { return x.rol === ROL_COMP.RECAMBIO && x.vence && x.vence <= limite; });
}

/* ---------------------------------------------------------------------------
 *  Resultado, errores y advertencias
 * ------------------------------------------------------------------------ */

function nuevoResultado_() {
  return { errores: [], advertencias: [], efectos: null };
}

function err_(res, codigo, mensaje) { res.errores.push({ codigo: codigo, mensaje: mensaje }); }
function adv_(res, codigo, mensaje) { res.advertencias.push({ codigo: codigo, mensaje: mensaje }); }

function validarFecha_(res, fecha, ctx, campo) {
  if (!esFechaValida(fecha)) {
    err_(res, 'FECHA_INVALIDA', 'La fecha "' + (fecha || '') + '" no es válida. Revisá el campo ' + (campo || 'Fecha') + '.');
    return false;
  }
  if (ctx.hoy && fecha > ctx.hoy) {
    err_(res, 'FECHA_FUTURA', 'La fecha ' + fechaTexto(fecha) + ' es posterior a hoy. Revisá el campo ' + (campo || 'Fecha') + '.');
    return false;
  }
  return true;
}

function cant_(n) { return Math.round(Number(n) * 1000) / 1000; }

/* ---------------------------------------------------------------------------
 *  Estado
 *  W = { clientes, maquinas, stock, envios, ingresos }
 * ------------------------------------------------------------------------ */

/** Estado de partida: cada máquina del maestro, Nueva en su depósito inicial. */
function estadoInicial(ctx) {
  var W = { clientes: {}, maquinas: {}, stock: {}, envios: {}, ingresos: {}, lotes: {}, movStock: [] };
  Object.keys(ctx.maquinas || {}).forEach(function (serie) {
    var m = ctx.maquinas[serie];
    var dep = String(m.depositoInicial || '').trim();
    W.maquinas[serie] = {
      serie: serie, estado: EST_MAQ.NUEVA,
      ubicTipo: UBIC.DEPOSITO, ubicId: dep, // v1.0: el depósito central es un depósito más (UBIC.CABA queda solo por compatibilidad)
      ultimaFecha: m.fechaAlta || '', ingresoAbierto: '', paraCaba: false
    };
  });
  return W;
}

function cliente_(W, id) {
  if (!W.clientes[id]) {
    W.clientes[id] = {
      id: id, estado: EST_CLI.SIN_DATOS, serie: '', tieneOT: false,
      fechaInstalacion: '', fechaCambio: '', fechaDesinstalacion: '', ultimaVisita: '', tipoUltimaVisita: '',
      ultimaFechaOT: '', fechaBase: '', ultimoMantenimiento: '', mantMes: 0, tipoUltimoMant: '', pendiente: '',
      sistema: '', prefiltro: '', comodato: {}, adicionales: {}, comentarioDesinstalacion: '', faltante: {}, devueltoDeMas: {}
    };
  }
  return W.clientes[id];
}

function leerCliente_(W, id) {
  return W.clientes[id] || { id: id, estado: EST_CLI.SIN_DATOS, serie: '', tieneOT: false, comodato: {}, adicionales: {}, ultimaFechaOT: '' };
}

function saldo_(W, dep, codigo) {
  var d = W.stock[dep] || {};
  return d[codigo] || { DISPONIBLE: 0, A_REVISAR: 0, PARA_CABA: 0 };
}

function moverStock_(W, dep, codigo, bucket, delta, fecha, mov) {
  if (!dep || !delta) return; // v1.0: el depósito central también registra (sin avisar faltantes)
  W.stock[dep] = W.stock[dep] || {};
  var s = W.stock[dep][codigo] = W.stock[dep][codigo] || { DISPONIBLE: 0, A_REVISAR: 0, PARA_CABA: 0 };
  s[bucket] = cant_(s[bucket] + delta);
  if (mov && fecha) registrarKardex_(W, dep, codigo, bucket, delta, fecha, mov);
  // v0.9.4: línea de tiempo del disponible, para avisar cuando algo se usa antes de haber llegado.
  if (bucket === SALDO.DISPONIBLE && fecha) {
    W.lineaDisp = W.lineaDisp || {};
    (W.lineaDisp[dep + '|' + codigo] = W.lineaDisp[dep + '|' + codigo] || []).push([fecha, cant_(delta)]);
  }
}

/**
 * v0.9.4: movimientos de stock de todos los saldos (Disponible, A revisar y Para CABA), con su origen.
 * mov = { texto, idCliente, serie, detalle }. Dos cambios seguidos de la misma operación, ítem y movimiento
 * (por ejemplo una revisión: sale de A revisar y entra a Disponible) quedan en un solo renglón.
 */
function registrarKardex_(W, dep, codigo, bucket, delta, fecha, mov) {
  W.kardex = W.kardex || [];
  var ult = W.kardex[W.kardex.length - 1], op = W._opId || '';
  if (ult && ult.op === op && ult.dep === dep && ult.cod === codigo && ult.mov === mov.texto && ult.f === fecha && ult.det === (mov.detalle || '') && ult.cli === (mov.idCliente || '')) {
    ult.d[bucket] = cant_((ult.d[bucket] || 0) + delta);
    return;
  }
  var d = {}; d[bucket] = cant_(delta);
  W.kardex.push({ f: fecha, dep: dep, cod: codigo, mov: mov.texto, d: d, cli: mov.idCliente || '', serie: mov.serie || '', det: mov.detalle || '', op: op });
}

/**
 * v0.9.4: ¿usar "uso" unidades de un código en un depósito con fecha "fecha" deja el disponible negativo
 * en algún momento desde esa fecha? Lo del mismo día se toma como anterior. Devuelve null si no falta.
 */
function compararComodato_(comodato, retirado) {
  var faltante = {}, deMas = {};
  var cods = Object.keys(comodato || {}).concat(Object.keys(retirado || {}));
  cods.forEach(function (k) {
    if (k in faltante || k in deMas) return;
    var dif = cant_(((comodato || {})[k] || 0) - ((retirado || {})[k] || 0));
    if (dif > 0) faltante[k] = dif; else if (dif < 0) deMas[k] = -dif;
  });
  return { faltante: faltante, deMas: deMas };
}

function faltaEnFecha_(W, dep, codigo, fecha, uso) {
  if (!dep || !fecha || !(uso > 0)) return null;
  var NUEVO = 1e9;
  var ev = ((W.lineaDisp || {})[dep + '|' + codigo] || []).map(function (x, i) { return { f: x[0], q: x[1], i: i }; });
  ev.push({ f: fecha, q: -uso, i: NUEVO });
  ev.sort(function (a, b) { return String(a.f).localeCompare(String(b.f)) || a.i - b.i; });
  var s = 0, habia = null, min = null, fMin = '';
  ev.forEach(function (e) {
    if (e.i === NUEVO) habia = s;
    s = cant_(s + e.q);
    if (habia !== null && (min === null || s < min)) { min = s; fMin = e.f; }
  });
  if (min === null || min >= 0) return null;
  var llega = ev.filter(function (e) { return e.f > fecha && e.q > 0; })[0];
  return { habia: habia, min: min, fechaMin: fMin, llega: llega ? llega.f : '' };
}

/**
 * v0.9.4: advertencia de stock a la fecha de la operación. Solo para los códigos en los que el stock de hoy alcanza
 * (si no alcanza hoy ya avisa STOCK_INSUFICIENTE): detecta lo cargado con una fecha anterior a la llegada de la mercadería.
 */
var SIN_AVISOS_DE_FECHA_ = false; // al reconstruir el historial no hacen falta (y se ahorra tiempo)

function avisarStockEnFecha_(res, W, ctx, dep, uso, fecha) {
  if (SIN_AVISOS_DE_FECHA_ || !controlaStock_(ctx, dep) || !esFechaValida(fecha)) return;
  Object.keys(uso || {}).forEach(function (k) {
    if (!(uso[k] > 0) || saldo_(W, dep, k).DISPONIBLE < uso[k]) return;
    var f = faltaEnFecha_(W, dep, k, fecha, uso[k]);
    if (!f) return;
    var item = nombreItem_(ctx, k), donde = ' en el ' + nombreDeposito_(dep);
    if (f.habia < uso[k]) {
      adv_(res, 'STOCK_A_ESA_FECHA', 'Al ' + fechaTexto(fecha) + ' había ' + f.habia + ' ' + item + ' disponibles' + donde + ' y se usan ' + uso[k] + '.' +
        (f.llega ? ' Lo que alcanza ingresó después (' + fechaTexto(f.llega) + ').' : '') + ' Revisá la fecha de esta operación o la del envío o ajuste.');
    } else {
      adv_(res, 'STOCK_A_ESA_FECHA', 'Con esto, el stock de ' + item + donde + ' queda en ' + f.min + ' el ' + fechaTexto(f.fechaMin) +
        ' (hay salidas cargadas después). Revisá las fechas.');
    }
  });
}

/**
 * Lotes de ítems a revisar: cada retiro (o ajuste) que entra A revisar queda como un lote con su origen
 * (cliente, fecha, tipo y N° de OT). El saldo A revisar de un depósito es la suma de sus lotes.
 */
function crearLote_(W, id, dep, codigo, cantidad, info) {
  if (!dep || !(cantidad > 0)) return;
  var l = W.lotes[id];
  if (l) { l.cantidad = cant_(l.cantidad + cantidad); return; }
  W.lotes[id] = { id: id, deposito: dep, codigo: codigo, cantidad: cant_(cantidad), fecha: info.fecha || '', idCliente: info.idCliente || '',
    tipoOT: info.tipoOT || '', origen: info.origen || '' };
}

/** Lotes con saldo de un depósito y código, del más viejo al más nuevo. */
function lotesDe_(W, dep, codigo) {
  return Object.keys(W.lotes || {}).map(function (k) { return W.lotes[k]; })
    .filter(function (l) { return l.deposito === dep && l.codigo === codigo && l.cantidad > 0; })
    .sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)) || String(a.id).localeCompare(String(b.id)); });
}

/** Descuenta de un lote puntual o, si no se indica, de los más viejos primero. */
function consumirLotes_(W, dep, codigo, cantidad, idLote) {
  var resta = cantidad;
  var lista = idLote ? [W.lotes[idLote]].filter(Boolean) : lotesDe_(W, dep, codigo);
  lista.forEach(function (l) {
    if (resta <= 0) return;
    var t = Math.min(l.cantidad, resta);
    l.cantidad = cant_(l.cantidad - t);
    resta = cant_(resta - t);
    if (l.cantidad <= 0) delete W.lotes[l.id];
  });
}

/**
 * Movimientos de stock de un depósito del interior, para medir ingresos y salidas por período.
 * Salidas:  CLIENTE (entregado a un cliente), MAQUINA (usado en una máquina, en calle o en depósito), AJUSTE (pérdida, rotura, conteo negativo).
 * Ingresos: ENVIO (recepción de un envío), REVISION (ítem retirado que la revisión dejó Disponible), AJUSTE (inventario, compra, conteo positivo).
 * No cuentan los retiros de clientes (entran A revisar y cuentan recién cuando la revisión los deja Disponibles)
 * ni lo que se despacha en un envío.
 */
var TIPO_MOV_TEXTO = {
  SALIDA: { CLIENTE: 'Entregado a cliente', MAQUINA: 'Usado en máquina', AJUSTE: 'Ajuste', REACONDICIONAMIENTO: 'Usado para reacondicionar' },
  INGRESO: { ENVIO: 'Recepción de envío', REVISION: 'Revisión OK', AJUSTE: 'Ajuste' }
};
function registrarMov_(W, sentido, dep, codigo, cantidad, fecha, tipo, origen, extra) {
  if (!dep || !(cantidad > 0)) return;
  extra = extra || {};
  W.movStock = W.movStock || [];
  W.movStock.push({ sentido: sentido, tipo: tipo, deposito: dep, codigo: codigo, cantidad: cant_(cantidad), fecha: fecha, origen: origen,
    idCliente: extra.idCliente || '', serie: extra.serie || '', detalle: extra.detalle || '' });
}
function registrarSalida_(W, dep, codigo, cantidad, fecha, tipo, origen, idCliente, serie) {
  registrarMov_(W, 'SALIDA', dep, codigo, cantidad, fecha, tipo, origen, { idCliente: idCliente, serie: serie });
}

function esDeposito_(ctx, id) {
  return id === DEPOSITO_CABA || !!(ctx.depositos && ctx.depositos[id]);
}

function nombreDeposito_(id) {
  if (/^dep[oó]sito/i.test(String(id || ''))) return id; // v1.1: el depósito se llama por su nombre
  return 'depósito ' + id;
}

function describirUbicacion_(m, ctx) {
  if (!m) return 'sin registro';
  if (m.ubicTipo === UBIC.DEPOSITO) return nombreDeposito_(m.ubicId);
  if (m.ubicTipo === UBIC.CABA) return 'CABA';
  if (m.ubicTipo === UBIC.TRANSITO) return 'en tránsito (envío ' + m.ubicId + ')';
  if (m.ubicTipo === UBIC.CLIENTE) {
    var c = ctx.clientes && ctx.clientes[m.ubicId];
    return 'cliente ' + (c ? c.nombre + ' (' + m.ubicId + ')' : m.ubicId);
  }
  return m.ubicTipo || 'desconocida';
}

function nombreItem_(ctx, codigo) {
  var c = ctx.catalogo && ctx.catalogo[codigo];
  return c ? c.descripcion : codigo;
}

function textoCantidades_(ctx, mapa) {
  return Object.keys(mapa).filter(function (k) { return mapa[k] > 0; }).sort()
    .map(function (k) { return mapa[k] + ' ' + nombreItem_(ctx, k); }).join(', ');
}

function categoriasPermitidas_(ctx, tipo) {
  var r = (ctx.reglas && ctx.reglas[tipo]) || REGLAS_POR_DEFECTO[tipo] || [];
  return r;
}

/** Depósito de la plaza del cliente (o '' si no se puede determinar). */
function depositoDeCliente_(ctx, idCliente) {
  var c = ctx.clientes && ctx.clientes[idCliente];
  if (!c) return '';
  var p = ctx.plazas && ctx.plazas[c.plaza];
  return p ? p.deposito : '';
}

/** v1.1: en qué OT van cilindros y a quién se le puede entregar CO₂ (las series las valida el motor de CO₂). */
/**
 * v1.3: técnicos de la OT. En las regiones con técnico obligatorio (config, por defecto AMBA) y con técnicos cargados,
 * el técnico se elige de la lista (y opcionalmente un segundo, cuando el trabajo se hace de a dos). En las demás es texto libre.
 */
function tecnicosDeRegion_(ctx, region) {
  return Object.keys(ctx.tecnicos || {}).filter(function (k) { var t = ctx.tecnicos[k]; return t.activo !== false && t.region === region; });
}
function validarTecnicos_(res, d, tipo, cm, ctx) {
  var t1 = String(d.tecnico || '').trim(), t2 = String(d.tecnico2 || '').trim();
  if (t2 && t2 === t1) err_(res, 'TECNICO_REPETIDO', 'El segundo técnico es el mismo que el primero.');
  if (tipo === TIPO_OT.ALTA_INICIAL || !cm) return;
  var region = cm.region || '';
  if ((ctx.regionesTecnicoObligatorio || []).indexOf(region) < 0) return;
  var lista = tecnicosDeRegion_(ctx, region);
  if (!lista.length) return; // todavía no se cargaron los técnicos de la región: no se exige
  if (!t1) err_(res, 'FALTA_TECNICO', 'Elegí el técnico que hizo el trabajo.');
  [t1, t2].forEach(function (t) {
    if (t && lista.indexOf(t) < 0) err_(res, 'TECNICO_INEXISTENTE', 'El técnico "' + t + '" no está en la lista de técnicos activos de ' + region + ' (Maestros → tecnicos).');
  });
}

function validarCilindrosEnOT_(res, d, tipo, cm, nom) {
  var cil = cilindrosDeOT_(d), reglas = CO2_EN_OT[tipo];
  if (!cil.entregadas.length && !cil.retiradas.length) return;
  if (!reglas) {
    err_(res, 'CO2_NO_PERMITIDO', 'En una ' + (TIPO_OT_TEXTO[tipo] || tipo) + ' no se cargan cilindros de CO₂: cargá otra OT "Entrega de CO₂" en la misma visita.');
    return;
  }
  if (cil.entregadas.length && !reglas.entrega) err_(res, 'CO2_NO_PERMITIDO', 'En una ' + TIPO_OT_TEXTO[tipo] + ' no se entregan cilindros: solo se retiran.');
  if (cil.retiradas.length && !reglas.retiro) err_(res, 'CO2_NO_PERMITIDO', 'En una ' + TIPO_OT_TEXTO[tipo] + ' no se retiran cilindros: para eso hay una OT "Entrega de CO₂".');
  if (cil.entregadas.length && /hielogic/i.test(String(cm.tipoCliente || ''))) {
    err_(res, 'CO2_HIELOGIC', 'El cliente ' + nom + ' es Hielogic: no recibe CO₂ (solo se le pueden retirar cilindros).');
  }
  if (tipo !== TIPO_OT.ENTREGA_CO2 && d.modalidadCo2) err_(res, 'MODALIDAD_SOBRANTE', 'El tipo de entrega de CO₂ va solo en una OT "Entrega de CO₂".');
}

/* ---------------------------------------------------------------------------
 *  Líneas de ítems
 * ------------------------------------------------------------------------ */

function normalizarLineas_(lineas) {
  return (lineas || []).map(function (l) {
    return {
      codigo: normalizarCodigo(l.codigo), cantidad: cant_(l.cantidad), mov: String(l.mov || 'ENTREGADO').toUpperCase(),
      codigoRetirado: normalizarCodigo(l.codigoRetirado || ''), dto: l.dto == null ? null : String(l.dto),
      desde: String(l.desde || '').toUpperCase(), resultado: String(l.resultado || '').toUpperCase()
    };
  }).filter(function (l) { return l.codigo || l.cantidad; });
}

/** Valida código y cantidad. Devuelve la categoría o '' si hay error. */
function validarCodigo_(res, ctx, codigo, cantidad, n) {
  var item = ctx.catalogo[codigo];
  if (!codigo) { err_(res, 'ITEM_SIN_CODIGO', 'La línea ' + n + ' no tiene ítem.'); return ''; }
  if (!item) { err_(res, 'ITEM_INEXISTENTE', 'El ítem "' + codigo + '" no existe en el CATÁLOGO.'); return ''; }
  if (item.activo === false) { err_(res, 'ITEM_INACTIVO', 'El ítem ' + item.descripcion + ' está inactivo en el CATÁLOGO.'); return ''; }
  if (!(cantidad > 0)) { err_(res, 'CANTIDAD_INVALIDA', 'La cantidad de ' + item.descripcion + ' debe ser mayor que cero.'); return ''; }
  return item.categoria;
}

/* ---------------------------------------------------------------------------
 *  OT
 *  d = { fecha, idCliente, tipo, tecnico, serieInstalada, serieRetirada, falla,
 *        sistema, prefiltro, comentarios, pendiente, estadoInicial, fechaInstalacion,
 *        fechaBase, items: [{ codigo, cantidad, mov, codigoRetirado, dto }] }
 * ------------------------------------------------------------------------ */
function validarOT_(d, W, ctx, idOp) {
  var res = nuevoResultado_();
  var tipo = normalizarTipoOT(d.tipo);
  if (!TIPO_OT_TEXTO[tipo]) err_(res, 'TIPO_OT_INVALIDO', 'El tipo de trabajo "' + (d.tipo || '') + '" no existe en este sistema.');
  var fechaOk = validarFecha_(res, d.fecha, ctx);
  var idCli = String(d.idCliente || '').trim();
  var cm = ctx.clientes[idCli];
  if (!cm) err_(res, 'CLIENTE_INEXISTENTE', 'El cliente "' + idCli + '" no existe en CLIENTES.');
  var dep = '';
  if (cm) {
    var plaza = ctx.plazas[cm.plaza];
    if (!plaza) err_(res, 'PLAZA_INEXISTENTE', 'El cliente ' + cm.nombre + ' tiene la plaza "' + (cm.plaza || '') + '", que no existe en PLAZAS.');
    else if (!ctx.depositos[plaza.deposito]) err_(res, 'DEPOSITO_INEXISTENTE', 'La plaza ' + cm.plaza + ' apunta al depósito "' + plaza.deposito + '", que no existe en DEPOSITOS.');
    else dep = plaza.deposito;
  }
  if (res.errores.length || !fechaOk) return res;

  var c = leerCliente_(W, idCli);
  var nom = cm.nombre + ' (' + idCli + ')';
  if (c.ultimaFechaOT && d.fecha < c.ultimaFechaOT) {
    err_(res, 'FECHA_ANTERIOR_A_HISTORIAL', 'El cliente ' + nom + ' tiene una OT del ' + fechaTexto(c.ultimaFechaOT) +
      ', posterior a ' + fechaTexto(d.fecha) + '. Cargá las OT en orden cronológico o revisá la fecha.');
  }

  var serieIn = normalizarSerie(d.serieInstalada), serieOut = normalizarSerie(d.serieRetirada);
  var estadoIni = String(d.estadoInicial || EST_CLI.ACTIVO).toUpperCase();
  var noTieneEquipo = 'El cliente ' + nom + ' no tiene un equipo instalado (' + EST_CLI_TEXTO[c.estado] + '). ' +
    (c.estado === EST_CLI.SIN_DATOS ? 'Si ya estaba instalado antes del sistema, cargalo primero con Alta inicial.' : '');
  var pideSerieIn = false, pideSerieOut = false;

  switch (tipo) {
    case TIPO_OT.ALTA_INICIAL:
      if (c.tieneOT) err_(res, 'ALTA_INICIAL_CON_HISTORIAL', 'El cliente ' + nom + ' ya tiene OT cargadas: el Alta inicial solo se usa para el primer registro.');
      if ([EST_CLI.ACTIVO, EST_CLI.MOMENTANEO, EST_CLI.EX].indexOf(estadoIni) < 0) err_(res, 'ESTADO_INICIAL_INVALIDO', 'El estado inicial debe ser Activo, Desinstalado momentáneo o Ex cliente.');
      if (estadoIni === EST_CLI.ACTIVO) pideSerieIn = true;
      else if (serieIn) err_(res, 'SERIE_SOBRANTE', 'Un cliente que no está activo no lleva serie instalada.');
      if (d.fechaInstalacion && !esFechaValida(d.fechaInstalacion)) err_(res, 'FECHA_INVALIDA', 'La fecha de instalación no es válida.');
      if (d.fechaBase && !esFechaValida(d.fechaBase)) err_(res, 'FECHA_INVALIDA', 'La fecha base de mantenimiento no es válida.');
      break;
    case TIPO_OT.INSTALACION:
      if (c.estado === EST_CLI.ACTIVO) err_(res, 'CLIENTE_YA_ACTIVO', 'El cliente ' + nom + ' ya tiene instalada la serie ' + c.serie + '. Para reemplazarla usá Cambio de modelo o Reparación con backup.');
      pideSerieIn = true;
      break;
    case TIPO_OT.CAMBIO_MODELO:
    case TIPO_OT.REPARACION_BACKUP:
      if (c.estado !== EST_CLI.ACTIVO) err_(res, 'CLIENTE_SIN_EQUIPO', noTieneEquipo);
      pideSerieIn = true; pideSerieOut = true;
      if (tipo === TIPO_OT.REPARACION_BACKUP && !String(d.falla || '').trim()) err_(res, 'FALTA_FALLA', 'Indicá la falla de la máquina retirada.');
      break;
    case TIPO_OT.REPARACION:
      if (c.estado !== EST_CLI.ACTIVO) err_(res, 'CLIENTE_SIN_EQUIPO', noTieneEquipo);
      if (!String(d.falla || '').trim()) err_(res, 'FALTA_FALLA', 'Indicá la falla.');
      break;
    case TIPO_OT.MANTENIMIENTO:
      if (c.estado !== EST_CLI.ACTIVO) err_(res, 'CLIENTE_SIN_EQUIPO', noTieneEquipo);
      if (d.tipoMant != null && d.tipoMant !== '' && !normalizarTipoMant(d.tipoMant)) err_(res, 'TIPO_MANT_INVALIDO', 'El mantenimiento tiene que ser Profundo o Express.');
      break;
    case TIPO_OT.ENTREGA_ADICIONALES:
      // v1.0 (decidido 22/10): a un Ex cliente o desinstalado momentáneo no se le entrega nada, pero sí se le puede retirar
      // (por ejemplo, botellas que quedaron pendientes).
      if (c.estado === EST_CLI.EX || c.estado === EST_CLI.MOMENTANEO) {
        if (normalizarLineas_(d.items).some(function (l) { return l.mov !== MOV_ITEM.RETIRADO; })) {
          err_(res, 'CLIENTE_SIN_ENTREGAS', 'El cliente ' + nom + ' está ' + EST_CLI_TEXTO[c.estado].toLowerCase() + ': no se le entrega nada. Solo se le puede retirar.');
        }
      } else if (c.estado !== EST_CLI.ACTIVO) err_(res, 'CLIENTE_SIN_EQUIPO', noTieneEquipo);
      break;
    case TIPO_OT.DESINST_MOMENTANEA:
      if (c.estado !== EST_CLI.ACTIVO) err_(res, 'CLIENTE_SIN_EQUIPO', noTieneEquipo);
      pideSerieOut = true;
      break;
    case TIPO_OT.DESINSTALACION:
      if (c.estado === EST_CLI.ACTIVO) pideSerieOut = true;
      else if (c.estado === EST_CLI.MOMENTANEO) { if (serieOut) err_(res, 'SERIE_SOBRANTE', 'El cliente está desinstalado momentáneamente: la máquina ya se retiró. Dejá vacía la serie retirada.'); }
      else err_(res, 'CLIENTE_SIN_EQUIPO', 'El cliente ' + nom + ' no está activo ni desinstalado momentáneamente (' + EST_CLI_TEXTO[c.estado] + ').');
      break;
    case TIPO_OT.ENTREGA_CO2:
      var cil = cilindrosDeOT_(d);
      if (!cil.entregadas.length && !cil.retiradas.length) err_(res, 'CO2_SIN_CILINDROS', 'Cargá al menos un cilindro entregado o retirado.');
      if (cil.entregadas.length) {
        // Como en la entrega de adicionales: a un ex cliente o desinstalado momentáneo solo se le retira.
        if (c.estado === EST_CLI.EX || c.estado === EST_CLI.MOMENTANEO) err_(res, 'CLIENTE_SIN_ENTREGAS', 'El cliente ' + nom + ' está ' + EST_CLI_TEXTO[c.estado].toLowerCase() + ': no se le entrega CO₂. Solo se le pueden retirar cilindros.');
        else if (c.estado !== EST_CLI.ACTIVO) err_(res, 'CLIENTE_SIN_EQUIPO', noTieneEquipo);
        if (!MODALIDAD_CO2[String(d.modalidadCo2 || '').toUpperCase()]) err_(res, 'FALTA_MODALIDAD_CO2', 'Indicá el tipo de entrega: Tradicional, Emergencia con costo o Emergencia sin costo.');
      }
      break;
  }
  validarCilindrosEnOT_(res, d, tipo, cm, nom);
  validarTecnicos_(res, d, tipo, cm, ctx);
  if (pideSerieIn && !serieIn) err_(res, 'FALTA_SERIE_INSTALADA', 'Indicá la serie instalada.');
  if (!pideSerieIn && serieIn && tipo !== TIPO_OT.ALTA_INICIAL) err_(res, 'SERIE_SOBRANTE', 'En una ' + TIPO_OT_TEXTO[tipo] + ' no se instala una máquina. Dejá vacía la serie instalada.');
  if (pideSerieOut && !serieOut) err_(res, 'FALTA_SERIE_RETIRADA', 'Indicá la serie retirada.');
  if (!pideSerieOut && serieOut && tipo !== TIPO_OT.DESINSTALACION) err_(res, 'SERIE_SOBRANTE', 'En una ' + TIPO_OT_TEXTO[tipo] + ' no se retira la máquina. Dejá vacía la serie retirada.');
  if (serieIn && serieOut && serieIn === serieOut) err_(res, 'MISMA_SERIE', 'La serie instalada y la retirada son la misma (' + serieIn + ').');
  if (res.errores.length) return res;

  // Serie retirada: tiene que ser la que figura instalada.
  if (pideSerieOut && serieOut !== c.serie) {
    err_(res, 'RETIRO_NO_COINCIDE', 'Se indica retirada la serie ' + serieOut + ', pero en ' + nom + ' figura instalada la ' + (c.serie || 'ninguna') + '.');
  }
  var mOut = pideSerieOut ? W.maquinas[serieOut] : null;
  if (pideSerieOut && !mOut) err_(res, 'SERIE_INEXISTENTE', 'La serie ' + serieOut + ' no existe en MÁQUINAS.');

  // Serie instalada: disponible en el depósito de la plaza.
  var mIn = serieIn ? W.maquinas[serieIn] : null;
  if (serieIn) {
    if (!mIn) err_(res, 'SERIE_INEXISTENTE', 'La serie ' + serieIn + ' no existe en MÁQUINAS. Dala de alta primero.');
    else if (tipo === TIPO_OT.ALTA_INICIAL) {
      if (mIn.ubicTipo === UBIC.CLIENTE) err_(res, 'MAQUINA_EN_OTRO_CLIENTE', 'La serie ' + serieIn + ' ya figura en el ' + describirUbicacion_(mIn, ctx) + '.');
      else if (mIn.estado === EST_MAQ.BAJA) err_(res, 'MAQUINA_BAJA', 'La serie ' + serieIn + ' está dada de baja.');
      // v0.9.1: también en la migración, la máquina tiene que estar en el depósito de la plaza del cliente.
      else if (mIn.ubicTipo !== UBIC.DEPOSITO || mIn.ubicId !== dep) {
        err_(res, 'MAQUINA_FUERA_DEL_DEPOSITO', 'La serie ' + serieIn + ' figura en ' + describirUbicacion_(mIn, ctx) + ', no en el ' + nombreDeposito_(dep) +
          ' de la plaza del cliente. Si la máquina es de esta plaza, corregí su DEPOSITO_INICIAL en MÁQUINAS.');
      }
    } else {
      if (mIn.estado === EST_MAQ.BAJA) err_(res, 'MAQUINA_BAJA', 'La serie ' + serieIn + ' está dada de baja: no se puede instalar.');
      else if (mIn.estado === EST_MAQ.A_REVISAR) err_(res, 'MAQUINA_A_REVISAR', 'La serie ' + serieIn + ' está A revisar. Cerrá su revisión antes de instalarla.');
      else if (mIn.ubicTipo !== UBIC.DEPOSITO || mIn.ubicId !== dep) {
        err_(res, 'MAQUINA_FUERA_DEL_DEPOSITO', 'La serie ' + serieIn + ' figura en ' + describirUbicacion_(mIn, ctx) + ', no en el ' + nombreDeposito_(dep) + ' de la plaza del cliente.');
      } else if (mIn.ultimaFecha && d.fecha < mIn.ultimaFecha) {
        err_(res, 'FECHA_ANTERIOR_A_HISTORIAL', 'La serie ' + serieIn + ' tiene un movimiento del ' + fechaTexto(mIn.ultimaFecha) + ', posterior a ' + fechaTexto(d.fecha) + '.');
      }
    }
  }

  // Ítems.
  var lineas = normalizarLineas_(d.items);
  var permitidas = categoriasPermitidas_(ctx, tipo);
  var saldoCli = {}; // copia de lo que tiene el cliente, para validar retiros dentro de la OT
  Object.keys(c.comodato || {}).forEach(function (k) { saldoCli[k] = c.comodato[k]; });
  Object.keys(c.faltante || {}).forEach(function (k) { saldoCli[k] = (saldoCli[k] || 0) + c.faltante[k]; }); // lo que quedó sin devolver se puede retirar después
  Object.keys(c.adicionales || {}).forEach(function (k) { saldoCli[k] = (saldoCli[k] || 0) + c.adicionales[k]; });
  if (tipo === TIPO_OT.ALTA_INICIAL) saldoCli = {};
  var usoStock = {}; // código → cantidad que sale del disponible
  var lineasOk = [];
  lineas.forEach(function (l, i) {
    var cat = validarCodigo_(res, ctx, l.codigo, l.cantidad, i + 1);
    if (!cat) return;
    var desc = nombreItem_(ctx, l.codigo);
    // v1.0: a un ex cliente o desinstalado momentáneo se le puede retirar después lo que quedó sin devolver,
    // aunque sea un insumo (un regulador, una bomba), con una Entrega de adicionales que solo retira.
    var retiroPendiente = tipo === TIPO_OT.ENTREGA_ADICIONALES && (c.estado === EST_CLI.EX || c.estado === EST_CLI.MOMENTANEO) &&
      l.mov === MOV_ITEM.RETIRADO && cat === CAT.INSUMO && (c.faltante || {})[l.codigo] > 0;
    // v1.2.1 (pedido de Facu, 26/10): en una desinstalación se puede retirar cualquier ítem del catálogo
    // (clientes cargados sin sus insumos ni adicionales). Si no figura en el cliente, se avisa.
    var retiroDesinst = TIPOS_RETIRO_LIBRE.indexOf(tipo) >= 0 && l.mov === MOV_ITEM.RETIRADO;
    if (permitidas.indexOf(cat) < 0 && !retiroPendiente && !retiroDesinst) {
      err_(res, 'ITEM_NO_PERMITIDO', 'En una ' + TIPO_OT_TEXTO[tipo] + ' no se puede cargar ' + desc + ' (' + (CAT_TEXTO[cat] || cat.toLowerCase()) + ').');
      return;
    }
    var deCliente = cat === CAT.INSUMO || cat === CAT.ADICIONAL;
    var movs;
    if (!deCliente && TIPOS_RETIRO_LIBRE.indexOf(tipo) >= 0) movs = [MOV_ITEM.RETIRADO];
    else if (!deCliente) movs = [MOV_ITEM.ENTREGADO];
    else if (tipo === TIPO_OT.ALTA_INICIAL || tipo === TIPO_OT.INSTALACION) movs = [MOV_ITEM.ENTREGADO];
    else if (tipo === TIPO_OT.DESINST_MOMENTANEA) movs = [MOV_ITEM.RETIRADO];
    else if (tipo === TIPO_OT.DESINSTALACION) movs = [MOV_ITEM.RETIRADO, MOV_ITEM.NO_DEVUELTO];
    else movs = [MOV_ITEM.ENTREGADO, MOV_ITEM.RETIRADO, MOV_ITEM.CAMBIO];
    if (movs.indexOf(l.mov) < 0) {
      err_(res, 'MOVIMIENTO_NO_PERMITIDO', desc + ': en una ' + TIPO_OT_TEXTO[tipo] + ' el movimiento debe ser ' +
        movs.map(function (m) { return m.toLowerCase().replace('_', ' '); }).join(' o ') + '.');
      return;
    }
    var retira = l.mov === MOV_ITEM.RETIRADO || l.mov === MOV_ITEM.NO_DEVUELTO ? l.codigo : (l.mov === MOV_ITEM.CAMBIO ? (l.codigoRetirado || l.codigo) : '');
    if (l.mov === MOV_ITEM.CAMBIO) {
      l.codigoRetirado = l.codigoRetirado || l.codigo;
      var catR = ctx.catalogo[l.codigoRetirado] ? ctx.catalogo[l.codigoRetirado].categoria : '';
      if (catR !== CAT.INSUMO && catR !== CAT.ADICIONAL) { err_(res, 'ITEM_INEXISTENTE', 'El ítem retirado en el cambio de ' + desc + ' no es un insumo ni un adicional del CATÁLOGO.'); return; }
    }
    if (!deCliente && l.mov === MOV_ITEM.RETIRADO) {
      // Un repuesto o filtro suelto: no es parte de lo que se registra en el cliente (el sistema se retira con su campo).
      if (sistemaDelCliente_(ctx, c)[l.codigo]) { err_(res, 'RETIRO_CON_EL_SISTEMA', desc + ' es parte del sistema o el prefiltro del cliente: se retira con el campo del sistema, no como ítem.'); return; }
      adv_(res, 'RETIRO_SIN_REGISTRO', desc + ' no figura en el cliente. Se registra el retiro igual y va a revisión.');
    } else if (retira && tipo !== TIPO_OT.DESINSTALACION) { // v0.9.4: al desinstalar se puede retirar más o menos que el comodato
      var tiene = saldoCli[retira] || 0;
      if (tiene < l.cantidad) {
        // v1.2.1: ya no frena (clientes cargados sin sus insumos ni adicionales): se avisa y el retiro va igual a revisión.
        adv_(res, 'RETIRO_SIN_REGISTRO', nombreItem_(ctx, retira) + ': el cliente tiene registrado' + (tiene === 1 ? '' : 's') + ' ' + tiene + ' y se retiran ' + l.cantidad + '. No figura' + (tiene ? ' todo' : '') +
          ' en el cliente: se registra el retiro igual y va a revisión.');
      }
      saldoCli[retira] = cant_(Math.max(0, tiene - l.cantidad));
    }
    if (deCliente && (l.mov === MOV_ITEM.ENTREGADO || l.mov === MOV_ITEM.CAMBIO)) saldoCli[l.codigo] = cant_((saldoCli[l.codigo] || 0) + l.cantidad);
    // En el alta inicial no se avisa stock: lo entregado entra antes con su ajuste automático (queda neutro).
    if (tipo !== TIPO_OT.ALTA_INICIAL && (l.mov === MOV_ITEM.ENTREGADO || l.mov === MOV_ITEM.CAMBIO)) usoStock[l.codigo] = cant_((usoStock[l.codigo] || 0) + l.cantidad);
    l.categoria = cat;
    lineasOk.push(l);
  });

  if (tipo === TIPO_OT.ENTREGA_ADICIONALES && !lineas.length) err_(res, 'SIN_ITEMS', 'Una ' + TIPO_OT_TEXTO[tipo] + ' lleva al menos un ítem.');

  // Sistema de purificación y prefiltro.
  var plan = planSistemas_(res, d, c, ctx, tipo);
  if (!res.errores.length && hayMaestroSistemas_(ctx)) {
    var instalados = {}, finales = {};
    SLOTS_SIS.forEach(function (s) { finales[s] = c.sis && c.sis[s] ? c.sis[s].nombre : ''; });
    plan.forEach(function (p) {
      if (p.accion !== 'INSTALAR') { finales[p.slot] = ''; return; }
      finales[p.slot] = p.nombre;
      defSistema_(ctx, p.nombre).partes.forEach(function (x) {
        instalados[x.codigo] = true;
        if (!p.migracion) usoStock[x.codigo] = cant_((usoStock[x.codigo] || 0) + x.unidades);
      });
    });
    var delSistema = {};
    SLOTS_SIS.forEach(function (s) {
      var df = finales[s] && defSistema_(ctx, finales[s]);
      if (df) { delSistema[df.filtro] = true; df.comps.forEach(function (x) { delSistema[x.codigo] = true; }); }
    });
    lineasOk.forEach(function (l) {
      if (instalados[l.codigo]) err_(res, 'YA_INCLUIDO_EN_SISTEMA', nombreItem_(ctx, l.codigo) + ' ya se descuenta con la instalación del sistema: no lo cargues como ítem.');
      else if ((l.categoria === CAT.FILTRO || l.categoria === CAT.RECAMBIO_FILTRO) && !delSistema[l.codigo]) {
        adv_(res, 'NO_ES_DEL_SISTEMA', nombreItem_(ctx, l.codigo) + ' no es parte del sistema ni del prefiltro del cliente: sale del stock pero no cuenta para sus vencimientos.');
      }
    });
  }

  if (tipo === TIPO_OT.DESINSTALACION && !res.errores.length) {
    var ret = {};
    lineasOk.forEach(function (l) { if (l.mov === MOV_ITEM.RETIRADO && (l.categoria === CAT.INSUMO || l.categoria === CAT.ADICIONAL)) ret[l.codigo] = cant_((ret[l.codigo] || 0) + l.cantidad); });
    var cmp = compararComodato_(c.comodato, ret);
    if (Object.keys(cmp.faltante).length) adv_(res, 'FALTANTE_COMODATO', 'No se retira todo el comodato: faltan ' + textoCantidades_(ctx, cmp.faltante) + '. Queda como faltante en la ficha del cliente.');
    if (Object.keys(cmp.deMas).length) adv_(res, 'RETIRO_DE_MAS', 'Se retira más que el comodato: ' + textoCantidades_(ctx, cmp.deMas) + '. Va a revisión y queda asentado en la ficha del cliente.');
  }
  if (res.errores.length) return res;

  Object.keys(usoStock).forEach(function (k) {
    var hay = saldo_(W, dep, k).DISPONIBLE;
    if (hay < usoStock[k] && controlaStock_(ctx, dep)) adv_(res, 'STOCK_INSUFICIENTE', 'En el ' + nombreDeposito_(dep) + ' hay ' + hay + ' ' + nombreItem_(ctx, k) + ' disponibles y se entregan ' + usoStock[k] + '. El stock queda negativo: revisá envíos o ajustes pendientes.');
  });
  avisarStockEnFecha_(res, W, ctx, dep, usoStock, d.fecha);

  res.efectos = { clase: 'OT', tipo: tipo, idCliente: idCli, deposito: dep, serieIn: serieIn, serieOut: serieOut, lineas: lineasOk, estadoIni: estadoIni, plan: plan, idOp: idOp };
  return res;
}

function aplicarOT_(d, ef, W, ctx) {
  var c = cliente_(W, ef.idCliente);
  var tipo = ef.tipo, f = d.fecha, dep = ef.deposito;
  // Alta inicial (v0.9.3, conStock): lo entregado sale del depósito con la fecha de instalación, después del ajuste
  // automático que lo ingresa. Las altas iniciales anteriores (sin conStock) no mueven stock.
  var conStock = tipo !== TIPO_OT.ALTA_INICIAL || !!d.conStock;
  var fStock = tipo === TIPO_OT.ALTA_INICIAL && esFechaValida(d.fechaInstalacion) ? d.fechaInstalacion : f;

  // Máquina retirada: queda A revisar en el depósito de la plaza, con su ingreso abierto.
  if (ef.serieOut) {
    var mo = W.maquinas[ef.serieOut];
    var idIng = 'ING-' + ef.idOp;
    mo.estado = EST_MAQ.A_REVISAR; mo.ubicTipo = UBIC.DEPOSITO; mo.ubicId = dep; mo.ultimaFecha = f; mo.ingresoAbierto = idIng; mo.paraCaba = false;
    W.ingresos[idIng] = { id: idIng, serie: ef.serieOut, deposito: dep, fecha: f, origen: ef.idOp, falla: String(d.falla || ''), estado: 'ABIERTO',
      resultado: '', fechaCierre: '', idCierre: '', diagnostico: '', idCliente: ef.idCliente, tipoOT: tipo };
  }
  if (ef.serieIn) {
    var mi = W.maquinas[ef.serieIn];
    mi.estado = EST_MAQ.USADA; mi.ubicTipo = UBIC.CLIENTE; mi.ubicId = ef.idCliente; mi.paraCaba = false;
    mi.ultimaFecha = maxFecha_(mi.ultimaFecha, f);
  }

  // Ítems: saldo del cliente y stock del depósito. Lo retirado entra A revisar como lote con su origen.
  var noDevuelto = {};
  var nLote = 0;
  var origenLote = { fecha: f, idCliente: ef.idCliente, tipoOT: tipo, origen: ef.idOp };
  var movOT = function (texto, detalle) { return { texto: texto, idCliente: ef.idCliente, serie: ef.serieIn || ef.serieOut || c.serie, detalle: TIPO_OT_TEXTO[tipo] + (detalle ? ' · ' + detalle : '') }; };
  var aRevisar = function (codigo, cantidad) {
    nLote++;
    moverStock_(W, dep, codigo, SALDO.A_REVISAR, cantidad, f, movOT('Retiro de cliente → a revisar'));
    crearLote_(W, ef.idOp + '-' + nLote, dep, codigo, cantidad, origenLote);
  };

  // Sistema y prefiltro: primero se retira lo que sale (a revisión, con cabezal o tanque) y después se instala lo nuevo.
  var sis = slotsCliente_(c);
  (ef.plan || []).forEach(function (p) {
    var actual = sis[p.slot];
    if (p.accion === 'RETIRAR' || p.accion === 'NO_DEVUELTO') {
      if (!actual) return;
      Object.keys(actual.partes).forEach(function (k) {
        if (p.accion === 'RETIRAR') aRevisar(k, actual.partes[k]);
        else noDevuelto[k] = cant_((noDevuelto[k] || 0) + actual.partes[k]);
      });
      sis[p.slot] = null;
      return;
    }
    var def = defSistema_(ctx, p.nombre);
    var nuevo = { nombre: def.nombre, desde: p.migracion ? (d.fechaInstalacion || f) : f, partes: {}, ult: {} };
    def.partes.forEach(function (x) {
      nuevo.partes[x.codigo] = cant_((nuevo.partes[x.codigo] || 0) + x.unidades);
      if (!p.migracion || conStock) {
        moverStock_(W, dep, x.codigo, SALDO.DISPONIBLE, -x.unidades, fStock, movOT('Entrega a cliente', 'sistema ' + def.nombre));
        registrarSalida_(W, dep, x.codigo, x.unidades, fStock, 'CLIENTE', ef.idOp, ef.idCliente, ef.serieIn || c.serie);
      }
    });
    def.comps.forEach(function (x) {
      if (x.rol === ROL_COMP.INSTALACION) return;
      var fx = (p.fechas || {})[x.codigo];
      nuevo.ult[x.codigo] = p.migracion ? (esFechaValida(fx) ? fx : (d.fechaBase || d.fechaInstalacion || f)) : f;
    });
    sis[p.slot] = nuevo;
  });
  // Un ítem que es componente del sistema instalado: el recambio reinicia su vencimiento; un componente de
  // instalación (tanque, cabezal) es un reemplazo por falla: el viejo va a revisión o se descarta según SI_FALLA.
  var usarComponente = function (l) {
    SLOTS_SIS.forEach(function (s) {
      var slot = sis[s];
      var def = slot && defSistema_(ctx, slot.nombre);
      if (!def) return;
      def.comps.forEach(function (x) {
        if (x.codigo !== l.codigo) return;
        if (x.rol === ROL_COMP.INSTALACION) { if (x.siFalla === SI_FALLA.REVISION) aRevisar(l.codigo, l.cantidad); }
        else slot.ult[l.codigo] = f;
      });
    });
  };

  // v0.9.4: saldos del cliente En comodato y Adicionales (ver TIPOS_COMODATO).
  c.comodato = c.comodato || {}; c.adicionales = c.adicionales || {};
  var poner = function (b, codigo, delta) {
    c[b][codigo] = cant_((c[b][codigo] || 0) + delta);
    if (c[b][codigo] <= 0) delete c[b][codigo];
  };
  var sacar = function (orden, codigo, cantidad) { // saca de los saldos en ese orden, sin dejar negativos
    var resta = cantidad;
    orden.forEach(function (b) { var q = Math.min(c[b][codigo] || 0, resta); if (q > 0) { poner(b, codigo, -q); resta = cant_(resta - q); } });
  };
  var entregaA = TIPOS_COMODATO.indexOf(tipo) >= 0 ? 'comodato' : 'adicionales';
  // El cambio de modelo y la desinstalación momentánea devuelven lo del comodato; el resto de las OT no lo tocan.
  c.faltante = c.faltante || {};
  var ordenRetiro = tipo === TIPO_OT.CAMBIO_MODELO || tipo === TIPO_OT.DESINST_MOMENTANEA ? ['comodato', 'adicionales']
    : (c.estado === EST_CLI.EX || c.estado === EST_CLI.MOMENTANEO ? ['faltante', 'adicionales'] : ['adicionales']); // retiro posterior de lo pendiente
  var faltanteAntes = JSON.stringify(c.faltante);
  var retiradoDesinst = {};

  ef.lineas.forEach(function (l) {
    var deCliente = l.categoria === CAT.INSUMO || l.categoria === CAT.ADICIONAL;
    if (l.mov === MOV_ITEM.ENTREGADO) {
      if (deCliente) poner(entregaA, l.codigo, l.cantidad);
      else usarComponente(l);
      if (conStock) {
        moverStock_(W, dep, l.codigo, SALDO.DISPONIBLE, -l.cantidad, fStock, deCliente ? movOT('Entrega a cliente', entregaA === 'comodato' ? 'en comodato' : 'adicional') : movOT('Usado en máquina'));
        registrarSalida_(W, dep, l.codigo, l.cantidad, fStock, deCliente ? 'CLIENTE' : 'MAQUINA', ef.idOp, ef.idCliente, c.serie);
      }
    } else if (l.mov === MOV_ITEM.RETIRADO) {
      if (tipo === TIPO_OT.DESINSTALACION) { if (deCliente) retiradoDesinst[l.codigo] = cant_((retiradoDesinst[l.codigo] || 0) + l.cantidad); } // v1.2.1: un repuesto suelto solo va a revisión
      else sacar(ordenRetiro, l.codigo, l.cantidad);
      aRevisar(l.codigo, l.cantidad);
    } else if (l.mov === MOV_ITEM.NO_DEVUELTO) {
      // Solo en desinstalaciones cargadas antes de la v0.9.4: lo no devuelto sale como faltante del comodato.
    } else if (l.mov === MOV_ITEM.CAMBIO) {
      if (l.codigoRetirado !== l.codigo) { // lo nuevo queda en el mismo saldo que lo retirado
        var b = (c.comodato[l.codigoRetirado] || 0) > 0 ? 'comodato' : 'adicionales';
        sacar([b], l.codigoRetirado, l.cantidad);
        poner(b, l.codigo, l.cantidad);
      }
      moverStock_(W, dep, l.codigo, SALDO.DISPONIBLE, -l.cantidad, f, movOT('Entrega a cliente', 'cambio'));
      registrarSalida_(W, dep, l.codigo, l.cantidad, f, 'CLIENTE', ef.idOp, ef.idCliente, c.serie);
      aRevisar(l.codigoRetirado, l.cantidad);
    }
  });

  // Retiro posterior de lo que había quedado sin devolver: queda anotado en la ficha.
  if (tipo !== TIPO_OT.DESINSTALACION && JSON.stringify(c.faltante) !== faltanteAntes) {
    var antes = JSON.parse(faltanteAntes), devuelto = {};
    Object.keys(antes).forEach(function (k) { var dif = cant_(antes[k] - (c.faltante[k] || 0)); if (dif > 0) devuelto[k] = dif; });
    c.comentarioDesinstalacion = (c.comentarioDesinstalacion ? c.comentarioDesinstalacion + ' ' : '') +
      'Retiro posterior ' + fechaTexto(f) + ' (' + ef.idOp + '): ' + textoCantidades_(ctx, devuelto) + '.' +
      (Object.keys(c.faltante).length ? ' Sigue faltando: ' + textoCantidades_(ctx, c.faltante) + '.' : ' Ya no falta nada.');
  }

  // Desinstalación: se compara lo retirado con el comodato. Lo que falta queda como faltante (para cobranzas)
  // y lo retirado de más queda asentado (sale de los adicionales si los había). Todo lo retirado va a revisión.
  if (tipo === TIPO_OT.DESINSTALACION) {
    var cmp = compararComodato_(c.comodato, retiradoDesinst);
    Object.keys(cmp.deMas).forEach(function (k) { sacar(['adicionales'], k, cmp.deMas[k]); });
    Object.keys(noDevuelto).forEach(function (k) { cmp.faltante[k] = cant_((cmp.faltante[k] || 0) + noDevuelto[k]); }); // partes del sistema no devueltas
    c.comodato = {};
    c.faltante = cmp.faltante;
    c.devueltoDeMas = cmp.deMas;
  }

  // Estado del cliente y fechas.
  switch (tipo) {
    case TIPO_OT.ALTA_INICIAL:
      c.estado = ef.estadoIni;
      c.serie = ef.serieIn || '';
      if (ef.estadoIni === EST_CLI.ACTIVO) {
        c.fechaInstalacion = d.fechaInstalacion || f;
        c.fechaBase = d.fechaBase || c.fechaInstalacion;
      } else {
        c.fechaDesinstalacion = d.fechaDesinstalacion || f;
      }
      break;
    case TIPO_OT.INSTALACION:
      c.estado = EST_CLI.ACTIVO; c.serie = ef.serieIn; c.fechaInstalacion = f; c.fechaDesinstalacion = ''; c.fechaBase = f;
      break;
    case TIPO_OT.CAMBIO_MODELO:
    case TIPO_OT.REPARACION_BACKUP:
      c.serie = ef.serieIn; c.fechaCambio = f; c.fechaBase = f;
      break;
    case TIPO_OT.MANTENIMIENTO:
      var tm = normalizarTipoMant(d.tipoMant) || TIPO_MANT.PROFUNDO;
      if (tm === TIPO_MANT.PROFUNDO) c.mantMes = 0;
      else {
        var sig = siguienteEnEsquema_(esquemaDe_(ctx && ctx.clientes[ef.idCliente], ctx), c.mantMes);
        if (sig && sig.tipo === TIPO_MANT.EXPRESS) c.mantMes = sig.mes; // si tocaba Profundo, queda pendiente
      }
      c.fechaBase = f; c.ultimoMantenimiento = f; c.tipoUltimoMant = tm;
      break;
    case TIPO_OT.DESINST_MOMENTANEA:
      c.estado = EST_CLI.MOMENTANEO; c.serie = ''; c.fechaDesinstalacion = f;
      break;
    case TIPO_OT.DESINSTALACION:
      c.estado = EST_CLI.EX; c.serie = ''; c.fechaDesinstalacion = f;
      c.comentarioDesinstalacion = Object.keys(c.faltante).length || Object.keys(c.devueltoDeMas).length
        ? 'Desinstalación ' + fechaTexto(f) + ' (' + ef.idOp + '): ' + [
            Object.keys(c.faltante).length ? 'no devolvió ' + textoCantidades_(ctx, c.faltante) : '',
            Object.keys(c.devueltoDeMas).length ? 'devolvió de más ' + textoCantidades_(ctx, c.devueltoDeMas) : ''
          ].filter(String).join('; ') + '.'
        : '';
      break;
  }
  if (TIPOS_REINICIAN_ESQUEMA.indexOf(tipo) >= 0 && c.estado === EST_CLI.ACTIVO) c.mantMes = 0;
  c.tieneOT = true;
  c.ultimaFechaOT = f;
  if (tipo !== TIPO_OT.ALTA_INICIAL) { c.ultimaVisita = f; c.tipoUltimaVisita = tipo; }
  else if (d.fechaUltimaVisita && esFechaValida(d.fechaUltimaVisita)) { c.ultimaVisita = d.fechaUltimaVisita; c.tipoUltimaVisita = normalizarTipoOT(d.tipoUltimaVisita); }
  // El pendiente vale hasta la próxima OT de ese ID.
  c.pendiente = String(d.pendiente || '').trim();
  if (hayMaestroSistemas_(ctx)) {
    c.sistema = sis.SISTEMA ? sis.SISTEMA.nombre : '';
    c.prefiltro = sis.PREFILTRO ? sis.PREFILTRO.nombre : '';
  } else { // sin maestro de sistemas: solo el nombre, como antes
    if (String(d.sistema || '').trim()) c.sistema = String(d.sistema).trim();
    if (String(d.prefiltro || '').trim()) c.prefiltro = String(d.prefiltro).trim();
  }
}

/* ---------------------------------------------------------------------------
 *  Ingreso manual a revisión: una máquina del depósito que se detecta con falla.
 *  d = { fecha, serie, falla }
 * ------------------------------------------------------------------------ */
function validarIngreso_(d, W, ctx, idOp) {
  var res = nuevoResultado_();
  var fechaOk = validarFecha_(res, d.fecha, ctx);
  var serie = normalizarSerie(d.serie);
  var m = W.maquinas[serie];
  if (!serie) err_(res, 'FALTA_SERIE', 'Indicá la serie.');
  else if (!m) err_(res, 'SERIE_INEXISTENTE', 'La serie ' + serie + ' no existe en MÁQUINAS.');
  else if (m.ubicTipo !== UBIC.DEPOSITO) err_(res, 'MAQUINA_FUERA_DEL_DEPOSITO', 'La serie ' + serie + ' figura en ' + describirUbicacion_(m, ctx) + '. Solo se ingresa a revisión una máquina que está en un depósito.');
  else if (m.ingresoAbierto) err_(res, 'INGRESO_YA_ABIERTO', 'La serie ' + serie + ' ya tiene una revisión abierta (' + m.ingresoAbierto + ').');
  else if (m.estado === EST_MAQ.BAJA) err_(res, 'MAQUINA_BAJA', 'La serie ' + serie + ' está dada de baja.');
  else if (fechaOk && m.ultimaFecha && d.fecha < m.ultimaFecha) err_(res, 'FECHA_ANTERIOR_A_HISTORIAL', 'La serie ' + serie + ' tiene un movimiento del ' + fechaTexto(m.ultimaFecha) + '.');
  if (res.errores.length) return res;
  res.efectos = { clase: 'INGRESO', serie: serie, deposito: m.ubicId, idOp: idOp };
  return res;
}

function aplicarIngreso_(d, ef, W) {
  var m = W.maquinas[ef.serie];
  var id = ef.idOp; // el ingreso manual usa el número de la operación (ING-000001)
  m.estado = EST_MAQ.A_REVISAR; m.ingresoAbierto = id; m.ultimaFecha = d.fecha; m.paraCaba = false;
  W.ingresos[id] = { id: id, serie: ef.serie, deposito: ef.deposito, fecha: d.fecha, origen: 'MANUAL', falla: String(d.falla || ''), estado: 'ABIERTO',
    resultado: '', fechaCierre: '', idCierre: '', diagnostico: '' };
}

/* ---------------------------------------------------------------------------
 *  Cierre de revisión de una máquina
 *  d = { fecha, serie | idIngreso, resultado, falla, diagnostico, items: [{ codigo, cantidad }] }
 * ------------------------------------------------------------------------ */
function validarCierre_(d, W, ctx, idOp) {
  var res = nuevoResultado_();
  var fechaOk = validarFecha_(res, d.fecha, ctx);
  var serie = normalizarSerie(d.serie);
  var idIng = String(d.idIngreso || '').trim() || (W.maquinas[serie] ? W.maquinas[serie].ingresoAbierto : '');
  var ing = idIng ? W.ingresos[idIng] : null;
  var resultado = String(d.resultado || '').toUpperCase();
  if (!ing) err_(res, 'SIN_INGRESO_ABIERTO', serie ? 'La serie ' + serie + ' no tiene una revisión abierta.' : 'Indicá la máquina a cerrar.');
  else if (ing.estado !== 'ABIERTO') err_(res, 'INGRESO_CERRADO', 'La revisión ' + idIng + ' ya está cerrada (' + RES_TALLER_TEXTO[ing.resultado] + ').');
  if (!RES_TALLER_TEXTO[resultado]) err_(res, 'RESULTADO_INVALIDO', 'El resultado debe ser Apta, Reparada, Enviar a CABA o Baja.');
  if (res.errores.length || !fechaOk) return res;
  if (d.fecha < ing.fecha) err_(res, 'FECHA_ANTERIOR_A_HISTORIAL', 'La revisión se abrió el ' + fechaTexto(ing.fecha) + ': el cierre no puede ser anterior.');

  var lineas = normalizarLineas_(d.items);
  if (lineas.length && resultado !== RES_TALLER.REPARADA) err_(res, 'ITEMS_SIN_REPARACION', 'Los ítems usados se cargan solo cuando el resultado es Reparada.');
  var lineasOk = validarItemsReparacion_(res, ctx, W, ing.deposito, lineas, d.fecha);
  if (res.errores.length) return res;
  res.efectos = { clase: 'CIERRE', idIngreso: ing.id, serie: ing.serie, deposito: ing.deposito, resultado: resultado, lineas: lineasOk, idOp: idOp };
  return res;
}

/** Ítems de una reparación de máquina (en revisión o en depósito): los mismos que permite la reparación en cliente. */
function validarItemsReparacion_(res, ctx, W, dep, lineas, fecha) {
  var permitidas = categoriasPermitidas_(ctx, TIPO_OT.REPARACION).filter(function (c) { return c !== CAT.ADICIONAL; });
  var uso = {};
  var lineasOk = [];
  lineas.forEach(function (l, i) {
    var cat = validarCodigo_(res, ctx, l.codigo, l.cantidad, i + 1);
    if (!cat) return;
    if (permitidas.indexOf(cat) < 0) {
      err_(res, 'ITEM_NO_PERMITIDO', 'En una reparación de máquina se cargan ' + permitidas.map(function (c) { return CAT_TEXTO[c] || c; }).join(', ') + '; no ' + nombreItem_(ctx, l.codigo) + ' (' + (CAT_TEXTO[cat] || cat.toLowerCase()) + ').');
      return;
    }
    uso[l.codigo] = cant_((uso[l.codigo] || 0) + l.cantidad);
    lineasOk.push(l);
  });
  if (!res.errores.length) {
    Object.keys(uso).forEach(function (k) {
      var hay = saldo_(W, dep, k).DISPONIBLE;
      if (hay < uso[k] && controlaStock_(ctx, dep)) adv_(res, 'STOCK_INSUFICIENTE', 'En el ' + nombreDeposito_(dep) + ' hay ' + hay + ' ' + nombreItem_(ctx, k) + ' disponibles y se usan ' + uso[k] + '.');
    });
    avisarStockEnFecha_(res, W, ctx, dep, uso, fecha);
  }
  return lineasOk;
}

/** Usa los ítems de una reparación: salen del disponible del depósito y quedan como salida "en máquinas". */
function usarItemsReparacion_(W, dep, lineas, fecha, idOp, ing, detalle) {
  ing.items = (ing.items || []).concat(lineas.map(function (l) { return { codigo: l.codigo, cantidad: l.cantidad }; }));
  lineas.forEach(function (l) {
    moverStock_(W, dep, l.codigo, SALDO.DISPONIBLE, -l.cantidad, fecha, { texto: 'Usado en máquina', serie: ing.serie, detalle: detalle || '' });
    registrarSalida_(W, dep, l.codigo, l.cantidad, fecha, 'MAQUINA', idOp, '', ing.serie);
  });
}

function aplicarCierre_(d, ef, W) {
  var ing = W.ingresos[ef.idIngreso];
  var m = W.maquinas[ef.serie];
  ing.estado = 'CERRADO'; ing.resultado = ef.resultado; ing.fechaCierre = d.fecha; ing.idCierre = ef.idOp;
  ing.diagnostico = String(d.diagnostico || '');
  ing.tecnico = String(d.tecnico || '');
  if (String(d.falla || '').trim()) ing.falla = String(d.falla).trim();
  m.ingresoAbierto = ''; m.ultimaFecha = d.fecha;
  if (ef.resultado === RES_TALLER.APTA || ef.resultado === RES_TALLER.REPARADA) { m.estado = EST_MAQ.USADA; m.paraCaba = false; }
  else if (ef.resultado === RES_TALLER.BAJA) { m.estado = EST_MAQ.BAJA; m.paraCaba = false; }
  else { m.estado = EST_MAQ.A_REVISAR; m.paraCaba = true; }
  usarItemsReparacion_(W, ef.deposito, ef.lineas, d.fecha, ef.idOp, ing, 'Cierre de revisión de la máquina');
}

/* ---------------------------------------------------------------------------
 *  Reparación en depósito: un técnico repara una máquina que está en un depósito
 *  del interior (esté o no en revisión). Si tenía una revisión abierta, la cierra como Reparada.
 *  d = { fecha, serie, falla, diagnostico, tecnico, items: [{ codigo, cantidad }] }
 * ------------------------------------------------------------------------ */
function validarReparacionDeposito_(d, W, ctx, idOp) {
  var res = nuevoResultado_();
  var fechaOk = validarFecha_(res, d.fecha, ctx);
  var serie = normalizarSerie(d.serie);
  var m = W.maquinas[serie];
  if (!serie) err_(res, 'FALTA_SERIE', 'Elegí la máquina.');
  else if (!m) err_(res, 'SERIE_INEXISTENTE', 'La serie ' + serie + ' no existe en MÁQUINAS.');
  else if (m.ubicTipo !== UBIC.DEPOSITO) err_(res, 'MAQUINA_FUERA_DEL_DEPOSITO', 'La serie ' + serie + ' figura en ' + describirUbicacion_(m, ctx) + '. Solo se repara en depósito una máquina que está en un depósito.');
  else if (m.estado === EST_MAQ.BAJA) err_(res, 'MAQUINA_BAJA', 'La serie ' + serie + ' está dada de baja.');
  if (!String(d.diagnostico || '').trim()) err_(res, 'FALTA_DIAGNOSTICO', 'Indicá qué se hizo en la reparación.');
  if (res.errores.length || !fechaOk) return res;
  var ing = m.ingresoAbierto ? W.ingresos[m.ingresoAbierto] : null;
  var desde = ing ? ing.fecha : m.ultimaFecha;
  if (desde && d.fecha < desde) err_(res, 'FECHA_ANTERIOR_A_HISTORIAL', 'La serie ' + serie + ' tiene un movimiento del ' + fechaTexto(desde) + ': la reparación no puede ser anterior.');
  var lineasOk = validarItemsReparacion_(res, ctx, W, m.ubicId, normalizarLineas_(d.items), d.fecha);
  if (res.errores.length) return res;
  res.efectos = { clase: 'REPARACION_DEPOSITO', serie: serie, deposito: m.ubicId, idIngreso: m.ingresoAbierto || '', lineas: lineasOk, idOp: idOp };
  return res;
}

function aplicarReparacionDeposito_(d, ef, W) {
  var m = W.maquinas[ef.serie];
  var ing = ef.idIngreso ? W.ingresos[ef.idIngreso] : null;
  if (!ing) {
    ing = W.ingresos[ef.idOp] = { id: ef.idOp, serie: ef.serie, deposito: ef.deposito, fecha: d.fecha, origen: 'REPARACION_DEPOSITO', falla: String(d.falla || ''),
      estado: 'ABIERTO', resultado: '', fechaCierre: '', idCierre: '', diagnostico: '', idCliente: '', tipoOT: 'REPARACION_DEPOSITO' };
  }
  ing.estado = 'CERRADO'; ing.resultado = RES_TALLER.REPARADA; ing.fechaCierre = d.fecha; ing.idCierre = ef.idOp;
  ing.diagnostico = String(d.diagnostico || ''); ing.tecnico = String(d.tecnico || '');
  if (String(d.falla || '').trim()) ing.falla = String(d.falla).trim();
  m.ingresoAbierto = ''; m.paraCaba = false; m.ultimaFecha = maxFecha_(m.ultimaFecha, d.fecha);
  if (m.estado === EST_MAQ.A_REVISAR) m.estado = EST_MAQ.USADA; // una Nueva reparada sigue siendo Nueva (nunca se instaló)
  usarItemsReparacion_(W, ef.deposito, ef.lineas, d.fecha, ef.idOp, ing, 'Reparación en depósito');
}

/* ---------------------------------------------------------------------------
 *  Revisión de insumos y adicionales retirados
 *  d = { fecha, deposito, items: [{ codigo, cantidad, resultado: DISPONIBLE | ENVIAR_CABA | DESCARTE }] }
 * ------------------------------------------------------------------------ */
function validarRevisionItems_(d, W, ctx, idOp) {
  var res = nuevoResultado_();
  validarFecha_(res, d.fecha, ctx);
  var dep = String(d.deposito || '').trim();
  if (!ctx.depositos[dep]) err_(res, 'DEPOSITO_INEXISTENTE', 'Elegí un depósito del interior.');
  var lineas = normalizarLineas_(d.items);
  (d.items || []).forEach(function (x, i) { if (lineas[i]) lineas[i].lote = String(x.lote || '').trim(); });
  if (!lineas.length) err_(res, 'SIN_ITEMS', 'Cargá al menos un ítem revisado.');
  if (res.errores.length) return res;
  var pedido = {}, porLote = {};
  var lineasOk = [];
  lineas.forEach(function (l, i) {
    if (!validarCodigo_(res, ctx, l.codigo, l.cantidad, i + 1)) return;
    if (!RES_ITEM[l.resultado]) { err_(res, 'RESULTADO_INVALIDO', nombreItem_(ctx, l.codigo) + ': el resultado debe ser Disponible, Enviar a CABA o Descarte.'); return; }
    if (l.lote) {
      var lo = W.lotes[l.lote];
      if (!lo || lo.deposito !== dep || lo.codigo !== l.codigo) { err_(res, 'LOTE_INEXISTENTE', 'El retiro ' + l.lote + ' de ' + nombreItem_(ctx, l.codigo) + ' ya no está a revisar en el ' + nombreDeposito_(dep) + '.'); return; }
      porLote[l.lote] = cant_((porLote[l.lote] || 0) + l.cantidad);
      l.origenLote = { fecha: lo.fecha, idCliente: lo.idCliente, tipoOT: lo.tipoOT, origen: lo.origen };
    }
    pedido[l.codigo] = cant_((pedido[l.codigo] || 0) + l.cantidad);
    lineasOk.push(l);
  });
  Object.keys(porLote).forEach(function (k) {
    if (W.lotes[k].cantidad < porLote[k]) err_(res, 'REVISION_SUPERA', 'Del retiro ' + k + ' quedan ' + W.lotes[k].cantidad + ' ' + nombreItem_(ctx, W.lotes[k].codigo) + ' a revisar; no se pueden resolver ' + porLote[k] + '.');
  });
  Object.keys(pedido).forEach(function (k) {
    var hay = saldo_(W, dep, k).A_REVISAR;
    if (hay < pedido[k]) err_(res, 'REVISION_SUPERA', 'En el ' + nombreDeposito_(dep) + ' hay ' + hay + ' ' + nombreItem_(ctx, k) + ' a revisar; no se pueden resolver ' + pedido[k] + '.');
  });
  if (res.errores.length) return res;
  // Cartuchos usados para reacondicionar un filtro retirado: salen del disponible del depósito.
  var consumos = normalizarLineas_(d.consumos);
  var usoC = {};
  consumos.forEach(function (l, i) {
    if (!validarCodigo_(res, ctx, l.codigo, l.cantidad, i + 1)) return;
    usoC[l.codigo] = cant_((usoC[l.codigo] || 0) + l.cantidad);
  });
  if (res.errores.length) return res;
  Object.keys(usoC).forEach(function (k) {
    var hay = saldo_(W, dep, k).DISPONIBLE;
    if (hay < usoC[k] && controlaStock_(ctx, dep)) adv_(res, 'STOCK_INSUFICIENTE', 'En el ' + nombreDeposito_(dep) + ' hay ' + hay + ' ' + nombreItem_(ctx, k) + ' disponibles y se usan ' + usoC[k] + ' para reacondicionar.');
  });
  avisarStockEnFecha_(res, W, ctx, dep, usoC, d.fecha);
  res.efectos = { clase: 'REVISION_ITEMS', deposito: dep, lineas: lineasOk, consumos: consumos, idOp: idOp };
  return res;
}

function aplicarRevisionItems_(d, ef, W) {
  (ef.consumos || []).forEach(function (l) {
    moverStock_(W, ef.deposito, l.codigo, SALDO.DISPONIBLE, -l.cantidad, d.fecha, { texto: 'Usado para reacondicionar', detalle: 'Reacondicionamiento de un filtro retirado' });
    registrarMov_(W, 'SALIDA', ef.deposito, l.codigo, l.cantidad, d.fecha, 'REACONDICIONAMIENTO', ef.idOp, { detalle: 'Reacondicionamiento de un filtro retirado' });
  });
  ef.lineas.forEach(function (l) {
    var oL = l.origenLote || {};
    var movRev = { texto: l.resultado === RES_ITEM.DISPONIBLE ? 'Revisión → disponible' : l.resultado === RES_ITEM.DESCARTE ? 'Revisión → descarte' : 'Revisión → para CABA',
      idCliente: oL.idCliente || '', detalle: oL.origen ? 'Retirado en ' + oL.origen : '' };
    moverStock_(W, ef.deposito, l.codigo, SALDO.A_REVISAR, -l.cantidad, d.fecha, movRev);
    // v1.2.2: lo descartado sale del stock (no pasa a ningún otro saldo).
    if (l.resultado !== RES_ITEM.DESCARTE) moverStock_(W, ef.deposito, l.codigo, l.resultado === RES_ITEM.DISPONIBLE ? SALDO.DISPONIBLE : SALDO.PARA_CABA, l.cantidad, d.fecha, movRev);
    if (l.resultado === RES_ITEM.DISPONIBLE) {
      var o = l.origenLote || {};
      registrarMov_(W, 'INGRESO', ef.deposito, l.codigo, l.cantidad, d.fecha, 'REVISION', ef.idOp, { idCliente: o.idCliente, detalle: o.origen ? 'Retirado en ' + o.origen : '' });
    }
    consumirLotes_(W, ef.deposito, l.codigo, l.cantidad, l.lote);
  });
}

/* ---------------------------------------------------------------------------
 *  Envío
 *  d = { fecha, origen, destino, transporte, guia, comentarios,
 *        items: [{ codigo, cantidad, desde: DISPONIBLE | PARA_CABA }], series: [] }
 * ------------------------------------------------------------------------ */
function validarEnvio_(d, W, ctx, idOp) {
  var res = nuevoResultado_();
  var fechaOk = validarFecha_(res, d.fecha, ctx);
  var origen = String(d.origen || DEPOSITO_CABA).trim(), destino = String(d.destino || '').trim();
  if (!esDeposito_(ctx, origen)) err_(res, 'DEPOSITO_INEXISTENTE', 'El origen "' + origen + '" no es un depósito.');
  if (!esDeposito_(ctx, destino)) err_(res, 'DEPOSITO_INEXISTENTE', 'El destino "' + destino + '" no es un depósito.');
  if (origen && origen === destino) err_(res, 'ORIGEN_IGUAL_DESTINO', 'El origen y el destino son el mismo depósito.');
  var series = (d.series || []).map(normalizarSerie).filter(String);
  var lineas = normalizarLineas_(d.items);
  if (!series.length && !lineas.length) err_(res, 'ENVIO_VACIO', 'El envío no tiene ítems ni máquinas.');
  var vistas = {};
  series.forEach(function (s) { if (vistas[s]) err_(res, 'SERIE_DUPLICADA', 'La serie ' + s + ' está dos veces en el envío.'); vistas[s] = true; });
  if (res.errores.length || !fechaOk) return res;

  series.forEach(function (s) {
    var m = W.maquinas[s];
    if (!m) { err_(res, 'SERIE_INEXISTENTE', 'La serie ' + s + ' no existe en MÁQUINAS. Dala de alta primero.'); return; }
    var enOrigen = (m.ubicTipo === UBIC.DEPOSITO && m.ubicId === origen) || (origen === DEPOSITO_CABA && m.ubicTipo === UBIC.CABA);
    if (!enOrigen) { err_(res, 'MAQUINA_FUERA_DEL_DEPOSITO', 'La serie ' + s + ' figura en ' + describirUbicacion_(m, ctx) + ', no en ' + (origen === DEPOSITO_CABA ? 'CABA' : 'el ' + nombreDeposito_(origen)) + '.'); return; }
    if (m.ingresoAbierto) { err_(res, 'MAQUINA_EN_REVISION', 'La serie ' + s + ' tiene la revisión abierta. Cerrala (por ejemplo, como Enviar a CABA) antes de despacharla.'); return; }
    if (m.estado === EST_MAQ.BAJA && destino !== DEPOSITO_CABA) { err_(res, 'MAQUINA_BAJA', 'La serie ' + s + ' está dada de baja: solo puede volver a CABA.'); return; }
    if (m.ultimaFecha && d.fecha < m.ultimaFecha) { err_(res, 'FECHA_ANTERIOR_A_HISTORIAL', 'La serie ' + s + ' tiene un movimiento del ' + fechaTexto(m.ultimaFecha) + '.'); return; }
    if (m.paraCaba && destino !== DEPOSITO_CABA) adv_(res, 'MAQUINA_PARA_CABA', 'La serie ' + s + ' se revisó como Enviar a CABA, pero el envío va a ' + destino + '.');
  });

  var uso = {};
  var lineasOk = [];
  lineas.forEach(function (l, i) {
    if (!validarCodigo_(res, ctx, l.codigo, l.cantidad, i + 1)) return;
    var desde = l.desde || SALDO.DISPONIBLE;
    if (desde !== SALDO.DISPONIBLE && desde !== SALDO.PARA_CABA) { err_(res, 'SALDO_INVALIDO', nombreItem_(ctx, l.codigo) + ': sale del stock Disponible o de lo revisado Para CABA.'); return; }
    if (desde === SALDO.PARA_CABA && origen === DEPOSITO_CABA) { err_(res, 'SALDO_INVALIDO', 'Desde CABA no se envía stock Para CABA.'); return; }
    l.desde = desde;
    uso[l.codigo + '|' + desde] = cant_((uso[l.codigo + '|' + desde] || 0) + l.cantidad);
    lineasOk.push(l);
  });
  if (res.errores.length) return res;
  if (controlaStock_(ctx, origen)) {
    Object.keys(uso).forEach(function (k) {
      var p = k.split('|');
      var hay = saldo_(W, origen, p[0])[p[1]];
      if (hay < uso[k]) adv_(res, 'STOCK_INSUFICIENTE', 'En el ' + nombreDeposito_(origen) + ' hay ' + hay + ' ' + nombreItem_(ctx, p[0]) +
        (p[1] === SALDO.PARA_CABA ? ' revisados para CABA' : ' disponibles') + ' y se envían ' + uso[k] + '.');
    });
    var usoDisp = {};
    Object.keys(uso).forEach(function (k) { var p = k.split('|'); if (p[1] === SALDO.DISPONIBLE) usoDisp[p[0]] = uso[k]; });
    avisarStockEnFecha_(res, W, ctx, origen, usoDisp, d.fecha);
  }
  res.efectos = { clase: 'ENVIO', origen: origen, destino: destino, series: series, lineas: lineasOk, idOp: idOp };
  return res;
}

function aplicarEnvio_(d, ef, W) {
  ef.series.forEach(function (s) {
    var m = W.maquinas[s];
    m.ubicTipo = UBIC.TRANSITO; m.ubicId = ef.idOp; m.ultimaFecha = d.fecha;
  });
  ef.lineas.forEach(function (l) { moverStock_(W, ef.origen, l.codigo, l.desde, -l.cantidad, d.fecha, { texto: 'Envío a ' + ef.destino, detalle: 'Envío ' + ef.idOp }); });
  W.envios[ef.idOp] = { id: ef.idOp, fecha: d.fecha, origen: ef.origen, destino: ef.destino, series: ef.series.slice(),
    lineas: ef.lineas.map(function (l) { return { codigo: l.codigo, cantidad: l.cantidad, desde: l.desde }; }),
    estado: 'EN_TRANSITO', fechaRecepcion: '', idRecepcion: '' };
}

/* ---------------------------------------------------------------------------
 *  Recepción de un envío
 *  d = { fecha, idEnvio }
 * ------------------------------------------------------------------------ */
function validarRecepcion_(d, W, ctx, idOp) {
  var res = nuevoResultado_();
  var fechaOk = validarFecha_(res, d.fecha, ctx);
  var id = String(d.idEnvio || '').trim();
  var e = W.envios[id];
  if (!e) err_(res, 'ENVIO_INEXISTENTE', 'El envío "' + id + '" no existe.');
  else if (e.estado !== 'EN_TRANSITO') err_(res, 'ENVIO_YA_RECIBIDO', 'El envío ' + id + ' ya se recibió el ' + fechaTexto(e.fechaRecepcion) + '.');
  else if (fechaOk && d.fecha < e.fecha) err_(res, 'FECHA_ANTERIOR_A_HISTORIAL', 'El envío salió el ' + fechaTexto(e.fecha) + ': no se puede recibir antes.');
  if (res.errores.length) return res;
  res.efectos = { clase: 'RECEPCION', idEnvio: id, idOp: idOp };
  return res;
}

function aplicarRecepcion_(d, ef, W) {
  var e = W.envios[ef.idEnvio];
  e.estado = 'RECIBIDO'; e.fechaRecepcion = d.fecha; e.idRecepcion = ef.idOp;
  e.series.forEach(function (s) {
    var m = W.maquinas[s];
    m.ultimaFecha = d.fecha;
    if (e.destino === DEPOSITO_CABA) { m.ubicTipo = UBIC.DEPOSITO; m.ubicId = DEPOSITO_CABA; m.paraCaba = false; return; } // queda en el depósito central con su estado
    m.ubicTipo = UBIC.DEPOSITO; m.ubicId = e.destino;
    // Lo que llega desde CABA ya viene resuelto por el taller de CABA.
    if (e.origen === DEPOSITO_CABA && m.estado === EST_MAQ.A_REVISAR) { m.estado = EST_MAQ.USADA; m.paraCaba = false; }
  });
  e.lineas.forEach(function (l) {
    moverStock_(W, e.destino, l.codigo, SALDO.DISPONIBLE, l.cantidad, d.fecha, { texto: 'Recepción de envío', detalle: 'Envío ' + ef.idEnvio + ' desde ' + e.origen });
    registrarMov_(W, 'INGRESO', e.destino, l.codigo, l.cantidad, d.fecha, 'ENVIO', ef.idOp, { detalle: 'Envío ' + ef.idEnvio + ' desde ' + e.origen });
  });
}

/* ---------------------------------------------------------------------------
 *  Ajuste de stock (inventario inicial, conteos, pérdidas, compras locales)
 *  d = { fecha, deposito, codigo, cantidad (+/-), saldo, motivo }
 * ------------------------------------------------------------------------ */
function validarAjuste_(d, W, ctx, idOp) {
  var res = nuevoResultado_();
  validarFecha_(res, d.fecha, ctx);
  var dep = String(d.deposito || '').trim();
  var codigo = normalizarCodigo(d.codigo);
  var cantidad = cant_(d.cantidad);
  var bucket = String(d.saldo || SALDO.DISPONIBLE).toUpperCase();
  var tipo = String(d.tipo || '').toUpperCase().trim();
  if (!ctx.depositos[dep]) err_(res, 'DEPOSITO_INEXISTENTE', 'Elegí un depósito de la lista de depósitos.');
  if (!ctx.catalogo[codigo]) err_(res, 'ITEM_INEXISTENTE', 'El ítem "' + codigo + '" no existe en el CATÁLOGO.');
  if (!cantidad) err_(res, 'CANTIDAD_INVALIDA', 'La cantidad del ajuste no puede ser cero.');
  if (!SALDO[bucket]) err_(res, 'SALDO_INVALIDO', 'El saldo debe ser Disponible, A revisar o Para CABA.');
  if (tipo && !TIPOS_AJUSTE[tipo]) err_(res, 'TIPO_AJUSTE_INVALIDO', 'El tipo de ajuste "' + d.tipo + '" no existe.');
  else if (tipo && TIPOS_AJUSTE[tipo].signo === 1 && cantidad < 0) err_(res, 'CANTIDAD_INVALIDA', 'Un ajuste de tipo ' + TIPOS_AJUSTE[tipo].texto + ' suma: la cantidad va en positivo.');
  if (tipo && TIPOS_AJUSTE[tipo] && TIPOS_AJUSTE[tipo].signo === -1) cantidad = -Math.abs(cantidad); // pérdida y rotura siempre restan
  if (!tipo && String(d.motivo || '').trim().length < 3) err_(res, 'FALTA_MOTIVO', 'Indicá el tipo o el motivo del ajuste.');
  if (res.errores.length) return res;
  var hay = saldo_(W, dep, codigo)[bucket];
  if (hay + cantidad < 0 && controlaStock_(ctx, dep)) adv_(res, 'STOCK_INSUFICIENTE', 'El ajuste deja ' + (hay + cantidad) + ' ' + nombreItem_(ctx, codigo) + ' en el ' + nombreDeposito_(dep) + '.');
  else if (cantidad < 0 && bucket === SALDO.DISPONIBLE) { var u = {}; u[codigo] = -cantidad; avisarStockEnFecha_(res, W, ctx, dep, u, d.fecha); }
  res.efectos = { clase: 'AJUSTE', deposito: dep, codigo: codigo, cantidad: cantidad, saldo: bucket, tipo: tipo, idOp: idOp };
  return res;
}

function aplicarAjuste_(d, ef, W) {
  var det = (ef.tipo ? TIPOS_AJUSTE[ef.tipo].texto : 'Ajuste') + (ef.saldo !== SALDO.DISPONIBLE ? ' · ' + SALDO_TEXTO[ef.saldo] : '') + (String(d.motivo || '').trim() ? ' · ' + String(d.motivo).trim() : '');
  moverStock_(W, ef.deposito, ef.codigo, ef.saldo, ef.cantidad, d.fecha, { texto: 'Ajuste' + (ef.tipo ? ' (' + TIPOS_AJUSTE[ef.tipo].texto + ')' : ''), detalle: String(d.motivo || '').trim() });
  registrarMov_(W, ef.cantidad > 0 ? 'INGRESO' : 'SALIDA', ef.deposito, ef.codigo, Math.abs(ef.cantidad), d.fecha, 'AJUSTE', ef.idOp, { detalle: det });
  if (ef.saldo !== SALDO.A_REVISAR) return;
  if (ef.cantidad > 0) crearLote_(W, ef.idOp, ef.deposito, ef.codigo, ef.cantidad, { fecha: d.fecha, idCliente: '', tipoOT: 'AJUSTE', origen: ef.idOp });
  else consumirLotes_(W, ef.deposito, ef.codigo, -ef.cantidad, '');
}

/* ---------------------------------------------------------------------------
 *  Punto de entrada
 *  ops = [{ clase, id?, datos }]   clase: OT | INGRESO | CIERRE | REVISION_ITEMS | ENVIO | RECEPCION | AJUSTE
 *  W   = estado de partida (no se modifica)
 *  Devuelve { ok, resultados, estado }
 * ------------------------------------------------------------------------ */
var VALIDADORES_ = {
  OT: [validarOT_, aplicarOT_],
  INGRESO: [validarIngreso_, aplicarIngreso_],
  CIERRE: [validarCierre_, aplicarCierre_],
  REVISION_ITEMS: [validarRevisionItems_, aplicarRevisionItems_],
  ENVIO: [validarEnvio_, aplicarEnvio_],
  RECEPCION: [validarRecepcion_, aplicarRecepcion_],
  AJUSTE: [validarAjuste_, aplicarAjuste_],
  REPARACION_DEPOSITO: [validarReparacionDeposito_, aplicarReparacionDeposito_]
};

function clonarEstado(W) {
  return JSON.parse(JSON.stringify(W));
}

/** Valida y aplica una operación sobre W (lo modifica solo si no hay errores). */
function procesarOperacion_(op, W, ctx, idOp) {
  var par = VALIDADORES_[op.clase];
  var res;
  if (!par) { res = nuevoResultado_(); err_(res, 'OPERACION_DESCONOCIDA', 'Tipo de operación desconocido: ' + op.clase); }
  else {
    res = par[0](op.datos || {}, W, ctx, idOp);
    W._opId = idOp; // para los movimientos de stock (kardex)
    if (!res.errores.length && res.efectos) par[1](op.datos || {}, res.efectos, W, ctx);
  }
  res.clase = op.clase;
  res.id = idOp;
  return res;
}

function simularLote(ops, ctx, W0) {
  var W = clonarEstado(W0 || ctx.estado || estadoInicial(ctx));
  var resultados = (ops || []).map(function (op, i) {
    return procesarOperacion_(op, W, ctx, op.id || ('NUEVO-' + (i + 1)));
  });
  var ok = resultados.every(function (r) { return r.errores.length === 0; });
  return { ok: ok, resultados: resultados, estado: W };
}

/**
 * Reconstruye todo el estado repitiendo las operaciones vigentes en orden.
 * Una operación del historial que ya no es válida se saltea y queda como inconsistencia.
 */
function reconstruir(ops, ctx) {
  var W = estadoInicial(ctx);
  var inconsistencias = [];
  SIN_AVISOS_DE_FECHA_ = true;
  try {
    (ops || []).forEach(function (op) {
      var r = procesarOperacion_(op, W, ctx, op.id);
      r.errores.forEach(function (e) {
        inconsistencias.push({ codigo: e.codigo, ref: op.id, mensaje: 'La operación ' + op.id + ' ya no es válida y no se tuvo en cuenta: ' + e.mensaje });
      });
    });
  } finally { SIN_AVISOS_DE_FECHA_ = false; }
  return { estado: W, inconsistencias: inconsistencias };
}

/**
 * Una operación se puede anular si, sin ella, todas las demás siguen siendo válidas.
 * Así nunca se borra un hecho del que dependen operaciones posteriores.
 */
function validarAnulacion(idOp, ops, ctx) {
  // idOp puede ser una lista: se anulan juntas (un alta inicial con su ajuste y su envío automáticos).
  var ids = [].concat(idOp);
  var resto = (ops || []).filter(function (o) { return ids.indexOf(o.id) < 0; });
  if (resto.length === (ops || []).length) return { ok: false, errores: [{ codigo: 'OPERACION_INEXISTENTE', mensaje: 'La operación ' + idOp + ' no existe o ya está anulada.' }] };
  var r = reconstruir(resto, ctx);
  var previas = reconstruir(ops, ctx).inconsistencias.map(function (i) { return i.ref + '|' + i.codigo; });
  var nuevas = r.inconsistencias.filter(function (i) { return previas.indexOf(i.ref + '|' + i.codigo) < 0; });
  if (nuevas.length) {
    return { ok: false, errores: nuevas.map(function (i) {
      return { codigo: 'ANULACION_CON_OPERACIONES_POSTERIORES', mensaje: 'No se puede anular ' + idOp + ': ' + i.ref + ' depende de ella (' + i.mensaje.replace(/^La operación \S+ ya no es válida y no se tuvo en cuenta: /, '') + '). Anulá primero ' + i.ref + '.' };
    }) };
  }
  return { ok: true, errores: [], estado: r.estado }; // v1.0: el estado sin las anuladas, para escribirlo sin repetir el historial otra vez
}

/* ---------------------------------------------------------------------------
 *  Dónde se guarda cada línea de una OT
 *  - Insumos y adicionales movidos DESPUÉS de la instalación → ENTREGA_ADICIONALES
 *    (para cobranzas; un cambio genera dos filas; los insumos llevan Dto "Sin cargo").
 *  - Todo lo demás (instalación, alta inicial, desinstalaciones, filtros, repuestos, CO₂) → OT_ITEMS.
 * ------------------------------------------------------------------------ */
function repartirLineasOT(tipo, lineas, ctx) {
  var otItems = [], adicionales = [];
  (lineas || []).forEach(function (l) {
    var cat = l.categoria || (ctx.catalogo[l.codigo] || {}).categoria;
    var cobranza = (cat === CAT.INSUMO || cat === CAT.ADICIONAL) && TIPOS_SIN_COBRANZA.indexOf(tipo) < 0;
    if (!cobranza) {
      otItems.push({ codigo: l.codigo, descripcion: nombreItem_(ctx, l.codigo), categoria: cat, cantidad: l.cantidad, movimiento: l.mov });
      return;
    }
    var dto = l.dto != null && l.dto !== '' ? l.dto : (cat === CAT.INSUMO ? 'Sin cargo' : '');
    if (l.mov === MOV_ITEM.CAMBIO) {
      var codR = l.codigoRetirado || l.codigo;
      var catR = (ctx.catalogo[codR] || {}).categoria;
      adicionales.push({ tipo: 'Cambio (entregado)', codigo: l.codigo, insumo: nombreItem_(ctx, l.codigo), cantidad: l.cantidad, dto: dto });
      adicionales.push({ tipo: 'Cambio (retirado)', codigo: codR, insumo: nombreItem_(ctx, codR), cantidad: l.cantidad,
        dto: l.dto != null && l.dto !== '' ? l.dto : (catR === CAT.INSUMO ? 'Sin cargo' : '') });
    } else {
      adicionales.push({ tipo: l.mov === MOV_ITEM.RETIRADO ? 'Retiro' : 'Entrega', codigo: l.codigo, insumo: nombreItem_(ctx, l.codigo), cantidad: l.cantidad, dto: dto });
    }
  });
  return { otItems: otItems, adicionales: adicionales };
}

/* ---------------------------------------------------------------------------
 *  Vistas derivadas (lo que se escribe en las hojas recalculadas)
 * ------------------------------------------------------------------------ */

/** Texto listo para copiar con todo lo que hay que retirar si se desinstala. */
function textoARetirar(c, ctx) {
  if (!c) return '';
  var partes = [];
  if (c.serie) partes.push('máquina serie ' + c.serie);
  var t = textoCantidades_(ctx, c.comodato || {}); // v0.9.4: solo el comodato; los adicionales son del cliente
  if (t) partes.push(t);
  return partes.length ? 'Retirar: ' + partes.join(', ') : '';
}

/**
 * Indicaciones para el técnico: recambios a cambiar en la próxima visita (vencidos o que vencen hasta 20 días después),
 * componentes por consumo a revisar, y el pendiente de la última OT.
 */
function textoTrabajos(c, ctx, proximo) {
  var partes = [];
  if (c && ctx && proximo) {
    var comps = componentesCliente_(c, ctx);
    var cambiar = aCambiarEnVisita_(comps, proximo, ctx.diasAnticipoFiltros);
    if (cambiar.length) partes.push('Cambiar: ' + cambiar.map(function (x) { return (x.unidades > 1 ? x.unidades + ' ' : '') + x.descripcion + ' (vence ' + fechaTexto(x.vence) + ')'; }).join(', '));
    comps.filter(function (x) { return x.rol === ROL_COMP.CONSUMO; }).forEach(function (x) { partes.push('Revisar nivel de ' + x.descripcion.toLowerCase()); });
  }
  if (c && c.pendiente) partes.push(c.pendiente);
  return partes.join(' · ');
}

/* ---------------------------------------------------------------------------
 *  Esquema de mantenimientos (v2.1, pedido 26/11/2026): seis meses, cada uno
 *  Profundo, Express o nada. Hay uno por defecto (Configuración) y cada cliente
 *  puede tener el suyo (ficha del cliente).
 *  - El mes 0 es el último reinicio: un Profundo, una Reparación con backup,
 *    una Instalación, un Cambio de modelo o el Alta inicial.
 *  - El próximo es el siguiente mes con algo en el esquema, contado desde la fecha
 *    del ÚLTIMO mantenimiento (si se atrasa, corre todo lo que sigue). Pasado el
 *    mes 6, el esquema vuelve a empezar por el mes 1.
 *  - Un Express ocupa su lugar en el esquema; si tocaba Profundo y se hizo Express,
 *    el Profundo sigue pendiente (y se cuenta desde el Express).
 *  - Los mantenimientos sin tipo (anteriores al esquema) cuentan como Profundo.
 * ------------------------------------------------------------------------ */
var TIPO_MANT = { PROFUNDO: 'PROFUNDO', EXPRESS: 'EXPRESS' };
var TIPO_MANT_TEXTO = { PROFUNDO: 'Profundo', EXPRESS: 'Express' };
var MESES_ESQUEMA = 6;
var ESQUEMA_MANT_DEFECTO = ['', '', 'EXPRESS', '', '', 'PROFUNDO'];
var TIPOS_REINICIAN_ESQUEMA = ['ALTA_INICIAL', 'INSTALACION', 'CAMBIO_MODELO', 'REPARACION_BACKUP'];

function normalizarTipoMant(x) {
  var t = String(x == null ? '' : x).trim().toUpperCase();
  return t === 'P' || t === 'PROFUNDO' ? TIPO_MANT.PROFUNDO : t === 'E' || t === 'EXPRESS' ? TIPO_MANT.EXPRESS : '';
}
/** "-;-;E;-;-;P" (o una lista) → ['', '', 'EXPRESS', '', '', 'PROFUNDO']. null si está vacío o no es válido. */
function leerEsquemaMant(x) {
  if (x == null || x === '') return null;
  var partes = Array.isArray(x) ? x : String(x).split(';');
  if (partes.length !== MESES_ESQUEMA) return null;
  var esq = [];
  for (var i = 0; i < partes.length; i++) {
    var t = String(partes[i] == null ? '' : partes[i]).trim().toUpperCase();
    if (t === '' || t === '-' || t === 'N' || t === 'NADA') esq.push('');
    else if (normalizarTipoMant(t)) esq.push(normalizarTipoMant(t));
    else return null;
  }
  return esq.some(String) ? esq : null;
}
/** ['', 'EXPRESS', …] → "-;E;…" (como se guarda). */
function textoEsquemaMant(esq) {
  return (esq || []).map(function (t) { return t === TIPO_MANT.PROFUNDO ? 'P' : t === TIPO_MANT.EXPRESS ? 'E' : '-'; }).join(';');
}
/** El esquema del cliente: el suyo, si tiene; si no, el de Configuración. */
function esquemaDe_(cm, ctx) {
  return leerEsquemaMant(cm && cm.esquemaMant) || leerEsquemaMant(ctx && ctx.esquemaMant) || ESQUEMA_MANT_DEFECTO;
}
/** Lo que sigue después del mes "mes" (0 a 6): { mes, meses (desde el último), tipo }. */
function siguienteEnEsquema_(esq, mes) {
  for (var k = 1; k <= MESES_ESQUEMA; k++) {
    var slot = ((Number(mes || 0) + k - 1) % MESES_ESQUEMA) + 1;
    if (esq[slot - 1]) return { mes: slot, meses: k, tipo: esq[slot - 1] };
  }
  return null;
}

/** Próximo mantenimiento de un cliente activo: fecha y tipo según su esquema. */
function proximoMantenimiento_(c, cm, ctx) {
  var esq = esquemaDe_(cm, ctx);
  var base = c.fechaBase || c.fechaInstalacion || '';
  var sig = siguienteEnEsquema_(esq, c.mantMes);
  return { base: base, proximo: base && sig ? sumarMeses(base, sig.meses) : '', tipo: sig ? sig.tipo : '', mesEsquema: sig ? sig.mes : '',
    esquema: esq, esquemaPropio: !!leerEsquemaMant(cm && cm.esquemaMant) };
}

function vistaClientes(W, ctx) {
  return Object.keys(ctx.clientes).sort().map(function (id) {
    var c = W.clientes[id] || leerCliente_(W, id);
    var m = c.serie ? (ctx.maquinas[c.serie] || {}) : {};
    return {
      id: id, estado: EST_CLI_TEXTO[c.estado] || c.estado, serie: c.serie || '', modelo: m.modelo || '',
      fechaInstalacion: c.fechaInstalacion || '', fechaCambio: c.fechaCambio || '', fechaDesinstalacion: c.fechaDesinstalacion || '',
      ultimaVisita: c.ultimaVisita || '', tipoUltimaVisita: TIPO_OT_TEXTO[c.tipoUltimaVisita] || c.tipoUltimaVisita || '',
      comodato: textoCantidades_(ctx, c.comodato || {}), adicionales: textoCantidades_(ctx, c.adicionales || {}),
      aRetirar: c.estado === EST_CLI.ACTIVO || c.estado === EST_CLI.MOMENTANEO ? textoARetirar(c, ctx) : '',
      comentarioDesinstalacion: c.comentarioDesinstalacion || '',
      sistema: hayMaestroSistemas_(ctx) ? (c.sistema || '') : (c.sistema || (ctx.clientes[id] || {}).sistema || ''),
      prefiltro: hayMaestroSistemas_(ctx) ? (c.prefiltro || '') : (c.prefiltro || (ctx.clientes[id] || {}).prefiltro || '')
    };
  });
}

function vistaMantenimiento(W, ctx, op) {
  var hoy = (op && op.hoy) || ctx.hoy;
  var aviso = Number((op && op.diasAviso) || 15);
  var filas = [];
  Object.keys(ctx.clientes).forEach(function (id) {
    var c = W.clientes[id];
    if (!c || c.estado !== EST_CLI.ACTIVO) return;
    var cm = ctx.clientes[id];
    var pm = proximoMantenimiento_(c, cm, ctx);
    var base = pm.base, prox = pm.proximo;
    var dias = prox ? diasEntre(hoy, prox) : '';
    var semaforo = prox === '' ? 'Sin fecha base' : dias < 0 ? 'Vencido' : dias <= aviso ? 'Próximo' : 'Al día';
    var m = ctx.maquinas[c.serie] || {};
    var comps = componentesCliente_(c, ctx).filter(function (x) { return x.rol === ROL_COMP.RECAMBIO; });
    var ultimo = '', primero = '';
    comps.forEach(function (x) { if (x.ultimo > ultimo) ultimo = x.ultimo; if (x.vence && (!primero || x.vence < primero)) primero = x.vence; });
    filas.push({
      id: id, nombre: cm.nombre, plaza: cm.plaza, zona: cm.zona || '', serie: c.serie, modelo: m.modelo || '',
      // Lo instalado según el historial; sin maestro de sistemas, la ficha (como antes).
      sistema: hayMaestroSistemas_(ctx) ? (c.sistema || '') : (c.sistema || cm.sistema || ''), prefiltro: hayMaestroSistemas_(ctx) ? (c.prefiltro || '') : (c.prefiltro || cm.prefiltro || ''),
      fechaBase: base, proximo: prox, dias: dias, semaforo: semaforo,
      tipoMant: pm.tipo, tipoMantTexto: TIPO_MANT_TEXTO[pm.tipo] || '', mesEsquema: pm.mesEsquema, esquema: textoEsquemaMant(pm.esquema), esquemaPropio: pm.esquemaPropio,
      ultimoTipoMant: TIPO_MANT_TEXTO[c.tipoUltimoMant] || '',
      // Si el mantenimiento ya está vencido, la visita es de hoy en adelante.
      trabajos: textoTrabajos(c, ctx, prox && prox > hoy ? prox : hoy), ultimoCambioFiltros: ultimo, proximoVencFiltros: primero
    });
  });
  return filas.sort(function (a, b) { return String(a.plaza).localeCompare(String(b.plaza)) || String(a.proximo).localeCompare(String(b.proximo)) || String(a.id).localeCompare(String(b.id)); });
}

/** Vencimientos de filtros de los clientes activos: un componente por fila (hoja VENCIMIENTOS_FILTROS y app). */
function vistaVencimientos(W, ctx, op) {
  var hoy = (op && op.hoy) || ctx.hoy;
  var filas = [];
  Object.keys(ctx.clientes).forEach(function (id) {
    var c = W.clientes[id];
    if (!c || c.estado !== EST_CLI.ACTIVO) return;
    var cm = ctx.clientes[id];
    var pm = proximoMantenimiento_(c, cm, ctx);
    var visita = pm.proximo && pm.proximo > hoy ? pm.proximo : hoy;
    var cambiar = aCambiarEnVisita_(componentesCliente_(c, ctx), visita, ctx.diasAnticipoFiltros).map(function (x) { return x.slot + '|' + x.codigo; });
    componentesCliente_(c, ctx).forEach(function (x) {
      var aCambiar = cambiar.indexOf(x.slot + '|' + x.codigo) >= 0;
      var estado = x.rol === ROL_COMP.CONSUMO ? 'Revisar nivel' : !x.vence ? 'Sin vencimiento' : x.vence < hoy ? 'Vencido' : aCambiar ? 'Cambiar en el próximo mantenimiento' : 'Al día';
      filas.push({ id: id, nombre: cm.nombre, plaza: cm.plaza, zona: cm.zona || '', slot: SLOT_TEXTO[x.slot], sistema: x.sistema, codigo: x.codigo, descripcion: x.descripcion,
        ultimo: x.ultimo, vence: x.vence, dias: x.vence ? diasEntre(hoy, x.vence) : '', estado: estado, proximo: pm.proximo, cambiar: aCambiar || x.rol === ROL_COMP.CONSUMO });
    });
  });
  return filas.sort(function (a, b) { return String(a.plaza).localeCompare(String(b.plaza)) || String(a.vence || '9999').localeCompare(String(b.vence || '9999')) || String(a.id).localeCompare(String(b.id)); });
}

function vistaMaquinas(W, ctx) {
  return Object.keys(W.maquinas).sort().map(function (s) {
    var m = W.maquinas[s];
    var ubic = describirUbicacion_(m, ctx);
    if (m.ubicTipo === UBIC.CABA) ubic = 'Enviada a CABA';
    return {
      serie: s, estado: EST_MAQ_TEXTO[m.estado] || m.estado, ubicacion: ubic,
      idCliente: m.ubicTipo === UBIC.CLIENTE ? m.ubicId : '', deposito: m.ubicTipo === UBIC.DEPOSITO ? m.ubicId : '',
      ultimaFecha: m.ultimaFecha || '', revision: m.ingresoAbierto || (m.paraCaba ? 'Para enviar a CABA' : '')
    };
  });
}

/** Stock de ítems por depósito, con lo que viene en camino y los ingresos y salidas (últimos 30 días e histórico). */
function vistaStock(W, ctx) {
  var filas = {};
  var fila = function (dep, cod) {
    var k = dep + '|' + cod;
    if (!filas[k]) {
      var it = ctx.catalogo[cod] || {};
      filas[k] = { deposito: dep, plaza: (ctx.depositos[dep] || {}).plaza || '', codigo: cod, descripcion: it.descripcion || cod, categoria: it.categoria || '',
        disponible: 0, aRevisar: 0, paraCaba: 0, enCamino: 0, ingresos30: 0, ingresosTotal: 0, salidas30: 0, salidasTotal: 0 };
    }
    return filas[k];
  };
  Object.keys(W.stock).forEach(function (dep) {
    Object.keys(W.stock[dep]).forEach(function (cod) {
      var s = W.stock[dep][cod];
      var f = fila(dep, cod);
      f.disponible = s.DISPONIBLE; f.aRevisar = s.A_REVISAR; f.paraCaba = s.PARA_CABA;
      f.registrado = true; // v1.0: el ítem tuvo movimientos en el depósito (aunque hoy esté en cero)
    });
  });
  Object.keys(W.envios).forEach(function (id) {
    var e = W.envios[id];
    if (e.estado !== 'EN_TRANSITO') return;
    e.lineas.forEach(function (l) { var f = fila(e.destino, l.codigo); f.enCamino = cant_(f.enCamino + l.cantidad); });
  });
  var desde30 = sumarDias(ctx.hoy, -30);
  (W.movStock || []).forEach(function (x) {
    var f = fila(x.deposito, x.codigo);
    var c = x.sentido === 'INGRESO' ? 'ingresos' : 'salidas';
    f[c + 'Total'] = cant_(f[c + 'Total'] + x.cantidad);
    if (x.fecha >= desde30) f[c + '30'] = cant_(f[c + '30'] + x.cantidad);
  });
  return Object.keys(filas).map(function (k) { return filas[k]; })
    .filter(function (f) { var ok = f.registrado || f.disponible || f.aRevisar || f.paraCaba || f.enCamino || f.salidasTotal || f.ingresosTotal; delete f.registrado; return ok; })
    .sort(function (a, b) { return String(a.deposito).localeCompare(String(b.deposito)) || String(a.categoria).localeCompare(String(b.categoria)) || String(a.descripcion).localeCompare(String(b.descripcion)); });
}

/** Cada ingreso y salida de stock, el más nuevo primero (hoja MOVIMIENTOS_STOCK). */
function vistaMovimientosStock(W, ctx) {
  return (W.movStock || []).slice().reverse().sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); })
    .map(function (x) {
      var cli = x.idCliente ? ctx.clientes[x.idCliente] : null;
      return { fecha: x.fecha, deposito: x.deposito, plaza: (ctx.depositos[x.deposito] || {}).plaza || '', codigo: x.codigo, descripcion: nombreItem_(ctx, x.codigo),
        categoria: (ctx.catalogo[x.codigo] || {}).categoria || '', sentido: x.sentido === 'INGRESO' ? 'Ingreso' : 'Salida', tipo: TIPO_MOV_TEXTO[x.sentido][x.tipo] || x.tipo,
        cantidad: x.cantidad, origen: x.origen, idCliente: x.idCliente || '', cliente: cli ? cli.nombre : (x.idCliente || ''), serie: x.serie || '', detalle: x.detalle || '' };
    });
}

/**
 * v0.9.4: movimientos de stock con el saldo acumulado de cada saldo (Disponible, A revisar, Para CABA) por depósito e ítem.
 * filtro = { codigo, idCliente, desde, hasta }. Devuelve { filas (de la más vieja a la más nueva), inicial: { 'dep|cod': saldos al inicio del período } }.
 */
function vistaKardex(W, ctx, filtro) {
  filtro = filtro || {};
  var desde = filtro.desde || '', hasta = filtro.hasta || '9999-12-31';
  var lista = (W.kardex || []).map(function (x, i) { return { x: x, i: i }; })
    .filter(function (o) { return (!filtro.codigo || o.x.cod === filtro.codigo) && (!filtro.idCliente || o.x.cli === filtro.idCliente || !!filtro.codigo); })
    .sort(function (a, b) { return String(a.x.f).localeCompare(String(b.x.f)) || a.i - b.i; });
  var saldos = {}, inicial = {}, filas = [];
  lista.forEach(function (o) {
    var x = o.x, k = x.dep + '|' + x.cod;
    var s = saldos[k] = saldos[k] || { DISPONIBLE: 0, A_REVISAR: 0, PARA_CABA: 0 };
    if (desde && x.f < desde) { Object.keys(x.d).forEach(function (b) { s[b] = cant_(s[b] + x.d[b]); }); return; }
    if (!(k in inicial)) inicial[k] = { DISPONIBLE: s.DISPONIBLE, A_REVISAR: s.A_REVISAR, PARA_CABA: s.PARA_CABA };
    Object.keys(x.d).forEach(function (b) { s[b] = cant_(s[b] + x.d[b]); });
    if (x.f > hasta) return;
    if (filtro.idCliente && x.cli !== filtro.idCliente) return;
    var cli = x.cli ? ctx.clientes[x.cli] : null;
    filas.push({ fecha: x.f, deposito: x.dep, plaza: (ctx.depositos[x.dep] || {}).plaza || '', codigo: x.cod, descripcion: nombreItem_(ctx, x.cod),
      categoria: (ctx.catalogo[x.cod] || {}).categoria || '', movimiento: x.mov,
      disponible: x.d.DISPONIBLE || 0, aRevisar: x.d.A_REVISAR || 0, paraCaba: x.d.PARA_CABA || 0,
      saldoDisponible: s.DISPONIBLE, saldoARevisar: s.A_REVISAR, saldoParaCaba: s.PARA_CABA,
      idCliente: x.cli, cliente: cli ? cli.nombre : x.cli, serie: x.serie, operacion: x.op, detalle: x.det });
  });
  return { filas: filas, inicial: inicial };
}

/** Ingresos y salidas agrupados por depósito, código, fecha, sentido y tipo (para filtrar por período en la app). */
function movimientosAgrupados(W) {
  var g = {};
  (W.movStock || []).forEach(function (x) {
    var k = [x.deposito, x.codigo, x.fecha, x.sentido, x.tipo].join('|');
    g[k] = g[k] || { deposito: x.deposito, codigo: x.codigo, fecha: x.fecha, sentido: x.sentido, tipo: x.tipo, cantidad: 0 };
    g[k].cantidad = cant_(g[k].cantidad + x.cantidad);
  });
  return Object.keys(g).map(function (k) { return g[k]; });
}

/** Máquinas por depósito, modelo y estado (incluye las que vienen en camino). */
function vistaStockMaquinas(W, ctx) {
  var filas = {};
  Object.keys(W.maquinas).forEach(function (s) {
    var m = W.maquinas[s];
    var dep = '', camino = false;
    if (m.ubicTipo === UBIC.DEPOSITO) dep = m.ubicId;
    else if (m.ubicTipo === UBIC.CABA) dep = DEPOSITO_CABA; // v1.0: el depósito central también cuenta sus máquinas
    else if (m.ubicTipo === UBIC.TRANSITO && W.envios[m.ubicId]) { dep = W.envios[m.ubicId].destino; camino = true; }
    if (!dep) return;
    var modelo = (ctx.maquinas[s] || {}).modelo || '';
    var k = dep + '|' + modelo;
    var f = filas[k] = filas[k] || { deposito: dep, modelo: modelo, nuevas: 0, usadas: 0, aRevisar: 0, baja: 0, enCamino: 0 };
    if (camino) f.enCamino++;
    else if (m.estado === EST_MAQ.NUEVA) f.nuevas++;
    else if (m.estado === EST_MAQ.USADA) f.usadas++;
    else if (m.estado === EST_MAQ.A_REVISAR) f.aRevisar++;
    else f.baja++;
  });
  return Object.keys(filas).sort().map(function (k) { return filas[k]; });
}

function vistaTaller(W, ctx) {
  return Object.keys(W.ingresos).map(function (id) { return W.ingresos[id]; })
    .sort(function (a, b) { return (a.estado === b.estado ? 0 : a.estado === 'ABIERTO' ? -1 : 1) || String(b.fecha).localeCompare(String(a.fecha)); })
    .map(function (i) {
      var cli = i.idCliente ? ctx.clientes[i.idCliente] : null;
      return { id: i.id, fecha: i.fecha, deposito: i.deposito, serie: i.serie, modelo: (ctx.maquinas[i.serie] || {}).modelo || '', origen: i.origen,
        idCliente: i.idCliente || '', cliente: cli ? cli.nombre : (i.idCliente || ''),
        tipoOT: ORIGEN_TALLER_TEXTO[i.tipoOT] || (i.tipoOT ? (TIPO_OT_TEXTO[i.tipoOT] || i.tipoOT) : ORIGEN_TALLER_TEXTO.MANUAL),
        items: (i.items || []).map(function (x) { return x.cantidad + ' ' + nombreItem_(ctx, x.codigo); }).join(', '), tecnico: i.tecnico || '',
        falla: i.falla, estado: i.estado === 'ABIERTO' ? 'Abierta' : 'Cerrada', resultado: RES_TALLER_TEXTO[i.resultado] || '', fechaCierre: i.fechaCierre,
        diagnostico: i.diagnostico || '', dias: i.estado === 'ABIERTO' ? diasEntre(i.fecha, ctx.hoy) : '' };
    });
}

/** Insumos y adicionales a revisar, lote por lote, con su origen (cliente, fecha, tipo y N° de OT). */
function vistaLotesRevision(W, ctx) {
  return Object.keys(W.lotes || {}).map(function (k) { return W.lotes[k]; })
    .filter(function (l) { return l.cantidad > 0; })
    .sort(function (a, b) { return String(a.deposito).localeCompare(String(b.deposito)) || String(a.fecha).localeCompare(String(b.fecha)) || String(a.id).localeCompare(String(b.id)); })
    .map(function (l) {
      var cli = l.idCliente ? ctx.clientes[l.idCliente] : null;
      return { lote: l.id, deposito: l.deposito, plaza: (ctx.depositos[l.deposito] || {}).plaza || '', fecha: l.fecha, idCliente: l.idCliente,
        cliente: cli ? cli.nombre : l.idCliente, tipoOT: l.tipoOT === 'AJUSTE' ? 'Ajuste de stock' : (TIPO_OT_TEXTO[l.tipoOT] || l.tipoOT), nOt: l.origen,
        codigo: l.codigo, descripcion: nombreItem_(ctx, l.codigo), cantidad: l.cantidad, dias: diasEntre(l.fecha, ctx.hoy) };
    });
}

/** Referencias rotas en los maestros: no frenan la carga, pero conviene corregirlas. */
function detectarAlertas(W, ctx) {
  var al = [];
  Object.keys(ctx.maquinas).forEach(function (s) {
    var dep = String(ctx.maquinas[s].depositoInicial || '').trim();
    if (!esDeposito_(ctx, dep)) al.push({ codigo: 'DEPOSITO_INICIAL_INEXISTENTE', ref: s, mensaje: 'La máquina ' + s + ' tiene depósito inicial "' + dep + '", que no existe en DEPOSITOS ni es CABA.' });
  });
  Object.keys(ctx.clientes).forEach(function (id) {
    var c = ctx.clientes[id];
    if (!ctx.plazas[c.plaza]) al.push({ codigo: 'PLAZA_INEXISTENTE', ref: id, mensaje: 'El cliente ' + c.nombre + ' (' + id + ') tiene la plaza "' + (c.plaza || '') + '", que no existe en PLAZAS.' });
  });
  if ((ctx.sistemasIncompletos || []).length) {
    al.push({ codigo: 'SISTEMAS_SIN_CODIGO', ref: 'SISTEMAS_PURIFICACION', mensaje: 'En SISTEMAS_PURIFICACION faltan códigos del CATÁLOGO (o no existen) para: ' + ctx.sistemasIncompletos.join(', ') + '. Hasta completarlos no se pueden instalar.' });
  }
  if (hayMaestroSistemas_(ctx)) {
    Object.keys(W.clientes).forEach(function (id) {
      var c = W.clientes[id];
      SLOTS_SIS.forEach(function (s) {
        if (c.sis && c.sis[s] && !defSistema_(ctx, c.sis[s].nombre)) al.push({ codigo: 'SISTEMA_DEL_CLIENTE_INEXISTENTE', ref: id + '|' + s, mensaje: 'El cliente ' + id + ' tiene ' + c.sis[s].nombre + ', que ya no está completo en SISTEMAS_PURIFICACION: sus vencimientos no se calculan.' });
      });
    });
  }
  Object.keys(W.stock).forEach(function (dep) {
    if (!controlaStock_(ctx, dep)) return; // v1.1: el central no avisa faltantes (tampoco en la auditoría)
    Object.keys(W.stock[dep]).forEach(function (cod) {
      var s = W.stock[dep][cod];
      if (s.DISPONIBLE < 0) al.push({ codigo: 'STOCK_NEGATIVO', ref: dep + '|' + cod, mensaje: 'El ' + nombreDeposito_(dep) + ' tiene ' + s.DISPONIBLE + ' ' + nombreItem_(ctx, cod) + ' disponibles. Falta cargar un envío o un ajuste.' });
    });
  });
  return al;
}


/** El nombre del depósito central sale de la configuración (DEPOSITO_CENTRAL). */
function fijarDepositoCentral(nombre) { DEPOSITO_CABA = String(nombre || 'Depósito CABA'); }
function depositoCentral() { return DEPOSITO_CABA; }

export {
  ACCION_SIS,
  CAT,
  CATEGORIAS,
  CAT_TEXTO,
  CO2_EN_OT,
  DEPOSITO_CABA,
  DIAS_ANTICIPO_FILTROS_DEFECTO,
  EST_CLI,
  EST_CLI_TEXTO,
  EST_MAQ,
  EST_MAQ_TEXTO,
  MODALIDAD_CO2,
  MOV_ITEM,
  ORIGEN_TALLER_TEXTO,
  REGLAS_POR_DEFECTO,
  RES_ITEM,
  RES_TALLER,
  RES_TALLER_TEXTO,
  ROL_COMP,
  SALDO,
  SALDO_TEXTO,
  SIN_AVISOS_DE_FECHA_,
  SI_FALLA,
  SLOTS_SIS,
  SLOT_SIS,
  SLOT_TEXTO,
  TIPOS_AJUSTE,
  TIPOS_CAMBIO_SISTEMA,
  TIPOS_COMODATO,
  TIPOS_RETIRO_LIBRE,
  TIPOS_SIN_COBRANZA,
  TIPO_MOV_TEXTO,
  TIPO_OT,
  TIPO_OT_ALIAS,
  TIPO_OT_TEXTO,
  UBIC,
  VALIDADORES_,
  aCambiarEnVisita_,
  adv_,
  aplicarAjuste_,
  aplicarCierre_,
  aplicarEnvio_,
  aplicarIngreso_,
  aplicarOT_,
  aplicarRecepcion_,
  aplicarReparacionDeposito_,
  aplicarRevisionItems_,
  avisarStockEnFecha_,
  cant_,
  categoriasPermitidas_,
  cilindrosDeOT_,
  cliente_,
  clonarEstado,
  co2VaACobranza_,
  compararComodato_,
  componentesCliente_,
  construirSistemas_,
  consumirLotes_,
  controlaStock_,
  crearLote_,
  defSistema_,
  depositoDeCliente_,
  describirUbicacion_,
  detectarAlertas,
  diasEntre,
  err_,
  esDeposito_,
  esFechaValida,
  estadoInicial,
  faltaEnFecha_,
  fechaTexto,
  hayMaestroSistemas_,
  leerCliente_,
  lotesDe_,
  maxFecha_,
  moverStock_,
  movimientosAgrupados,
  nombreDeposito_,
  nombreItem_,
  normalizarCodigo,
  normalizarLineas_,
  normalizarSerie,
  normalizarTipoOT,
  nuevoResultado_,
  planSistemas_,
  procesarOperacion_,
  proximoMantenimiento_,
  TIPO_MANT,
  TIPO_MANT_TEXTO,
  ESQUEMA_MANT_DEFECTO,
  normalizarTipoMant,
  leerEsquemaMant,
  textoEsquemaMant,
  esquemaDe_,
  siguienteEnEsquema_,
  reconstruir,
  registrarKardex_,
  registrarMov_,
  registrarSalida_,
  repartirLineasOT,
  saldo_,
  simularLote,
  sistemaDelCliente_,
  slotsCliente_,
  sumarDias,
  sumarMeses,
  tecnicosDeRegion_,
  textoARetirar,
  textoCantidades_,
  textoTrabajos,
  usarItemsReparacion_,
  validarAjuste_,
  validarAnulacion,
  validarCierre_,
  validarCilindrosEnOT_,
  validarCodigo_,
  validarEnvio_,
  validarFecha_,
  validarIngreso_,
  validarItemsReparacion_,
  validarOT_,
  validarRecepcion_,
  validarReparacionDeposito_,
  validarRevisionItems_,
  validarTecnicos_,
  vistaClientes,
  vistaKardex,
  vistaLotesRevision,
  vistaMantenimiento,
  vistaMaquinas,
  vistaMovimientosStock,
  vistaStock,
  vistaStockMaquinas,
  vistaTaller,
  vistaVencimientos,
  fijarDepositoCentral,
  depositoCentral
};
