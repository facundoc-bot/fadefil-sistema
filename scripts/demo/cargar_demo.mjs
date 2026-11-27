// Carga los datos de ejemplo de la DEMO (empresa ficticia, datos inventados).
// Todo pasa por el motor de reglas, igual que en el sistema real: maestros, envíos, altas
// iniciales, instalaciones, mantenimientos Profundo/Express, reparaciones, revisiones,
// carritos, CO₂ con LINDE y Gases Nordelta, facturas.
// Se corre contra la base de la demo recién creada (sin datos) y al final guarda la "foto"
// que usa "Salir de la demo" para volver a este punto (demo_guardar_base()).
//
//   DATABASE_URL=postgres://… node scripts/demo/cargar_demo.mjs
//
// NUNCA contra la base real: se niega si la base no tiene la marca de demo (supabase/demo/demo.sql).
import postgres from 'postgres';
import { OPCIONES_POSTGRES, usuarioPorEmail, guardarLote, hoyArgentina } from '../../supabase/functions/_compartido/estado.js';
import { co2Guardar, co2GuardarFactura } from '../../supabase/functions/_compartido/co2_estado.js';
import { sumarDias } from '../../supabase/functions/_compartido/motor.js';

const opciones = { ...OPCIONES_POSTGRES, max: 2, onnotice: () => {}, prepare: false };
const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL, opciones) : postgres(opciones);
const hoy = hoyArgentina();
const hace = (n) => sumarDias(hoy, -n);

// Números "al azar" pero siempre iguales (la demo sale idéntica cada vez).
let semilla = 20261127;
const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
const elegir = (lista) => lista[Math.floor(azar() * lista.length)];

async function paso(nombre, fn) {
  const t = Date.now();
  await fn();
  console.log('✓ ' + nombre + ' (' + ((Date.now() - t) / 1000).toFixed(1) + ' s)');
}
function revisar(r, nombre) {
  if (r && r.ok) return r;
  const errores = ((r && r.resultados) || []).flatMap((x, i) => (x.errores || []).map((e) => '  op ' + i + ': ' + e.codigo + ' — ' + e.mensaje));
  throw new Error(nombre + ': no se guardó.\n' + (errores.join('\n') || JSON.stringify(r).slice(0, 2000)));
}
/** guardarLote acepta hasta 50 operaciones por vez: se guardan en tandas, en orden. */
async function guardarEnTandas(ops, nombre) {
  const ids = [];
  for (let i = 0; i < ops.length; i += 50) ids.push(...revisar(await guardarLote(sql, yo, ops.slice(i, i + 50), true), nombre + ' (tanda ' + (i / 50 + 1) + ')').ids);
  return ids;
}
const ordenar = (ops) => ops.sort((a, b) => (a.datos.fecha < b.datos.fecha ? -1 : a.datos.fecha > b.datos.fecha ? 1 : 0));

// ---------------------------------------------------------------- seguridad: solo en la demo
const marca = await sql`select valor from config where clave = 'DEMO'`;
if (!marca.length || marca[0].valor !== 'SI') {
  console.error('Esta base no es la de la demo (falta config DEMO = SI). No se carga nada.');
  process.exit(1);
}
if ((await sql`select count(*)::int n from operaciones`)[0].n > 0) {
  console.error('La base de la demo ya tiene operaciones: se carga solo sobre una base recién creada.');
  process.exit(1);
}
const yo = await usuarioPorEmail(sql, 'demo@fadefil.demo');

