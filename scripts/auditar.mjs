// Auditoría nocturna (la corre la tarea diaria): rearma equipos, stock y CO₂ desde el registro de operaciones,
// corrige las tablas de estado si alguien las tocó y anota los hallazgos en inconsistencias.
// Uso: DATABASE_URL=postgres://… node scripts/auditar.mjs
import postgres from 'postgres';
import { OPCIONES_POSTGRES, auditar } from '../supabase/functions/_compartido/estado.js';
import { co2Auditar } from '../supabase/functions/_compartido/co2_estado.js';

const sql = postgres(process.env.DATABASE_URL, { ...OPCIONES_POSTGRES, max: 1, prepare: false, onnotice: () => {} });
const sistema = { email: 'tarea-diaria', nombre: 'Tarea diaria', rol: 'ADMIN' };
try {
  const a = await auditar(sql, sistema);
  console.log('Equipos y stock: ' + a.operaciones + ' operaciones; tablas corregidas: ' + (a.corregidas.map((x) => x.tabla + ' (' + x.filas + ')').join(', ') || 'ninguna') + '; hallazgos nuevos: ' + a.nuevas);
  const c = await co2Auditar(sql, sistema);
  console.log('CO₂: ' + c.series + ' series, ' + c.movimientos + ' movimientos; corregidas: ' + c.corregidas + '; incoherencias nuevas: ' + c.nuevas + '; alertas nuevas: ' + c.alertas);
} finally { await sql.end(); }
