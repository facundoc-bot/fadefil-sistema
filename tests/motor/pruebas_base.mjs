// Pruebas de punta a punta del guardado en la base (lo que hace la función del servidor "guardar").
// Corre contra un PostgreSQL de prueba con las migraciones aplicadas (lo arma tests/db/probar.sh).
import postgres from 'postgres';
import {
  OPCIONES_POSTGRES, ErrorDeUsuario, usuarioPorEmail, validarLote, guardarLote, anularOperacion, auditar, hoyArgentina
} from '../../supabase/functions/_compartido/estado.js';
import { sumarDias } from '../../supabase/functions/_compartido/motor.js';
import {
  co2Validar, co2Guardar, co2EnviarAprobacion, co2RechazarPendiente, co2ValidarFactura, co2GuardarFactura, co2AnularFactura, co2Anular, co2Auditar
} from '../../supabase/functions/_compartido/co2_estado.js';
import { api } from '../../supabase/functions/_compartido/api.js';
import { co2Api } from '../../supabase/functions/_compartido/co2_api.js';
import { importarValidar, importarMaquinas } from '../../supabase/functions/_compartido/importar.js';
import { readFileSync } from 'node:fs';

const sql = postgres({ ...OPCIONES_POSTGRES, max: 4, onnotice: () => {} });
const hoy = hoyArgentina();
const hace = (n) => sumarDias(hoy, -n);

let fallas = 0, ok = 0;
async function prueba(nombre, fn) {
  try { await fn(); ok++; console.log('✓ ' + nombre); }
  catch (e) { fallas++; console.log('✗ ' + nombre + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e)); }
}
function igual(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg + ': obtuvo ' + JSON.stringify(a) + ', esperaba ' + JSON.stringify(b)); }
function si(c, msg) { if (!c) throw new Error(msg); }
const codigos = (r, campo = 'errores') => r.resultados.flatMap((x) => x[campo].map((e) => e.codigo));
const uno = async (q) => (await q)[0];

// ---------------------------------------------------------------- maestros de prueba
await sql`insert into depositos (deposito_id) values ('Depósito Mendoza')`;
await sql`insert into plazas (plaza_id, region_id, deposito_id, provincia) values ('Mendoza', 'INTERIOR', 'Depósito Mendoza', 'Mendoza')`;
await sql`insert into zonas (zona_id, plaza_id) values ('Mendoza Centro', 'Mendoza'), ('Palermo', 'CABA')`;
await sql`insert into modelos (modelo) values ('AQA 200')`;
await sql`insert into catalogo (codigo, descripcion, categoria) values ('BOMBA', 'Bomba Starflo', 'INSUMO'), ('BOT', 'Botella', 'ADICIONAL'), ('FRENTE', 'Frente de equipo', 'REPUESTO')`;
await sql`insert into clientes (cliente_id, nombre_fantasia, zona_id) values ('10001', 'Bar Ejemplo', 'Mendoza Centro'), ('10002', 'Resto Dos', 'Mendoza Centro'), ('30001', 'Oficina Palermo', 'Palermo')`;
await sql`insert into maquinas (serie, modelo, fecha_alta, deposito_inicial_id) values
  ('E-0001', 'AQA 200', ${hace(200)}, 'Depósito Mendoza'), ('E-0002', 'AQA 200', ${hace(200)}, 'Depósito Mendoza'), ('A-0001', 'AQA 200', ${hace(200)}, 'Depósito CABA')`;
await sql`insert into usuarios (email, nombre, rol) values ('carga@empresa.com', 'Carga', 'CARGA'), ('consulta@empresa.com', 'Consulta', 'CONSULTA')`;

const admin = await usuarioPorEmail(sql, 'FacundoC@aqa.com.ar ');
const carga = await usuarioPorEmail(sql, 'carga@empresa.com');
const consulta = await usuarioPorEmail(sql, 'consulta@empresa.com');

await prueba('Usuarios: el email se busca en minúscula; un mail no habilitado no entra', async () => {
  igual(admin.rol, 'ADMIN', 'Facu es ADMIN');
  let error = '';
  try { await usuarioPorEmail(sql, 'nadie@otro.com'); } catch (e) { error = e instanceof ErrorDeUsuario ? 'usuario' : 'otro'; }
  igual(error, 'usuario', 'un mail que no está en usuarios no entra');
});

await prueba('Permisos: CONSULTA no guarda; CARGA no carga ajustes de stock', async () => {
  for (const [u, ops] of [[consulta, [{ clase: 'ENVIO', datos: {} }]], [carga, [{ clase: 'AJUSTE', datos: {} }]]]) {
    let error = '';
    try { await guardarLote(sql, u, ops, true); } catch (e) { error = e.message; }
    si(/no permite esta acción/.test(error), 'debería frenar por rol: ' + error);
  }
});

await prueba('Envío CABA → Mendoza y su recepción: stock en tránsito, después disponible; numeración ENV/REC', async () => {
  const r = await guardarLote(sql, admin, [{ clase: 'ENVIO', datos: { fecha: hace(120), origen: 'Depósito CABA', destino: 'Depósito Mendoza', transporte: 'Andreani',
    items: [{ codigo: 'BOMBA', cantidad: 4 }, { codigo: 'BOT', cantidad: 40 }], series: ['A-0001'] } }], true);
  igual(r.ok, true, 'se guarda: ' + JSON.stringify(r.resultados));
  igual(r.ids, ['ENV-000001'], 'número del envío');
  igual((await uno(sql`select ubicacion_tipo, ubicacion_id from maquinas_estado where serie = 'A-0001'`)), { ubicacion_tipo: 'TRANSITO', ubicacion_id: 'ENV-000001' }, 'la máquina viaja');
  const r2 = await guardarLote(sql, carga, [{ clase: 'RECEPCION', datos: { fecha: hace(116), idEnvio: 'ENV-000001' } }], false);
  igual(r2.ok, true, 'la recepción se guarda (CARGA puede)');
  igual(r2.ids, ['REC-000001'], 'número de la recepción');
  igual(await uno(sql`select estado, fecha_recepcion, recepcion_id from envios where envio_id = 'ENV-000001'`), { estado: 'RECIBIDO', fecha_recepcion: hace(116), recepcion_id: 'REC-000001' }, 'envío recibido');
  igual(await uno(sql`select disponible from stock where deposito_id = 'Depósito Mendoza' and codigo = 'BOT'`), { disponible: 40 }, '40 botellas en Mendoza');
  igual((await uno(sql`select ubicacion_id from maquinas_estado where serie = 'A-0001'`)).ubicacion_id, 'Depósito Mendoza', 'la máquina llegó');
  igual((await uno(sql`select count(*)::int n from ingresos_salidas where op_id = 'REC-000001' and sentido = 'INGRESO'`)).n, 2, 'dos ingresos por recepción');
});

