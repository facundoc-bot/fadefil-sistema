// =============================================================================
//  SISTEMA FADEFIL · Carga masiva desde Excel (antes Importacion.gs v1.4).
//  La app lee el Excel (hojas maquinas, clientes, comodato, componentes, cilindros,
//  stock) y manda las filas. Acá se valida todo con el motor, sin guardar, y se
//  devuelve el resultado de cada fila con la operación lista para guardar:
//  cada cliente entra con su OT de Alta inicial (mismas reglas que la app).
//  Guardar: la app manda las máquinas (importarMaquinas) y después las operaciones
//  en tandas, por el camino de siempre (guardar / co2_guardar).
// =============================================================================
import {
  simularLote, normalizarSerie, normalizarCodigo, esFechaValida, fechaTexto, EST_CLI_TEXTO, EST_MAQ, UBIC, depositoCentral
} from './motor.js';
import { co2_simularLote, co2_ESTADO } from './co2_motor.js';
import { simularLotePreparado_ } from './carga.js';
import { contexto, cargarEstado } from './estado.js';
import { co2Contexto } from './co2_estado.js';
import { ErrorDeUsuario, exigirRol, insertar, anotar, BLOQUEO, hoyArgentina } from './base.js';

export const HOJAS_IMPORTACION = {
  maquinas: ['serie', 'modelo', 'fecha_ingreso'],
  clientes: ['cliente_id', 'nombre_fantasia', 'razon_social_cuit', 'sector', 'tipo_cliente', 'modalidad', 'plaza', 'zona', 'esquema_mant', 'comentarios',
    'estado', 'serie', 'modelo', 'fecha_instalacion', 'ultimo_mantenimiento', 'ultima_visita', 'fecha_desinstalacion', 'sistema', 'prefiltro'],
  comodato: ['cliente_id', 'codigo', 'cantidad'],
  componentes: ['cliente_id', 'codigo', 'ultimo_cambio'],
  cilindros: ['cliente_id', 'serie', 'peso_kg'],
  stock: ['deposito', 'codigo', 'cantidad']
};
const ESTADOS = { 'Activo': 'ACTIVO', 'Desinstalado momentáneo': 'DESINSTALADO_MOMENTANEO', 'Ex cliente': 'EX_CLIENTE' };
const FECHA_INGRESO_DEFECTO = '2015-01-01';

const texto = (v) => String(v == null ? '' : v).trim();
/** Fecha de una celda: AAAA-MM-DD, DD/MM/AAAA o número de serie de Excel. '' si está vacía; 'INVALIDA:…' si no se entiende. */
function fecha(v) {
  if (v === '' || v == null) return '';
  let s = texto(v), m;
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(s)) * 86400000);
    s = d.toISOString().slice(0, 10);
  } else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) s = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) s = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return esFechaValida(s) ? s : 'INVALIDA:' + texto(v);
}
/** Filas de una hoja (las vacías se saltean). Cada fila conserva su número en el Excel (_fila). */
function filas(hojas, h) {
  return ((hojas && hojas[h]) || []).map((r, i) => ({ _fila: r._fila || i + 2, ...r }))
    .filter((r) => Object.keys(r).some((k) => k !== '_fila' && texto(r[k]) !== ''));
}

