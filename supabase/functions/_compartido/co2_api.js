// =============================================================================
//  SISTEMA FADEFIL · Lo que pide la pantalla de CO₂ (antes co2_WebApp.gs).
//  Mismos nombres y respuestas que en Sheets (sin el prefijo co2_). El PDF lo sube y
//  lo lee el navegador: acá llega el texto y la ruta del archivo ya guardado.
// =============================================================================
import {
  co2_ESTADO, co2_ESTADO_TEXTO, co2_UBIC, co2_normalizarSerie, co2_analizarRecambios, co2_detectarAlertas, co2_diasEntre, co2_nombreProveedor_, co2_PROVEEDOR_DEFECTO
} from './co2_motor.js';
import { co2_parsearRemitoLinde_, co2_parsearFacturaLinde_, co2_PATRON_SERIE_PDF } from './co2_pdf.js';
import {
  co2Contexto, co2Validar, co2Guardar, co2EnviarAprobacion, co2RechazarPendiente, co2ValidarFactura, co2GuardarFactura, co2AnularFactura, co2Anular,
  rutaArchivo, urlArchivo, cilindroParaApp, movDeFila
} from './co2_estado.js';
import { ErrorDeUsuario, exigirRol, iso, anotar } from './base.js';

export const VERSION_CO2 = '3.0';

const nomProv = (ctx, id) => co2_nombreProveedor_(ctx, id || co2_PROVEEDOR_DEFECTO);
function ubicacionLegible(ctx, tipo, id) {
  if (tipo === co2_UBIC.INVENTARIO) return 'Inventario inicial';
  if (tipo === co2_UBIC.DEPOSITO) return ctx.depositos[id] ? 'Depósito ' + ctx.depositos[id].nombre : 'Depósito inexistente: ' + id;
  if (tipo === co2_UBIC.CLIENTE) return ctx.clientes[id] ? ctx.clientes[id].nombre + ' (' + id + ')' : 'Cliente inexistente: ' + id;
  if (tipo === co2_UBIC.LINDE) return nomProv(ctx, id);
  return id || '';
}

async function inicio(sql, u) {
  const ctx = await co2Contexto(sql);
  const cilindros = [], pesos = {};
  Object.values(ctx.cilindros).forEach((c) => { if (c.pesoKg) pesos[c.serie] = c.pesoKg; if (c.estado !== co2_ESTADO.LINDE) cilindros.push(cilindroParaApp(c)); });
  const [{ n }] = await sql`select count(*)::int n from co2_remitos where estado = 'PENDIENTE_APROBACION'`;
  const [plazas, zonas] = await Promise.all([sql`select plaza_id, region_id, deposito_id, activa, proveedor_co2 from plazas`, sql`select zona_id, plaza_id, activa from zonas`]);
  const porNombre = (a, b) => String(a.nombre).localeCompare(String(b.nombre));
  return {
    usuario: u, hoy: ctx.hoy, version: VERSION_CO2, urlApp: 'index.html',
    regiones: Object.values(ctx.regiones),
    plazas: plazas.map((p) => ({ id: p.plaza_id, nombre: p.plaza_id, regionId: p.region_id, depositoId: p.deposito_id, activa: p.activa, proveedor: p.proveedor_co2 || co2_PROVEEDOR_DEFECTO })),
    proveedores: Object.values(ctx.proveedores),
    zonas: zonas.map((z) => ({ id: z.zona_id, nombre: z.zona_id, plazaId: z.plaza_id, activa: z.activa })),
    depositos: Object.values(ctx.depositos).sort(porNombre), clientes: Object.values(ctx.clientes).sort(porNombre),
    cilindros, pesos, cargas: ctx.cargasValidas,
    cargaInicial: { activa: false, pendientes: 0, conError: 0, procesados: 0, series: [] },
    pendientesAprobacion: n, iaDisponible: false, iaOrigen: '', iaFinal: '', iaHayCompartida: false, estados: co2_ESTADO_TEXTO
  };
}