await prueba('Advertencias: sin aceptarlas no se guarda nada; aceptadas, se guarda la instalación', async () => {
  const ops = [{ clase: 'OT', datos: { fecha: hace(110), idCliente: '10001', tipo: 'INSTALACION', serieInstalada: 'E-0001', tecnico: 'Técnico Mendoza', sistema: '4 Etapas',
    items: [{ codigo: 'BOMBA', cantidad: 1 }, { codigo: 'BOT', cantidad: 6 }] } }];
  const antes = (await uno(sql`select count(*)::int n from operaciones`)).n;
  const v = await validarLote(sql, carga, ops);
  igual(v.ok, true, 'valida sin errores');
  si(codigos(v, 'advertencias').length > 0, 'avisa stock (no hay filtros 4 Etapas en Mendoza)');
  const r = await guardarLote(sql, carga, ops, false);
  igual(r.requiereConfirmacion, true, 'pide confirmar');
  igual((await uno(sql`select count(*)::int n from operaciones`)).n, antes, 'no guardó nada');
  igual((await uno(sql`select ultimo from contadores where prefijo = 'OT'`)) || null, null, 'no gastó número de OT');
  const r2 = await guardarLote(sql, carga, ops, true);
  igual(r2.ok, true, 'aceptando, se guarda');
  igual(r2.ids, ['OT-000001'], 'número de OT');
  const c = await uno(sql`select estado, serie_instalada, fecha_instalacion, fecha_base from clientes_estado where cliente_id = '10001'`);
  igual(c, { estado: 'ACTIVO', serie_instalada: 'E-0001', fecha_instalacion: hace(110), fecha_base: hace(110) }, 'cliente activo');
  igual((await sql`select codigo, saldo, cantidad from clientes_items where cliente_id = '10001' order by codigo`), [
    { codigo: 'BOMBA', saldo: 'COMODATO', cantidad: 1 }, { codigo: 'BOT', saldo: 'COMODATO', cantidad: 6 }], 'comodato');
  igual((await uno(sql`select sistema, desde from clientes_sistemas where cliente_id = '10001'`)), { sistema: '4 Etapas', desde: hace(110) }, 'sistema instalado');
  igual((await uno(sql`select count(*)::int n from clientes_componentes where cliente_id = '10001' and tipo = 'ULTIMO_CAMBIO'`)).n, 4, '4 recambios con fecha');
  igual((await uno(sql`select disponible from stock where deposito_id = 'Depósito Mendoza' and codigo = 'BOT'`)).disponible, 34, 'quedan 34 botellas');
  igual((await uno(sql`select ubicacion_tipo, ubicacion_id, estado from maquinas_estado where serie = 'E-0001'`)), { ubicacion_tipo: 'CLIENTE', ubicacion_id: '10001', estado: 'USADA' }, 'máquina en el cliente');
  igual((await uno(sql`select zona_id, tipo, sistema, tecnico from ot where ot_id = 'OT-000001'`)), { zona_id: 'Mendoza Centro', tipo: 'INSTALACION', sistema: '4 Etapas', tecnico: 'Técnico Mendoza' }, 'fila de la OT');
  igual((await uno(sql`select count(*)::int n from ot_lineas where ot_id = 'OT-000001'`)).n, 2, 'líneas de la OT');
  igual((await uno(sql`select region_id, created_by from operaciones where op_id = 'OT-000001'`)), { region_id: 'INTERIOR', created_by: 'carga@empresa.com' }, 'registro de la operación');
});

await prueba('Errores: una OT inválida frena todo el lote (lo válido tampoco se guarda)', async () => {
  const antes = (await uno(sql`select count(*)::int n from operaciones`)).n;
  const r = await guardarLote(sql, admin, [
    { clase: 'OT', datos: { fecha: hace(100), idCliente: '10001', tipo: 'ENTREGA_ADICIONALES', items: [{ codigo: 'BOT', cantidad: 2 }] } },
    { clase: 'OT', datos: { fecha: hace(100), idCliente: '10001', tipo: 'INSTALACION', serieInstalada: 'E-0002', sistema: '4 Etapas' } }
  ], true);
  igual(r.ok, false, 'no se guarda');
  si(codigos(r).includes('CLIENTE_YA_ACTIVO'), 'avisa que ya está activo: ' + codigos(r));
  igual(r.resultados[0].errores.length, 0, 'la primera no tiene errores');
  igual((await uno(sql`select count(*)::int n from operaciones`)).n, antes, 'no se guardó ninguna');
});

await prueba('Alta inicial con cliente nuevo y máquina nueva desde CABA: envío, recepción y ajustes automáticos', async () => {
  const r = await guardarLote(sql, admin, [{ clase: 'OT', datos: { fecha: hace(60), tipo: 'ALTA_INICIAL', serieInstalada: 'm-9001', traerMaquina: true, maquinaNueva: { modelo: 'AQA 200' },
    fechaInstalacion: hace(400), sistema: 'PWG HP PRO', items: [{ codigo: 'BOT', cantidad: 2 }],
    clienteNuevo: { id: '10003', nombre: 'Café Tres', zonaId: 'Mendoza Centro', esquemaMant: 'e;-;-;-;-;p' } } }], true);
  igual(r.ok, true, 'se guarda: ' + JSON.stringify(r.resultados));
  igual(r.ids.length, 6, 'envío + recepción + 3 ajustes (botella, cartucho, cabezal) + la OT: ' + r.ids);
  igual(await uno(sql`select nombre_fantasia, esquema_mant from clientes where cliente_id = '10003'`), { nombre_fantasia: 'Café Tres', esquema_mant: 'E;-;-;-;-;P' }, 'cliente dado de alta con su esquema');
  igual(await uno(sql`select deposito_inicial_id from maquinas where serie = 'M-9001'`), { deposito_inicial_id: 'Depósito CABA' }, 'máquina dada de alta en el central');
  igual(await uno(sql`select ubicacion_tipo, ubicacion_id from maquinas_estado where serie = 'M-9001'`), { ubicacion_tipo: 'CLIENTE', ubicacion_id: '10003' }, 'máquina en el cliente');
  const ot = r.ids[r.ids.length - 1];
  const d = (await uno(sql`select datos from operaciones where op_id = ${ot}`)).datos;
  igual(d.operacionesAuto.length, 5, 'la OT conoce sus automáticas');
  igual((await uno(sql`select count(*)::int n from operaciones where datos ->> 'generadaPor' = ${ot}`)).n, 5, 'las automáticas conocen su OT');
  igual(await uno(sql`select estado from envios where envio_id = ${r.ids[0]}`), { estado: 'RECIBIDO' }, 'el envío automático quedó recibido');
  igual((await uno(sql`select coalesce(sum(cantidad), 0)::int n from ajustes_stock where generada_por = ${ot}`)).n, 4, 'ajustes por 2 botellas, cartucho y cabezal');
});

