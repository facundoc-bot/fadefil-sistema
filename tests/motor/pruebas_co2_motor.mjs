// Corre las pruebas originales del motor de CO₂ (co2_Pruebas.gs de Sheets) contra el módulo co2_motor.js.
import * as motor from '../../supabase/functions/_compartido/co2_motor.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const silencioso = { log: () => {}, error: console.error };
const contexto = vm.createContext({ console: silencioso, JSON, Math, Date, Object, Array, String, Number, RegExp });
for (const [k, v] of Object.entries(motor)) contexto[k] = v;
vm.runInContext(readFileSync(new URL('./co2_Pruebas.gs', import.meta.url), 'utf8'), contexto);
const r = contexto.co2_ejecutarPruebas();
const fallidas = r.fallidas ?? r.fallas ?? 0;
if (fallidas) { console.error((r.detalle || []).filter((x) => String(x).startsWith('✗')).join('\n') || JSON.stringify(r)); process.exit(1); }
console.log(`Motor de CO₂: ${r.pasadas ?? r.ok} pruebas OK.`);
