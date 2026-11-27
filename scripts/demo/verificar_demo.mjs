// Verifica una base de demo recién cargada: la auditoría no encuentra nada que corregir,
// y "Salir de la demo" (demo_restaurar) vuelve a la foto y se puede seguir cargando.
// Lo corre tests/db/probar.sh sobre una base de prueba.
import postgres from 'postgres';
import { OPCIONES_POSTGRES, usuarioPorEmail, guardarLote, auditar } from '../../supabase/functions/_compartido/estado.js';
import { co2Auditar } from '../../supabase/functions/_compartido/co2_estado.js';

const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL, { ...OPCIONES_POSTGRES, max: 2, onnotice: () => {} }) : postgres({ ...OPCIONES_POSTGRES, max: 2, onnotice: () => {} });
const yo = await usuarioPorEmail(sql, 'demo@fadefil.demo');
const fallas = [];
const n = async () => (await sql`select count(*)::int n from operaciones`)[0].n;
const a = await auditar(sql, yo);
if (a.corregidas.length) fallas.push('la auditoría corrigió: ' + JSON.stringify(a.corregidas));
const b = await co2Auditar(sql, yo);
if (b.corregidas) fallas.push('la auditoría de CO₂ corrigió ' + b.corregidas);
const neg = await sql`select deposito_id, codigo, disponible from stock where disponible < 0`;
if (neg.length) fallas.push('stock negativo: ' + JSON.stringify(neg));
await sql`select demo_guardar_base()`; // la auditoría anotó en inconsistencias: la foto queda limpia de nuevo
const antes = await n();
const hoy = (await sql`select to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') f`)[0].f;
const ajuste = [{ clase: 'AJUSTE', datos: { fecha: hoy, deposito: 'Depósito CABA', codigo: 'BOT', cantidad: 3, tipo: 'COMPRA', motivo: 'prueba' } }];
await guardarLote(sql, yo, ajuste, true);
await sql`select demo_restaurar()`;
if ((await n()) !== antes) fallas.push('demo_restaurar no volvió a la foto');
const r = await guardarLote(sql, yo, ajuste, true);
if (!r.ok) fallas.push('después de restaurar no se puede guardar');
const c = (await sql`select count(*)::int n from clientes`)[0].n;
await sql.end();
if (fallas.length) { console.error('Demo: ' + fallas.join('\n')); process.exit(1); }
console.log('Demo: ' + c + ' clientes, ' + antes + ' operaciones; auditoría sin correcciones; salir vuelve a la foto.');