await prueba('Desinstalación con retiro a revisión y revisión de ítems (lotes)', async () => {
  const r = await guardarLote(sql, admin, [{ clase: 'OT', datos: { fecha: hace(30), idCliente: '10001', tipo: 'DESINSTALACION', serieRetirada: 'E-0001',
    items: [{ codigo: 'BOMBA', cantidad: 1, mov: 'RETIRADO' }, { codigo: 'BOT', cantidad: 4, mov: 'RETIRADO' }] } }], true);
  igual(r.ok, true, 'desinstalación: ' + JSON.stringify(r.resultados));
  const c = await uno(sql`select estado from clientes_estado where cliente_id = '10001'`);
  igual(c.estado, 'EX_CLIENTE', 'ex cliente');
  igual((await sql`select codigo, cantidad from clientes_items where cliente_id = '10001' and saldo = 'FALTANTE'`), [{ codigo: 'BOT', cantidad: 2 }], 'faltan 2 botellas');
  igual((await uno(sql`select estado, revision_abierta_id from maquinas_estado where serie = 'E-0001'`)).estado, 'A_REVISAR', 'máquina a revisar');
  igual((await uno(sql`select count(*)::int n from taller where estado = 'ABIERTO'`)).n, 1, 'revisión abierta');
  igual((await uno(sql`select a_revisar from stock where deposito_id = 'Depósito Mendoza' and codigo = 'BOT'`)).a_revisar, 4, '4 botellas a revisar');
  const lote = (await uno(sql`select lote_id from lotes_revision where codigo = 'BOT'`)).lote_id;
  const r2 = await guardarLote(sql, carga, [
    { clase: 'REVISION_ITEMS', datos: { fecha: hace(29), deposito: 'Depósito Mendoza', items: [{ codigo: 'BOT', cantidad: 4, resultado: 'DISPONIBLE', lote }] } },
    { clase: 'CIERRE', datos: { fecha: hace(29), serie: 'E-0001', resultado: 'REPARADA', diagnostico: 'Cambio de frente', items: [{ codigo: 'FRENTE', cantidad: 1 }] } }
  ], true);
  igual(r2.ok, true, 'revisión y cierre: ' + JSON.stringify(r2.resultados));
  igual((await sql`select lote_id from lotes_revision where codigo = 'BOT'`).length, 0, 'el lote de botellas se resolvió (se borra)');
  igual(await uno(sql`select disponible, a_revisar from stock where deposito_id = 'Depósito Mendoza' and codigo = 'BOT'`), { disponible: 38, a_revisar: 0 }, 'las 4 botellas revisadas vuelven al disponible (34 + 4)');
  igual(await uno(sql`select estado, resultado from taller where serie = 'E-0001'`), { estado: 'CERRADO', resultado: 'REPARADA' }, 'revisión cerrada');
  igual((await uno(sql`select count(*)::int n from taller_lineas`)).n, 1, 'el frente usado queda en la revisión');
  igual((await uno(sql`select estado, revision_abierta_id from maquinas_estado where serie = 'E-0001'`)), { estado: 'USADA', revision_abierta_id: '' }, 'máquina usada otra vez');
  igual((await uno(sql`select resultado from revision_lineas where revision_id = ${r2.ids[0]}`)).resultado, 'DISPONIBLE', 'registro de la revisión');
});

await prueba('Dos guardados a la vez: se hacen de a uno, con números distintos', async () => {
  const op = (n) => [{ clase: 'AJUSTE', datos: { fecha: hace(10), deposito: 'Depósito Mendoza', codigo: 'BOMBA', cantidad: n, tipo: 'COMPRA' } }];
  const [a, b] = await Promise.all([guardarLote(sql, admin, op(1), true), guardarLote(sql, admin, op(2), true)]);
  igual(a.ok && b.ok, true, 'los dos se guardan');
  si(a.ids[0] !== b.ids[0], 'con distinto número: ' + a.ids + ' / ' + b.ids);
  igual((await uno(sql`select disponible from stock where deposito_id = 'Depósito Mendoza' and codigo = 'BOMBA'`)).disponible, 6, '4 - 1 + 1 + 2 = 6 bombas');
});

await prueba('Auditoría: el estado guardado de a poco es igual al rearmado desde el registro', async () => {
  const r = await auditar(sql, admin);
  igual(r.corregidas, [], 'no hay nada que corregir');
  si(r.operaciones >= 12, 'repasó todas las operaciones: ' + r.operaciones);
});

await prueba('Auditoría: si alguien toca el stock a mano, lo corrige y lo anota', async () => {
  await sql`update stock set disponible = 999 where deposito_id = 'Depósito Mendoza' and codigo = 'BOT'`;
  const r = await auditar(sql, admin);
  igual(r.corregidas.map((x) => x.tabla), ['stock'], 'corrigió el stock');
  igual((await uno(sql`select disponible from stock where deposito_id = 'Depósito Mendoza' and codigo = 'BOT'`)).disponible, 38, 'volvió a 38');
  si((await uno(sql`select count(*)::int n from inconsistencias where codigo = 'ESTADO_CORREGIDO'`)).n >= 1, 'quedó anotado');
});