// ---------------------------------------------------------------- maestros
const PLAZAS = [
  { plaza: 'Córdoba', region: 'INTERIOR', dep: 'Depósito Córdoba', prov: 'Córdoba', resp: 'Lucía Paz', zonas: ['Nueva Córdoba', 'Cerro de las Rosas', 'General Paz'] },
  { plaza: 'Rosario', region: 'INTERIOR', dep: 'Depósito Rosario', prov: 'Santa Fe', resp: 'Matías Rinaldi', zonas: ['Rosario Centro', 'Fisherton'] },
  { plaza: 'Mendoza', region: 'INTERIOR', dep: 'Depósito Mendoza', prov: 'Mendoza', resp: 'Carla Funes', zonas: ['Mendoza Centro', 'Godoy Cruz'] }
];
const ZONAS_AMBA = { CABA: ['Palermo', 'Belgrano', 'Microcentro', 'Recoleta', 'Puerto Madero'], GBA: ['San Isidro', 'Vicente López', 'Tigre', 'Pilar'] };
const TECNICOS = { CABA: ['Martín Gómez', 'Nicolás Vera'], GBA: ['Diego Ruiz'], 'Córdoba': ['Lucas Ferreyra'], Rosario: ['Pablo Medina'], Mendoza: ['Sofía Aguirre'] };
const MODELOS = [['AQA Pure 200', 'AQA'], ['AQA Pure 400', 'AQA'], ['Hielogic Ice 50', 'Hielogic'], ['Office 3E', 'Office']];
const CATALOGO = [['BOT', 'Botella de vidrio 1 L', 'ADICIONAL'], ['VASO', 'Vaso térmico', 'ADICIONAL'], ['CANI', 'Canilla extra', 'ADICIONAL'],
  ['MANG', 'Manguera de conexión', 'INSUMO'], ['KITC', 'Kit de conexión', 'INSUMO'], ['BOMBA', 'Bomba de agua', 'REPUESTO'], ['FRENTE', 'Frente de equipo', 'REPUESTO']];

const NOMBRES = {
  Palermo: ['Café Plaza Serrano', 'Estudio Creativo Soho', 'Gimnasio Fit Palermo'], Belgrano: ['Clínica Odontológica Juramento', 'Colegio Bilingüe Belgrano'],
  Microcentro: ['Estudio Jurídico Florida', 'Agencia de Viajes Lavalle', 'Consultora Diagonal'], Recoleta: ['Hotel Boutique Alvear', 'Restaurante La Recova'],
  'Puerto Madero': ['Oficinas Dique 3', 'Parrilla del Dique'],
  'San Isidro': ['Club Náutico San Isidro', 'Panadería Martínez'], 'Vicente López': ['Laboratorio Olivos', 'Escuela de Música Libertador'],
  Tigre: ['Hostería del Delta', 'Kayak Club Tigre'], Pilar: ['Country Office Pilar', 'Cervecería Artesanal Pilar'],
  'Nueva Córdoba': ['Coworking Nueva Córdoba', 'Heladería Buen Pastor'], 'Cerro de las Rosas': ['Clínica del Cerro', 'Bar Rafael Núñez'], 'General Paz': ['Taller Mecánico General Paz'],
  'Rosario Centro': ['Estudio Contable Córdoba 1200', 'Café del Monumento', 'Gimnasio Oroño'], Fisherton: ['Colegio Fisherton'],
  'Mendoza Centro': ['Bodega Urbana Arístides', 'Hotel Peatonal Sarmiento'], 'Godoy Cruz': ['Fábrica de Pastas Godoy Cruz', 'Oficinas Palmares']
};
const SECTORES = ['Gastronomía', 'Oficina', 'Salud', 'Educación', 'Hotelería', 'Deporte', 'Industria'];

