// Prueba de humo en Deno (el mismo entorno que la función del servidor): conecta con npm:postgres,
// arma el contexto y valida una operación. Corre después de pruebas_base.mjs, sobre la misma base.
import postgres from 'npm:postgres@3.4.7';
import { OPCIONES_POSTGRES, usuarioPorEmail, validarLote, hoyArgentina } from '../../supabase/functions/_compartido/estado.js';

const sql = postgres({ ...OPCIONES_POSTGRES, max: 1, onnotice: () => {} });
const u = await usuarioPorEmail(sql, 'facundoc@aqa.com.ar');
const r = await validarLote(sql, u, [{ clase: 'AJUSTE', datos: { fecha: hoyArgentina(), deposito: 'Depósito Mendoza', codigo: 'BOMBA', cantidad: 1, tipo: 'COMPRA' } }]);
await sql.end();
if (!r.ok) { console.error('✗ Deno: la validación falló', JSON.stringify(r)); Deno.exit(1); }
console.log('✓ Deno: la función del servidor conecta con la base y valida con el motor.');
