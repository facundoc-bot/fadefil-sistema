// =============================================================================
//  SISTEMA FADEFIL · CO₂: puente entre la base y el motor de CO₂ (antes co2_Datos.gs).
//  - contexto del motor (depósitos, clientes, cilindros, remitos);
//  - guardar remitos de LINDE y altas de inventario; los cilindros de las OT se
//    validan y guardan junto con la OT (mismo lote, misma transacción);
//  - remitos con series dudosas pendientes de aprobación;
//  - facturas de LINDE (validación por kg contra lo que entregó cada remito);
//  - anulación (solo si los movimientos son los últimos de cada serie) y auditoría.
// =============================================================================
import {
  co2_simularLote, co2_normalizarSerie, co2_normalizarNroRemito, co2_esFechaValida, co2_MOV, co2_UBIC,
  co2_reconstruirSerie, co2_validarAnulacion, co2_detectarAlertas, co2_PROVEEDOR_DEFECTO
} from './co2_motor.js';
import { cilindrosDeOT_, normalizarTipoOT, TIPO_OT, TIPO_OT_TEXTO, MODALIDAD_CO2 } from './motor.js';
import { BLOQUEO, iso, nulo, ErrorDeUsuario, exigirRol, insertar, contadores, anotar, hoyArgentina, fechaHora } from './base.js';

/** Advertencias que al guardar quedan como inconsistencia para revisar. */
const CODIGOS_A_REVISION = ['RETIRO_LINDE_LLENO', 'ARCHIVO_YA_CARGADO'];
const MAX_OPS = 50;

/**
 * Ruta del archivo en el espacio co2-linde. La app la manda como archivoRuta o, en las pantallas que vienen
 * de Sheets, como archivoUrl ("archivo.html?r=<ruta>", el enlace que abre el archivo).
 */
export function rutaArchivo(d) {
  const v = String((d && (d.archivoRuta || d.archivoUrl)) || '');
  const m = /[?&]r=([^&]+)/.exec(v);
  return m ? decodeURIComponent(m[1]) : v;
}
/** Enlace para abrir un archivo guardado (la página archivo.html pide un enlace temporal con el login del usuario). */
export const urlArchivo = (ruta) => (ruta ? 'archivo.html?r=' + encodeURIComponent(ruta) : '');
export const cilindroParaApp = (c) => ({ serie: c.serie, estado: c.estado, ubicTipo: c.ubicTipo, ubicId: c.ubicId, depOrigen: c.depOrigen, ultimaFecha: c.ultimaFecha, pesoKg: c.pesoKg,
  proveedor: c.proveedor || co2_PROVEEDOR_DEFECTO });
const provDe = (v) => String(v || co2_PROVEEDOR_DEFECTO).toUpperCase();

/* ---------------------------------------------------------------------------
 *  Filas ↔ motor
 * ------------------------------------------------------------------------ */
const pesoDe = (v) => (v === '' || v == null ? '' : Number(v));
const estadoDeFila = (r) => ({
  serie: r.serie, estado: r.estado, ubicTipo: r.ubicacion_tipo, ubicId: r.ubicacion_id || '', depOrigen: r.deposito_origen_id || '',
  idCircuito: r.circuito_id || '', pesoKg: pesoDe(r.peso_kg), ultimaFecha: iso(r.fecha_ultimo_mov), fechaAlta: iso(r.fecha_alta), proveedor: r.proveedor || co2_PROVEEDOR_DEFECTO
});
const filaDeEstado = (s, fechaAlta) => ({
  serie: s.serie, peso_kg: s.pesoKg === '' || s.pesoKg == null ? null : Number(s.pesoKg), estado: s.estado, ubicacion_tipo: s.ubicTipo, ubicacion_id: s.ubicId || '',
  deposito_origen_id: s.depOrigen || '', circuito_id: s.idCircuito || '', fecha_alta: nulo(fechaAlta || s.fechaAlta || s.ultimaFecha), fecha_ultimo_mov: nulo(s.ultimaFecha),
  proveedor: s.proveedor || co2_PROVEEDOR_DEFECTO
});
const movDeFila = (r) => ({
  idMov: r.movimiento_id, orden: Number(r.orden) || 0, fecha: iso(r.fecha), serie: r.serie, tipoMov: r.tipo, origenTipo: r.origen_tipo, origenId: r.origen_id || '',
  destinoTipo: r.destino_tipo, destinoId: r.destino_id || '', estadoAnterior: r.estado_anterior, estadoNuevo: r.estado_nuevo, idCircuito: r.circuito_id || '',
  depOrigen: r.deposito_origen_id || '', zonaId: r.zona_id || '', refTipo: r.ref_tipo, refId: r.ref_id || '', pesoKg: pesoDe(r.peso_kg), anulado: r.anulado === true, proveedor: r.proveedor || ''
});
const filaCircuito = (c) => ({
  circuito_id: c.idCircuito, serie: c.serie, deposito_origen_id: c.depOrigen, fecha_inicio: c.fechaInicio, ref_entrada: c.refEntrada || '',
  fecha_cierre: nulo(c.fechaCierre), ref_salida: c.refSalida || '', estado: c.estado
});

async function upsertCilindros(sql, filas) {
  for (let i = 0; i < filas.length; i += 500) {
    await sql`insert into co2_cilindros ${sql(filas.slice(i, i + 500))} on conflict (serie) do update set peso_kg = excluded.peso_kg, proveedor = excluded.proveedor, estado = excluded.estado,
      ubicacion_tipo = excluded.ubicacion_tipo, ubicacion_id = excluded.ubicacion_id, deposito_origen_id = excluded.deposito_origen_id,
      circuito_id = excluded.circuito_id, fecha_alta = excluded.fecha_alta, fecha_ultimo_mov = excluded.fecha_ultimo_mov, updated_at = now()`;
  }
}

/* ---------------------------------------------------------------------------
 *  Contexto
 * ------------------------------------------------------------------------ */
/** "2,5; 5; 10" → [2.5, 5, 10] (separadas por punto y coma; decimales con coma o punto). */
export function leerCargas(v) {
  return [...new Set(String(v == null || v === '' ? '5;10' : v).split(/[;\s]+/).map((x) => Number(x.replace(',', '.'))).filter((x) => x > 0))].sort((a, b) => a - b);
}
export { estadoDeFila, movDeFila };