const clientes = []; // { id, nombre, zona, plaza, dep, tipo, alta: bool }
await paso('Maestros: plazas, zonas, depósitos, técnicos, modelos, catálogo, clientes, máquinas', async () => {
  for (const p of PLAZAS) {
    await sql`insert into depositos (deposito_id, direccion, controla_stock) values (${p.dep}, ${'Calle Falsa ' + entre(100, 999) + ', ' + p.plaza}, true)`;
    await sql`insert into plazas (plaza_id, region_id, deposito_id, provincia, responsable) values (${p.plaza}, ${p.region}, ${p.dep}, ${p.prov}, ${p.resp})`;
    for (const z of p.zonas) await sql`insert into zonas (zona_id, plaza_id) values (${z}, ${p.plaza})`;
  }
  for (const [plaza, zs] of Object.entries(ZONAS_AMBA)) for (const z of zs) await sql`insert into zonas (zona_id, plaza_id) values (${z}, ${plaza})`;
  await sql`update plazas set responsable = 'Andrea Sosa' where plaza_id in ('CABA', 'GBA')`;
  for (const [plaza, ts] of Object.entries(TECNICOS)) for (const t of ts) await sql`insert into tecnicos (tecnico_id, plaza_id) values (${t}, ${plaza})`;
  for (const [m, l] of MODELOS) await sql`insert into modelos (modelo, linea) values (${m}, ${l})`;
  for (const [c, d, cat] of CATALOGO) await sql`insert into catalogo (codigo, descripcion, categoria) values (${c}, ${d}, ${cat}) on conflict (codigo) do nothing`;
  await sql`insert into co2_depositos (deposito_id, plaza_linde) values ('Depósito CABA', 'CAPITAL FEDERAL'), ('Depósito Córdoba', 'CORDOBA') on conflict do nothing`;
  await sql`insert into usuarios (email, nombre, rol) values ('carga@empresa-demo.com', 'Operador de carga (demo)', 'CARGA'), ('consulta@empresa-demo.com', 'Consulta (demo)', 'CONSULTA') on conflict do nothing`;

  const plazaDeZona = {};
  for (const p of PLAZAS) for (const z of p.zonas) plazaDeZona[z] = p;
  for (const z of ZONAS_AMBA.CABA) plazaDeZona[z] = { plaza: 'CABA', dep: 'Depósito CABA' };
  for (const z of ZONAS_AMBA.GBA) plazaDeZona[z] = { plaza: 'GBA', dep: 'Depósito CABA' };
  let id = 50001;
  for (const [zona, nombres] of Object.entries(NOMBRES)) {
    for (const nombre of nombres) {
      const p = plazaDeZona[zona];
      const tipo = /Café|Bar|Restaurante|Parrilla|Cervecería|Heladería|Hostería|Hotel|Bodega/.test(nombre) && azar() < 0.6 ? 'Hielogic' : (/Oficinas|Estudio|Consultora|Agencia|Coworking|Office/.test(nombre) ? 'Office' : 'AQA');
      const c = { id: String(id++), nombre, zona, plaza: p.plaza, dep: p.dep, tipo };
      clientes.push(c);
      await sql`insert into clientes (cliente_id, nombre_fantasia, razon_social_cuit, sector, tipo_cliente, modalidad, zona_id)
        values (${c.id}, ${nombre}, ${nombre.toUpperCase() + ' S.R.L. · 30-' + entre(50000000, 79999999) + '-' + entre(1, 9)}, ${elegir(SECTORES)}, ${tipo},
          ${tipo === 'Office' ? 'Venta con fee' : elegir(['Comodato', 'Comodato', 'Venta sin fee'])}, ${zona})`;
    }
  }
  // Un esquema de mantenimiento propio (cliente de mucho uso): Profundo cada 2 meses.
  await sql`update clientes set esquema_mant = '-;P;-;P;-;P' where nombre_fantasia = 'Gimnasio Fit Palermo'`;
  // Máquinas: todas entran por el depósito central.
  let n = 1;
  for (const [modelo, cant] of [['AQA Pure 200', 22], ['AQA Pure 400', 10], ['Hielogic Ice 50', 12], ['Office 3E', 10]]) {
    for (let i = 0; i < cant; i++) {
      await sql`insert into maquinas (serie, modelo, fecha_alta, deposito_inicial_id) values (${'AQ-' + (25000 + n++)}, ${modelo}, ${hace(330)}, 'Depósito CABA')`;
    }
  }
});