/** Propone los datos del remito a partir del texto del PDF (lo extrae el navegador). */
async function leerRemito(sql, u, x) {
  exigirRol(u, ['ADMIN', 'CARGA']);
  const archivo = (x && x.archivo) || {}, texto = String((x && x.texto) || '');
  if (!texto.trim()) {
    return { ok: false, archivo, motivo: 'SIN_TEXTO', texto: '',
      mensaje: 'No se encontró texto en el archivo (¿es una foto o un escaneo?). El archivo quedó guardado: cargá los datos a mano.' };
  }
  const ctx = await co2Contexto(sql);
  const r = co2_parsearRemitoLinde_(texto, { depositos: ctx.depositos, cilindros: ctx.cilindros, cargas: ctx.cargasValidas, hoy: ctx.hoy,
    patron: ctx.config.PATRON_SERIE_PDF || co2_PATRON_SERIE_PDF });
  r.archivoUrl = archivo.url || ''; r.archivoHash = archivo.hash || ''; r.origenCarga = 'PDF';
  await anotar(sql, u.email, 'LEER_REMITO_PDF', archivo.nombre || '', 'OK ' + r.lineas.length + ' líneas');
  return { ok: true, archivo, remito: r, texto: texto.slice(0, 20000) };
}

async function leerFactura(sql, u, x) {
  exigirRol(u, ['ADMIN', 'CARGA']);
  const archivo = (x && x.archivo) || {}, texto = String((x && x.texto) || '');
  if (!texto.trim()) return { ok: false, archivo, texto: '', mensaje: 'No se encontró texto en el archivo. El archivo quedó guardado: cargá los datos a mano.' };
  const r = co2_parsearFacturaLinde_(texto, { hoy: (await co2Contexto(sql)).hoy });
  r.archivoUrl = archivo.url || ''; r.archivoHash = archivo.hash || '';
  return { ok: true, archivo, factura: r, texto: texto.slice(0, 20000) };
}

async function fichaSerie(sql, serie) {
  const s = co2_normalizarSerie(serie);
  const ctx = await co2Contexto(sql);
  const movs = (await sql`select * from co2_movimientos where serie = ${s} order by orden`).map(movDeFila);
  const circuitos = (await sql`select * from co2_circuitos where serie = ${s} order by fecha_inicio`).map((c) => ({ idCircuito: c.circuito_id, serie: c.serie, depOrigen: c.deposito_origen_id,
    fechaInicio: iso(c.fecha_inicio), refEntrada: c.ref_entrada, fechaCierre: iso(c.fecha_cierre), refSalida: c.ref_salida, estado: c.estado }));
  const e = ctx.cilindros[s] || null;
  return {
    serie: s, existe: movs.length > 0,
    estado: e ? { estado: e.estado, ubicacion: ubicacionLegible(ctx, e.ubicTipo, e.ubicTipo === co2_UBIC.LINDE ? e.proveedor : e.ubicId), depOrigen: ubicacionLegible(ctx, 'DEPOSITO', e.depOrigen), idCircuito: e.idCircuito,
      ultimaFecha: e.ultimaFecha, pesoKg: e.pesoKg, proveedor: e.proveedor, proveedorNombre: nomProv(ctx, e.proveedor) } : null,
    circuitos,
    movimientos: movs.map((m) => ({ idMov: m.idMov, fecha: m.fecha, tipoMov: m.tipoMov, origen: ubicacionLegible(ctx, m.origenTipo, m.origenId), destino: ubicacionLegible(ctx, m.destinoTipo, m.destinoId),
      estadoNuevo: m.estadoNuevo, idCircuito: m.idCircuito, refId: m.refId, anulado: m.anulado }))
  };
}

async function lineasDeTrabajos(sql, ids) {
  const out = {};
  ids.forEach((id) => { out[id] = { ENTREGA: [], RETIRO: [] }; });
  if (ids.length) (await sql`select trabajo_id, tipo, serie from co2_trabajo_lineas where trabajo_id = any(${ids}) order by linea_id`).forEach((l) => { out[l.trabajo_id][l.tipo].push(l.serie); });
  return out;
}

async function fichaCliente(sql, idCliente) {
  const ctx = await co2Contexto(sql);
  const cli = ctx.clientes[idCliente];
  if (!cli) throw new ErrorDeUsuario('Cliente inexistente.');
  const series = Object.values(ctx.cilindros).filter((c) => c.ubicTipo === co2_UBIC.CLIENTE && c.ubicId === String(idCliente)).map((c) => c.serie).sort();
  const trabajos = await sql`select * from co2_trabajos where cliente_id = ${String(idCliente)} order by fecha desc, trabajo_id desc limit 20`;
  const l = await lineasDeTrabajos(sql, trabajos.map((t) => t.trabajo_id));
  return { cliente: cli, series, trabajos: trabajos.map((t) => ({ id: t.trabajo_id, fecha: iso(t.fecha), tipo: t.tipo, entregadas: l[t.trabajo_id].ENTREGA.join(', '), retiradas: l[t.trabajo_id].RETIRO.join(', '), estado: t.estado })) };
}