export async function co2Contexto(sql) {
  const [config, deps, co2deps, plazas, zonas, regiones, clientes, cil, rem, provs] = await Promise.all([
    sql`select clave, valor from co2_config`,
    sql`select * from depositos`,
    sql`select * from co2_depositos`,
    sql`select * from plazas`,
    sql`select * from zonas`,
    sql`select region_id from regiones`,
    sql`select cliente_id, nombre_fantasia, sector, zona_id, tipo_cliente from clientes`,
    sql`select * from co2_cilindros`,
    sql`select remito_id, nro_remito, nro_normalizado, deposito_id, archivo_hash, estado, proveedor from co2_remitos where estado in ('CONFIRMADO', 'BORRADOR', 'CON_ERROR', 'PENDIENTE_APROBACION')`,
    sql`select * from co2_proveedores order by proveedor_id`
  ]);
  const proveedores = {};
  provs.forEach((p) => { proveedores[p.proveedor_id] = { id: p.proveedor_id, nombre: p.nombre, lectorPdf: p.lector_pdf, activo: p.activo }; });
  const cfg = {};
  config.forEach((r) => { cfg[r.clave] = r.valor; });
  const extra = {}, depositos = {};
  co2deps.forEach((r) => { extra[r.deposito_id] = r; });
  deps.forEach((d) => {
    const x = extra[d.deposito_id] || {};
    depositos[d.deposito_id] = { id: d.deposito_id, nombre: d.deposito_id, direccion: d.direccion, plaza: x.plaza_linde || '', activo: d.activo && x.activo !== false, enMaestro: true };
  });
  const P = {}, Z = {}, R = {};
  regiones.forEach((r) => { R[r.region_id] = { id: r.region_id, nombre: r.region_id }; });
  plazas.forEach((p) => { P[p.plaza_id] = { id: p.plaza_id, nombre: p.plaza_id, regionId: p.region_id, depositoId: p.deposito_id, proveedor: p.proveedor_co2 || co2_PROVEEDOR_DEFECTO }; });
  zonas.forEach((z) => { Z[z.zona_id] = { id: z.zona_id, nombre: z.zona_id, plazaId: z.plaza_id }; });
  const C = {};
  clientes.forEach((c) => {
    const z = Z[c.zona_id], p = z ? P[z.plazaId] : null;
    C[c.cliente_id] = { id: c.cliente_id, nombre: c.nombre_fantasia + (c.sector ? ' · ' + c.sector : ''), zonaId: c.zona_id, plazaId: p ? p.id : '', regionId: p ? p.regionId : '',
      depositoId: p ? p.depositoId : '', proveedor: p ? p.proveedor : co2_PROVEEDOR_DEFECTO, tipoCliente: c.tipo_cliente, activo: true };
  });
  const cilindros = {}, fechaAlta = {};
  cil.forEach((r) => { cilindros[r.serie] = estadoDeFila(r); fechaAlta[r.serie] = iso(r.fecha_alta); });
  let n = 0;
  return {
    hoy: hoyArgentina(), regiones: R, plazas: P, zonas: Z, depositos, clientes: C, cilindros, fechaAlta, config: cfg, proveedores,
    remitos: rem.map((r) => ({ idRemito: r.remito_id, nro: r.nro_remito, nroNorm: r.nro_normalizado, idDeposito: r.deposito_id, hash: r.archivo_hash, estado: r.estado, proveedor: r.proveedor })),
    cargasValidas: leerCargas(cfg.CARGAS_KG),
    nuevoIdCircuito: () => 'NUEVO-' + (++n) // provisorio; se reemplaza al guardar
  };
}

/* ---------------------------------------------------------------------------
 *  Cilindros dentro de las OT (antes simularCilindros_ de Datos.gs)
 * ------------------------------------------------------------------------ */
/** ¿El lote necesita el motor de CO₂? (OT con cilindros, o desinstalaciones: avisan si quedan cilindros en el cliente). */
export function loteTocaCo2(ops) {
  return (ops || []).some((op) => {
    if (op.clase !== 'OT') return false;
    const d = op.datos || {}, cil = cilindrosDeOT_(d), tipo = normalizarTipoOT(d.tipo);
    return cil.entregadas.length || cil.retiradas.length || tipo === TIPO_OT.DESINSTALACION || tipo === TIPO_OT.DESINST_MOMENTANEA;
  });
}

/**
 * Arma los trabajos de CO₂ de las OT del lote (uno por OT con cilindros) y los simula con el motor de CO₂
 * sobre el estado actual de los cilindros. También avisa si una desinstalación deja cilindros en el cliente.
 */
export function simularCilindrosOT(ops, sim, ctx, cctx) {
  const conCo2 = [], desinst = [];
  ops.forEach((op, k) => {
    if (op.clase !== 'OT' || op._auto) return;
    const d = op.datos, cil = cilindrosDeOT_(d), tipo = normalizarTipoOT(d.tipo);
    if (cil.entregadas.length || cil.retiradas.length) conCo2.push(k);
    if (tipo === TIPO_OT.DESINSTALACION || tipo === TIPO_OT.DESINST_MOMENTANEA) desinst.push(k);
  });
  if (!conCo2.length && !desinst.length) return null;
  // Clientes nuevos del lote (alta en la instalación): todavía no están en la base.
  ops.forEach((op) => {
    const id = String((op.datos || {}).idCliente || '');
    if (!id || cctx.clientes[id] || !ctx.clientes[id]) return;
    const cm = ctx.clientes[id], z = cctx.zonas[cm.zonaId], p = z ? cctx.plazas[z.plazaId] : null;
    cctx.clientes[id] = { id, nombre: cm.nombre, zonaId: cm.zonaId, plazaId: p ? p.id : '', regionId: p ? p.regionId : '', depositoId: p ? p.depositoId : '', activo: true };
  });
  const co2ops = conCo2.map((k) => {
    const d = ops[k].datos, cil = cilindrosDeOT_(d), tipoOT = normalizarTipoOT(d.tipo);
    const tipo = cil.entregadas.length && cil.retiradas.length ? 'RECAMBIO' : cil.entregadas.length ? 'ENTREGA' : 'RETIRO';
    const mod = MODALIDAD_CO2[String(d.modalidadCo2 || '').toUpperCase()];
    return { clase: 'TRABAJO', datos: { fecha: d.fecha, tipo, idCliente: String(d.idCliente || ''), entregadas: cil.entregadas, retiradas: cil.retiradas,
      observaciones: (TIPO_OT_TEXTO[tipoOT] || tipoOT) + (mod ? ' · ' + mod : '') + (d.comentarios ? ' · ' + d.comentarios : '') } };
  });
  const csim = co2_simularLote(co2ops, cctx);
  const pendientes = [];
  desinst.forEach((k) => {
    const id = String(ops[k].datos.idCliente || '');
    const quedan = Object.keys(csim.estadosFinales).filter((sr) => { const c = csim.estadosFinales[sr]; return c.ubicTipo === co2_UBIC.CLIENTE && c.ubicId === id; }).sort();
    if (quedan.length) pendientes.push({ k, mensaje: 'Quedan ' + quedan.length + ' cilindro(s) de CO₂ en el cliente (' + quedan.join(', ') + '). Se retiran después con una OT "Entrega de CO₂".' });
  });
  return { ops: co2ops, idx: conCo2, sim: csim, ctx: cctx, pendientes };
}