// Máquinas por modelo, disponibles para asignar (se van sacando).
const libres = {};
for (const r of await sql`select serie, modelo from maquinas order by serie`) (libres[r.modelo] = libres[r.modelo] || []).push(r.serie);
const modeloDe = (c) => (c.tipo === 'Hielogic' ? 'Hielogic Ice 50' : c.tipo === 'Office' ? 'Office 3E' : elegir(['AQA Pure 200', 'AQA Pure 200', 'AQA Pure 400']));
const sistemaDe = (c, modelo) => (modelo === 'Office 3E' ? '3 ETAPAS OFFICE' : modelo === 'Hielogic Ice 50' ? 'PWG HP PRO' : elegir(['4 Etapas', '4 Etapas', 'PWG HP PRO R']));
const tecnicoDe = (c) => elegir(TECNICOS[c.plaza]);

// Reparto: los primeros de cada zona ya estaban instalados antes del sistema (alta inicial), el resto se instala.
const yaInstalados = [], aInstalar = [];
const vistos = {};
for (const c of clientes) { vistos[c.zona] = (vistos[c.zona] || 0) + 1; (vistos[c.zona] === 1 ? yaInstalados : aInstalar).push(c); }
for (const c of clientes) { c.modelo = modeloDe(c); c.serie = libres[c.modelo].shift(); c.sistema = sistemaDe(c, c.modelo); }

// ---------------------------------------------------------------- stock inicial y envíos a las plazas
await paso('Compras en el central y envíos a Córdoba, Rosario y Mendoza (con recepción)', async () => {
  const compras = [['F4E', 60], ['PWGR', 30], ['PWG', 40], ['F3EO', 30], ['SED1', 120], ['CGRA', 80], ['CBLO', 80], ['MIN', 50], ['CAB', 40],
    ['BOT', 400], ['VASO', 200], ['CANI', 40], ['MANG', 150], ['KITC', 80], ['BOMBA', 15], ['FRENTE', 12], ['TANQ', 10]];
  revisar(await guardarLote(sql, yo, compras.map(([codigo, cantidad]) => ({ clase: 'AJUSTE', datos: { fecha: hace(320), deposito: 'Depósito CABA', codigo, cantidad, tipo: 'COMPRA', motivo: 'Compra inicial (demo)' } })), true), 'compras');
  const envios = PLAZAS.map((p) => ({ clase: 'ENVIO', datos: { fecha: hace(312), origen: 'Depósito CABA', destino: p.dep, transporte: elegir(['Vía Cargo', 'Andreani', 'Cruz del Sur']),
    guia: 'G-' + entre(100000, 999999),
    series: clientes.filter((c) => c.dep === p.dep).map((c) => c.serie).concat(libres['AQA Pure 200'].splice(0, 1)),
    items: [['F4E', 10], ['PWGR', 5], ['PWG', 4], ['F3EO', 4], ['SED1', 20], ['CGRA', 12], ['CBLO', 12], ['MIN', 8], ['CAB', 6], ['BOT', 60], ['VASO', 30], ['MANG', 25], ['KITC', 15], ['FRENTE', 2], ['BOMBA', 2], ['TANQ', 1]]
      .map(([codigo, cantidad]) => ({ codigo, cantidad })) } }));
  const r = revisar(await guardarLote(sql, yo, envios, true), 'envíos');
  revisar(await guardarLote(sql, yo, r.ids.map((id) => ({ clase: 'RECEPCION', datos: { fecha: hace(306), idEnvio: id } })), true), 'recepciones');
});

// ---------------------------------------------------------------- CO₂: remitos iniciales (las entregas van con las OT)
let nRem = 4100;
const remito = (fecha, dep, prov, entregas, retiros = []) => ({ clase: 'REMITO', datos: { nroRemito: (prov === 'GN' ? '0003-' : '0511-') + String(nRem++).padStart(8, '0'), fecha, idDeposito: dep, proveedor: prov,
  origenCarga: 'MANUAL', tipoCopia: 'ORIGINAL', lineas: entregas.map(([serie, pesoKg]) => ({ tipo: 'ENTREGA', serie, pesoKg })).concat(retiros.map((serie) => ({ tipo: 'RETIRO', serie }))) } });