async function recientes(sql) {
  const N = 40;
  const ctx = await co2Contexto(sql);
  const ops = [];
  const remitos = await sql`select r.*, (select count(*)::int from co2_remito_lineas l where l.remito_id = r.remito_id and l.tipo = 'ENTREGA') as entregas,
      (select count(*)::int from co2_remito_lineas l where l.remito_id = r.remito_id and l.tipo = 'RETIRO') as retiros
    from co2_remitos r where estado in ('CONFIRMADO', 'ANULADO') order by created_at desc limit ${N}`;
  remitos.forEach((r) => {
    const d = ctx.depositos[r.deposito_id];
    ops.push({ id: r.remito_id, clase: 'Remito ' + nomProv(ctx, r.proveedor), fecha: iso(r.fecha), detalle: 'N° ' + r.nro_remito + ' · ' + (d ? d.nombre : r.deposito_id) + ' · ' + r.entregas + ' entregados, ' + r.retiros + ' retirados',
      estado: r.estado, por: r.created_by, carga: new Date(r.confirmado_at || r.created_at).toISOString(), url: urlArchivo(r.archivo_ruta) });
  });
  const trabajos = await sql`select * from co2_trabajos order by created_at desc limit ${N}`;
  const l = await lineasDeTrabajos(sql, trabajos.map((t) => t.trabajo_id));
  trabajos.forEach((t) => {
    const x = l[t.trabajo_id], c = ctx.clientes[t.cliente_id];
    ops.push({ id: t.trabajo_id, clase: 'Trabajo ' + String(t.tipo).toLowerCase(), fecha: iso(t.fecha),
      detalle: (c ? c.nombre : t.cliente_id) + (x.ENTREGA.length ? ' · entrega ' + x.ENTREGA.join(', ') : '') + (x.RETIRO.length ? ' · retira ' + x.RETIRO.join(', ') : ''),
      estado: t.estado, por: t.created_by, carga: new Date(t.created_at).toISOString() });
  });
  (await sql`select * from co2_altas order by created_at desc limit ${N}`).forEach((a) => {
    const d = ctx.depositos[a.deposito_origen_id], c = ctx.clientes[a.cliente_id];
    ops.push({ id: a.alta_id, clase: 'Inventario inicial', fecha: iso(a.fecha), detalle: a.serie + ' · ' + (a.ubicacion === 'CLIENTE' ? (c ? c.nombre : a.cliente_id) : 'depósito ' + (d ? d.nombre : a.deposito_origen_id)),
      estado: a.estado, por: a.created_by, carga: new Date(a.created_at).toISOString() });
  });
  return ops.sort((a, b) => (a.carga < b.carga ? 1 : a.carga > b.carga ? -1 : 0)).slice(0, 60);
}

async function inconsistencias(sql) {
  return (await sql`select * from co2_inconsistencias where estado <> 'RESUELTA' order by detectada_at desc`)
    .map((r) => ({ id: r.inconsistencia_id, fecha: r.detectada_at, codigo: r.codigo, serie: r.serie, ref: r.ref_id, detalle: r.detalle }));
}
async function resolverInconsistencia(sql, u, id, resolucion) {
  exigirRol(u, ['ADMIN', 'CARGA']);
  if (!resolucion || String(resolucion).trim().length < 5) throw new ErrorDeUsuario('Escribí cómo se resolvió.');
  const [r] = await sql`update co2_inconsistencias set estado = 'RESUELTA', resolucion = ${String(resolucion) + ' — ' + u.email}, usuario = ${u.email}
    where inconsistencia_id = ${String(id)} returning inconsistencia_id`;
  if (!r) throw new ErrorDeUsuario('No se encontró ' + id);
  await anotar(sql, u.email, 'CO2_RESOLVER_INC', id, resolucion);
  return true;
}