/* ---------------------------------------------------------------------------
 *  Escritura de un lote de CO₂ ya simulado sin errores (dentro de la transacción de quien llama)
 *  opts.refIds[i]: identificador de la operación i (los trabajos de una OT usan el número de la OT).
 * ------------------------------------------------------------------------ */
export async function co2Escribir(sql, ops, sim, ctx, usuario, opts = {}) {
  const C = opts.C;
  const circuitoReal = {}, circuitosNuevos = {}, cierres = {}, tocadas = {};
  const filas = { co2_movimientos: [], co2_remitos: [], co2_remito_lineas: [], co2_trabajos: [], co2_trabajo_lineas: [], co2_altas: [], co2_inconsistencias: [] };
  const confirmadas = [];
  sim.resultados.forEach((res, i) => {
    const op = ops[i], d = op.datos;
    let refId, refTipo;
    if (op.clase === 'REMITO') { refId = C.siguiente('REM'); refTipo = 'REMITO'; }
    else if (op.clase === 'TRABAJO') { refId = (opts.refIds && opts.refIds[i]) || C.siguiente('TRB'); refTipo = 'TRABAJO'; }
    else { refId = C.siguiente('INV'); refTipo = 'INVENTARIO'; }
    const movPorClave = {};
    res.movimientos.forEach((m) => {
      if (m.circuitoNuevo) circuitoReal[m.idCircuito] = C.siguiente('CIR');
      const idCirc = circuitoReal[m.idCircuito] || m.idCircuito;
      const idMov = C.siguiente('MOV', 7);
      movPorClave[m.tipoMov + '|' + m.serie] = idMov;
      tocadas[m.serie] = true;
      filas.co2_movimientos.push({ movimiento_id: idMov, fecha: m.fecha, serie: m.serie, peso_kg: m.pesoKg === '' || m.pesoKg == null ? null : Number(m.pesoKg), tipo: m.tipoMov,
        origen_tipo: m.origenTipo || '', origen_id: m.origenId || '', destino_tipo: m.destinoTipo || '', destino_id: m.destinoId || '',
        estado_anterior: m.estadoAnterior || '', estado_nuevo: m.estadoNuevo, circuito_id: idCirc || '', deposito_origen_id: m.depOrigen || '', zona_id: m.zonaId || '',
        ref_tipo: refTipo, ref_id: refId, proveedor: m.proveedor || '', created_by: usuario.email });
      if (m.circuitoNuevo) circuitosNuevos[idCirc] = { circuito_id: idCirc, serie: m.serie, deposito_origen_id: m.depOrigen, fecha_inicio: m.fecha, ref_entrada: refId, fecha_cierre: null, ref_salida: '', estado: 'ABIERTO' };
      if (m.tipoMov === co2_MOV.RETIRO_LINDE) {
        const nuevo = circuitosNuevos[idCirc];
        if (nuevo) { nuevo.fecha_cierre = m.fecha; nuevo.ref_salida = refId; nuevo.estado = 'CERRADO'; }
        else cierres[idCirc] = { fecha_cierre: m.fecha, ref_salida: refId };
      }
    });
    if (op.clase === 'REMITO') {
      filas.co2_remitos.push({ remito_id: refId, nro_remito: String(d.nroRemito), nro_normalizado: co2_normalizarNroRemito(d.nroRemito), fecha: d.fecha, deposito_id: d.idDeposito, proveedor: provDe(d.proveedor),
        tipo_copia: d.tipoCopia || '', plaza_texto: d.plazaTexto || '', origen_carga: d.origenCarga || 'MANUAL', archivo_ruta: rutaArchivo(d), archivo_hash: d.archivoHash || '',
        observaciones: d.observaciones || '', estado: 'CONFIRMADO', errores: '', created_by: usuario.email, confirmado_at: new Date() });
      (d.lineas || []).forEach((l) => {
        const tipo = String(l.tipo).toUpperCase(), serie = co2_normalizarSerie(l.serie);
        const peso = tipo === 'ENTREGA' ? Number(l.pesoKg) || null : (ctx.cilindros[serie] || {}).pesoKg || null;
        filas.co2_remito_lineas.push({ linea_id: C.siguiente('DET', 7), remito_id: refId, tipo, serie, peso_kg: peso, serie_leida: l.serieLeida || l.serieLeidaIA || '',
          movimiento_id: movPorClave[(tipo === 'ENTREGA' ? co2_MOV.ENTREGA_LINDE : co2_MOV.RETIRO_LINDE) + '|' + serie] || '',
          revision: l.dudosa ? 'APROBADA: se leyó ' + (l.serieLeida || l.serieLeidaIA || serie) + (l.sugerida ? ', sugerida ' + l.sugerida : '') + ', es ' + serie + ' · ' + usuario.email + ' · ' + fechaHora() : '' });
      });
    } else if (op.clase === 'TRABAJO') {
      const cli = ctx.clientes[d.idCliente] || {};
      filas.co2_trabajos.push({ trabajo_id: refId, fecha: d.fecha, tipo: String(d.tipo).toUpperCase(), cliente_id: d.idCliente, zona_id: cli.zonaId || '',
        observaciones: d.observaciones || '', estado: 'CONFIRMADO', created_by: usuario.email });
      [['ENTREGA', d.entregadas, co2_MOV.ENTREGA_CLIENTE], ['RETIRO', d.retiradas, co2_MOV.RETIRO_CLIENTE]].forEach((g) => {
        (g[1] || []).map(co2_normalizarSerie).forEach((s) => {
          filas.co2_trabajo_lineas.push({ linea_id: C.siguiente('TRL', 7), trabajo_id: refId, tipo: g[0], serie: s, movimiento_id: movPorClave[g[2] + '|' + s] || '' });
        });
      });
    } else {
      filas.co2_altas.push({ alta_id: refId, fecha: d.fecha, serie: co2_normalizarSerie(d.serie), peso_kg: Number(d.pesoKg) || null, deposito_origen_id: d.idDepositoOrigen,
        ubicacion: String(d.ubicacion).toUpperCase(), cliente_id: d.idCliente || null, estado_cilindro: d.estado || '', observaciones: d.observaciones || '',
        proveedor: (res.movimientos[0] && res.movimientos[0].proveedor) || provDe(d.proveedor), estado: 'CONFIRMADO', created_by: usuario.email });
    }
    res.advertencias.forEach((a) => {
      if (CODIGOS_A_REVISION.indexOf(a.codigo) < 0) return;
      filas.co2_inconsistencias.push({ codigo: a.codigo, serie: a.serie || '', ref_id: refId, detalle: a.mensaje, usuario: usuario.email });
    });
    confirmadas.push({ clase: op.clase, id: refId, movimientos: res.movimientos.length, advertencias: res.advertencias });
  });

  const cilindros = Object.keys(tocadas).map((s) => {
    const e = sim.estadosFinales[s];
    e.idCircuito = circuitoReal[e.idCircuito] || e.idCircuito;
    return filaDeEstado(e, ctx.fechaAlta[s] || e.ultimaFecha);
  });
  // Primero la fuente de verdad (movimientos); después los registros y el estado.
  for (const t of ['co2_remitos', 'co2_remito_lineas', 'co2_trabajos', 'co2_trabajo_lineas', 'co2_altas', 'co2_movimientos', 'co2_inconsistencias']) await insertar(sql, t, filas[t]);
  await insertar(sql, 'co2_circuitos', Object.values(circuitosNuevos));
  for (const [id, c] of Object.entries(cierres)) await sql`update co2_circuitos set fecha_cierre = ${c.fecha_cierre}, ref_salida = ${c.ref_salida}, estado = 'CERRADO' where circuito_id = ${id}`;
  await upsertCilindros(sql, cilindros);
  return { confirmadas, ids: confirmadas.map((c) => c.id), movimientos: filas.co2_movimientos.length, cilindros: cilindros.map((f) => cilindroParaApp(estadoDeFila(f))) };
}