const serieCil = (pref, n) => pref + String(n).padStart(6, '0');
const lindeCaba = Array.from({ length: 16 }, (_, i) => [serieCil('LN', 310001 + i), i < 10 ? 10 : 5]);
const gnCaba = Array.from({ length: 8 }, (_, i) => [serieCil('GN', 70001 + i), 10]);
const lindeCba = Array.from({ length: 6 }, (_, i) => [serieCil('LN', 420001 + i), 10]);
let remitosIniciales;
await paso('CO₂: remitos de LINDE (CABA y Córdoba) y de Gases Nordelta (para GBA)', async () => {
  await sql`update co2_config set valor = '5; 10' where clave = 'CARGAS_KG'`;
  remitosIniciales = revisar(await co2Guardar(sql, yo, [remito(hace(200), 'Depósito CABA', 'LINDE', lindeCaba), remito(hace(199), 'Depósito CABA', 'GN', gnCaba),
    remito(hace(198), 'Depósito Córdoba', 'LINDE', lindeCba)]), 'remitos');
});

// ---------------------------------------------------------------- OT: altas iniciales, instalaciones, mantenimientos, reparaciones
await paso('OT de un año: altas iniciales, instalaciones, mantenimientos Profundo/Express, reparaciones y bajas', async () => {
  const ops = [];
  const ot = (fecha, c, tipo, extra = {}) => ops.push({ clase: 'OT', datos: { fecha, idCliente: c.id, tipo, tecnico: tecnicoDe(c), ...extra } });
  const items = (c) => c.tipo === 'Office' ? [{ codigo: 'VASO', cantidad: 6 }] : [{ codigo: 'BOT', cantidad: entre(4, 12) }, { codigo: 'KITC', cantidad: 1 }];
  // Altas iniciales (clientes de antes del sistema).
  for (const c of yaInstalados) {
    ot(hace(300), c, 'ALTA_INICIAL', { serieInstalada: c.serie, sistema: c.sistema, fechaInstalacion: hace(entre(420, 900)), fechaBase: hace(entre(330, 380)), items: items(c) });
    c.desde = hace(300);
  }
  // Instalaciones a lo largo del año.
  aInstalar.forEach((c, i) => {
    const f = hace(280 - Math.floor(i * 250 / aInstalar.length));
    ot(f, c, 'INSTALACION', { serieInstalada: c.serie, sistema: c.sistema, items: items(c).concat([{ codigo: 'MANG', cantidad: 1 }]), nOtPersat: 'P-' + entre(40000, 49999) });
    c.desde = f;
  });
  // Mantenimientos según el esquema por defecto (Express al mes 3, Profundo al 6), algunos atrasados.
  for (const c of clientes) {
    let f = c.desde, k = 0;
    while (true) {
      const atraso = entre(-5, 25);
      const prox = sumarDias(f, (c.nombre === 'Gimnasio Fit Palermo' ? 60 : 91) + atraso);
      if (prox > hace(4) || (azar() < 0.12 && prox > hace(60))) break; // algunos quedan vencidos o por vencer
      k++;
      const tipoMant = c.nombre === 'Gimnasio Fit Palermo' ? 'PROFUNDO' : (k % 2 === 1 ? 'EXPRESS' : 'PROFUNDO');
      ot(prox, c, 'MANTENIMIENTO', { tipoMant, items: tipoMant === 'PROFUNDO' && c.sistema === '4 Etapas' ? [{ codigo: 'SED1', cantidad: 1 }, { codigo: 'CGRA', cantidad: 1 }, { codigo: 'CBLO', cantidad: 1 }] : [] });
      f = prox;
    }
    c.ultimo = f;
  }
  // Reparaciones, un backup, una desinstalación momentánea y dos bajas con retiro a revisión.
  const activos = clientes.filter((c) => c.ultimo < hace(30));
  for (const c of activos.slice(0, 6)) ot(sumarDias(c.ultimo, 9), c, 'REPARACION', { falla: elegir(['Pierde agua por la canilla', 'No enfría', 'Ruido en la bomba', 'Gotea la bandeja']),
    items: [{ codigo: elegir(['FRENTE', 'BOMBA', 'TANQ']), cantidad: 1 }] });
  const conBackup = clientes.find((c) => c.plaza === 'CABA' && c.ultimo < hace(40) && c.modelo === 'AQA Pure 200' && !activos.slice(0, 6).includes(c));
  if (conBackup) { ot(sumarDias(conBackup.ultimo, 12), conBackup, 'REPARACION_BACKUP', { serieRetirada: conBackup.serie, serieInstalada: libres['AQA Pure 200'].shift(), falla: 'No enciende' }); }
  const bajas = clientes.filter((c) => c.plaza === 'Mendoza' && c.ultimo < hace(25)).slice(0, 1).concat(clientes.filter((c) => c.plaza === 'Córdoba' && c.ultimo < hace(25) && c.tipo !== 'AQA').slice(0, 1));
  const baja0 = bajas;
  for (const c of bajas) ot(sumarDias(c.ultimo, 15), c, 'DESINSTALACION', { serieRetirada: c.serie, items: c.tipo === 'Office' ? [{ codigo: 'VASO', cantidad: 6, mov: 'RETIRADO' }] : [{ codigo: 'BOT', cantidad: 4, mov: 'RETIRADO' }] });
  const pausa = clientes.find((c) => c.plaza === 'Rosario' && c.ultimo < hace(25));
  if (pausa) ot(sumarDias(pausa.ultimo, 10), pausa, 'DESINSTALACION_MOMENTANEA', { serieRetirada: pausa.serie, comentarios: 'Cierre por refacción del local' });
  // CO₂: clientes AQA (los Hielogic no reciben CO₂) de CABA, GBA y Córdoba; cada plaza con su proveedor.
  const co2Cli = clientes.filter((c) => ['CABA', 'GBA', 'Córdoba'].includes(c.plaza) && c.tipo === 'AQA' && c.desde < hace(190) && !baja0.includes(c)).slice(0, 8);
  const pool = { CABA: lindeCaba.map((x) => x[0]), GBA: gnCaba.map((x) => x[0]), 'Córdoba': lindeCba.map((x) => x[0]) };
  co2Cli.forEach((c, i) => {
    const s1 = pool[c.plaza].shift();
    if (!s1) return;
    ot(hace(150 + i * 4), c, 'ENTREGA_CO2', { modalidadCo2: 'TRADICIONAL', co2: { entregadas: [s1] } });
    const s2 = i < 5 ? pool[c.plaza].shift() : null;
    if (s2) ot(hace(70 + i * 5), c, 'ENTREGA_CO2', { modalidadCo2: i === 2 ? 'EMERGENCIA_CON_COSTO' : 'TRADICIONAL', co2: { entregadas: [s2], retiradas: [s1] } });
  });
  // Entrega de adicionales a algunos.
  for (const c of clientes.filter((x) => x.tipo !== 'Office').slice(0, 5)) ot(hace(entre(15, 45)), c, 'ENTREGA_ADICIONALES', { items: [{ codigo: 'BOT', cantidad: 6 }] });
  ordenar(ops);
  // Que una entrega de adicionales no caiga después de una baja del mismo cliente.
  const baja = {};
  ops.forEach((o) => { if (/DESINSTALACION/.test(o.datos.tipo)) baja[o.datos.idCliente] = o.datos.fecha; });
  const finales = ops.filter((o) => !(baja[o.datos.idCliente] && o.datos.fecha > baja[o.datos.idCliente]));
  await guardarEnTandas(finales, 'OT');
  console.log('   ' + finales.length + ' OT');
});