function armarMaquinas(hojas, ctx, hoy) {
  const vistas = {};
  return filas(hojas, 'maquinas').map((r) => {
    const serie = normalizarSerie(r.serie), x = { hoja: 'maquinas', fila: r._fila, serie, modelo: texto(r.modelo), fecha: fecha(r.fecha_ingreso), errores: [], avisos: [], omitida: '' };
    if (!serie) { x.errores.push('Falta la serie.'); return x; }
    const previa = vistas[serie];
    vistas[serie] = previa || x;
    if (ctx.maquinas[serie]) { x.omitida = 'YA CARGADA'; x.avisos.push('Ya está en máquinas: no se vuelve a cargar. Las fechas de los clientes se comparan con su fecha de alta (' + fechaTexto(ctx.maquinas[serie].fechaAlta) + ').'); return x; }
    if (x.modelo && !ctx.modelos[x.modelo]) x.errores.push('El modelo "' + x.modelo + '" no existe en Datos → Modelos.');
    else if (!x.modelo) x.errores.push('Falta el modelo.');
    if (!x.fecha) { x.fecha = FECHA_INGRESO_DEFECTO; x.avisos.push('Sin fecha de ingreso: se toma ' + fechaTexto(FECHA_INGRESO_DEFECTO) + '.'); }
    else if (String(x.fecha).indexOf('INVALIDA:') === 0) { x.errores.push('Fecha de ingreso inválida: "' + x.fecha.slice(9) + '" (usá AAAA-MM-DD o DD/MM/AAAA).'); x.fecha = ''; }
    else if (x.fecha > hoy) x.errores.push('La fecha de ingreso es posterior a hoy.');
    if (previa) {
      if (previa.modelo === x.modelo && previa.fecha === x.fecha) { x.omitida = 'REPETIDA'; x.errores = []; x.avisos = ['Repetida: ya está en la fila ' + previa.fila + ' (se carga esa).']; }
      else x.errores.push('La serie ' + serie + ' está dos veces en la hoja con datos distintos (filas ' + previa.fila + ' y ' + r._fila + ').');
    }
    if (!x.errores.length && !x.omitida) x.op = { clase: 'MAQUINA', datos: { serie, modelo: x.modelo, fechaIngreso: x.fecha } };
    return x;
  });
}