async function listarFacturas(sql) {
  const lineas = {};
  (await sql`select * from co2_factura_lineas order by linea_id`).forEach((l) => {
    (lineas[l.factura_id] = lineas[l.factura_id] || []).push({ nroRemito: l.nro_remito, kgFactura: l.kg_factura, kgSistema: l.kg_sistema, resultado: l.resultado, detalle: l.detalle, remitoId: l.remito_id });
  });
  const ctx = await co2Contexto(sql);
  return (await sql`select * from co2_facturas order by fecha desc, factura_id desc`).map((f) => ({ id: f.factura_id, nro: f.nro_factura, fecha: iso(f.fecha), totalKg: f.total_kg,
    proveedor: f.proveedor, proveedorNombre: nomProv(ctx, f.proveedor),
    estado: f.estado, resumen: f.resumen, archivoUrl: urlArchivo(f.archivo_ruta), cargadaPor: f.created_by, observaciones: f.observaciones, lineas: lineas[f.factura_id] || [] }));
}

const textoComposicion = (c) => Object.keys(c || {}).map(Number).sort((a, b) => b - a).map((kg) => c[kg] + ' × ' + (kg || '¿?') + ' kg').join(' + ');
/** Resumen de remitos confirmados: entregas, retiros, kg entregados y en qué factura están. */
async function resumenRemitos(sql, f) {
  f = f || {};
  const kgs = {};
  (await sql`select ref_id, tipo, peso_kg from co2_movimientos where not anulado and tipo in ('ENTREGA_LINDE', 'RETIRO_LINDE')`).forEach((m) => {
    const r = kgs[m.ref_id] = kgs[m.ref_id] || { entregas: 0, retiros: 0, kg: 0, composicion: {} };
    if (m.tipo === 'RETIRO_LINDE') { r.retiros++; return; }
    const kg = Number(m.peso_kg) || 0; r.entregas++; r.kg += kg; r.composicion[kg] = (r.composicion[kg] || 0) + 1;
  });
  const fac = {};
  (await sql`select l.remito_id, l.resultado, l.kg_factura, f.factura_id, f.nro_factura, f.fecha from co2_factura_lineas l join co2_facturas f using (factura_id)
    where f.estado <> 'ANULADA' and l.remito_id is not null and l.resultado <> 'YA_FACTURADO'`).forEach((x) => {
    fac[x.remito_id] = { facturaId: x.factura_id, nroFactura: x.nro_factura, fecha: iso(x.fecha), resultado: x.resultado, kgFactura: x.kg_factura };
  });
  const filas = [];
  const tot = { remitos: 0, entregas: 0, retiros: 0, kg: 0, composicion: {}, kgFacturadoValidado: 0, sinFacturar: 0, kgSinFacturar: 0 };
  const ctx = await co2Contexto(sql);
  (await sql`select remito_id, nro_remito, fecha, deposito_id, archivo_ruta, proveedor from co2_remitos where estado = 'CONFIRMADO'`).forEach((r) => {
    const fecha = iso(r.fecha);
    if (f.proveedor && r.proveedor !== f.proveedor) return;
    if (f.desde && fecha < f.desde) return;
    if (f.hasta && fecha > f.hasta) return;
    if (f.deposito && r.deposito_id !== f.deposito) return;
    const fa = fac[r.remito_id] || null;
    if (f.facturacion === 'SIN_FACTURAR' && fa) return;
    if (f.facturacion === 'FACTURADOS' && !fa) return;
    const k = kgs[r.remito_id] || { entregas: 0, retiros: 0, kg: 0, composicion: {} };
    filas.push({ id: r.remito_id, nro: r.nro_remito, fecha, deposito: r.deposito_id, proveedor: r.proveedor, proveedorNombre: nomProv(ctx, r.proveedor), entregas: k.entregas, retiros: k.retiros, kg: k.kg,
      composicion: textoComposicion(k.composicion), archivoUrl: urlArchivo(r.archivo_ruta), factura: fa });
    tot.remitos++; tot.entregas += k.entregas; tot.retiros += k.retiros; tot.kg += k.kg;
    Object.keys(k.composicion).forEach((kg) => { tot.composicion[kg] = (tot.composicion[kg] || 0) + k.composicion[kg]; });
    if (fa && fa.resultado === 'VALIDADO') tot.kgFacturadoValidado += k.kg;
    if (!fa && k.kg > 0) { tot.sinFacturar++; tot.kgSinFacturar += k.kg; }
  });
  filas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : String(a.nro) < String(b.nro) ? -1 : 1));
  tot.composicionTexto = textoComposicion(tot.composicion);
  return { filas, totales: tot };
}