await prueba('Anular: no se anula algo de lo que dependen operaciones posteriores; sí lo último, y se rearma el estado', async () => {
  let r = await anularOperacion(sql, admin, 'OT-000001', 'Cargada por error');
  igual(r.ok, false, 'la instalación no se anula (después hubo una desinstalación)');
  igual(r.errores[0].codigo, 'ANULACION_CON_OPERACIONES_POSTERIORES', 'por dependencias');
  const aj = (await uno(sql`select ajuste_id from ajustes_stock where tipo = 'COMPRA' and cantidad = 2`)).ajuste_id;
  r = await anularOperacion(sql, admin, aj, 'Compra duplicada');
  igual(r.ok, true, 'anula el ajuste: ' + JSON.stringify(r));
  igual((await uno(sql`select estado from ajustes_stock where ajuste_id = ${aj}`)).estado, 'ANULADA', 'el ajuste queda anulado');
  igual((await uno(sql`select estado from operaciones where op_id = ${aj}`)).estado, 'ANULADA', 'la operación queda anulada');
  igual((await uno(sql`select disponible from stock where deposito_id = 'Depósito Mendoza' and codigo = 'BOMBA'`)).disponible, 4, 'vuelven a ser 4 bombas');
  igual((await auditar(sql, admin)).corregidas, [], 'después de anular, el estado coincide con el registro');
  let error = '';
  try { await anularOperacion(sql, carga, aj, 'Prueba de permisos'); } catch (e) { error = e.message; }
  si(/no permite/.test(error), 'CARGA no anula');
});

await prueba('Anular un alta inicial anula también sus automáticas (envío, recepción, ajustes)', async () => {
  const ot = (await uno(sql`select op_id from operaciones where clase = 'OT' and datos ->> 'tipo' = 'ALTA_INICIAL'`)).op_id;
  const auto = (await uno(sql`select op_id from operaciones where datos ->> 'generadaPor' = ${ot} limit 1`)).op_id;
  const r0 = await anularOperacion(sql, admin, auto, 'Prueba de automática');
  igual(r0.errores[0].codigo, 'OPERACION_AUTOMATICA', 'una automática no se anula sola');
  const r = await anularOperacion(sql, admin, ot, 'Cliente cargado por error');
  igual(r.ok, true, 'se anula: ' + JSON.stringify(r));
  igual(r.ids.length, 6, 'junto con sus 5 automáticas');
  igual((await uno(sql`select ubicacion_tipo, ubicacion_id from maquinas_estado where serie = 'M-9001'`)), { ubicacion_tipo: 'DEPOSITO', ubicacion_id: 'Depósito CABA' }, 'la máquina vuelve al central');
  igual((await sql`select 1 from clientes_estado where cliente_id = '10003'`).length, 0, 'el cliente queda sin datos');
  igual((await uno(sql`select estado from envios where envio_id = ${r.ids[1]}`)).estado, 'ANULADO', 'el envío automático queda anulado');
});

// ---------------------------------------------------------------- CO₂
const remito = (nro, fecha, entregas, retiros = [], extra = {}) => ({ clase: 'REMITO', datos: { nroRemito: nro, fecha, idDeposito: 'Depósito Mendoza', origenCarga: 'PDF',
  lineas: entregas.map((x) => (typeof x === 'string' ? { tipo: 'ENTREGA', serie: x, pesoKg: 10 } : { tipo: 'ENTREGA', pesoKg: 10, ...x })).concat(retiros.map((x) => ({ tipo: 'RETIRO', serie: x }))), ...extra } });
const cil = async (serie) => uno(sql`select estado, ubicacion_tipo, ubicacion_id, peso_kg from co2_cilindros where serie = ${serie}`);

await prueba('CO₂: remito de LINDE con 3 cilindros llenos; un número de remito no se repite', async () => {
  const r = await co2Guardar(sql, carga, [remito('0001-00000101', hace(20), ['A1000001', 'A1000002', 'A1000003'])]);
  igual(r.ok, true, 'se guarda: ' + JSON.stringify(r.resultados));
  igual(await cil('A1000001'), { estado: 'LLENO_DISPONIBLE', ubicacion_tipo: 'DEPOSITO', ubicacion_id: 'Depósito Mendoza', peso_kg: 10 }, 'cilindro lleno en el depósito');
  igual((await uno(sql`select count(*)::int n from co2_circuitos where estado = 'ABIERTO'`)).n, 3, 'tres circuitos abiertos');
  igual((await uno(sql`select count(*)::int n from co2_remito_lineas where remito_id = ${r.ids[0]} and movimiento_id <> ''`)).n, 3, 'cada línea con su movimiento');
  const r2 = await co2Validar(sql, carga, [remito('1-101', hace(19), ['A1000009'])]);
  si(codigos(r2).includes('REMITO_DUPLICADO'), 'mismo número (escrito distinto) → duplicado: ' + codigos(r2));
  let error = '';
  try { await co2Guardar(sql, carga, [{ clase: 'ALTA', datos: {} }]); } catch (e) { error = e.message; }
  si(/no permite/.test(error), 'el inventario inicial es solo de ADMIN');
});

await prueba('CO₂ en OT: entrega tradicional y recambio de emergencia con costo (va a cobranzas)', async () => {
  let r = await guardarLote(sql, carga, [{ clase: 'OT', datos: { fecha: hace(25), idCliente: '10002', tipo: 'INSTALACION', serieInstalada: 'E-0002', sistema: '4 Etapas' } }], true);
  igual(r.ok, true, 'instalación del cliente 10002: ' + JSON.stringify(r.resultados));
  r = await guardarLote(sql, carga, [{ clase: 'OT', datos: { fecha: hace(15), idCliente: '10002', tipo: 'ENTREGA_CO2', modalidadCo2: 'TRADICIONAL', co2: { entregadas: ['a1000001'] } } }], true);
  igual(r.ok, true, 'entrega: ' + JSON.stringify(r.resultados));
  const ot1 = r.ids[0];
  igual(await cil('A1000001'), { estado: 'EN_USO', ubicacion_tipo: 'CLIENTE', ubicacion_id: '10002', peso_kg: 10 }, 'el cilindro está en el cliente');
  igual(await uno(sql`select tipo, cliente_id from co2_trabajos where trabajo_id = ${ot1}`), { tipo: 'ENTREGA', cliente_id: '10002' }, 'el trabajo de CO₂ lleva el número de la OT');
  igual(await uno(sql`select codigo, cantidad, movimiento, cobranza from ot_lineas where ot_id = ${ot1}`), { codigo: 'CO2', cantidad: 1, movimiento: 'ENTREGADO', cobranza: false }, 'línea CO2 sin cobranza');
  const v = await validarLote(sql, carga, [{ clase: 'OT', datos: { fecha: hace(12), idCliente: '10002', tipo: 'ENTREGA_CO2', modalidadCo2: 'TRADICIONAL', co2: { entregadas: ['A1000001'] } } }]);
  si(codigos(v).some((c) => /^.*/.test(c)) && !v.ok, 'no se entrega un cilindro que ya está en el cliente: ' + codigos(v));
  si(v.resultados[0].errores.every((e) => e.mensaje.startsWith('CO₂: ')), 'los errores del motor de CO₂ vienen marcados');
  r = await guardarLote(sql, carga, [{ clase: 'OT', datos: { fecha: hace(10), idCliente: '10002', tipo: 'ENTREGA_CO2', modalidadCo2: 'EMERGENCIA_CON_COSTO', co2: { entregadas: ['A1000002'], retiradas: ['A1000001'] } } }], true);
  igual(r.ok, true, 'recambio: ' + JSON.stringify(r.resultados));
  igual(await cil('A1000001'), { estado: 'VACIO_DISPONIBLE', ubicacion_tipo: 'DEPOSITO', ubicacion_id: 'Depósito Mendoza', peso_kg: 10 }, 'el retirado vuelve vacío al depósito');
  igual((await sql`select movimiento, cobranza from ot_lineas where ot_id = ${r.ids[0]} order by linea_id`), [{ movimiento: 'ENTREGADO', cobranza: true }, { movimiento: 'RETIRADO', cobranza: false }], 'la entrega de emergencia con costo va a cobranzas');
  const d = await validarLote(sql, carga, [{ clase: 'OT', datos: { fecha: hace(9), idCliente: '10002', tipo: 'DESINSTALACION_MOMENTANEA', serieRetirada: 'E-0002' } }]);
  si(codigos(d, 'advertencias').includes('CO2_PENDIENTE_EN_CLIENTE'), 'al desinstalar avisa que quedan cilindros en el cliente');
});