// ---------------------------------------------------------------- revisiones en las plazas y carritos
await paso('Revisiones (una reparada, una "Enviar a CABA" que entra sola al carrito) y carritos', async () => {
  const abiertas = await sql`select serie, deposito_id from taller where estado = 'ABIERTO' order by serie`;
  const cierres = abiertas.map((t, i) => ({ clase: 'CIERRE', datos: i === 0
    ? { fecha: hace(3), serie: t.serie, resultado: 'ENVIAR_CABA', diagnostico: 'Compresor con pérdida de gas' }
    : { fecha: hace(3), serie: t.serie, resultado: 'REPARADA', diagnostico: 'Cambio de bomba', items: [{ codigo: 'BOMBA', cantidad: 1 }] } }));
  if (cierres.length > 1) cierres.pop(); // una queda abierta, para mostrar el taller
  if (cierres.length) revisar(await guardarLote(sql, yo, cierres, true), 'revisiones');
  // Carrito armándose en el central hacia Córdoba (queda reservado) y un envío en camino a Rosario.
  revisar(await guardarLote(sql, yo, [
    { clase: 'CARRITO', datos: { fecha: hace(2), origen: 'Depósito CABA', destino: 'Depósito Córdoba', accion: 'AGREGAR', items: [{ codigo: 'F4E', cantidad: 6 }, { codigo: 'BOT', cantidad: 48 }, { codigo: 'SED1', cantidad: 12 }], series: libres['AQA Pure 400'].splice(0, 1) } },
    { clase: 'CARRITO', datos: { fecha: hace(1), origen: 'Depósito CABA', destino: 'Depósito Córdoba', accion: 'AGREGAR', items: [{ codigo: 'VASO', cantidad: 24 }] } },
    { clase: 'ENVIO', datos: { fecha: hace(2), origen: 'Depósito CABA', destino: 'Depósito Rosario', transporte: 'Vía Cargo', guia: 'G-' + entre(100000, 999999),
      items: [{ codigo: 'PWGR', cantidad: 4 }, { codigo: 'MANG', cantidad: 10 }], series: libres['Hielogic Ice 50'].splice(0, 1) } }
  ], true), 'carritos');
});