/** Una OT de Alta inicial por cliente. Devuelve también los errores de forma (antes del motor). */
function armarClientes(hojas, ctx, hoy, seriesHoja) {
  const porCliente = (h) => { const m = {}; filas(hojas, h).forEach((r) => { const id = texto(r.cliente_id); (m[id] = m[id] || []).push(r); }); return m; };
  const comodato = porCliente('comodato'), componentes = porCliente('componentes');
  const vistos = {};
  return filas(hojas, 'clientes').map((r) => {
    const id = texto(r.cliente_id), errores = [];
    const x = { hoja: 'clientes', fila: r._fila, id, errores, avisos: [], op: null, omitida: '' };
    if (!id) errores.push('Falta cliente_id.');
    else if (vistos[id]) errores.push('El cliente ' + id + ' está dos veces en la hoja (filas ' + vistos[id] + ' y ' + r._fila + ').');
    vistos[id] = vistos[id] || r._fila;
    if (id && ctx.clientes[id] && !errores.length) { x.omitida = 'YA CARGADO'; x.avisos.push('El cliente ' + id + ' ya está cargado (' + ctx.clientes[id].nombre + '): no se vuelve a cargar.'); return x; }
    const estadoTxt = texto(r.estado), serie = normalizarSerie(r.serie);
    const estado = estadoTxt ? (ESTADOS[estadoTxt] || ESTADOS[Object.keys(ESTADOS).find((k) => k.toUpperCase() === estadoTxt.toUpperCase())] || (EST_CLI_TEXTO[estadoTxt.toUpperCase()] ? estadoTxt.toUpperCase() : '')) : (serie ? 'ACTIVO' : '');
    if (!estado) errores.push(estadoTxt ? 'El estado "' + estadoTxt + '" no existe: Activo, Desinstalado momentáneo o Ex cliente.' : 'Falta el estado (o la serie, si está activo).');
    const fechas = { fechaInstalacion: fecha(r.fecha_instalacion), fechaBase: fecha(r.ultimo_mantenimiento), fechaUltimaVisita: fecha(r.ultima_visita), fechaDesinstalacion: fecha(r.fecha_desinstalacion) };
    Object.keys(fechas).forEach((k) => {
      if (String(fechas[k]).indexOf('INVALIDA:') === 0) { errores.push('Fecha inválida: "' + fechas[k].slice(9) + '" (usá AAAA-MM-DD o DD/MM/AAAA).'); fechas[k] = ''; }
      else if (fechas[k] && fechas[k] > hoy) { errores.push('La fecha ' + fechaTexto(fechas[k]) + ' es posterior a hoy.'); fechas[k] = ''; }
    });
    const sistema = texto(r.sistema), prefiltro = texto(r.prefiltro);
    [[sistema, 'SISTEMA', 'El sistema'], [prefiltro, 'PREFILTRO', 'El prefiltro']].forEach((s) => {
      if (s[0] && (!ctx.sistemas[s[0]] || ctx.sistemas[s[0]].tipo !== s[1])) errores.push(s[2] + ' "' + s[0] + '" no está en la lista (o le faltan códigos en Datos → Sistemas de purificación).');
    });
    const fechasSistema = {}, fechasPrefiltro = {};
    (componentes[id] || []).forEach((c) => {
      const cod = normalizarCodigo(c.codigo), f = fecha(c.ultimo_cambio);
      if (!cod) return;
      if (!f || String(f).indexOf('INVALIDA:') === 0 || f > hoy) { errores.push('componentes (fila ' + c._fila + '): la fecha del último cambio de ' + cod + ' no es válida.'); return; }
      const en = (n) => n && ctx.sistemas[n] && ctx.sistemas[n].comps.some((k) => k.codigo === cod);
      if (en(sistema)) fechasSistema[cod] = f;
      else if (en(prefiltro)) fechasPrefiltro[cod] = f;
      else errores.push('componentes (fila ' + c._fila + '): ' + cod + ' no es un componente de ' + (sistema || 'su sistema') + (prefiltro ? ' ni de ' + prefiltro : '') + '.');
    });
    const items = [];
    (comodato[id] || []).forEach((c) => {
      const cod = normalizarCodigo(c.codigo), n = Number(c.cantidad);
      if (!cod && !c.cantidad) return;
      if (!cod || !(n > 0)) { errores.push('comodato (fila ' + c._fila + '): falta el código o la cantidad.'); return; }
      items.push({ codigo: cod, cantidad: n, mov: 'ENTREGADO' });
    });
    const zonaTxt = texto(r.zona), plazaTxt = texto(r.plaza);
    if (!texto(r.nombre_fantasia)) errores.push('Falta nombre_fantasia.');
    if (!zonaTxt) errores.push('Falta la zona.');
    else if (!ctx.zonas[zonaTxt]) errores.push('La zona "' + zonaTxt + '" no existe en Datos → Zonas.');
    if (plazaTxt && !ctx.plazas[plazaTxt]) errores.push('La plaza "' + plazaTxt + '" no existe en Datos → Plazas.');
    else if (plazaTxt && ctx.zonas[zonaTxt] && ctx.zonas[zonaTxt].plaza !== plazaTxt) errores.push('La zona "' + zonaTxt + '" es de la plaza ' + ctx.zonas[zonaTxt].plaza + ', no de ' + plazaTxt + '.');
    const esquema = texto(r.esquema_mant).toUpperCase();
    const d = {
      fecha: hoy, tipo: 'ALTA_INICIAL', estadoInicial: estado || 'ACTIVO', serieInstalada: estado === 'ACTIVO' ? serie : '',
      sistema, prefiltro, fechasSistema, fechasPrefiltro, items, comentarios: 'Carga masiva (importación)',
      clienteNuevo: { id, nombre: texto(r.nombre_fantasia), razon: texto(r.razon_social_cuit), sector: texto(r.sector), tipoCliente: texto(r.tipo_cliente),
        modalidad: texto(r.modalidad), zonaId: zonaTxt, esquemaMant: esquema, comentarios: texto(r.comentarios) }
    };
    if (estado !== 'ACTIVO' && serie) errores.push('Un cliente que no está activo no lleva serie instalada.');
    if (fechas.fechaInstalacion) d.fechaInstalacion = fechas.fechaInstalacion;
    if (fechas.fechaBase) d.fechaBase = fechas.fechaBase;
    if (fechas.fechaUltimaVisita) { d.fechaUltimaVisita = fechas.fechaUltimaVisita; d.tipoUltimaVisita = 'MANTENIMIENTO'; }
    if (fechas.fechaDesinstalacion) d.fechaDesinstalacion = fechas.fechaDesinstalacion;
    if (d.serieInstalada) {
      const z = ctx.zonas[zonaTxt], p = z ? ctx.plazas[z.plaza] : null, dep = p ? p.deposito : '';
      const m = ctx.estado.maquinas[d.serieInstalada], mq = ctx.maquinas[d.serieInstalada];
      if (!seriesHoja[d.serieInstalada] && !mq) errores.push('La serie ' + d.serieInstalada + ' no está cargada ni figura en la hoja maquinas: agregala (con modelo y fecha de ingreso).');
      else if (!mq) errores.push('La serie ' + d.serieInstalada + ' tiene un error en la hoja maquinas: corregí esa fila.');
      else {
        if (texto(r.modelo) && mq.modelo && texto(r.modelo) !== mq.modelo) errores.push('El modelo "' + texto(r.modelo) + '" no coincide con el de la serie ' + d.serieInstalada + ' (' + mq.modelo + ').');
        [['fechaInstalacion', 'La fecha de instalación'], ['fechaBase', 'El último mantenimiento'], ['fechaUltimaVisita', 'La última visita']].forEach((f) => {
          if (d[f[0]] && mq.fechaAlta && d[f[0]] < mq.fechaAlta) errores.push(f[1] + ' (' + fechaTexto(d[f[0]]) + ') es anterior al ingreso de la serie ' + d.serieInstalada + ' (' + fechaTexto(mq.fechaAlta) + ').');
        });
      }
      if (mq && m && dep && !(m.ubicTipo === UBIC.DEPOSITO && m.ubicId === dep)) {
        d.traerMaquina = true;
        if (m.ubicTipo !== UBIC.CLIENTE) x.avisos.push('La serie ' + d.serieInstalada + ' figura en ' + m.ubicId + ': se registran el envío al ' + dep + ' y su recepción.');
      }
    }
    x.op = { clase: 'OT', datos: d };
    return x;
  });
}