await prueba('CO₂: series dudosas → pendiente de aprobación; la aprueba un ADMIN', async () => {
  const op = remito('0001-00000102', hace(8), [{ serie: 'A1000004', dudosa: true, sugerida: 'A1000004', serieLeidaIA: 'A1OOOO04' }]);
  const r0 = await co2Guardar(sql, carga, [op]);
  igual(r0.ok, false, 'CARGA no la guarda directo');
  si(codigos(r0).includes('SERIE_DUDOSA'), 'por la serie dudosa');
  const p = await co2EnviarAprobacion(sql, carga, op.datos);
  igual(p.ok, true, 'queda pendiente: ' + JSON.stringify(p));
  igual((await uno(sql`select estado from co2_remitos where remito_id = ${p.id}`)).estado, 'PENDIENTE_APROBACION', 'pendiente de aprobación');
  igual((await uno(sql`select revision from co2_remito_lineas where remito_id = ${p.id}`)).revision, 'DUDOSA:A1000004', 'la línea queda marcada');
  const aprob = JSON.parse(JSON.stringify(op));
  aprob.datos.idPendiente = p.id;
  aprob.datos.lineas[0].aprobada = true;
  const r = await co2Guardar(sql, admin, [aprob]);
  igual(r.ok, true, 'el ADMIN la aprueba: ' + JSON.stringify(r.resultados));
  igual((await sql`select 1 from co2_remitos where remito_id = ${p.id}`).length, 0, 'el pendiente se reemplaza por el confirmado');
  si(/^APROBADA: se leyó A1OOOO04/.test((await uno(sql`select revision from co2_remito_lineas where remito_id = ${r.ids[0]}`)).revision), 'queda registrado quién y qué aprobó');
  const p2 = await co2EnviarAprobacion(sql, carga, remito('0001-00000199', hace(8), [{ serie: 'A1000008', dudosa: true }]).datos);
  const x = await co2RechazarPendiente(sql, admin, p2.id);
  igual(x.pendientes, 0, 'rechazado, no queda ninguno pendiente');
});

await prueba('CO₂: factura de LINDE por kg (30 kg = 3 × 10 kg); diferencias y remito ya facturado', async () => {
  const f = { nroFactura: '0380-00012345', fecha: hace(3), lineas: [{ nroRemito: '1-101', kg: 30 }, { nroRemito: '0001-00000102', kg: 20 }, { nroRemito: '9-999', kg: 5 }] };
  const v = await co2ValidarFactura(sql, f);
  igual(v.lineas.map((x) => x.resultado), ['VALIDADO', 'DIFERENCIA_KG', 'NO_ENCONTRADO'], 'resultado por remito');
  igual(v.lineas[0].composicion, '3 × 10 kg', 'composición');
  const g = await co2GuardarFactura(sql, carga, f);
  igual(g.estado, 'CON_DIFERENCIAS', 'queda con diferencias para reclamar');
  const v2 = await co2ValidarFactura(sql, { nroFactura: '0380-00012346', fecha: hace(2), lineas: [{ nroRemito: '0001-00000101', kg: 30 }] });
  igual(v2.lineas[0].resultado, 'YA_FACTURADO', 'un remito no se factura dos veces');
  const v3 = await co2ValidarFactura(sql, f);
  si(v3.errores.some((e) => /ya está cargada/.test(e)), 'la misma factura no se carga dos veces');
  await co2AnularFactura(sql, admin, g.id, 'Prueba de anulación');
  igual((await co2ValidarFactura(sql, { nroFactura: 'X-1', fecha: hace(2), lineas: [{ nroRemito: '0001-00000101', kg: 30 }] })).lineas[0].resultado, 'VALIDADO', 'anulada la factura, el remito queda libre');
});

await prueba('CO₂: LINDE retira el vacío (cierra el circuito); anulaciones respetan el orden', async () => {
  const r = await co2Guardar(sql, carga, [remito('0001-00000103', hace(5), [], ['A1000001'])]);
  igual(r.ok, true, 'retiro: ' + JSON.stringify(r.resultados));
  igual((await cil('A1000001')).estado, 'ENTREGADO_LINDE', 'entregado a LINDE');
  igual((await uno(sql`select estado, ref_salida from co2_circuitos where serie = 'A1000001'`)), { estado: 'CERRADO', ref_salida: r.ids[0] }, 'circuito cerrado');
  const otRecambio = (await uno(sql`select ot_id from ot where modalidad_co2 = 'EMERGENCIA_CON_COSTO'`)).ot_id;
  let a = await anularOperacion(sql, admin, otRecambio, 'Recambio cargado por error');
  igual(a.ok, false, 'la OT no se anula: LINDE ya retiró ese cilindro');
  si(a.errores[0].mensaje.startsWith('CO₂: '), 'el motivo es de CO₂: ' + JSON.stringify(a.errores));
  a = await co2Anular(sql, admin, r.ids[0], 'Retiro cargado por error');
  igual(a.ok, true, 'se anula el retiro de LINDE');
  a = await anularOperacion(sql, admin, otRecambio, 'Recambio cargado por error');
  igual(a.ok, true, 'ahora sí se anula la OT con sus cilindros: ' + JSON.stringify(a));
  igual(await cil('A1000001'), { estado: 'EN_USO', ubicacion_tipo: 'CLIENTE', ubicacion_id: '10002', peso_kg: 10 }, 'el cilindro vuelve al cliente');
  igual((await cil('A1000002')).estado, 'LLENO_DISPONIBLE', 'el entregado vuelve lleno al depósito');
  igual((await uno(sql`select estado from co2_trabajos where trabajo_id = ${otRecambio}`)).estado, 'ANULADO', 'el trabajo de CO₂ queda anulado');
  let error = '';
  try { await co2Anular(sql, admin, otRecambio, 'Prueba de anulación'); } catch (e) { error = e.message; }
  si(/junto con la OT/.test(error), 'los cilindros de una OT no se anulan sueltos');
});