/* ---------------------------------------------------------------------------
 *  Servicios: remitos y altas de inventario
 * ------------------------------------------------------------------------ */
function validarPedidoCo2(usuario, ops) {
  if (!Array.isArray(ops) || !ops.length) throw new ErrorDeUsuario('No hay operaciones para guardar.');
  if (ops.length > MAX_OPS) throw new ErrorDeUsuario('Máximo ' + MAX_OPS + ' operaciones por envío.');
  exigirRol(usuario, ops.some((o) => o && o.clase === 'ALTA') ? ['ADMIN'] : ['ADMIN', 'CARGA']); // el inventario inicial es de administradores
  if (ops.some((o) => o && o.clase === 'TRABAJO')) throw new ErrorDeUsuario('Los cilindros en clientes se cargan en una OT (Entrega de CO₂, instalación o desinstalación).');
  return JSON.parse(JSON.stringify(ops)).map((o) => ({ clase: String(o.clase || ''), datos: o.datos || {} }));
}

/* ---------------------------------------------------------------------------
 *  Pesos nuevos (v2.2, pedido 26/11/2026): al cargar un remito o el inventario inicial se
 *  puede elegir "Otro peso"; esa carga (marcada cargaNueva) vale para esa operación y, al
 *  guardarla, se suma a la lista de Configuración CO₂ (CARGAS_KG).
 * ------------------------------------------------------------------------ */
const PESO_MAXIMO_KG = 100;
function cargasNuevas(ops) {
  const out = new Set();
  (ops || []).forEach((op) => {
    const d = op.datos || {};
    if (op.clase === 'ALTA' && d.cargaNueva) out.add(Number(d.pesoKg));
    if (op.clase === 'REMITO') (d.lineas || []).forEach((l) => { if (l.cargaNueva && String(l.tipo).toUpperCase() === 'ENTREGA') out.add(Number(l.pesoKg)); });
  });
  const lista = [...out];
  const mal = lista.filter((p) => !(p > 0 && p <= PESO_MAXIMO_KG) || Math.round(p * 100) !== p * 100);
  if (mal.length) throw new ErrorDeUsuario('El peso nuevo tiene que ser un número de kg mayor que 0 y hasta ' + PESO_MAXIMO_KG + ' (con hasta 2 decimales).');
  return lista;
}
function sumarCargasAlContexto(cctx, nuevas) {
  nuevas.forEach((p) => { if (cctx.cargasValidas.indexOf(p) < 0) cctx.cargasValidas.push(p); });
  cctx.cargasValidas.sort((a, b) => a - b);
}
async function guardarCargasNuevas(tx, cctx, nuevas, usuario) {
  if (!nuevas.length) return;
  const lista = leerCargas((await tx`select valor from co2_config where clave = 'CARGAS_KG'`).map((r) => r.valor)[0]);
  const sumar = nuevas.filter((p) => lista.indexOf(p) < 0);
  if (!sumar.length) return;
  const valor = lista.concat(sumar).sort((a, b) => a - b).map((p) => String(p).replace('.', ',')).join('; ');
  await tx`update co2_config set valor = ${valor} where clave = 'CARGAS_KG'`;
  await anotar(tx, usuario.email, 'CO2_PESO_NUEVO', sumar.join(', ') + ' kg', 'Lista: ' + valor);
}