async function pendientesAprobacion(sql) {
  const rem = await sql`select * from co2_remitos where estado = 'PENDIENTE_APROBACION' order by fecha`;
  if (!rem.length) return [];
  const lineas = {};
  (await sql`select * from co2_remito_lineas where remito_id = any(${rem.map((r) => r.remito_id)}) order by linea_id`).forEach((l) => {
    const x = { tipo: l.tipo, serie: l.serie, pesoKg: l.peso_kg == null ? '' : Number(l.peso_kg), serieLeidaIA: l.serie_leida };
    if (String(l.revision || '').indexOf('DUDOSA') === 0) { x.dudosa = true; x.sugerida = l.revision.slice(7); }
    (lineas[l.remito_id] = lineas[l.remito_id] || []).push(x);
  });
  return rem.map((r) => ({ id: r.remito_id, fecha: iso(r.fecha), idDeposito: r.deposito_id, cargadoPor: r.created_by, cargadoEl: r.created_at,
    datos: { nroRemito: r.nro_remito, fecha: iso(r.fecha), idDeposito: r.deposito_id, proveedor: r.proveedor, tipoCopia: r.tipo_copia, plazaTexto: r.plaza_texto, origenCarga: r.origen_carga,
      archivoUrl: urlArchivo(r.archivo_ruta), archivoHash: r.archivo_hash, observaciones: r.observaciones, lineas: lineas[r.remito_id] || [] } }));
}

function alcanceFiltro(ctx, f) {
  f = f || {};
  let plazas = Object.values(ctx.plazas).filter((p) => (!f.regionId || p.regionId === f.regionId) && (!f.plazaId || p.id === f.plazaId));
  if (f.zonaId && ctx.zonas[f.zonaId]) plazas = plazas.filter((p) => p.id === ctx.zonas[f.zonaId].plazaId);
  const deps = {};
  plazas.forEach((p) => { if (p.depositoId) deps[p.depositoId] = true; });
  return { todo: !f.regionId && !f.plazaId && !f.zonaId, depositos: deps };
}

/** Saldo con cada proveedor por depósito y carga, con las series en nuestro poder (desde co2_circuitos). */
async function saldoLinde(sql, filtro) {
  const ctx = await co2Contexto(sql);
  const al = alcanceFiltro(ctx, filtro);
  const nros = {};
  (await sql`select remito_id, nro_remito from co2_remitos`).forEach((r) => { nros[r.remito_id] = r.nro_remito; });
  const cargas = ctx.cargasValidas.length ? ctx.cargasValidas : [''];
  const filas = {};
  const fila = (dep, peso, prov) => {
    const k = dep + '|' + prov + '|' + peso;
    if (!filas[k]) filas[k] = { depositoId: dep, nombre: ctx.depositos[dep] ? ctx.depositos[dep].nombre : 'Depósito inexistente: ' + dep, inexistente: !ctx.depositos[dep], pesoKg: peso,
      proveedor: prov, proveedorNombre: nomProv(ctx, prov), recibidos: 0, inicial: 0, devueltos: 0, enPoder: 0 };
    return filas[k];
  };
  const incluye = (dep) => al.todo || al.depositos[dep];
  // Proveedores de cada depósito: los de sus plazas (el Depósito CABA trabaja con LINDE y con Gases Nordelta).
  const provDep = {};
  Object.values(ctx.plazas).forEach((p) => { if (p.depositoId) (provDep[p.depositoId] = provDep[p.depositoId] || new Set()).add(p.proveedor || co2_PROVEEDOR_DEFECTO); });
  Object.keys(ctx.depositos).forEach((id) => { if (incluye(id)) [...(provDep[id] || [co2_PROVEEDOR_DEFECTO])].forEach((pr) => cargas.forEach((p) => fila(id, p, pr))); });
  const series = [];
  (await sql`select * from co2_circuitos`).forEach((c) => {
    const dep = c.deposito_origen_id;
    if (!incluye(dep)) return;
    const cil = ctx.cilindros[c.serie] || {}, f = fila(dep, cil.pesoKg || '', cil.proveedor || co2_PROVEEDOR_DEFECTO);
    const esInicial = String(c.ref_entrada).indexOf('INV-') === 0;
    if (esInicial) f.inicial++; else f.recibidos++;
    if (c.estado === 'CERRADO') { f.devueltos++; return; }
    f.enPoder++;
    series.push({ serie: c.serie, pesoKg: cil.pesoKg || '', proveedor: f.proveedor, proveedorNombre: f.proveedorNombre, depositoId: dep, deposito: f.nombre, inexistente: f.inexistente, ubicacion: ubicacionLegible(ctx, cil.ubicTipo, cil.ubicId).replace(/ \([^)]*\)$/, ''),
      estado: co2_ESTADO_TEXTO[cil.estado] || cil.estado || '', desde: iso(c.fecha_inicio), remito: esInicial ? 'Inventario inicial' : nros[c.ref_entrada] || c.ref_entrada, dias: co2_diasEntre(iso(c.fecha_inicio), ctx.hoy) });
  });
  series.sort((a, b) => String(a.deposito).localeCompare(String(b.deposito)) || b.dias - a.dias || (a.serie < b.serie ? -1 : 1));
  return { filas: Object.values(filas).sort((a, b) => a.inexistente - b.inexistente || String(a.nombre).localeCompare(String(b.nombre)) || String(a.proveedorNombre).localeCompare(String(b.proveedorNombre)) ||
    Number(a.pesoKg) - Number(b.pesoKg)), series };
}