await prueba('Auditorías: equipos y CO₂ coinciden con el historial; si se toca un cilindro a mano, se corrige', async () => {
  igual((await auditar(sql, admin)).corregidas, [], 'equipos y stock sin diferencias');
  let r = await co2Auditar(sql, admin);
  igual(r.corregidas, 0, 'CO₂ sin diferencias');
  await sql`update co2_cilindros set estado = 'VACIO_DISPONIBLE' where serie = 'A1000003'`;
  r = await co2Auditar(sql, admin);
  igual(r.corregidas, 1, 'corrige el cilindro tocado');
  igual((await cil('A1000003')).estado, 'LLENO_DISPONIBLE', 'vuelve a lleno');
});

// ---------------------------------------------------------------- pantallas (mismas respuestas que en Sheets)
await prueba('Pantalla principal: datos de arranque, fichas, recientes, técnicos y movimientos', async () => {
  const ini = await api(sql, consulta, 'apiInicio', []);
  si(ini.clientes.length >= 3 && ini.maquinas.length >= 3 && ini.catalogo.every((c) => c.codigo !== 'CO2'), 'clientes, máquinas y catálogo (sin el código CO2)');
  si(ini.depositos.some((d) => d.id === 'Depósito Mendoza' && d.region === 'INTERIOR'), 'depósitos con su región');
  si(ini.stock.some((x) => x.deposito === 'Depósito Mendoza' && x.codigo === 'BOT'), 'stock por depósito');
  si(ini.co2 && ini.co2.enCliente['10002'] && ini.co2.enCliente['10002'].length === 1, 'cilindros en el cliente para la OT');
  igual(ini.urlApp, 'co2.html', 'enlace a la pantalla de CO₂');
  const f = await api(sql, consulta, 'apiFichaCliente', ['10002']);
  si(f.historial.length >= 2 && f.historial.some((h) => h.items.some((t) => /^CO₂ entregado: A1000001/.test(t))), 'ficha con historial y series de CO₂: ' + JSON.stringify(f.historial.map((h) => h.items)));
  const m = await api(sql, consulta, 'apiFichaMaquina', ['E-0001']);
  si(m.eventos.length >= 4, 'ficha de la máquina con su historia: ' + m.eventos.length);
  si((await api(sql, consulta, 'apiRecientes', [])).length >= 10, 'recientes');
  const t = await api(sql, consulta, 'apiTecnicos', [hace(200), hoy]);
  si(t.ots.length >= 3, 'informe de técnicos');
  si((await api(sql, consulta, 'apiIngresosSalidas', [hace(365), hoy])).length > 0, 'ingresos y salidas');
  si((await api(sql, consulta, 'apiMovimientosItem', ['BOT', '', ''])).filas.length > 0, 'kárdex de un ítem');
  let error = '';
  try { await api(sql, consulta, 'apiConfirmar', [[{ clase: 'ENVIO', datos: {} }], true]); } catch (e) { error = e.message; }
  si(/no permite/.test(error), 'CONSULTA no guarda desde la pantalla');
  const v = await api(sql, carga, 'apiValidar', [[{ clase: 'OT', datos: { fecha: hoy, idCliente: '10002', tipo: 'MANTENIMIENTO' } }]]);
  igual(v.ok, true, 'validar desde la pantalla');
});

await prueba('Esquema de mantenimientos: Express guardado, ficha con lo que toca, esquema propio y auditoría', async () => {
  const antes = (await api(sql, consulta, 'apiInicio', [])).mantenimiento.find((m) => m.id === '10002');
  igual([antes.tipoMant, antes.mesEsquema], ['EXPRESS', 3], 'con el esquema por defecto le toca Express al mes 3');
  const r = await api(sql, carga, 'apiConfirmar', [[{ clase: 'OT', datos: { fecha: hoy, idCliente: '10002', tipo: 'MANTENIMIENTO', tipoMant: 'EXPRESS', items: [] } }], true]);
  igual(r.ok, true, 'se guarda el Express: ' + JSON.stringify(r.resultados && r.resultados.map((x) => x.errores)));
  igual(await uno(sql`select tipo_mantenimiento from ot where ot_id = ${r.ids[0]}`), { tipo_mantenimiento: 'EXPRESS' }, 'la OT guarda el tipo');
  igual(await uno(sql`select mant_mes, tipo_ultimo_mant from clientes_estado where cliente_id = '10002'`), { mant_mes: 3, tipo_ultimo_mant: 'EXPRESS' }, 'el cliente queda en el mes 3');
  let m = (await api(sql, consulta, 'apiInicio', [])).mantenimiento.find((x) => x.id === '10002');
  igual([m.tipoMant, m.proximo.slice(5) === hoy.slice(5) || m.proximo > hoy], ['PROFUNDO', true], 'ahora toca el Profundo del mes 6');
  await api(sql, carga, 'apiGuardarCliente', [{ id: '10002', nombre: 'Resto Dos', zonaId: 'Mendoza Centro', esquemaMant: 'P;-;-;-;-;-' }]);
  m = (await api(sql, consulta, 'apiInicio', [])).mantenimiento.find((x) => x.id === '10002');
  igual([m.esquema, m.esquemaPropio, m.tipoMant, m.mesEsquema], ['P;-;-;-;-;-', true, 'PROFUNDO', 1], 'esquema propio desde la ficha');
  let error = '';
  try { await api(sql, carga, 'apiGuardarCliente', [{ id: '10002', nombre: 'Resto Dos', zonaId: 'Mendoza Centro', esquemaMant: '-;-;-;-;-;-' }]); } catch (e) { error = e.message; }
  si(/al menos un mes/.test(error), 'un esquema sin mantenimientos no se guarda');
  await api(sql, carga, 'apiGuardarCliente', [{ id: '10002', nombre: 'Resto Dos', zonaId: 'Mendoza Centro', esquemaMant: '' }]);
  igual((await auditar(sql, admin)).corregidas, [], 'la auditoría rearma el mismo mes del esquema desde el historial');
});