export async function co2Validar(sql, usuario, opsPedido) {
  const ops = validarPedidoCo2(usuario, opsPedido);
  const cctx = await co2Contexto(sql);
  sumarCargasAlContexto(cctx, cargasNuevas(ops));
  cctx.rolUsuario = usuario.rol; // las series dudosas las aprueba un administrador
  const sim = co2_simularLote(ops, cctx);
  return { ok: sim.ok, resultados: sim.resultados };
}

/** Guarda remitos y altas. Un remito que esperaba aprobación (idPendiente) queda reemplazado por el confirmado. */
export async function co2Guardar(sql, usuario, opsPedido) {
  const ops = validarPedidoCo2(usuario, opsPedido);
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BLOQUEO})`;
    const cctx = await co2Contexto(tx);
    cctx.rolUsuario = usuario.rol;
    const nuevas = cargasNuevas(ops);
    sumarCargasAlContexto(cctx, nuevas);
    const sim = co2_simularLote(ops, cctx);
    const resultados = sim.resultados.map((r) => ({ clase: r.clase, errores: r.errores, advertencias: r.advertencias }));
    if (!sim.ok) return { ok: false, resultados, mensaje: 'Hay errores: no se guardó nada.' };
    await guardarCargasNuevas(tx, cctx, nuevas, usuario);
    const pendientes = ops.filter((o) => o.clase === 'REMITO' && o.datos.idPendiente).map((o) => String(o.datos.idPendiente));
    if (pendientes.length) await tx`delete from co2_remitos where remito_id = any(${pendientes}) and estado = 'PENDIENTE_APROBACION'`;
    const C = await contadores(tx);
    const r = await co2Escribir(tx, ops, sim, cctx, usuario, { C });
    await C.guardar();
    await anotar(tx, usuario.email, 'CO2_GUARDAR', r.ids.join(', '), 'OK (' + r.movimientos + ' movimientos)');
    return { ok: true, resultados, ids: r.ids, confirmadas: r.confirmadas, cilindros: r.cilindros, cargas: cctx.cargasValidas, mensaje: 'Se guardaron ' + r.ids.length + ' operaciones y ' + r.movimientos + ' movimientos.' };
  });
}

/**
 * Guarda un remito con series dudosas para que lo apruebe un administrador. Se valida todo lo demás
 * (como si las dudosas estuvieran aprobadas); las dudosas quedan como DUDOSA:<sugerida>.
 */
export async function co2EnviarAprobacion(sql, usuario, d) {
  exigirRol(usuario, ['ADMIN', 'CARGA']);
  const dudosas = ((d && d.lineas) || []).filter((l) => l.dudosa && !l.aprobada);
  if (!dudosas.length) throw new ErrorDeUsuario('El remito no tiene series dudosas sin aprobar: guardalo directamente.');
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BLOQUEO})`;
    const cctx = await co2Contexto(tx);
    cctx.rolUsuario = 'ADMIN';
    const nuevas = cargasNuevas([{ clase: 'REMITO', datos: d }]);
    sumarCargasAlContexto(cctx, nuevas);
    const prueba = JSON.parse(JSON.stringify(d));
    prueba.lineas.forEach((l) => { if (l.dudosa) l.aprobada = true; });
    const sim = co2_simularLote([{ clase: 'REMITO', datos: prueba }], cctx);
    if (!sim.ok) return { ok: false, resultados: sim.resultados.map((r) => ({ errores: r.errores, advertencias: r.advertencias })), mensaje: 'Hay errores: corregilos antes de enviarlo a aprobación.' };
    await guardarCargasNuevas(tx, cctx, nuevas, usuario); // así, cuando se apruebe, el peso ya está en la lista
    let id = '', creado = null;
    if (d.idPendiente) {
      const [p] = await tx`select remito_id, created_by, created_at from co2_remitos where remito_id = ${String(d.idPendiente)} and estado = 'PENDIENTE_APROBACION'`;
      if (!p) throw new ErrorDeUsuario('No se encontró el remito pendiente ' + d.idPendiente + ' (puede que ya se haya aprobado o rechazado).');
      id = p.remito_id; creado = p;
      await tx`delete from co2_remitos where remito_id = ${id}`;
    }
    const C = await contadores(tx);
    if (!id) id = C.siguiente('REM');
    await insertar(tx, 'co2_remitos', [{ remito_id: id, nro_remito: String(d.nroRemito), nro_normalizado: co2_normalizarNroRemito(d.nroRemito), fecha: d.fecha, deposito_id: d.idDeposito, proveedor: provDe(d.proveedor),
      tipo_copia: d.tipoCopia || '', plaza_texto: d.plazaTexto || '', origen_carga: d.origenCarga || 'MANUAL', archivo_ruta: rutaArchivo(d), archivo_hash: d.archivoHash || '',
      observaciones: d.observaciones || '', estado: 'PENDIENTE_APROBACION', errores: dudosas.length + ' serie(s) dudosa(s)',
      created_by: creado ? creado.created_by : usuario.email, created_at: creado ? creado.created_at : new Date() }]);
    await insertar(tx, 'co2_remito_lineas', d.lineas.map((l) => ({ linea_id: C.siguiente('DET', 7), remito_id: id, tipo: String(l.tipo).toUpperCase(), serie: co2_normalizarSerie(l.serie),
      peso_kg: Number(l.pesoKg) || null, serie_leida: l.serieLeida || l.serieLeidaIA || '', movimiento_id: '', revision: l.dudosa ? 'DUDOSA:' + (l.sugerida || '') : '' })));
    await C.guardar();
    await anotar(tx, usuario.email, 'CO2_ENVIAR_APROBACION', id + ' · ' + d.nroRemito + ' · ' + dudosas.map((l) => l.serieLeida || l.serieLeidaIA || l.serie).join(', '));
    return { ok: true, id, mensaje: 'El remito ' + d.nroRemito + ' quedó pendiente de aprobación (' + id + ').' };
  });
}

