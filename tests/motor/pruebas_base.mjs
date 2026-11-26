// Pruebas de punta a punta del guardado en la base (lo que hace la función del servidor "guardar").
// Corre contra un PostgreSQL de prueba con las migraciones aplicadas (lo arma tests/db/probar.sh).
import postgres from 'postgres';
import {
  OPCIONES_POSTGRES, ErrorDeUsuario, usuarioPorEmail, validarLote, guardarLote, anularOperacion, auditar, hoyArgentina
} from '../../supabase/functions/_compartido/estado.js';
import { sumarDias } from '../../supabase/functions/_compartido/motor.js';

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

await prueba('CO₂ en una OT: todavía no se guarda (etapa 2) y lo avisa', async () => {
  const r = await validarLote(sql, admin, [{ clase: 'OT', datos: { fecha: hace(5), idCliente: '10001', tipo: 'ENTREGA_CO2', modalidadCo2: 'TRADICIONAL', co2: { entregadas: ['K-1'] } } }]);
  si(codigos(r).includes('CO2_NO_DISPONIBLE'), 'avisa CO₂: ' + codigos(r));
});

await prueba('Alta inicial con cliente nuevo y máquina nueva desde CABA: envío, recepción y ajustes automáticos', async () => {
  const r = await guardarLote(sql, admin, [{ clase: 'OT', datos: { fecha: hace(60), tipo: 'ALTA_INICIAL', serieInstalada: 'm-9001', traerMaquina: true, maquinaNueva: { modelo: 'AQA 200' },
    fechaInstalacion: hace(400), sistema: 'PWG HP PRO', items: [{ codigo: 'BOT', cantidad: 2 }],
    clienteNuevo: { id: '10003', nombre: 'Café Tres', zonaId: 'Mendoza Centro', frecuencia: 60 } } }], true);
  igual(r.ok, true, 'se guarda: ' + JSON.stringify(r.resultados));
  igual(r.ids.length, 6, 'envío + recepción + 3 ajustes (botella, cartucho, cabezal) + la OT: ' + r.ids);
  igual(await uno(sql`select nombre_fantasia, frecuencia_mant_dias from clientes where cliente_id = '10003'`), { nombre_fantasia: 'Café Tres', frecuencia_mant_dias: 60 }, 'cliente dado de alta');
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

await sql.end();
console.log(`Guardado en la base: ${ok} pruebas OK${fallas ? ', ' + fallas + ' con fallas' : ''}.`);
if (fallas) process.exit(1);