await prueba('Pantalla de CO₂: arranque, ficha de serie, recientes, resumen de remitos, saldo con LINDE, recambios y alertas', async () => {
  const ini = await co2Api(sql, consulta, 'apiInicio', []);
  si(ini.cilindros.length >= 3 && ini.depositos.length >= 2 && ini.cargas.join() === '5,10', 'arranque');
  const f = await co2Api(sql, consulta, 'apiFichaSerie', ['a1000001']);
  si(f.existe && f.movimientos.length >= 3, 'ficha de la serie');
  si((await co2Api(sql, consulta, 'apiRecientes', [])).some((x) => x.clase === 'Remito LINDE'), 'recientes');
  const rr = await co2Api(sql, consulta, 'apiResumenRemitos', [{}]);
  igual(rr.totales.kg, 40, '40 kg entregados por LINDE (3 + 1 cilindros de 10 kg)');
  const sl = await co2Api(sql, consulta, 'apiSaldoLinde', [{}]);
  si(sl.series.length >= 4, 'saldo con LINDE');
  si(Array.isArray((await co2Api(sql, consulta, 'apiRecambios', [6])).clientes || []), 'recambios');
  si(Array.isArray((await co2Api(sql, consulta, 'apiAlertas', [])).alertas), 'alertas');
  igual((await co2Api(sql, consulta, 'apiPendientesAprobacion', [])).length, 0, 'sin pendientes');
});

await prueba('Leer PDF: el texto que extrae el navegador (pdf.js) se interpreta igual que antes', async () => {
  await sql`insert into depositos (deposito_id) values ('Depósito Córdoba')`;
  await sql`insert into co2_depositos (deposito_id, plaza_linde) values ('Depósito Córdoba', '23081740')`;
  const texto = readFileSync(new URL('./fixtures/remito_511-6544.txt', import.meta.url), 'utf8');
  const r = await co2Api(sql, carga, 'apiLeerRemitoPDF', [{ texto, archivo: { url: 'archivo.html?r=remitos%2F2025%2Fx.pdf', hash: 'abc', nombre: 'x.pdf' } }]);
  igual([r.remito.nroRemito, r.remito.fecha, r.remito.idDeposito], ['00511-00006544', '2025-10-24', 'Depósito Córdoba'], 'número, fecha y depósito (por el código de LINDE)');
  igual(r.remito.lineas.filter((l) => l.tipo === 'ENTREGA' && l.pesoKg === 10).length, 48, '48 cilindros de 10 kg');
  si(/^Coincide/.test(r.remito.control), 'coincide con los totales: ' + r.remito.control);
  const tf = readFileSync(new URL('./fixtures/factura_525-3080.txt', import.meta.url), 'utf8');
  const fa = await co2Api(sql, carga, 'apiLeerFacturaPDF', [{ texto: tf, archivo: {} }]);
  igual([fa.factura.nroFactura, fa.factura.lineas[0].nroRemito, fa.factura.lineas[0].kg], ['00525-00003080', '00290-00005053', 90], 'factura: número, remito y kg');
});

await prueba('Carga masiva: valida máquinas, clientes, comodato, componentes, cilindros y stock; después se guarda en tandas', async () => {
  const hojas = {
    maquinas: [{ serie: 'IMP-1', modelo: 'AQA 200', fecha_ingreso: '01/03/2024' }, { serie: 'IMP-2', modelo: 'NO EXISTE', fecha_ingreso: '2024-03-01' }],
    clientes: [
      { cliente_id: '70001', nombre_fantasia: 'Importado Uno', plaza: 'Mendoza', zona: 'Mendoza Centro', estado: 'Activo', serie: 'imp-1', fecha_instalacion: '2024-05-10', sistema: '4 Etapas' },
      { cliente_id: '70002', nombre_fantasia: 'Importado Dos', zona: 'Zona Inexistente', estado: 'Ex cliente' },
      { cliente_id: '10002', nombre_fantasia: 'Ya está', zona: 'Mendoza Centro', estado: 'Ex cliente' }
    ],
    comodato: [{ cliente_id: '70001', codigo: 'BOT', cantidad: 4 }],
    componentes: [{ cliente_id: '70001', codigo: 'SED1', ultimo_cambio: '2024-09-01' }],
    cilindros: [{ cliente_id: '70001', serie: 'A7000001', peso_kg: 10 }],
    stock: [{ deposito: 'Depósito Mendoza', codigo: 'FRENTE', cantidad: 5 }]
  };
  const v = await importarValidar(sql, admin, hojas);
  const fila = (h, n) => v.filas.find((x) => x.hoja === h && x.fila === n);
  igual(fila('maquinas', 2).resultado, 'OK', 'máquina OK');
  igual(fila('maquinas', 3).resultado, 'ERROR', 'modelo inexistente');
  si(fila('clientes', 2).op && fila('clientes', 2).op.datos.traerMaquina, 'cliente OK; la máquina viene del central: ' + fila('clientes', 2).detalle);
  igual(fila('clientes', 3).resultado, 'ERROR', 'zona inexistente');
  igual(fila('clientes', 4).resultado, 'YA CARGADO', 'un cliente que ya está se saltea');
  igual(fila('cilindros', 2).resultado, 'OK', 'cilindro OK');
  igual(fila('stock', 2).resultado, 'OK', 'stock OK');
  let error = '';
  try { await importarValidar(sql, carga, hojas); } catch (e) { error = e.message; }
  si(/no permite/.test(error), 'la carga masiva es de ADMIN');
  igual((await importarMaquinas(sql, admin, v.filas.filter((x) => x.hoja === 'maquinas' && x.op))).cargadas, 1, 'se carga la máquina');
  const ots = v.filas.filter((x) => x.hoja === 'clientes' && x.op).map((x) => x.op);
  const g = await guardarLote(sql, admin, ots, true);
  igual(g.ok, true, 'se guardan los clientes: ' + JSON.stringify(g.resultados));
  igual((await uno(sql`select estado, serie_instalada from clientes_estado where cliente_id = '70001'`)), { estado: 'ACTIVO', serie_instalada: 'IMP-1' }, 'cliente activo con su máquina');
  igual((await uno(sql`select ultimo_cambio from clientes_componentes where cliente_id = '70001' and codigo = 'SED1' and tipo = 'ULTIMO_CAMBIO'`)).ultimo_cambio, '2024-09-01', 'fecha del último cambio del componente');
  const c = await co2Guardar(sql, admin, v.filas.filter((x) => x.hoja === 'cilindros' && x.op).map((x) => x.op));
  igual(c.ok, true, 'cilindro en el cliente: ' + JSON.stringify(c.resultados));
  const st = await guardarLote(sql, admin, v.filas.filter((x) => x.hoja === 'stock' && x.op).map((x) => x.op), true);
  igual(st.ok, true, 'stock inicial');
  const v2 = await importarValidar(sql, admin, hojas);
  igual(v2.filas.find((x) => x.hoja === 'clientes' && x.fila === 2).resultado, 'YA CARGADO', 'al validar de nuevo, lo importado se saltea');
  igual((await auditar(sql, admin)).corregidas, [], 'todo coincide con el historial');
});