/** Rechaza (borra) un remito pendiente de aprobación. Su archivo queda guardado. */
export async function co2RechazarPendiente(sql, usuario, id) {
  exigirRol(usuario, ['ADMIN']);
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BLOQUEO})`;
    const [r] = await tx`delete from co2_remitos where remito_id = ${String(id || '')} and estado = 'PENDIENTE_APROBACION' returning remito_id, nro_remito`;
    if (!r) throw new ErrorDeUsuario('No se encontró el remito pendiente ' + id + ' (si ya se guardó, para deshacerlo anulá el remito).');
    await anotar(tx, usuario.email, 'CO2_RECHAZAR_PENDIENTE', r.remito_id + ' · ' + r.nro_remito);
    const [{ n }] = await tx`select count(*)::int n from co2_remitos where estado = 'PENDIENTE_APROBACION'`;
    return { ok: true, pendientes: n };
  });
}

/* ---------------------------------------------------------------------------
 *  Facturas de LINDE: se comparan los kg facturados de cada remito con los kg de los
 *  cilindros que ese remito entregó según el sistema (90 kg = 9 × 10 kg o 18 × 5 kg).
 * ------------------------------------------------------------------------ */
async function kgPorRemito(sql) {
  const filas = await sql`select ref_id, tipo, peso_kg from co2_movimientos where not anulado and tipo in ('ENTREGA_LINDE', 'RETIRO_LINDE')`;
  const out = {};
  filas.forEach((m) => {
    const r = out[m.ref_id] = out[m.ref_id] || { entregas: 0, retiros: 0, kg: 0, composicion: {} };
    if (m.tipo === co2_MOV.RETIRO_LINDE) { r.retiros++; return; }
    const kg = Number(m.peso_kg) || 0;
    r.entregas++; r.kg += kg; r.composicion[kg] = (r.composicion[kg] || 0) + 1;
  });
  return out;
}
const textoComposicion = (c) => Object.keys(c || {}).map(Number).sort((a, b) => b - a).map((kg) => c[kg] + ' × ' + (kg || '¿?') + ' kg').join(' + ');
const fechaTexto = (f) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(f || ''); };

async function facturacion(sql) {
  const facs = await sql`select factura_id, nro_factura, nro_normalizado, fecha, estado, proveedor from co2_facturas where estado <> 'ANULADA'`;
  const facturas = {}, porRemito = {};
  facs.forEach((f) => { facturas[f.factura_id] = f; });
  const lineas = await sql`select factura_id, remito_id, resultado, kg_factura from co2_factura_lineas where remito_id is not null`;
  lineas.forEach((l) => {
    const f = facturas[l.factura_id];
    if (!f || l.resultado === 'YA_FACTURADO') return; // ese renglón no es la factura del remito: ya estaba en otra
    porRemito[l.remito_id] = { facturaId: f.factura_id, nroFactura: f.nro_factura, fecha: iso(f.fecha), resultado: l.resultado, kgFactura: l.kg_factura };
  });
  return { facturas, porRemito };
}

/** d = { proveedor, nroFactura, fecha, lineas: [{ nroRemito, fechaRemito, kg }], idFactura? } (cada factura es de un proveedor y mira sus remitos) */
export async function co2ValidarFactura(sql, d) {
  d = d || {};
  const errores = [];
  const prov = provDe(d.proveedor);
  if (!(await sql`select 1 from co2_proveedores where proveedor_id = ${prov}`).length) errores.push('El proveedor "' + prov + '" no existe.');
  const nroNorm = co2_normalizarNroRemito(d.nroFactura);
  if (!nroNorm) errores.push('Falta el número de la factura.');
  if (!co2_esFechaValida(d.fecha)) errores.push('La fecha de la factura no es válida.');
  const fac = await facturacion(sql);
  Object.keys(fac.facturas).forEach((id) => {
    const f = fac.facturas[id];
    if (nroNorm && f.nro_normalizado === nroNorm && provDe(f.proveedor) === prov && id !== String(d.idFactura || '')) errores.push('La factura ' + d.nroFactura + ' ya está cargada (' + id + ', ' + f.estado + ').');
  });
  const remitos = {};
  (await sql`select remito_id, nro_remito, nro_normalizado, fecha, deposito_id, estado from co2_remitos where estado <> 'ANULADO' and proveedor = ${prov}`).forEach((r) => {
    const k = r.nro_normalizado || co2_normalizarNroRemito(r.nro_remito);
    if (!remitos[k] || r.estado === 'CONFIRMADO') remitos[k] = r;
  });
  const kgs = await kgPorRemito(sql);
  const agrupadas = {}, lineas = [];
  (d.lineas || []).forEach((l) => {
    const k = co2_normalizarNroRemito(l.nroRemito);
    if (!k) return;
    let x = agrupadas[k];
    if (!x) { x = agrupadas[k] = { nroRemito: String(l.nroRemito).trim(), fechaRemito: l.fechaRemito || '', kg: '' }; lineas.push(x); }
    if (l.kg !== '' && l.kg != null && !isNaN(Number(l.kg))) x.kg = (x.kg === '' ? 0 : x.kg) + Number(l.kg);
  });
  if (!lineas.length) errores.push('La factura no tiene remitos.');
  const res = { validados: 0, kgValidados: 0, conDiferencias: 0, noEncontrados: 0, yaFacturados: 0, kgFactura: 0, kgSistema: 0 };
  lineas.forEach((x) => {
    const r = remitos[co2_normalizarNroRemito(x.nroRemito)];
    if (x.kg !== '') res.kgFactura += x.kg;
    x.avisos = [];
    if (!r) { x.resultado = 'NO_ENCONTRADO'; x.detalle = 'El remito no está cargado en el sistema (entre los de este proveedor).'; res.noEncontrados++; return; }
    x.remitoId = r.remito_id; x.deposito = r.deposito_id; x.fechaSistema = iso(r.fecha);
    if (r.estado !== 'CONFIRMADO') { x.resultado = 'NO_CONFIRMADO'; x.detalle = 'El remito está cargado pero no confirmado (' + r.estado + ').'; res.noEncontrados++; return; }
    const info = kgs[r.remito_id] || { entregas: 0, kg: 0, composicion: {} };
    x.kgSistema = info.kg; x.composicion = textoComposicion(info.composicion); x.entregas = info.entregas;
    res.kgSistema += info.kg;
    if (x.fechaRemito && x.fechaSistema && x.fechaRemito !== x.fechaSistema) x.avisos.push('En el sistema el remito tiene fecha ' + fechaTexto(x.fechaSistema) + '.');
    const ya = fac.porRemito[r.remito_id];
    if (ya && String(ya.facturaId) !== String(d.idFactura || '')) { x.resultado = 'YA_FACTURADO'; x.detalle = 'Ya está en la factura ' + ya.nroFactura + ' (' + ya.facturaId + ').'; res.yaFacturados++; return; }
    if (x.kg === '') { x.resultado = 'SIN_KG'; x.detalle = 'Faltan los kg facturados.'; res.conDiferencias++; return; }
    if (Math.abs(x.kg - info.kg) < 0.001) {
      x.resultado = 'VALIDADO'; x.detalle = 'Coincide: ' + info.kg + ' kg (' + (x.composicion || 'sin entregas') + ').'; res.validados++; res.kgValidados += x.kg;
    } else {
      x.resultado = 'DIFERENCIA_KG';
      x.detalle = 'Factura ' + x.kg + ' kg; el remito registra ' + info.kg + ' kg (' + (x.composicion || 'sin entregas') + '). Diferencia: ' + (x.kg - info.kg > 0 ? '+' : '') + Math.round((x.kg - info.kg) * 100) / 100 + ' kg.';
      res.conDiferencias++;
    }
  });
  return { ok: !errores.length, errores, lineas, resumen: res, todoValidado: !errores.length && lineas.length > 0 && res.validados === lineas.length };
}

/** Guarda la factura con el resultado de la validación (aunque tenga diferencias: queda para reclamar). */
export async function co2GuardarFactura(sql, usuario, d) {
  exigirRol(usuario, ['ADMIN', 'CARGA']);
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BLOQUEO})`;
    const v = await co2ValidarFactura(tx, d);
    if (!v.ok) return v;
    const C = await contadores(tx);
    const id = C.siguiente('FAC');
    const r = v.resumen, estado = v.todoValidado ? 'VALIDADA' : 'CON_DIFERENCIAS';
    await insertar(tx, 'co2_facturas', [{ factura_id: id, nro_factura: String(d.nroFactura).trim(), nro_normalizado: co2_normalizarNroRemito(d.nroFactura), fecha: d.fecha, proveedor: provDe(d.proveedor),
      total_kg: r.kgFactura, archivo_ruta: rutaArchivo(d), archivo_hash: d.archivoHash || '', observaciones: d.observaciones || '', estado,
      resumen: r.validados + ' de ' + v.lineas.length + ' remitos validados (' + r.kgValidados + ' de ' + r.kgFactura + ' kg)', created_by: usuario.email }]);
    await insertar(tx, 'co2_factura_lineas', v.lineas.map((x) => ({ linea_id: C.siguiente('FDT', 7), factura_id: id, nro_remito: x.nroRemito, nro_normalizado: co2_normalizarNroRemito(x.nroRemito),
      fecha_remito: nulo(x.fechaRemito), kg_factura: x.kg === '' ? null : x.kg, remito_id: x.remitoId || null, kg_sistema: x.kgSistema == null ? null : x.kgSistema,
      resultado: x.resultado, detalle: [x.detalle].concat(x.avisos || []).join(' ') })));
    await C.guardar();
    await anotar(tx, usuario.email, 'CO2_GUARDAR_FACTURA', id + ' · ' + d.nroFactura + ' · ' + estado);
    return { ...v, id, estado };
  });
}