// ---------------------------------------------------------------- CO₂
await paso('CO₂: LINDE retira los vacíos del central y trae llenos; factura de LINDE', async () => {
  const vaciosLinde = (await sql`select serie from co2_cilindros where estado = 'VACIO_DISPONIBLE' and ubicacion_id = 'Depósito CABA' and proveedor = 'LINDE' order by serie`).map((x) => x.serie);
  const nuevos = Array.from({ length: 6 }, (_, i) => [serieCil('LN', 310101 + i), 10]);
  revisar(await co2Guardar(sql, yo, [remito(hace(40), 'Depósito CABA', 'LINDE', nuevos, vaciosLinde)]), 'remito con retiros');
  // Factura de LINDE del primer remito de CABA (10 × 10 kg + 6 × 5 kg = 130 kg).
  const nroRem1 = (await sql`select nro_remito from co2_remitos where remito_id = ${remitosIniciales.ids[0]}`)[0].nro_remito;
  const f = await co2GuardarFactura(sql, yo, { proveedor: 'LINDE', nroFactura: '0511-00098765', fecha: hace(170), lineas: [{ nroRemito: nroRem1, fechaRemito: hace(200), kg: 130 }] });
  if (!f || f.ok === false) throw new Error('factura: ' + JSON.stringify(f).slice(0, 500));
});

// ---------------------------------------------------------------- foto para "Salir de la demo"
await paso('Foto de la demo (para volver a este punto al salir)', async () => {
  await sql`select demo_guardar_base()`;
});
const n = (await sql`select count(*)::int n from operaciones`)[0].n;
console.log('Demo cargada: ' + clientes.length + ' clientes, ' + n + ' operaciones.');
await sql.end();