async function recambios(sql, meses) {
  const ctx = await co2Contexto(sql);
  const movs = (await sql`select * from co2_movimientos where not anulado order by orden`).map(movDeFila);
  return co2_analizarRecambios(movs, { hoy: ctx.hoy, meses: Number(meses) || 0, cilindros: ctx.cilindros, clientes: ctx.clientes, mesesGrafico: 12 });
}

async function alertas(sql) {
  const ctx = await co2Contexto(sql);
  const diasCliente = Number(ctx.config.DIAS_INMOVILIZADO_CLIENTE || 60) || 0, diasVacio = Number(ctx.config.DIAS_VACIO_SIN_DEVOLVER || 30) || 0;
  return { diasCliente, diasVacio, alertas: co2_detectarAlertas(ctx.cilindros, { hoy: ctx.hoy, clientes: ctx.clientes, depositos: ctx.depositos, proveedores: ctx.proveedores, diasCliente, diasVacio }) };
}

const sinCargaInicial = () => { throw new ErrorDeUsuario('La carga inicial de remitos históricos en borrador no está en la app nueva: cargá cada remito normalmente o el inventario inicial.'); };

/** Despacho de lo que pide la pantalla de CO₂. */
export async function co2Api(sql, u, fn, args) {
  const a = Array.isArray(args) ? args : [];
  switch (fn) {
    case 'apiInicio': return inicio(sql, u);
    case 'apiValidar': return co2Validar(sql, u, a[0]);
    case 'apiConfirmar': return co2Guardar(sql, u, a[0]);
    case 'apiLeerRemitoPDF': return leerRemito(sql, u, a[0]);
    case 'apiLeerFacturaPDF': return leerFactura(sql, u, a[0]);
    case 'apiFichaSerie': return fichaSerie(sql, a[0]);
    case 'apiFichaCliente': return fichaCliente(sql, a[0]);
    case 'apiRecientes': return recientes(sql);
    case 'apiInconsistencias': return inconsistencias(sql);
    case 'apiResolverInconsistencia': return resolverInconsistencia(sql, u, a[0], a[1]);
    case 'apiAnular': return co2Anular(sql, u, a[0], a[1]);
    case 'apiValidarFactura': exigirRol(u, ['ADMIN', 'CARGA']); return co2ValidarFactura(sql, a[0]);
    case 'apiGuardarFactura': return co2GuardarFactura(sql, u, a[0]);
    case 'apiAnularFactura': await co2AnularFactura(sql, u, a[0], a[1]); return listarFacturas(sql);
    case 'apiFacturas': return listarFacturas(sql);
    case 'apiResumenRemitos': return resumenRemitos(sql, a[0]);
    case 'apiEnviarAprobacion': {
      const r = await co2EnviarAprobacion(sql, u, a[0]);
      if (r.ok) r.pendientes = (await pendientesAprobacion(sql)).length;
      return r;
    }
    case 'apiPendientesAprobacion': return pendientesAprobacion(sql);
    case 'apiRechazarPendiente': return (await co2RechazarPendiente(sql, u, a[0])).pendientes;
    case 'apiSaldoLinde': return saldoLinde(sql, a[0]);
    case 'apiRecambios': return recambios(sql, a[0]);
    case 'apiAlertas': return alertas(sql);
    case 'apiBorradores': return [];
    case 'apiValidarBorrador': case 'apiGuardarBorrador': case 'apiEliminarBorrador': case 'apiProcesarCargaInicial': case 'apiModoCargaInicial': return sinCargaInicial();
  }
  throw new ErrorDeUsuario('La pantalla de CO₂ pidió algo que el servidor no conoce: ' + fn);
}

export { rutaArchivo };