export async function co2AnularFactura(sql, usuario, id, motivo) {
  exigirRol(usuario, ['ADMIN']);
  if (!motivo || String(motivo).trim().length < 5) throw new ErrorDeUsuario('Indicá el motivo de la anulación.');
  const [f] = await sql`update co2_facturas set estado = 'ANULADA', anulada_por = ${usuario.email}::text, anulada_at = now(),
      observaciones = concat_ws(' · ', nullif(observaciones, ''), ${'Anulada: ' + String(motivo).trim()}::text)
    where factura_id = ${String(id || '')}::text and estado <> 'ANULADA' returning factura_id`;
  if (!f) throw new ErrorDeUsuario('No se encontró la factura ' + id + ' o ya está anulada.');
  await anotar(sql, usuario.email, 'CO2_ANULAR_FACTURA', id + ' · ' + motivo);
  return { ok: true, mensaje: 'Se anuló la factura ' + id + '.' };
}

/* ---------------------------------------------------------------------------
 *  Anulación: solo si los movimientos de la operación son los últimos de cada serie
 * ------------------------------------------------------------------------ */
export async function co2PrepararAnulacion(sql, refId) {
  const propios = (await sql`select * from co2_movimientos where ref_id = ${refId} and not anulado order by orden`).map(movDeFila);
  const series = [...new Set(propios.map((m) => m.serie))];
  const porSerie = {};
  if (series.length) (await sql`select * from co2_movimientos where serie = any(${series}) and not anulado order by orden`).map(movDeFila).forEach((m) => { (porSerie[m.serie] = porSerie[m.serie] || []).push(m); });
  return { propios, porSerie, v: propios.length ? co2_validarAnulacion(refId, porSerie) : { ok: true, errores: [], series: [] } };
}

export async function co2AplicarAnulacion(sql, refId, motivo, usuario, prep) {
  await sql`update co2_movimientos set anulado = true where ref_id = ${refId} and not anulado`;
  const series = Object.keys(prep.porSerie);
  const guardar = [], borrar = [], circuitos = [];
  series.forEach((serie) => {
    const vigentes = prep.porSerie[serie].filter((m) => m.refId !== refId);
    const rec = co2_reconstruirSerie(serie, vigentes);
    if (rec.estado) guardar.push(filaDeEstado(rec.estado, vigentes[0].fecha)); else borrar.push(serie);
    Object.keys(rec.circuitos).forEach((k) => circuitos.push(filaCircuito(rec.circuitos[k])));
  });
  if (series.length) await sql`delete from co2_circuitos where serie = any(${series})`;
  await insertar(sql, 'co2_circuitos', circuitos);
  if (borrar.length) await sql`delete from co2_cilindros where serie = any(${borrar})`;
  await upsertCilindros(sql, guardar);
  const nota = 'Anulado por ' + usuario.email + ' el ' + fechaHora() + '. Motivo: ' + String(motivo).trim();
  const cambiar = (tabla, col) => sql`update ${sql(tabla)} set estado = 'ANULADO', observaciones = concat_ws(' | ', nullif(observaciones, ''), ${nota}::text) where ${sql(col)} = ${refId}`;
  if (refId.indexOf('REM-') === 0) await cambiar('co2_remitos', 'remito_id');
  else if (refId.indexOf('INV-') === 0) await cambiar('co2_altas', 'alta_id');
  else await cambiar('co2_trabajos', 'trabajo_id'); // los trabajos de una OT llevan el número de la OT
  await anotar(sql, usuario.email, 'CO2_ANULAR', refId + ' — ' + motivo, 'OK (' + prep.v.series.length + ' series)');
  return { ok: true, mensaje: 'Se anuló ' + refId + '. Series afectadas: ' + prep.v.series.join(', ') };
}