function armarCilindros(hojas, cctx, clientesOk, hoy) {
  return filas(hojas, 'cilindros').map((r) => {
    const id = texto(r.cliente_id), x = { hoja: 'cilindros', fila: r._fila, id, errores: [], avisos: [], op: null };
    const cli = cctx.clientes[id];
    if (!id || !cli) { x.errores.push('El cliente ' + (id || '(vacío)') + ' no existe ni está en la hoja clientes.'); return x; }
    if (!clientesOk[id]) { x.errores.push('Su cliente tiene un error en la hoja clientes: corregilo primero.'); return x; }
    x.op = { clase: 'ALTA', datos: { fecha: hoy, serie: texto(r.serie), pesoKg: Number(r.peso_kg) || '', idDepositoOrigen: cli.depositoId, ubicacion: 'CLIENTE', idCliente: id,
      estado: co2_ESTADO.EN_USO, observaciones: 'Carga masiva (importación)' } };
    return x;
  });
}

function armarStock(hojas, hoy) {
  return filas(hojas, 'stock').map((r) => {
    const x = { hoja: 'stock', fila: r._fila, errores: [], avisos: [], op: null };
    const n = Number(r.cantidad);
    if (!(n > 0)) x.errores.push('La cantidad tiene que ser mayor que cero.');
    x.op = { clase: 'AJUSTE', datos: { fecha: hoy, deposito: texto(r.deposito), codigo: normalizarCodigo(r.codigo), cantidad: n, saldo: 'DISPONIBLE', tipo: 'INVENTARIO', motivo: 'Stock inicial (importación)' } };
    return x;
  });
}

const resultado = (x) => ({ hoja: x.hoja, fila: x.fila, resultado: x.errores.length ? 'ERROR' : x.omitida || (x.avisos.length ? 'OK con avisos' : 'OK'),
  detalle: (x.errores.length ? x.errores : x.avisos).join(' | '), op: x.errores.length || x.omitida ? null : x.op || null, serie: x.serie, modelo: x.modelo, fechaIngreso: x.fecha, id: x.id });