await prueba('CO₂ con dos proveedores: Gases Nordelta en GBA (mismo depósito que CABA), cargas fijas por serie, facturas y saldo', async () => {
  await sql`insert into zonas (zona_id, plaza_id) values ('Tigre', 'GBA')`;
  await sql`insert into clientes (cliente_id, nombre_fantasia, zona_id) values ('40001', 'Kiosco Tigre', 'Tigre')`;
  await sql`update co2_config set valor = '2,5; 5; 10; 25' where clave = 'CARGAS_KG'`;
  const rem = (nro, prov, series, kg, extra = {}) => ({ clase: 'REMITO', datos: { nroRemito: nro, fecha: hace(3), idDeposito: 'Depósito CABA', proveedor: prov, origenCarga: 'MANUAL',
    lineas: series.map((x) => ({ tipo: 'ENTREGA', serie: x, pesoKg: kg })), ...extra } });
  let r = await co2Guardar(sql, carga, [rem('0001-00000101', 'GN', ['GN0001', 'GN0002'], 25), rem('0001-00000777', 'LINDE', ['L0000001'], 2.5)]);
  igual(r.ok, true, 'remitos de GN (con un número que LINDE ya usó) y de LINDE (2,5 kg): ' + JSON.stringify(r.resultados && r.resultados.map((x) => x.errores)));
  igual(await uno(sql`select proveedor, peso_kg from co2_cilindros where serie = 'GN0001'`), { proveedor: 'GN', peso_kg: 25 }, 'la serie queda de GN con 25 kg');
  igual(await uno(sql`select proveedor from co2_remitos where remito_id = ${r.ids[0]}`), { proveedor: 'GN' }, 'el remito guarda su proveedor');
  const v = await co2Validar(sql, carga, [rem('0001-00000101', 'GN', ['GN0009'], 25)]);
  si(codigos(v).includes('REMITO_DUPLICADO'), 'dentro de GN el número no se repite: ' + codigos(v));
  const v2 = await co2Validar(sql, carga, [rem('0001-00000900', 'GN', ['GN0010'], 7)]);
  si(codigos(v2).includes('CARGA_INVALIDA'), 'una carga que no está en la configuración: ' + codigos(v2));
  const alta = (serie, prov) => ({ clase: 'ALTA', datos: { fecha: hace(3), serie, pesoKg: 5, idDepositoOrigen: 'Depósito CABA', ubicacion: 'CLIENTE', idCliente: '40001', estado: 'EN_USO', ...(prov ? { proveedor: prov } : {}) } });
  const v3 = await co2Validar(sql, admin, [alta('X0001', 'LINDE')]);
  si(codigos(v3).includes('PROVEEDOR_NO_CORRESPONDE'), 'a un cliente de GBA no va un cilindro de LINDE: ' + codigos(v3));
  r = await co2Guardar(sql, admin, [alta('X0001')]);
  igual(r.ok, true, 'inventario inicial en el cliente de GBA: ' + JSON.stringify(r.resultados && r.resultados.map((x) => x.errores)));
  igual(await uno(sql`select proveedor from co2_altas where serie = 'X0001'`), { proveedor: 'GN' }, 'toma el proveedor de la plaza del cliente');
  const ot = await validarLote(sql, carga, [{ clase: 'OT', datos: { fecha: hace(2), idCliente: '30001', tipo: 'ENTREGA_CO2', modalidadCo2: 'TRADICIONAL', co2: { entregadas: ['GN0001'] } } }]);
  si(ot.resultados[0].errores.some((e) => /trabaja con LINDE/.test(e.mensaje)), 'a un cliente de CABA no se le entrega un cilindro de GN: ' + JSON.stringify(ot.resultados[0].errores.map((e) => e.mensaje)));
  const f = await co2ValidarFactura(sql, { proveedor: 'GN', nroFactura: '0380-00012345', fecha: hace(1), lineas: [{ nroRemito: '0001-00000101', kg: 50 }] });
  igual([f.ok, f.lineas[0].resultado, f.lineas[0].kgSistema], [true, 'VALIDADO', 50], 'factura de GN: mismo número que una de LINDE y mira solo sus remitos (2 × 25 kg)');
  const sl = await co2Api(sql, consulta, 'apiSaldoLinde', [{}]);
  si(sl.filas.some((x) => x.proveedor === 'GN' && Number(x.pesoKg) === 25 && x.enPoder === 2 && x.depositoId === 'Depósito CABA'), 'saldo con GN en el Depósito CABA');
  const ini = await co2Api(sql, consulta, 'apiInicio', []);
  igual([ini.cargas.join(), ini.proveedores.map((p) => p.id).join(), ini.plazas.find((p) => p.id === 'GBA').proveedor], ['2.5,5,10,25', 'GN,LINDE', 'GN'], 'la pantalla recibe cargas, proveedores y el de cada plaza');
  igual((await co2Auditar(sql, admin)).corregidas, 0, 'la auditoría de CO₂ rearma el mismo proveedor');
});

await sql.end();
console.log(`Guardado en la base: ${ok} pruebas OK${fallas ? ', ' + fallas + ' con fallas' : ''}.`);
if (fallas) process.exit(1);