export async function co2Anular(sql, usuario, refId, motivo) {
  exigirRol(usuario, ['ADMIN']);
  const id = String(refId || '').trim();
  if (!motivo || String(motivo).trim().length < 5) throw new ErrorDeUsuario('Indicá el motivo de la anulación.');
  if (/^OT-/.test(id)) throw new ErrorDeUsuario('Los cilindros de ' + id + ' se cargaron en una OT: se anulan junto con la OT.');
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BLOQUEO})`;
    const prep = await co2PrepararAnulacion(tx, id);
    if (!prep.propios.length) throw new ErrorDeUsuario('La operación ' + id + ' no tiene movimientos vigentes (¿ya está anulada?).');
    if (!prep.v.ok) return { ok: false, errores: prep.v.errores };
    return co2AplicarAnulacion(tx, id, motivo, usuario, prep);
  });
}

/* ---------------------------------------------------------------------------
 *  Auditoría: repasa todo el historial, corrige el estado si no coincide y registra alertas
 * ------------------------------------------------------------------------ */
export async function co2Auditar(sql, usuario) {
  exigirRol(usuario, ['ADMIN']);
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${BLOQUEO})`;
    const movs = (await tx`select * from co2_movimientos where not anulado order by orden`).map(movDeFila);
    const porSerie = {};
    movs.forEach((m) => { (porSerie[m.serie] = porSerie[m.serie] || []).push(m); });
    const cilindros = {}, circuitos = [], fechaAlta = {};
    let incoh = [];
    Object.keys(porSerie).sort().forEach((serie) => {
      const rec = co2_reconstruirSerie(serie, porSerie[serie]);
      if (rec.estado) cilindros[serie] = rec.estado;
      Object.keys(rec.circuitos).forEach((k) => circuitos.push(rec.circuitos[k]));
      incoh = incoh.concat(rec.inconsistencias);
      fechaAlta[serie] = porSerie[serie][0].fecha;
    });
    let cctx = await co2Contexto(tx);
    const claves = new Set(Object.keys(cilindros).concat(Object.keys(cctx.cilindros)));
    const dif = [...claves].filter((s) => {
      const a = cilindros[s], b = cctx.cilindros[s];
      if (!a || !b) return true;
      return a.estado !== b.estado || a.ubicTipo !== b.ubicTipo || String(a.ubicId) !== String(b.ubicId) || String(a.depOrigen) !== String(b.depOrigen) ||
        String(a.idCircuito) !== String(b.idCircuito) || String(a.pesoKg || '') !== String(b.pesoKg || '') || a.ultimaFecha !== b.ultimaFecha ||
        provDe(a.proveedor) !== provDe(b.proveedor);
    });
    const [{ n: nCirc }] = await tx`select count(*)::int n from co2_circuitos`;
    if (dif.length || nCirc !== circuitos.length) {
      await tx`delete from co2_cilindros`;
      await tx`delete from co2_circuitos`;
      await upsertCilindros(tx, Object.keys(cilindros).sort().map((s) => filaDeEstado(cilindros[s], fechaAlta[s])));
      await insertar(tx, 'co2_circuitos', circuitos.sort((a, b) => (a.idCircuito < b.idCircuito ? -1 : 1)).map(filaCircuito));
      cctx = await co2Contexto(tx);
    }
    const previas = await tx`select codigo, serie, ref_id, detalle, estado from co2_inconsistencias`;
    const abiertas = new Set(previas.filter((r) => r.estado === 'ABIERTA').map((r) => r.codigo + '|' + r.serie + '|' + r.detalle));
    const yaAlertadas = new Set(previas.map((r) => r.codigo + '|' + r.serie + '|' + r.ref_id));
    const nuevas = incoh.filter((i) => !abiertas.has(i.codigo + '|' + i.serie + '|' + i.mensaje)).map((i) => ({ codigo: i.codigo, serie: i.serie || '', ref_id: '', detalle: i.mensaje, usuario: usuario.email }));
    if (dif.length) nuevas.push({ codigo: 'ESTADO_CORREGIDO', serie: dif.slice(0, 20).join(', '), ref_id: '', usuario: usuario.email,
      detalle: 'El estado guardado de ' + dif.length + ' cilindro(s) no coincidía con el historial y se corrigió desde co2_movimientos.' });
    const alertas = co2_detectarAlertas(cctx.cilindros, { hoy: cctx.hoy, clientes: cctx.clientes, depositos: cctx.depositos, proveedores: cctx.proveedores,
      diasCliente: Number(cctx.config.DIAS_INMOVILIZADO_CLIENTE || 60) || 0, diasVacio: Number(cctx.config.DIAS_VACIO_SIN_DEVOLVER || 30) || 0 })
      .filter((a) => !yaAlertadas.has(a.codigo + '|' + a.serie + '|' + a.idCircuito))
      .map((a) => ({ codigo: a.codigo, serie: a.serie, ref_id: a.idCircuito || '', detalle: a.mensaje, usuario: usuario.email }));
    await insertar(tx, 'co2_inconsistencias', nuevas.concat(alertas));
    await anotar(tx, usuario.email, 'CO2_AUDITAR', 'Series: ' + Object.keys(cilindros).length + ' · movimientos: ' + movs.length,
      nuevas.length + ' incoherencias, ' + alertas.length + ' alertas nuevas' + (dif.length ? ', estado corregido en ' + dif.length + ' series' : ''));
    return { series: Object.keys(cilindros).length, movimientos: movs.length, nuevas: nuevas.length, alertas: alertas.length, corregidas: dif.length };
  });
}
