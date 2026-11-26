// =============================================================================
//  SISTEMA FADEFIL · Lectura de remitos y facturas de LINDE ("Leer PDF", sin IA).
//  Pasado tal cual desde co2_IA.gs (Sheets, CO₂ v2.4): recibe el texto del PDF y
//  propone los datos. El texto ahora lo extrae el navegador (pdf.js).
// =============================================================================
/* eslint-disable */
import { co2_ESTADO, co2_esFechaValida, co2_normalizarNroRemito, co2_normalizarSerie } from './co2_motor.js';

var co2_PATRON_SERIE_PDF = '[A-Z]{1,3}-?[0-9]{4,9}[A-Z]{0,2}'; // v2.2.1: admite sufijo (A3526979PX, A189712A)

/** Entrega o retiro según el renglón (título de la sección o descripción del cilindro). '' si no dice o dice las dos. */
function co2_seccionDeRenglon_(l) {
  var e = /\bENTREG|\bDESPACH|\bLLENOS?\b|\bCARGADOS?\b/.test(l), r = /\bRETIR|\bDEVOL|\bVACIOS?\b|\bRECIBID|\bRECUPER/.test(l);
  return e && !r ? 'ENTREGA' : r && !e ? 'RETIRO' : '';
}


/** Fechas válidas (AAAA-MM-DD) de un renglón, en día/mes/año. */
function co2_fechasDeRenglon_(l, hoy) {
  var out = [], re = /(^|[^0-9])(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?![0-9])/g, m;
  while ((m = re.exec(l))) {
    var a = m[4].length === 2 ? '20' + m[4] : m[4];
    var iso = a + '-' + ('0' + m[3]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    if (co2_esFechaValida(iso) && (!hoy || iso <= hoy)) out.push(iso);
  }
  return out;
}


/**
 * Interpreta el texto de un remito de LINDE (Praxair) con reglas fijas. Función pura (se prueba sin Drive).
 * Formato real (remitos 00511-00006544 y 00082-00018868):
 *   - cabecera "NRO.: 00511 - 00006544" y "FECHA: 24/10/2025";
 *   - bloque del cliente: CLIENTE / CODIGO (código de LINDE del lugar de entrega) / DIRECCION / AGENCIA (de LINDE) / CAMION;
 *   - tabla de productos con "TOTAL <salen> <entran>";
 *   - "DETALLE DE CILINDROS ENTREGADOS ..." y "DETALLE DE CILINDROS DEVUELTOS ...": código de producto, capacidad
 *     ("10 KGS") y las series; después "Números de lote" (repite las series, cortadas: no se leen);
 *   - el PDF trae las 3 copias (ORIGINAL, DUPLICADO, TRIPLICADO), una por página: vale la de la primera.
 * Si el documento no tiene ese formato, se usan reglas generales (secciones por palabras o, si no, dónde está el cilindro).
 * op = { depositos, cilindros (estado por serie), cargas: [5, 10], hoy, patron }
 * Devuelve { nroRemito, fecha, plazaTexto, tipoCopia, idDeposito, lineas, observaciones, control }
 */
function co2_parsearRemitoLinde_(texto, op) {
  op = op || {};
  var obs = [];
  var orig = String(texto || '').replace(/\r/g, '').split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(String);
  var may = orig.map(co2_sinAcentos_);
  var junto = may.join(' ');

  // Copia: la primera que aparece (en el PDF de LINDE, la de la primera página). Si ese renglón nombra varias, a mano.
  var tipoCopia = 'NO_INDICADO';
  for (var c = 0; c < may.length; c++) {
    var nombradas = ['ORIGINAL', 'DUPLICADO', 'TRIPLICADO'].filter(function (x) { return new RegExp('\\b' + x + '\\b').test(may[c]); });
    if (nombradas.length === 1) { tipoCopia = nombradas[0]; break; }
    if (nombradas.length > 1) { obs.push('El documento nombra ' + nombradas.join(', ').toLowerCase() + ': elegí la copia a mano.'); break; }
  }

  var cerca = function (re, salvo) {
    var idx = [];
    may.forEach(function (l, i) { if (re.test(l) && !(salvo && salvo.test(l))) { idx.push(i); if (i + 1 < may.length) idx.push(i + 1); } });
    return idx;
  };
  var orden = function (pref) { var vistos = {}, out = []; pref.concat(may.map(function (x, i) { return i; })).forEach(function (i) { if (!vistos[i]) { vistos[i] = true; out.push(i); } }); return out; };

  // Número: punto de venta - número ("NRO.: 00511 - 00006544").
  var nro = '';
  orden(cerca(/REMITO|\bN\s*[°ºO]|\bNRO\b|NUMERO/)).some(function (i) {
    var m = /(^|[^0-9])(\d{4,5})\s*-\s*(\d{6,8})(?![0-9])/.exec(may[i]);
    if (m) { nro = m[2] + '-' + m[3]; return true; }
    return false;
  });
  if (!nro) obs.push('No se encontró el número de remito.');

  // Fecha: la de "FECHA:" (no la de inicio de actividades ni el vencimiento del CAI).
  var fecha = '';
  orden(cerca(/FECHA/, /INICIO|ACTIVIDADES|VTO|VENC/)).some(function (i) {
    if (/INICIO|ACTIVIDADES|VTO|VENC/.test(may[i])) return false;
    var f = co2_fechasDeRenglon_(may[i], op.hoy); if (f.length) { fecha = f[0]; return true; } return false;
  });
  if (!fecha) obs.push('No se encontró la fecha.');

  // Depósito. 1) plaza_linde de co2_depositos (puede ser el CODIGO de LINDE del lugar de entrega, o varios valores con ";").
  // 2) Nombre, ciudad o dirección del depósito en el bloque del cliente (sin AGENCIA ni CAMION, que son de LINDE).
  var deps = op.depositos || {};
  var reDe = function (k) { return new RegExp('(^|[^A-Z0-9])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Z0-9])'); };
  var buscar = function (renglones, clavesDe) {
    var hallados = {}, renglon = {};
    Object.keys(deps).forEach(function (id) {
      clavesDe(deps[id]).map(function (k) { return co2_sinAcentos_(k).trim(); }).filter(function (k) { return k.length >= 3; }).forEach(function (k) {
        var re = reDe(k);
        renglones.forEach(function (r) { if (!hallados[id] && re.test(r.t)) { hallados[id] = true; renglon[id] = r.o; } });
      });
    });
    var ids = Object.keys(hallados);
    return ids.length === 1 ? { id: ids[0], renglon: renglon[ids[0]] } : ids.length > 1 ? { varios: ids } : null;
  };
  var todos = may.map(function (t, i) { return { t: t, o: orig[i] }; });
  var bloque = [], iCli = -1;
  for (var b = 0; b < may.length; b++) if (/\bCLIENTE\b/.test(may[b])) { iCli = b; break; }
  if (iCli >= 0) {
    for (var b2 = iCli; b2 < Math.min(may.length, iCli + 25); b2++) {
      if (b2 > iCli && /OBSERVACION|DETALLE DE CILINDROS|DESCRIPCION DEL PRODUCTO|^IVA\b|\bRESPONSABLE\b/.test(may[b2])) break;
      var corte = may[b2].search(/AGENCIA|CAMION|CODIGO|C\.\s*POSTAL|TEL\s*\/\s*FAX|\bCUIT\b/);
      var t = corte >= 0 ? may[b2].slice(0, corte) : may[b2];
      var limpio = t.replace(/CLIENTE:?|DIRECCION:?/g, '').trim();
      if (limpio && !/^[\d\s.,-]+$/.test(limpio)) bloque.push({ t: t, o: orig[b2].slice(0, corte >= 0 ? corte : undefined).replace(/^\s*(CLIENTE|DIRECCI[OÓ]N):?\s*/i, '') });
    }
  }
  var sinPrefijo = function (x) { return String(x.nombre || '').replace(/^dep[oó]sito\s+/i, ''); };
  var d = buscar(todos, function (x) { return String(x.plaza || '').split(';'); }) ||
    buscar(bloque.length ? bloque : todos, function (x) { return [x.nombre, sinPrefijo(x), String(x.direccion || '').split(',')[0]]; });
  var idDeposito = '', plazaTexto = bloque.slice(0, 3).map(function (r) { return r.o.trim(); }).join(' · ').slice(0, 200);
  if (d && d.id) { idDeposito = d.id; if (!plazaTexto) plazaTexto = String(d.renglon || '').slice(0, 200); }
  else if (d && d.varios) obs.push('El documento nombra varios depósitos (' + d.varios.join(', ') + '): elegilo a mano.');
  else obs.push('No se reconoció el depósito: elegilo a mano. Para que se reconozca solo, cargá en co2_depositos (columna plaza_linde) el CODIGO de LINDE de ese depósito.');

  // Totales de la tabla de productos: "TOTAL <cilindros que salen> <cilindros que entran>".
  // Si el texto viene desordenado, queda "TOTAL CILINDROS TRANSPORTADOS: <n>" (los que entrega LINDE).
  var tot = /\bTOTAL\s+(\d+)\s+(\d+)\b/.exec(junto), transp = /TOTAL CILINDROS TRANSPORTADOS:?\s*(\d+)/.exec(junto);
  var totales = tot ? { entregas: Number(tot[1]), retiros: Number(tot[2]) } : transp ? { entregas: Number(transp[1]), retiros: null } : null;

  // Cilindros.
  var conocidas = op.cilindros || {};
  var patronTxt = op.patron || co2_PATRON_SERIE_PDF;
  if (patronTxt === '[A-Z]{1,3}-?[0-9]{4,9}') patronTxt = co2_PATRON_SERIE_PDF; // el valor por defecto de la v2.2 se actualiza solo
  var patron = new RegExp('^(?:' + patronTxt + ')$');
  var cargas = op.cargas || [];
  var vistas = {}, lineas = [], porEstado = 0, distintas = 0;
  var agregar = function (tipo, serie, leida, renglon, kg, kgTexto, deSeccion) {
    if (vistas[tipo + '|' + serie]) return;
    vistas[tipo + '|' + serie] = true;
    var est = conocidas[serie], segunSistema = est && est.estado !== co2_ESTADO.LINDE ? 'RETIRO' : 'ENTREGA';
    var duda = deSeccion && tipo !== segunSistema;
    if (duda) distintas++;
    lineas.push({ tipo: tipo, serie: serie, serieLeidaIA: leida,
      pesoKg: tipo === 'ENTREGA' && cargas.indexOf(kg) >= 0 ? kg : '', legible: !duda });
  };
  var esSerie = function (t) { var s = co2_normalizarSerie(t); return !!conocidas[s] || patron.test(s); };
  var iDet = -1;
  for (var k0 = 0; k0 < may.length; k0++) if (/DETALLE DE CILINDROS/.test(may[k0])) { iDet = k0; break; }

  if (iDet >= 0) {
    // Formato LINDE: solo lo que está dentro de "DETALLE DE CILINDROS ...". Los códigos de producto no son series.
    var antes = {};
    may.slice(0, iDet).join(' ').split(/[^A-Z0-9-]+/).forEach(function (t) { if (t) antes[t] = true; });
    var esProducto = function (t, resto) { return antes[t] || /^ARE?-?[0O]\d{6}$/.test(t) || /^\s*\d+\s*(KGS?|CU|LTS?)\b/.test(resto); };
    var seccion = '', dentro = false, kg = 0, kgTexto = '';
    may.forEach(function (l, k) {
      if (/DETALLE DE CILINDROS/.test(l)) {
        seccion = /DEVUEL|RETIR|RECIB/.test(l) ? 'RETIRO' : /ENTREG/.test(l) ? 'ENTREGA' : co2_seccionDeRenglon_(l);
        dentro = !!seccion; kg = 0; kgTexto = '';
        return;
      }
      if (/TOTAL CILINDROS|^NOTA\b|SUSCRIPCION|RECIBI CONFORME/.test(l)) { dentro = false; return; }
      if (!dentro || /[A-Z0-9]{6,}\s*\(/.test(l)) return; // "Números de lote": ARCFAA8RKC(A32703,...) repite series cortadas
      var mk = /(\d+(?:[.,]\d+)?)\s*(KGS?|KILOS?)\b/.exec(l);
      if (mk) { kg = Number(mk[1].replace(',', '.')); kgTexto = mk[1] + ' ' + mk[2]; }
      var re = /[A-Z0-9-]+/g, m;
      while ((m = re.exec(l))) {
        var t = m[0].replace(/^-+|-+$/g, '');
        if (!t || esProducto(t, l.slice(m.index + m[0].length)) || !esSerie(t)) continue;
        agregar(seccion, co2_normalizarSerie(t), t, orig[k], kg, kgTexto, true);
      }
    });
  } else {
    // Otro formato: series del patrón o conocidas; entrega o retiro por palabras del renglón o, si no, por dónde está el cilindro.
    var sec = '';
    may.forEach(function (l, k) {
      var s = co2_seccionDeRenglon_(l);
      if (s) sec = s;
      l.split(/[^A-Z0-9-]+/).forEach(function (t) {
        t = t.replace(/^-+|-+$/g, '');
        if (!t || (nro && t.indexOf(nro) >= 0) || !esSerie(t)) return;
        var serie = co2_normalizarSerie(t), est = conocidas[serie];
        var tipo = sec || (est && est.estado !== co2_ESTADO.LINDE ? 'RETIRO' : 'ENTREGA');
        if (!sec) porEstado++;
        var mk = /(\d+(?:[.,]\d+)?)\s*(KGS?|KILOS?)\b/.exec(l);
        agregar(tipo, serie, t, orig[k], mk ? Number(mk[1].replace(',', '.')) : 0, mk ? mk[0] : '', !!sec);
      });
    });
  }

  // Control de lectura: las series entregadas se repiten en "Números de lote" (entre paréntesis). Si una serie no está
  // ahí pero hay una casi igual (un carácter de diferencia), seguramente se leyó mal: queda DUDOSA con la sugerencia
  // y el remito no se guarda hasta que un administrador indica a qué cilindro corresponde (v2.3).
  var lote = {};
  may.forEach(function (l) {
    var m, re = /\(([^)]*)(\)?)/g;
    while ((m = re.exec(l))) {
      var ts = m[1].split(/[^A-Z0-9-]+/).filter(String);
      if (!m[2]) ts.pop(); // renglón cortado: el último puede estar incompleto
      ts.forEach(function (t) { lote[co2_normalizarSerie(t)] = true; });
    }
  });
  var dudosasLote = [];
  if (Object.keys(lote).length) {
    lineas.forEach(function (l) {
      if (l.tipo !== 'ENTREGA' || lote[l.serie]) return;
      var parecida = Object.keys(lote).filter(function (x) { return co2_distanciaUno_(x, l.serie); })[0];
      if (parecida) { l.dudosa = true; l.sugerida = parecida; l.legible = false; dudosasLote.push(l.serie + ' (¿' + parecida + '?)'); }
    });
  }
  if (dudosasLote.length) obs.push('Series dudosas (no figuran igual en los números de lote): ' + dudosasLote.join(', ') + '. Un administrador tiene que indicar a qué cilindro corresponde cada una.');

  var nE = lineas.filter(function (l) { return l.tipo === 'ENTREGA'; }).length, nR = lineas.length - nE;
  var control = '';
  if (totales) {
    var sinRet = totales.retiros === null;
    control = (totales.entregas === nE && (sinRet || totales.retiros === nR))
      ? 'Coincide con los totales del remito: ' + nE + ' entregados' + (sinRet ? '' : ' y ' + nR + ' retirados') + '.'
      : 'NO coincide con los totales del remito: dice ' + totales.entregas + ' entregados' + (sinRet ? '' : ' y ' + totales.retiros + ' retirados') +
        '; se leyeron ' + nE + (sinRet ? '' : ' y ' + nR) + '. Revisá contra el documento.';
  }
  if (!lineas.length) obs.push('No se encontraron series de cilindros. Cargalas a mano (si las series tienen otro formato, avisá para ajustar PATRON_SERIE_PDF).');
  if (porEstado) obs.push('El documento no dice en todos los casos si es entrega o retiro: esos cilindros se clasificaron según dónde están en el sistema.');
  if (distintas) obs.push(distintas + ' cilindro(s) no coinciden con lo que dice el sistema (marcados en amarillo): revisalos.');

  return { nroRemito: nro, fecha: fecha, plazaTexto: plazaTexto, tipoCopia: tipoCopia, idDeposito: idDeposito, lineas: lineas,
    observaciones: obs.join(' '), control: control, totales: totales };
}


/**
 * v2.4 · Interpreta el texto de una factura de LINDE (Praxair). Función pura.
 * Formato real (factura 00525-00003080): cabecera "NRO. : 00525-00003080" y "FECHA : 21/10/2026"; en "Detalle:", un renglón
 * por remito: código de producto, descripción, remito (00290-00005053), fecha del remito, U.M (KG), cantidad, precio e importe.
 * Solo interesan los kg por remito. Si el renglón trae precio e importe, se usa cantidad × precio = importe como control de lectura.
 * Devuelve { nroFactura, fecha, lineas: [{ nroRemito, fechaRemito, kg, controlada }], observaciones }
 */
function co2_parsearFacturaLinde_(texto, op) {
  op = op || {};
  var obs = [];
  var orig = String(texto || '').replace(/\r/g, '').split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(String);
  var may = orig.map(co2_sinAcentos_);
  var iDet = -1;
  for (var i = 0; i < may.length; i++) if (/^DETALLE\b|\bDETALLE:/.test(may[i])) { iDet = i; break; }
  var cab = iDet >= 0 ? may.slice(0, iDet) : may;
  var reNro = /(^|[^0-9])(\d{4,5})\s*-\s*(\d{6,8})(?![0-9])/;

  // Número de la factura: el de "NRO." de la cabecera.
  var nroFactura = '';
  [cab.filter(function (l) { return /\bNRO\b|FACTURA/.test(l); }), cab].some(function (ls) {
    return ls.some(function (l) { var m = reNro.exec(l); if (m) { nroFactura = m[2] + '-' + m[3]; return true; } return false; });
  });
  if (!nroFactura) obs.push('No se encontró el número de la factura.');

  // Fecha de la factura (no la de inicio de actividades, vencimiento de pago ni CAE).
  var fecha = '';
  cab.some(function (l) {
    if (!/FECHA/.test(l) || /INICIO|ACTIVIDADES|VENC|VTO|CAE/.test(l)) return false;
    var f = co2_fechasDeRenglon_(l.slice(l.indexOf('FECHA')), op.hoy); if (f.length) { fecha = f[0]; return true; } return false;
  });
  if (!fecha) obs.push('No se encontró la fecha de la factura.');

  // Renglones de detalle: un número de remito seguido de su fecha. Los kg son la cantidad después de "KG".
  var porRemito = {}, lineas = [], sinKg = [], otraUnidad = [];
  var nroFacNorm = co2_normalizarNroRemito(nroFactura);
  may.forEach(function (l) {
    var re = new RegExp(reNro.source, 'g'), m;
    while ((m = re.exec(l))) {
      var nro = m[2] + '-' + m[3];
      if (co2_normalizarNroRemito(nro) === nroFacNorm) continue;
      var resto = l.slice(m.index + m[0].length);
      var f = co2_fechasDeRenglon_(resto.slice(0, 20));
      if (!f.length) continue; // teléfonos, cuentas: sin fecha al lado
      var u = /^[^A-Z0-9]*\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\W*([A-Z]{1,4})\b\W*(\d+(?:[.,]\d+)?)?(?:\s+(\d+(?:[.,]\d+)?))?(?:\s+(\d+(?:[.,]\d+)?))?/.exec(resto);
      var unidad = u ? u[1] : '', num = function (x) { return x == null ? null : Number(String(x).replace(/\./g, '').replace(',', '.')); };
      if (unidad && unidad !== 'KG' && unidad !== 'KGS') { otraUnidad.push(nro + ' (' + unidad + ')'); continue; }
      var kg = u && u[2] != null ? num(u[2]) : '';
      var controlada = false;
      if (kg !== '' && u[3] != null && u[4] != null) {
        var precio = num(u[3]), importe = num(u[4]);
        controlada = Math.abs(kg * precio - importe) <= Math.max(0.02, importe * 0.001);
      }
      var k = co2_normalizarNroRemito(nro), x = porRemito[k];
      if (!x) { x = porRemito[k] = { nroRemito: nro, fechaRemito: f[0], kg: '', controlada: true }; lineas.push(x); }
      if (kg === '') { x.controlada = false; if (sinKg.indexOf(nro) < 0) sinKg.push(nro); }
      else { x.kg = (x.kg || 0) + kg; x.controlada = x.controlada && controlada; }
    }
  });
  // Texto desordenado (la cantidad quedó lejos del remito): se buscan ternas cantidad, precio, importe que cierren
  // (cantidad × precio = importe). Si hay exactamente una por cada remito sin kg, se asignan en orden.
  var faltan = lineas.filter(function (x) { return x.kg === ''; });
  if (faltan.length) {
    var nums = [];
    may.slice(Math.max(0, iDet)).join(' ').split(/\s+/).forEach(function (t) {
      if (/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(t)) nums.push(Number(t.replace(/\./g, '').replace(',', '.')));
    });
    var ternas = [];
    for (var n = 0; n + 2 < nums.length; n++) {
      var q = nums[n], pr = nums[n + 1], im = nums[n + 2];
      if (q > 0 && pr > 0 && Math.abs(q * pr - im) <= Math.max(0.02, im * 0.001)) { ternas.push(q); n += 2; }
    }
    if (ternas.length === faltan.length) {
      faltan.forEach(function (x, k) { x.kg = ternas[k]; x.controlada = true; sinKg.splice(sinKg.indexOf(x.nroRemito), 1); });
    }
  }
  if (!lineas.length) obs.push('No se encontraron remitos en el detalle: cargalos a mano.');
  if (sinKg.length) obs.push('No se pudieron leer los kg de ' + sinKg.join(', ') + ': completalos a mano.');
  if (otraUnidad.length) obs.push('Renglones que no son en kg (no se validan): ' + otraUnidad.join(', ') + '.');
  var dudosas = lineas.filter(function (x) { return x.kg !== '' && !x.controlada; }).map(function (x) { return x.nroRemito; });
  if (dudosas.length) obs.push('Revisá los kg de ' + dudosas.join(', ') + ' contra la factura (no se pudo controlar con precio e importe).');
  return { nroFactura: nroFactura, fecha: fecha, lineas: lineas, observaciones: obs.join(' ') };
}


/** true si a y b difieren en exactamente un carácter (cambiado, agregado o quitado). */
function co2_distanciaUno_(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  var i = 0, j = 0, dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++dif > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return dif + (a.length - i) + (b.length - j) === 1;
}


function co2_sinAcentos_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}


/** Sugiere el depósito comparando el texto de la plaza con plaza_linde, nombre y dirección del depósito. */
function co2_sugerirDeposito_(plazaTexto, depositos) {
  var t = co2_sinAcentos_(plazaTexto);
  if (!t) return '';
  var candidatos = Object.keys(depositos).filter(function (id) {
    var d = depositos[id];
    return [d.plaza, d.nombre].some(function (x) { var k = co2_sinAcentos_(x); return k && t.indexOf(k) >= 0; });
  });
  return candidatos.length === 1 ? candidatos[0] : '';
}


export { co2_PATRON_SERIE_PDF, co2_seccionDeRenglon_, co2_fechasDeRenglon_, co2_parsearRemitoLinde_, co2_parsearFacturaLinde_, co2_distanciaUno_, co2_sinAcentos_, co2_sugerirDeposito_ };