/** Valida todo el Excel sin guardar nada. Devuelve el resultado de cada fila y las operaciones listas para guardar. */
export async function importarValidar(sql, u, hojas) {
  exigirRol(u, ['ADMIN']);
  const hoy = hoyArgentina();
  const ctx = await contexto(sql);
  ctx.estado = (await cargarEstado(sql, ctx, { clientes: [] })).W;
  const maqs = armarMaquinas(hojas, ctx, hoy);
  const seriesHoja = {};
  maqs.forEach((x) => {
    if (x.serie) seriesHoja[x.serie] = true;
    if (x.omitida || x.errores.length) return; // las de la hoja, como si ya estuvieran cargadas: nuevas en el central
    ctx.maquinas[x.serie] = { serie: x.serie, modelo: x.modelo, fechaAlta: x.fecha, depositoInicial: depositoCentral() };
    ctx.estado.maquinas[x.serie] = { serie: x.serie, estado: EST_MAQ.NUEVA, ubicTipo: UBIC.DEPOSITO, ubicId: depositoCentral(), ultimaFecha: x.fecha, ingresoAbierto: '', paraCaba: false };
  });
  const cli = armarClientes(hojas, ctx, hoy, seriesHoja);
  const pend = cli.filter((x) => x.op && !x.errores.length);
  if (pend.length) {
    const p = simularLotePreparado_(pend.map((x) => JSON.parse(JSON.stringify(x.op))), ctx);
    pend.forEach((x, i) => {
      const res = p.porOriginal[i] || { errores: [], advertencias: [] };
      res.errores.forEach((e) => x.errores.push(e.mensaje));
      res.advertencias.forEach((e) => { if (x.avisos.indexOf(e.mensaje) < 0) x.avisos.push(e.mensaje); });
    });
  }
  const okIds = {};
  cli.forEach((x) => { if ((x.op && !x.errores.length) || x.omitida) okIds[x.id] = true; });
  const cctx = await co2Contexto(sql);
  cli.forEach((x) => {
    if (!x.op || cctx.clientes[x.id]) return;
    const z = ctx.zonas[x.op.datos.clienteNuevo.zonaId], p = z ? ctx.plazas[z.plaza] : null;
    cctx.clientes[x.id] = { id: x.id, nombre: x.op.datos.clienteNuevo.nombre, zonaId: z ? z.id : '', plazaId: p ? p.plaza : '', regionId: p ? p.region : '', depositoId: p ? p.deposito : '', activo: true };
  });
  const cil = armarCilindros(hojas, cctx, okIds, hoy);
  const pc = cil.filter((x) => x.op && !x.errores.length);
  if (pc.length) {
    const sc = co2_simularLote(pc.map((x) => x.op), cctx);
    pc.forEach((x, i) => sc.resultados[i].errores.forEach((e) => x.errores.push(e.mensaje)));
  }
  const stock = armarStock(hojas, hoy);
  const ps = stock.filter((x) => x.op && !x.errores.length);
  if (ps.length) {
    const s2 = simularLote(ps.map((x) => JSON.parse(JSON.stringify(x.op))), ctx);
    ps.forEach((x, i) => s2.resultados[i].errores.forEach((e) => x.errores.push(e.mensaje)));
  }
  const filasRes = [...maqs, ...cli, ...cil, ...stock].map(resultado);
  const cuenta = (h) => {
    const l = filasRes.filter((x) => x.hoja === h);
    return { total: l.length, ok: l.filter((x) => x.op).length, error: l.filter((x) => x.resultado === 'ERROR').length, omitidas: l.filter((x) => !x.op && x.resultado !== 'ERROR').length };
  };
  const resumen = {};
  Object.keys(HOJAS_IMPORTACION).filter((h) => h !== 'comodato' && h !== 'componentes').forEach((h) => { resumen[h] = cuenta(h); });
  return { filas: filasRes, resumen, errores: filasRes.filter((x) => x.resultado === 'ERROR').length };
}

/** Da de alta en el depósito central las máquinas de la hoja que validaron bien. */
export async function importarMaquinas(sql, u, maquinas) {
  exigirRol(u, ['ADMIN']);
  const lista = (maquinas || []).map((m) => (m && m.op && m.op.datos) || (m && m.datos) || m).map((m) => ({ serie: normalizarSerie(m.serie), modelo: texto(m.modelo), fecha_alta: m.fechaIngreso, deposito_inicial_id: depositoCentral() || 'Depósito CABA', comentarios: 'Carga masiva (importación)' }));
  if (!lista.length) return { cargadas: 0 };
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BLOQUEO})`;
    const [central] = await tx`select valor from config where clave = 'DEPOSITO_CENTRAL'`;
    lista.forEach((m) => { m.deposito_inicial_id = (central && central.valor) || 'Depósito CABA'; });
    const ya = new Set((await tx`select serie from maquinas where serie = any(${lista.map((m) => m.serie)})`).map((r) => r.serie));
    const nuevas = lista.filter((m) => !ya.has(m.serie) && esFechaValida(m.fecha_alta));
    await insertar(tx, 'maquinas', nuevas);
    await anotar(tx, u.email, 'IMPORTAR_MAQUINAS', nuevas.length + ' máquinas');
    return { cargadas: nuevas.length };
  });
}

export function importarPlantilla() {
  return HOJAS_IMPORTACION;
}

export { ErrorDeUsuario };
